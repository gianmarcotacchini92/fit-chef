import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  defaultBodyProfile, estimateTdee, profileSchema, proposeTargets, type BodyProfile,
} from "../src/lib/nutrition-profile";

function makeProfile(overrides: Partial<BodyProfile> = {}): BodyProfile {
  return { ...defaultBodyProfile(), age: 30, sex: "male", heightCm: 180, weightKg: 80, activity: 1.375, ...overrides };
}

test("Mifflin-St Jeor formula matches the exact reference equation for both sexes", () => {
  const male = makeProfile({ sex: "male", age: 30, heightCm: 180, weightKg: 80, bmrMethod: "mifflin" });
  const female = makeProfile({ sex: "female", age: 30, heightCm: 165, weightKg: 60, bmrMethod: "mifflin" });
  const maleBmr = 10 * 80 + 6.25 * 180 - 5 * 30 + 5;
  const femaleBmr = 10 * 60 + 6.25 * 165 - 5 * 30 - 161;
  assert.equal(estimateTdee(male).bmr, Math.round(maleBmr * 100) / 100);
  assert.equal(estimateTdee(female).bmr, Math.round(femaleBmr * 100) / 100);
  assert.equal(estimateTdee(male).tdee, Math.round(maleBmr * 1.375 * 100) / 100);
});

test("selecting measured BMR overrides any formula and uses the declared value exactly", () => {
  const profile = makeProfile({ bmrMethod: "measured", measuredBmr: 1850, activity: 1.2 });
  const result = estimateTdee(profile);
  assert.equal(result.bmr, 1850);
  assert.equal(result.method, "measured");
  assert.equal(result.tdee, 1850 * 1.2);
  assert.ok(result.warnings.some((warning) => /dispositiv|strumento/i.test(warning)), "should warn about measurement device variability");
});

test("measured method without a measured BMR value is rejected, not silently defaulted to a formula", () => {
  const profile = makeProfile({ bmrMethod: "measured", measuredBmr: null });
  assert.throws(() => estimateTdee(profile));
  assert.throws(() => profileSchema.parse(profile));
});

test("lean-mass (Katch-McArdle) BMR can be derived from body fat percent or supplied lean mass directly, consistently", () => {
  const fromBodyFat = makeProfile({ bmrMethod: "lean", weightKg: 80, bodyFatPercent: 20, leanMassKg: 64 });
  const fromLeanMass = makeProfile({ bmrMethod: "lean", weightKg: 80, bodyFatPercent: null, leanMassKg: 64 });
  assert.equal(estimateTdee(fromBodyFat).bmr, estimateTdee(fromLeanMass).bmr);
  assert.equal(estimateTdee(fromLeanMass).bmr, Math.round((370 + 21.6 * 64) * 100) / 100);
});

test("lean method without any lean-mass source (no leanMassKg and no bodyFatPercent) is rejected", () => {
  const profile = makeProfile({ bmrMethod: "lean", leanMassKg: null, bodyFatPercent: null });
  assert.throws(() => estimateTdee(profile));
  assert.throws(() => profileSchema.parse(profile));
});

test("inconsistent body fat percent and lean mass combination fails validation instead of being silently reconciled", () => {
  const profile = makeProfile({ weightKg: 80, bodyFatPercent: 10, leanMassKg: 40 });
  assert.throws(() => profileSchema.parse(profile));
});

test("lean mass equal to or exceeding total body weight is rejected", () => {
  const profile = makeProfile({ weightKg: 70, leanMassKg: 70, bodyFatPercent: null });
  assert.throws(() => profileSchema.parse(profile));
});

test("visceral fat score is accepted but never multiplies or otherwise alters the TDEE computation", () => {
  const withVisceral = makeProfile({ visceralFat: 15 });
  const withoutVisceral = makeProfile({ visceralFat: null });
  const withHighVisceral = makeProfile({ visceralFat: 58 });
  assert.equal(estimateTdee(withVisceral).tdee, estimateTdee(withoutVisceral).tdee);
  assert.equal(estimateTdee(withHighVisceral).tdee, estimateTdee(withoutVisceral).tdee);
});

test("22 percent body fat and 58.4 kg muscle are independent, with lean mass derived from fat", () => {
  const profile = makeProfile({ weightKg: 80, bodyFatPercent: 22, muscleMassKg: 58.4, leanMassKg: null, bmrMethod: "lean" });
  assert.doesNotThrow(() => profileSchema.parse(profile));
  assert.equal(estimateTdee(profile).bmr, 1717.84);
  assert.deepEqual(estimateTdee(profile), estimateTdee({ ...profile, muscleMassKg: 50 }));
  assert.equal(proposeTargets(profile).kcal, proposeTargets({ ...profile, muscleMassKg: null }).kcal);
});

test("muscle measurements are optional for legacy profiles, bounded, and cannot replace a missing fat percentage", () => {
  const legacy = makeProfile();
  delete legacy.muscleMassKg;
  assert.deepEqual(profileSchema.parse(legacy), legacy);
  for (const muscleMassKg of [0, -1, 80, NaN, Infinity]) {
    assert.equal(profileSchema.safeParse({ ...legacy, muscleMassKg }).success, false);
  }
  assert.throws(() => estimateTdee({ ...legacy, bmrMethod: "lean", muscleMassKg: 58.4, leanMassKg: null, bodyFatPercent: null }));
});

test("goal adjustment and macro proposal use exact 4/4/9 kcal accounting", () => {
  const profile = makeProfile({
    sex: "male", age: 30, heightCm: 180, weightKg: 80, activity: 1.2, bmrMethod: "mifflin",
    goal: "cut", adjustmentPercent: -10,
  });
  const { tdee } = estimateTdee(profile);
  const targets = proposeTargets(profile);
  const expectedKcal = Math.round(tdee * 0.9);
  const expectedProtein = Math.round(1.8 * 80 * 10) / 10;
  const expectedFat = Math.round(0.8 * 80 * 10) / 10;
  const expectedCarbs = Math.round(((expectedKcal - expectedProtein * 4 - expectedFat * 9) / 4) * 10) / 10;
  assert.equal(targets.kcal, expectedKcal);
  assert.equal(targets.protein, expectedProtein);
  assert.equal(targets.fat, expectedFat);
  assert.equal(targets.carbs, expectedCarbs);
  assert.equal(Math.round(targets.protein * 4 + targets.carbs * 4 + targets.fat * 9), targets.kcal);
});

test("maintain and recomp goals use 1.6 g/kg protein while cut and surplus use 1.8 g/kg", () => {
  const maintain = proposeTargets(makeProfile({ goal: "maintain", adjustmentPercent: 0, weightKg: 70 }));
  const recomp = proposeTargets(makeProfile({ goal: "recomp", adjustmentPercent: 0, weightKg: 70 }));
  const cut = proposeTargets(makeProfile({ goal: "cut", adjustmentPercent: -10, weightKg: 70 }));
  assert.equal(maintain.protein, 112);
  assert.equal(recomp.protein, 112);
  assert.equal(cut.protein, Math.round(1.8 * 70 * 10) / 10);
});

test("a proposal that would require negative carbohydrates throws instead of fabricating a result", () => {
  const profile = makeProfile({
    sex: "female", age: 60, heightCm: 150, weightKg: 100, activity: 1.2, bmrMethod: "mifflin",
    goal: "cut", adjustmentPercent: -20,
  });
  assert.throws(() => proposeTargets(profile), /superano|negativ/i);
});

test("an aggressively low resulting calorie target produces an explicit low-calorie warning", () => {
  const profile = makeProfile({
    sex: "female", age: 45, heightCm: 150, weightKg: 45, activity: 1.2, bmrMethod: "mifflin",
    goal: "maintain", adjustmentPercent: -20,
  });
  const result = estimateTdee(profile);
  assert.ok(result.warnings.some((warning) => /molto basso.*soglia universale/i.test(warning)));
});

test("under-18 ages are rejected: this domain only supports adult profiles", () => {
  const profile = makeProfile({ age: 17 });
  assert.throws(() => profileSchema.parse(profile));
});

test("activity factor must be one of the defined standard multipliers, not an arbitrary custom number", () => {
  const profile = makeProfile({ activity: 1.3 as BodyProfile["activity"] });
  assert.throws(() => profileSchema.parse(profile));
});

test("default draft profile is a sensible placeholder that validates on its own", () => {
  const profile = defaultBodyProfile();
  assert.doesNotThrow(() => profileSchema.parse(profile));
  assert.equal(profile.goal, "maintain");
  assert.equal(profile.adjustmentPercent, 0);
});
test("implausible measured BMR (far from the formula estimate) is rejected; a moderate gap only warns", () => {
  assert.throws(() => profileSchema.parse(makeProfile({ bmrMethod: "measured", measuredBmr: 5000 })));
  assert.throws(() => profileSchema.parse(makeProfile({ bmrMethod: "measured", measuredBmr: 700 })));
  const warned = estimateTdee(makeProfile({ bmrMethod: "measured", measuredBmr: 2400 }));
  assert.ok(warned.warnings.some((warning) => /oltre il 25%/.test(warning)));
  const close = estimateTdee(makeProfile({ bmrMethod: "measured", measuredBmr: 1800 }));
  assert.ok(!close.warnings.some((warning) => /oltre il 25%/.test(warning)));
});

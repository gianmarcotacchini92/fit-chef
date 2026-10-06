import { z } from "zod";

export type BodyProfile = {
  age: number;
  sex: "male" | "female";
  heightCm: number;
  weightKg: number;
  bodyFatPercent: number | null;
  leanMassKg: number | null;
  muscleMassKg?: number | null;
  visceralFat: number | null;
  measuredBmr: number | null;
  bmrMethod: "mifflin" | "lean" | "measured";
  activity: number;
  goal: "cut" | "recomp" | "maintain" | "surplus";
  adjustmentPercent: number;
};

export type MacroTargets = {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

/** Standard Harris/Mifflin activity multipliers; no custom factors are accepted. */
export const ACTIVITY_FACTORS = [1.2, 1.375, 1.55, 1.725, 1.9] as const;

const finite = (min: number, max: number) => z.number().finite().min(min).max(max);

function mifflinBmr(profile: Pick<BodyProfile, "sex" | "weightKg" | "heightCm" | "age">): number {
  const base = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age;
  return profile.sex === "male" ? base + 5 : base - 161;
}

export const profileSchema = z.strictObject({
  age: z.number().int().min(18).max(100),
  sex: z.enum(["male", "female"]),
  heightCm: finite(100, 230),
  weightKg: finite(30, 300),
  bodyFatPercent: finite(2, 70).nullable(),
  leanMassKg: finite(10, 250).nullable(),
  muscleMassKg: finite(0.1, 250).nullable().optional(),
  visceralFat: finite(1, 59).nullable(),
  measuredBmr: finite(400, 6000).nullable(),
  bmrMethod: z.enum(["mifflin", "lean", "measured"]),
  activity: z.union(ACTIVITY_FACTORS.map((value) => z.literal(value)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]),
  goal: z.enum(["cut", "recomp", "maintain", "surplus"]),
  adjustmentPercent: z.number().finite().min(-20).max(20),
}).superRefine((profile, ctx) => {
  if (profile.muscleMassKg !== undefined && profile.muscleMassKg !== null && profile.muscleMassKg >= profile.weightKg) {
    ctx.addIssue({ code: "custom", path: ["muscleMassKg"], message: "La massa muscolare deve essere inferiore al peso corporeo." });
  }
  if (profile.bmrMethod === "measured" && profile.measuredBmr === null) {
    ctx.addIssue({ code: "custom", path: ["measuredBmr"], message: "Indica il BMR misurato o scegli un altro metodo di calcolo." });
  }
  if (profile.bmrMethod === "lean" && profile.leanMassKg === null && profile.bodyFatPercent === null) {
    ctx.addIssue({ code: "custom", path: ["leanMassKg"], message: "Indica la massa magra o la percentuale di grasso per usare questo metodo." });
  }
  if (profile.bmrMethod === "measured" && profile.measuredBmr !== null) {
    const ratio = profile.measuredBmr / mifflinBmr(profile);
    if (ratio < 0.5 || ratio > 2) {
      ctx.addIssue({ code: "custom", path: ["measuredBmr"], message: "Il BMR misurato e meno della meta o piu del doppio della stima da formula: probabile errore di inserimento. Ricontrollalo o scegli un altro metodo." });
    }
  }
  if (profile.leanMassKg !== null && profile.leanMassKg >= profile.weightKg) {
    ctx.addIssue({ code: "custom", path: ["leanMassKg"], message: "La massa magra non puo essere uguale o superiore al peso corporeo." });
  }
  if (profile.bodyFatPercent !== null && profile.leanMassKg !== null) {
    const impliedLean = profile.weightKg * (1 - profile.bodyFatPercent / 100);
    if (Math.abs(impliedLean - profile.leanMassKg) > 2) {
      ctx.addIssue({ code: "custom", path: ["leanMassKg"], message: "Massa magra e percentuale di grasso corporeo indicate non sono coerenti tra loro: correggi uno dei due valori." });
    }
  }
}) satisfies z.ZodType<BodyProfile>;

export const macroTargetsSchema = z.strictObject({
  kcal: finite(0, 10_000),
  protein: finite(0, 1_000),
  carbs: finite(0, 1_500),
  fat: finite(0, 500),
}) satisfies z.ZodType<MacroTargets>;

/** Unsaved placeholder draft: never applied until the user explicitly calculates and confirms. */
export function defaultBodyProfile(): BodyProfile {
  return {
    age: 30,
    sex: "female",
    heightCm: 165,
    weightKg: 65,
    bodyFatPercent: null,
    leanMassKg: null,
    muscleMassKg: null,
    visceralFat: null,
    measuredBmr: null,
    bmrMethod: "mifflin",
    activity: 1.375,
    goal: "maintain",
    adjustmentPercent: 0,
  };
}

/** Suggested starting adjustment for a goal; the user can still override it within -20..20. */
export function defaultAdjustmentForGoal(goal: BodyProfile["goal"]): number {
  if (goal === "cut") return -10;
  if (goal === "surplus") return 5;
  return 0;
}

export function estimateTdee(profile: BodyProfile): { bmr: number; tdee: number; method: string; warnings: string[] } {
  const parsed = profileSchema.parse(profile);
  const warnings: string[] = [];
  let bmr: number;
  let method: string;
  if (parsed.bmrMethod === "measured") {
    if (parsed.measuredBmr === null) throw new Error("Il BMR misurato non e disponibile: indicalo o scegli un altro metodo.");
    bmr = parsed.measuredBmr;
    method = "measured";
    warnings.push("Il BMR misurato con dispositivi indossabili o bilance puo variare in base allo strumento, al digiuno e all'idratazione del momento della misura.");
    const ratio = bmr / mifflinBmr(parsed);
    if (ratio < 0.75 || ratio > 1.25) {
      warnings.push(`Il BMR misurato differisce di oltre il 25% dalla stima da formula (${Math.round(mifflinBmr(parsed))} kcal): verifica lo strumento e le condizioni della misura prima di fidarti del risultato.`);
    }
  } else if (parsed.bmrMethod === "lean") {
    let leanMassKg = parsed.leanMassKg;
    if (leanMassKg === null) {
      if (parsed.bodyFatPercent === null) throw new Error("Serve la massa magra o la percentuale di grasso per calcolare il BMR con Katch-McArdle.");
      leanMassKg = parsed.weightKg * (1 - parsed.bodyFatPercent / 100);
    }
    bmr = 370 + 21.6 * leanMassKg;
    method = "katch-mcardle";
    warnings.push("Il metodo Katch-McArdle dipende dalla precisione della composizione corporea: una stima errata della massa magra sposta il risultato.");
  } else {
    bmr = mifflinBmr(parsed);
    method = "mifflin";
    warnings.push("Formula stimata (Mifflin-St Jeor): l'errore tipico rispetto al metabolismo reale e di circa +/-10-15%.");
  }
  const tdee = bmr * parsed.activity;
  warnings.push("Il fattore di attivita stima il dispendio quotidiano complessivo: se pratichi allenamento strutturato aggiuntivo, non sommarlo di nuovo come se fosse extra.");
  if (parsed.visceralFat !== null) {
    warnings.push("Il grasso viscerale e mostrato solo a scopo informativo: non viene usato come moltiplicatore nel calcolo del TDEE.");
  }
  const previewKcal = tdee * (1 + parsed.adjustmentPercent / 100);
  if (previewKcal < bmr || previewKcal < 1200) {
    warnings.push(`L'obiettivo calorico risultante (${Math.round(previewKcal)} kcal) e molto basso rispetto al tuo fabbisogno stimato. Non esiste una soglia universale garantita come sicura: e solo una stima, valutala con un professionista sanitario prima di seguirla, soprattutto se protratta nel tempo.`);
  }
  return { bmr: Math.round(bmr * 100) / 100, tdee: Math.round(tdee * 100) / 100, method, warnings };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function proposeTargets(profile: BodyProfile): MacroTargets {
  const parsed = profileSchema.parse(profile);
  const { tdee } = estimateTdee(parsed);
  const rawKcal = tdee * (1 + parsed.adjustmentPercent / 100);
  if (!Number.isFinite(rawKcal) || rawKcal <= 0) {
    throw new Error("Il calcolo del fabbisogno calorico non ha prodotto un risultato valido: controlla i dati del profilo.");
  }
  const kcal = Math.round(rawKcal);
  const proteinPerKg = parsed.goal === "maintain" || parsed.goal === "recomp" ? 1.6 : 1.8;
  const protein = round1(proteinPerKg * parsed.weightKg);
  const fat = round1(0.8 * parsed.weightKg);
  // Carbohydrates are derived from the already-rounded kcal target so the 4/4/9 totals reconcile exactly with the displayed kcal.
  const carbKcal = kcal - protein * 4 - fat * 9;
  if (carbKcal < 0) {
    throw new Error("Con questi parametri le calorie di proteine e grassi superano l'obiettivo calorico: aumenta le calorie o riduci gli apporti minimi prima di generare la proposta.");
  }
  const carbs = round1(carbKcal / 4);
  const targets = { kcal, protein, carbs, fat };
  return macroTargetsSchema.parse(targets);
}
"use client";

import { useId, useState } from "react";
import {
  ACTIVITY_FACTORS, defaultAdjustmentForGoal, defaultBodyProfile, estimateTdee, macroTargetsSchema,
  profileSchema, proposeTargets, type BodyProfile, type MacroTargets,
} from "@/lib/nutrition-profile";

type NutritionProfileProps = {
  profile?: BodyProfile;
  targets?: MacroTargets;
  onConfirm: (profile: BodyProfile, targets: MacroTargets) => void;
};

const ACTIVITY_LABELS: Record<number, string> = {
  1.2: "Sedentario (poco o nessun esercizio)",
  1.375: "Leggermente attivo (1-3 allenamenti/settimana)",
  1.55: "Moderatamente attivo (3-5 allenamenti/settimana)",
  1.725: "Molto attivo (6-7 allenamenti/settimana)",
  1.9: "Estremamente attivo (lavoro fisico o doppi allenamenti)",
};

const GOAL_LABELS: Record<BodyProfile["goal"], string> = {
  cut: "Definizione (deficit calorico)",
  recomp: "Ricomposizione (mantenimento)",
  maintain: "Mantenimento",
  surplus: "Aumento (surplus calorico)",
};

const BMR_METHOD_LABELS: Record<BodyProfile["bmrMethod"], string> = {
  mifflin: "Mifflin-St Jeor (peso, altezza, eta, sesso biologico)",
  lean: "Katch-McArdle (massa magra ricavata da peso e % grasso)",
  measured: "BMR misurato (es. calorimetria indiretta, dispositivo dedicato)",
};

/** Draft form state keeps every numeric field editable as free text so decimals and empty values are never silently clamped. */
type Draft = {
  age: string;
  sex: BodyProfile["sex"] | "";
  heightCm: string;
  weightKg: string;
  bodyFatPercent: string;
  muscleMassKg: string;
  visceralFat: string;
  measuredBmr: string;
  bmrMethod: BodyProfile["bmrMethod"];
  activity: string;
  goal: BodyProfile["goal"];
  adjustmentPercent: string;
};

function draftFromProfile(profile: BodyProfile): Draft {
  return {
    age: String(profile.age),
    sex: profile.sex,
    heightCm: String(profile.heightCm),
    weightKg: String(profile.weightKg),
    bodyFatPercent: profile.bodyFatPercent === null ? "" : String(profile.bodyFatPercent),
    muscleMassKg: profile.muscleMassKg == null ? "" : String(profile.muscleMassKg),
    visceralFat: profile.visceralFat === null ? "" : String(profile.visceralFat),
    measuredBmr: profile.measuredBmr === null ? "" : String(profile.measuredBmr),
    bmrMethod: profile.bmrMethod,
    activity: String(profile.activity),
    goal: profile.goal,
    adjustmentPercent: String(profile.adjustmentPercent),
  };
}

function blankDraft(): Draft {
  return {
    age: "", sex: "", heightCm: "", weightKg: "", bodyFatPercent: "", muscleMassKg: "", visceralFat: "",
    measuredBmr: "", bmrMethod: "mifflin", activity: "", goal: "maintain", adjustmentPercent: "0",
  };
}

function parseOptionalNumber(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

function parseRequiredNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed.replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

function draftToProfile(draft: Draft): { profile?: BodyProfile; error?: string } {
  const age = parseRequiredNumber(draft.age);
  const heightCm = parseRequiredNumber(draft.heightCm);
  const weightKg = parseRequiredNumber(draft.weightKg);
  const bodyFatPercent = parseOptionalNumber(draft.bodyFatPercent);
  const muscleMassKg = parseOptionalNumber(draft.muscleMassKg);
  const visceralFat = parseOptionalNumber(draft.visceralFat);
  const measuredBmr = parseOptionalNumber(draft.measuredBmr);
  const adjustmentPercent = parseRequiredNumber(draft.adjustmentPercent);
  const activity = parseRequiredNumber(draft.activity);
  if (draft.sex === "" || activity === undefined) return { error: "Seleziona il sesso biologico e il livello di attivita." };
  if (age === undefined || heightCm === undefined || weightKg === undefined || adjustmentPercent === undefined
    || bodyFatPercent === undefined || muscleMassKg === undefined || visceralFat === undefined || measuredBmr === undefined) {
    return { error: "Controlla i campi numerici: alcuni valori non sono numeri validi." };
  }
  const candidate: BodyProfile = {
    age, sex: draft.sex, heightCm, weightKg, bodyFatPercent, leanMassKg: null, muscleMassKg, visceralFat, measuredBmr,
    bmrMethod: draft.bmrMethod, activity, goal: draft.goal, adjustmentPercent,
  };
  const parsed = profileSchema.safeParse(candidate);
  if (!parsed.success) return { error: parsed.error.issues.map((issue) => issue.message).join(" ") };
  return { profile: parsed.data };
}

export function NutritionProfile({ profile, targets, onConfirm }: NutritionProfileProps) {
  const [draft, setDraft] = useState<Draft>(() => profile ? draftFromProfile(profile) : blankDraft());
  const [estimate, setEstimate] = useState<{ bmr: number; tdee: number; method: string; warnings: string[] } | null>(null);
  const [proposal, setProposal] = useState<MacroTargets | null>(null);
  const [manual, setManual] = useState<{ kcal: string; protein: string; carbs: string; fat: string } | null>(null);
  const [error, setError] = useState("");
  const [exampleShown, setExampleShown] = useState(false);
  const headingId = useId();

  function fillExample() {
    setDraft(draftFromProfile(defaultBodyProfile()));
    setExampleShown(true);
    setEstimate(null); setProposal(null); setManual(null); setError("");
  }

  function updateDraft(change: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...change }));
    setEstimate(null);
    setProposal(null);
    setManual(null);
    setError("");
    setExampleShown(false);
  }

  function handleCalculate() {
    setError("");
    const { profile: parsed, error: parseError } = draftToProfile(draft);
    if (!parsed) { setError(parseError ?? "Profilo non valido."); return; }
    try {
      const result = estimateTdee(parsed);
      setEstimate(result);
      const proposed = proposeTargets(parsed);
      setProposal(proposed);
      setManual({ kcal: String(proposed.kcal), protein: String(proposed.protein), carbs: String(proposed.carbs), fat: String(proposed.fat) });
    } catch (calculationError) {
      setEstimate(null);
      setProposal(null);
      setManual(null);
      setError(calculationError instanceof Error ? calculationError.message : "Calcolo non riuscito.");
    }
  }

  function handleConfirm() {
    setError("");
    const { profile: parsedProfile, error: profileError } = draftToProfile(draft);
    if (!parsedProfile) { setError(profileError ?? "Profilo non valido."); return; }
    if (!manual) { setError("Calcola prima una proposta o inserisci i target manualmente."); return; }
    const kcal = parseRequiredNumber(manual.kcal);
    const protein = parseRequiredNumber(manual.protein);
    const carbs = parseRequiredNumber(manual.carbs);
    const fat = parseRequiredNumber(manual.fat);
    if (kcal === undefined || protein === undefined || carbs === undefined || fat === undefined) {
      setError("I target contengono valori numerici non validi.");
      return;
    }
    const parsedTargets = macroTargetsSchema.safeParse({ kcal, protein, carbs, fat });
    if (!parsedTargets.success) { setError(parsedTargets.error.issues.map((issue) => issue.message).join(" ")); return; }
    onConfirm(parsedProfile, parsedTargets.data);
  }

  const declaredKcalFromMacros = manual
    ? (parseRequiredNumber(manual.protein) ?? 0) * 4 + (parseRequiredNumber(manual.carbs) ?? 0) * 4 + (parseRequiredNumber(manual.fat) ?? 0) * 9
    : null;
  const manualKcalValue = manual ? parseRequiredNumber(manual.kcal) : undefined;
  const macroMismatch = manual && declaredKcalFromMacros !== null && manualKcalValue !== undefined
    && Math.abs(declaredKcalFromMacros - manualKcalValue) > 15;

  return <section className="nf-card" aria-labelledby={headingId}>
    <h2 id={headingId}>Profilo, TDEE e obiettivi</h2>
    <p className="nf-muted">Stime indicative, non sostituiscono una valutazione medica o nutrizionale professionale. I dati restano una bozza finche non confermi.</p>
    {!profile && !exampleShown && <p><button type="button" className="nf-button" onClick={fillExample}>Compila con valori di esempio</button></p>}
    {exampleShown && <p className="nf-alert" role="status">Valori di esempio, non sono le tue misure: sostituiscili prima di calcolare. Nulla viene salvato finche non confermi.</p>}
    {targets && <p className="nf-alert" role="status">Target attivo: {targets.kcal} kcal - P {targets.protein} g / C {targets.carbs} g / G {targets.fat} g</p>}

    <div className="nf-grid">
      <label className="nf-field">Eta (anni)
        <input type="number" inputMode="numeric" min={18} max={100} step={1} value={draft.age} onChange={(event) => updateDraft({ age: event.target.value })}/>
      </label>
      <label className="nf-field">Sesso biologico (usato solo dalla formula fisiologica Mifflin-St Jeor)
        <select value={draft.sex} onChange={(event) => updateDraft({ sex: event.target.value as BodyProfile["sex"] })}>
          <option value="">Seleziona...</option>
          <option value="female">Femminile</option>
          <option value="male">Maschile</option>
        </select>
      </label>
      <label className="nf-field">Altezza (cm)
        <input type="number" inputMode="decimal" step="0.1" value={draft.heightCm} onChange={(event) => updateDraft({ heightCm: event.target.value })}/>
      </label>
      <label className="nf-field">Peso (kg)
        <input type="number" inputMode="decimal" step="0.1" value={draft.weightKg} onChange={(event) => updateDraft({ weightKg: event.target.value })}/>
      </label>
      <label className="nf-field">% Grasso corporeo (opzionale)
        <input type="number" inputMode="decimal" step="0.1" value={draft.bodyFatPercent} placeholder="Non misurato" onChange={(event) => updateDraft({ bodyFatPercent: event.target.value })}/>
      </label>
      <label className="nf-field">Massa muscolare in kg (opzionale)
        <input type="number" inputMode="decimal" min="0.1" max="250" step="0.1" value={draft.muscleMassKg} placeholder="Non misurata" onChange={(event) => updateDraft({ muscleMassKg: event.target.value })}/>
      </label>
      <label className="nf-field">Grasso viscerale (punteggio, opzionale)
        <input type="number" inputMode="decimal" step="1" value={draft.visceralFat} placeholder="Non misurato" onChange={(event) => updateDraft({ visceralFat: event.target.value })}/>
      </label>
      <label className="nf-field">Metodo di calcolo del BMR
        <select value={draft.bmrMethod} onChange={(event) => updateDraft({ bmrMethod: event.target.value as BodyProfile["bmrMethod"] })}>
          {(Object.keys(BMR_METHOD_LABELS) as BodyProfile["bmrMethod"][]).map((method) => <option key={method} value={method}>{BMR_METHOD_LABELS[method]}</option>)}
        </select>
      </label>
      {draft.bmrMethod === "measured" && <label className="nf-field">BMR misurato (kcal/die)
        <input type="number" inputMode="decimal" step="1" value={draft.measuredBmr} onChange={(event) => updateDraft({ measuredBmr: event.target.value })}/>
      </label>}
      <label className="nf-field">Livello di attivita (esclude l&apos;allenamento strutturato aggiuntivo)
        <select value={draft.activity} onChange={(event) => updateDraft({ activity: event.target.value })}>
          <option value="">Seleziona...</option>
          {ACTIVITY_FACTORS.map((factor) => <option key={factor} value={factor}>{ACTIVITY_LABELS[factor]}</option>)}
        </select>
      </label>
      <label className="nf-field">Obiettivo
        <select value={draft.goal} onChange={(event) => {
          const goal = event.target.value as BodyProfile["goal"];
          updateDraft({ goal, adjustmentPercent: String(defaultAdjustmentForGoal(goal)) });
        }}>
          {(Object.keys(GOAL_LABELS) as BodyProfile["goal"][]).map((goal) => <option key={goal} value={goal}>{GOAL_LABELS[goal]}</option>)}
        </select>
      </label>
      <label className="nf-field">Aggiustamento calorico (% da -20 a 20)
        <input type="number" inputMode="decimal" min={-20} max={20} step="1" value={draft.adjustmentPercent} onChange={(event) => updateDraft({ adjustmentPercent: event.target.value })}/>
      </label>
    </div>
    <p className="nf-muted">La massa muscolare della bilancia e un dato di monitoraggio, non la massa magra. Per Katch-McArdle inserisci la percentuale di grasso: la massa magra viene ricavata come peso x (1 - % grasso / 100), senza usare i kg di muscolo.</p>
    {profile?.leanMassKg != null && <p className="nf-muted">Il precedente valore di massa magra ({profile.leanMassKg} kg) resta nei dati salvati finche non confermi il nuovo profilo; non viene copiato nel campo muscolare. Con il metodo Katch-McArdle, completa la percentuale di grasso prima di ricalcolare.</p>}
    <p className="nf-muted">Cambiando obiettivo, l&apos;aggiustamento torna al valore predefinito (definizione -10%, aumento +5%, altri 0%); puoi poi modificarlo. Servizio per adulti (18+).</p>
    {draft.goal === "recomp" && <p className="nf-muted">La ricomposizione parte dal mantenimento: non e una garanzia di risultato, solo un punto di partenza prudente.</p>}

    <button type="button" className="nf-button" onClick={handleCalculate}>Calcola stima TDEE e proposta</button>
    {error && <p className="nf-alert" role="alert">{error}</p>}

    {estimate && <div className="nf-card" aria-label="Stima del metabolismo">
      <p><strong>BMR stimato:</strong> {estimate.bmr} kcal/die ({estimate.method})</p>
      <p><strong>TDEE stimato:</strong> {estimate.tdee} kcal/die</p>
      {estimate.method === "katch-mcardle" && <p className="nf-muted">Massa magra ricavata da peso e grasso corporeo: {((parseRequiredNumber(draft.weightKg) ?? 0) * (1 - (parseOptionalNumber(draft.bodyFatPercent) ?? 0) / 100)).toFixed(1)} kg. Non e la massa muscolare.</p>}
      {estimate.warnings.length > 0 && <ul>{estimate.warnings.map((warning, index) => <li key={index} className="nf-muted">{warning}</li>)}</ul>}
    </div>}

    {proposal && manual && <div className="nf-card" aria-label="Proposta di target, non ancora confermata">
      <p className="nf-muted">Proposta calcolata (non confermata): {proposal.kcal} kcal - P {proposal.protein} g / C {proposal.carbs} g / G {proposal.fat} g. Puoi modificare liberamente i valori sotto prima di confermare.</p>
      <div className="nf-grid">
        <label className="nf-field">Calorie (kcal)
          <input type="number" inputMode="decimal" step="1" value={manual.kcal} onChange={(event) => setManual((current) => current && { ...current, kcal: event.target.value })}/>
        </label>
        <label className="nf-field">Proteine (g)
          <input type="number" inputMode="decimal" step="0.1" value={manual.protein} onChange={(event) => setManual((current) => current && { ...current, protein: event.target.value })}/>
        </label>
        <label className="nf-field">Carboidrati (g)
          <input type="number" inputMode="decimal" step="0.1" value={manual.carbs} onChange={(event) => setManual((current) => current && { ...current, carbs: event.target.value })}/>
        </label>
        <label className="nf-field">Grassi (g)
          <input type="number" inputMode="decimal" step="0.1" value={manual.fat} onChange={(event) => setManual((current) => current && { ...current, fat: event.target.value })}/>
        </label>
      </div>
      {macroMismatch && <p className="nf-alert" role="status">Le calorie indicate ({manualKcalValue} kcal) non corrispondono a quelle calcolate dai macro (circa {Math.round(declaredKcalFromMacros ?? 0)} kcal con 4/4/9). Resta modificabile: non viene corretto automaticamente.</p>}
      <button type="button" className="nf-button" onClick={handleConfirm}>Conferma profilo e target</button>
    </div>}
  </section>;
}
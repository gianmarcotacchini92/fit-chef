"use client";

import { useMemo, useState } from "react";
import { estimateRusticPie, rusticReuseGrams, RUSTIC_PORTION_SCENARIOS, type RusticBase, type RusticSize } from "@/lib/rustic-pie";
import type { FoodSnapshot } from "@/lib/nutrition-diary";

export function RusticPieGuide({ initialSlices, initialSize, initialGrams, savedFoods, onPreview, onSave, onInvalidate }: {
  initialGrams: number | null;
  savedFoods: FoodSnapshot[];
  initialSlices: number;
  initialSize: RusticSize;
  onPreview: (food: FoodSnapshot, grams: number, note: string) => void;
  onSave: (food: FoodSnapshot) => boolean;
  onInvalidate: () => void;
}) {
  const [slices, setSlices] = useState(initialSlices);
  const [size, setSize] = useState<RusticSize>(initialSize);
  const [base, setBase] = useState<RusticBase>("unknown");
  const [onlyRicotta, setOnlyRicotta] = useState(false);
  const [knownWeight, setKnownWeight] = useState(initialGrams === null ? "" : String(initialGrams));
  const [reuseConfirmed, setReuseConfirmed] = useState(false);
  const [pastryShare, setPastryShare] = useState(40);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");
  const grams = knownWeight.trim() === "" ? null : Number(knownWeight.replace(",", "."));
  const estimate = useMemo(() => estimateRusticPie({
    slices, size, base, filling: onlyRicotta ? "ricotta" : "unknown",
    knownGrams: grams, pastrySharePercent: pastryShare,
  }), [slices, size, base, onlyRicotta, grams, pastryShare]);
  const [minPiece, maxPiece] = RUSTIC_PORTION_SCENARIOS[size];

  function invalidate() { setReuseConfirmed(false); setSaved(false); setMessage(""); onInvalidate(); }

  function save() {
    if (!estimate) return;
    const food: FoodSnapshot = { ...estimate.food,
      id: `personal-rustic-${crypto.randomUUID()}`,
      rusticPortion: { version: 1, grams: estimate.centralGrams, slices: slices || null, size, measured: grams !== null },
      name: "La mia torta rustica alla ricotta",
      source: estimate.food.source + ` Porzione salvata: ${estimate.centralGrams} g${slices ? ` per ${slices} fette` : "; numero di fette non indicato"}. Dati salvati come stima, non ricetta misurata.`,
    };
    if (!onSave(food)) { setMessage("Salvataggio non riuscito. Controlla il limite degli alimenti personali."); return; }
    setSaved(true);
    setMessage("Piatto personale salvato. Lo ritroverai tra i tuoi alimenti; i nutrienti restano una stima.");
  }

  return <section className="nf-food-row nf-rustic-guide" aria-label="Stima guidata torta rustica">
    <h3>Torta rustica alla ricotta · guida gratuita</h3>
    <p className="nf-muted">Non conosco la ricetta né il peso effettivo. I valori nutrizionali di ricotta e sfoglia derivano da USDA; pesi delle fette e proporzioni sono solo scenari ipotetici, non misure della tua torta.</p>
    <div className="nf-grid">
      <label className="nf-field">Numero di fette
        <input type="number" min="1" max="30" step="1" value={slices || ""} onChange={e => {setSlices(Number(e.target.value));invalidate();}}/>
      </label>
      <label className="nf-field">Dimensione delle fette
        <select value={size} onChange={e => {setSize(e.target.value as RusticSize);invalidate();}}>
          <option value="small">Piccole</option><option value="medium">Medie</option><option value="large">Grandi</option>
        </select>
      </label>
      <label className="nf-field">Quale base?
        <select value={base} onChange={e => {setBase(e.target.value as RusticBase);invalidate();}}>
          <option value="unknown">Non lo so</option><option value="puff">Pasta sfoglia</option>
          <option value="shortcrust">Pasta brisée</option><option value="other">Altro impasto</option>
        </select>
      </label>
      <label className="nf-field">Peso totale se conosciuto, g (facoltativo)
        <input type="number" min="1" max="5000" step="0.1" value={knownWeight} placeholder="Non misurato" onChange={e=>{setKnownWeight(e.target.value);invalidate();}}/>
      </label>
    </div>
    {savedFoods.length > 0 && <div className="nf-food-row">
      <strong>Riutilizza una tua torta salvata</strong>
      <label className="nf-check"><input type="checkbox" checked={reuseConfirmed} onChange={e => {setReuseConfirmed(e.target.checked); onInvalidate();}}/>
        Confermo stessi ingredienti e stessa dimensione delle fette della porzione salvata.
      </label>
      {savedFoods.map(food => {
        const reused = rusticReuseGrams(food, slices, grams, reuseConfirmed);
        return <button type="button" className="nf-text-button" key={food.id} disabled={reused === null || !reuseConfirmed}
          onClick={() => { if (reused !== null) onPreview(food, reused, "Alimento personale riutilizzato; nutrienti stimati."); }}>
          Usa {food.name} ({reused === null ? "conferma porzione o indica peso" : `${Math.round(reused)} g`})
        </button>;
      })}
    </div>}
    <label className="nf-check"><input type="checkbox" checked={onlyRicotta} onChange={e=>{setOnlyRicotta(e.target.checked);invalidate();}}/>
      Confermo: nella stima considero solo ricotta e sfoglia, senza altri ingredienti o condimenti.
    </label>
    {base === "puff" && onlyRicotta && <label className="nf-field">Ipotesi: percentuale di sfoglia sul peso finito — {pastryShare}%
      <input type="range" min="25" max="55" step="5" value={pastryShare} onChange={e=>{setPastryShare(Number(e.target.value));invalidate();}}/>
    </label>}
    <div className="nf-alert">
      <strong>Scenario di peso</strong>
      <p>{grams === null ? `Per una fetta ${size === "medium" ? "media" : size === "small" ? "piccola" : "grande"} ipotizzo ${minPiece}–${maxPiece} g (intervallo editoriale NON verificato). Per ${slices} fette: ${slices*minPiece}–${slices*maxPiece} g.` : `Peso dichiarato da te: ${grams} g complessivi.`}</p>
      {!estimate ? <p>Per il calcolo servono un peso valido oppure 1–30 fette, sfoglia e conferma della composizione. Se è brisée, contiene altri ingredienti o non conosci la base, evita questa stima: usa una ricetta personale o un alimento con valori verificabili.</p>
        : <>
          <p><strong>{estimate.lowKcal}–{estimate.highKcal} kcal</strong> · intervallo di scenari, NON intervallo statistico.</p>
          <p>Ipotesi centrale con {estimate.centralGrams} g e {pastryShare}% di sfoglia: circa {Math.round(estimate.food.per100g.kcal*estimate.centralGrams/100)} kcal; P {(estimate.food.per100g.protein*estimate.centralGrams/100).toFixed(1)} g · C {(estimate.food.per100g.carbs*estimate.centralGrams/100).toFixed(1)} g · G {(estimate.food.per100g.fat*estimate.centralGrams/100).toFixed(1)} g.</p>
          <p>Fonti ingredienti: USDA ricotta intera NDB 01036, sfoglia cotta FDC 172738. Quantità e percentuali NON provengono da USDA.</p>
          <div className="nf-smart-meal-actions">
            <button type="button" className="nf-button" onClick={()=>onPreview(estimate.food,estimate.centralGrams,`Scenario ${estimate.lowKcal}–${estimate.highKcal} kcal; peso ${estimate.gramsLow}–${estimate.gramsHigh} g`)}>Usa questa stima nell&apos;anteprima</button>
            <button type="button" className="nf-text-button" disabled={saved} onClick={save}>{saved?"Piatto salvato":"Salva come mio piatto"}</button>
          </div>
        </>}
    </div>
    {message && <p role="status" className="nf-muted">{message}</p>}
  </section>;
}

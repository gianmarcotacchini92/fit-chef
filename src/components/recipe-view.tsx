"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowLeft, Check, CheckCheck, ChevronRight, Clock3, Dumbbell, Flame, Heart, ImagePlus, Leaf, RefreshCw, Shuffle, Sparkles, Utensils, Zap } from "lucide-react";
import { FoodArt } from "./food-art";
import { NUTRIENT_LABELS } from "@/lib/defaults";
import { getIngredient } from "@/lib/catalog";
import { formatNumber } from "@/lib/pantry";
import { MealBreakdown } from "./meal-breakdown";
import type { Recipe, VariantRequest } from "@/lib/types";

type Props = {
  recipe: Recipe;
  saved: boolean;
  cooked: boolean;
  busy: boolean;
  imageBusy: boolean;
  canGenerateImage: boolean;
  onSave: () => void;
  onCooked: () => void;
  onBack: () => void;
  onVariant: (kind: VariantRequest["kind"]) => void;
  onSubstitute: (ingredientId: string, replacementId: string) => void;
  onImage: () => void;
};

export function RecipeView({ recipe, saved, cooked, busy, imageBusy, canGenerateImage, onSave, onCooked, onBack, onVariant, onSubstitute, onImage }: Props) {
  const [tab, setTab] = useState("ingredients");
  const [whole, setWhole] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const [imageFailed, setImageFailed] = useState(false);
  const values = whole ? recipe.nutritionTotal : recipe.nutritionPerServing;
  const image = process.env.NEXT_PUBLIC_FIT_STATIC !== "true" && recipe.image?.planHash === recipe.planHash ? recipe.image : undefined;
  const baseIds = new Set(recipe.input.pantry.filter((item) => item.mode === "fixed").map((item) => item.ingredientId));
  const mealBased = baseIds.size > 0;
  const hasTargets = (["kcal", "protein", "carbs", "fat", "fiber"] as const).some((key) => recipe.input.targets[key] !== null);
  const toggleStep = (id: string) => setCompleted((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return (
    <div className="recipe-page fade-in">
      <button className="text-button back-button" onClick={onBack}><ArrowLeft size={17}/> {mealBased ? "Torna al tuo pasto" : "Torna al tuo frigo"}</button>
      <div className="recipe-hero">
        <div className="recipe-visual">
          {image && !imageFailed ? <Image className="generated-photo" src={image.url} width={1024} height={1024} unoptimized onError={() => setImageFailed(true)} alt={`Visualizzazione AI di ${recipe.title}`}/> : <FoodArt recipe={recipe}/>}
          <span className="visual-caption">{imageFailed ? "Foto non disponibile: illustrazione editoriale" : image ? "Immagine generata con AI" : "Illustrazione editoriale indicativa"}</span>
          {canGenerateImage && (!image || imageFailed) && <button className="image-button" onClick={() => { setImageFailed(false); onImage(); }} disabled={imageBusy || busy}><ImagePlus size={16}/>{imageBusy ? "Creo la visualizzazione..." : "Genera una foto AI"}</button>}
        </div>
        <div className="recipe-intro">
          <span className="eyebrow"><Sparkles size={14}/> {mealBased ? "IL TUO PASTO, REINVENTATO" : "FATTA PER IL TUO FRIGO"}</span>
          <h1>{recipe.title}</h1>
          <p className="recipe-description">{recipe.description}</p>
          <div className="recipe-meta">
            <span><Clock3 size={16}/>{recipe.minutes} min totali</span>
            <span><Utensils size={16}/>{recipe.difficulty === "easy" ? "Facile" : "Media"}</span>
            <span>{recipe.servings} {recipe.servings === 1 ? "porzione" : "porzioni"}</span>
          </div>
          <div className={`fit-status ${recipe.targetStatus === "closest" ? "fit-status-warning" : ""}`}>
            {recipe.targetStatus === "matched" ? <CheckCheck size={20}/> : <Flame size={20}/>}
            <div><strong>{recipe.targetStatus === "matched" ? mealBased && !hasTargets ? "Quantita del pasto originale rispettate" : "In linea con i tuoi obiettivi" : "La combinazione piu vicina trovata"}</strong>
              <p>{recipe.targetStatus === "matched" ? mealBased ? "Grammature di base invariate. Tutte le aggiunte sono conteggiate separatamente." : "Valori calcolati, entro le tolleranze indicate." : "Non tutti i target sono raggiunti. Gli alimenti bloccati non sono stati ridotti: gli scostamenti sono visibili nei macros."}</p></div>
          </div>
          <div className="button-row"><button className={`button ${saved ? "button-saved" : "button-primary"}`} onClick={onSave} disabled={busy}><Heart size={18} fill={saved ? "currentColor" : "none"}/>{saved ? "Ricetta salvata" : "Salva ricetta"}</button>
            <button className="button button-secondary" onClick={() => onVariant("another")} disabled={busy}><RefreshCw size={17} className={busy ? "spin" : ""}/> Fammi un&apos;altra</button></div>
          <p className="micro-copy">{recipe.sourceMode === "ai" ? "Presentazione AI, composizione e nutrienti dal motore FIT." : "Ricetta editoriale personalizzata dal motore FIT. Nessun valore inventato dall'AI."}</p>
        </div>
      </div>

      <div className="nutrition-strip" aria-label="Valori nutrizionali per porzione">
        {(Object.keys(NUTRIENT_LABELS) as (keyof typeof NUTRIENT_LABELS)[]).map((key) => <div key={key} className={`nutrient nutrient-${key}`}>
          <span className="nutrient-label">{NUTRIENT_LABELS[key]}</span><strong>{formatNumber(recipe.nutritionPerServing[key], key === "kcal" ? 0 : 1)}<small>{key === "kcal" ? " kcal" : " g"}</small></strong><span className="micro-copy">per porzione</span>
        </div>)}
      </div>

      <MealBreakdown recipe={recipe}/>
      {recipe.warnings.length > 0 && <div className="notice warning-notice" role="status">{recipe.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
      <div className="recipe-content-grid">
        <section className="card recipe-details">
          <div className="recipe-tabs" role="tablist" aria-label="Dettagli ricetta">
            {[["ingredients", "Ingredienti"], ["steps", "Preparazione"], ["macros", "Macros"], ["swaps", "Sostituzioni"]].map(([id, label]) =>
              <button key={id} role="tab" id={`tab-${id}`} aria-controls="recipe-panel" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
          </div>
          <div className="tab-content" id="recipe-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === "ingredients" && <>
              <div className="section-heading"><div><h2>Tutto quello che ti serve</h2><p>Quantita per l&apos;intera ricetta: {recipe.servings} {recipe.servings === 1 ? "porzione" : "porzioni"}.</p></div><span className="count-badge">{recipe.ingredients.length}</span></div>
              <div className="recipe-ingredients">{recipe.ingredients.map((item) => <div className="recipe-ingredient" key={item.ingredientId}>
                <span className="ingredient-emoji">{getIngredient(item.ingredientId)?.emoji ?? <Leaf size={20}/>}</span><div><strong>{item.name}</strong><span>{item.state}</span>{mealBased && <small className={`meal-ingredient-tag ${baseIds.has(item.ingredientId) ? "meal-ingredient-base" : ""}`}>{baseIds.has(item.ingredientId) ? "Pasto originale" : "Aggiunta confermata"}</small>}</div><b>{formatNumber(item.grams, 1)} g</b>
              </div>)}</div>
              <p className="micro-copy bottom-note">Pesa gli alimenti nello stato indicato. Acqua di preparazione: segui il procedimento. Condimenti e salse sono gia conteggiati.</p>
            </>}
            {tab === "steps" && <>
              <div className="section-heading"><div><h2>Dal frigo al piatto</h2><p>Tocca il numero per segnare un passaggio completato.</p></div><span className="count-badge">{completed.length}/{recipe.steps.length}</span></div>
              <div className="steps">{recipe.steps.map((step, index) => <div key={step.id} className={`recipe-step ${completed.includes(step.id) ? "step-complete" : ""}`}>
                <button className="step-number" aria-label={`Completa passaggio ${index + 1}`} aria-pressed={completed.includes(step.id)} onClick={() => toggleStep(step.id)}>{completed.includes(step.id) ? <Check size={19}/> : String(index + 1).padStart(2, "0")}</button>
                <div><h3>{step.title}</h3><p>{step.instruction}</p>{step.minutes > 0 && <span className="step-time"><Clock3 size={12}/>{step.minutes} min</span>}</div>
              </div>)}</div>
              <button className={`button ${cooked ? "button-saved" : "button-secondary"}`} onClick={onCooked} disabled={busy}><CheckCheck size={17}/>{cooked ? "Segnata come cucinata" : "L'ho cucinata!"}</button>
              <p className="micro-copy">Registra il consumo nello storico; non modifica automaticamente le scorte.</p>
            </>}
            {tab === "macros" && <>
              <div className="section-heading"><div><h2>I numeri, senza sorprese</h2><p>{whole ? "Totali dell'intera ricetta." : "Confronto per una porzione."}</p></div></div>
              <div className="segmented-control"><button className={!whole ? "active" : ""} onClick={() => setWhole(false)}>Per porzione</button><button className={whole ? "active" : ""} onClick={() => setWhole(true)}>Intera ricetta</button></div>
              <table className="macro-table"><thead><tr><th>Nutriente</th><th>Ricetta</th><th>{whole ? "Porzioni" : "Target"}</th></tr></thead><tbody>
                {(Object.keys(NUTRIENT_LABELS) as (keyof typeof NUTRIENT_LABELS)[]).map((key) => <tr key={key}><th>{NUTRIENT_LABELS[key]}</th><td>{formatNumber(values[key], key === "kcal" ? 0 : 1)} {key === "kcal" ? "kcal" : "g"}</td><td>{whole ? recipe.servings : recipe.input.targets[key] === null ? "Non impostato" : `${key === "fiber" ? "Min. " : key === "kcal" && recipe.input.targets.strictCalories ? "Max. " : ""}${recipe.input.targets[key]} ${key === "kcal" ? "kcal" : "g"}`}</td></tr>)}
              </tbody></table>
              {recipe.deviations.map((deviation, index) => <p className="deviation" key={index}>{deviation}</p>)}
              <div className="nutrition-explanation"><strong>Come definiamo la compatibilita</strong><p>Target: calorie ± max(25 kcal, 5%); proteine ± max(3 g, 10%); carboidrati ± max(5 g, 10%); grassi ± max(2 g, 10%). Le fibre sono un minimo desiderato. Un massimo calorico obbligatorio non ha questa tolleranza.</p>
                <p>Grassi aggiunti: {formatNumber(recipe.fit.addedFatGrams, 1)} g per porzione. Zuccheri aggiunti: {recipe.fit.addedSugarGrams === null ? "dato non completo" : `${formatNumber(recipe.fit.addedSugarGrams, 1)} g`}.</p>
                {recipe.fit.caloricDensity !== null ? <p>Densita stimata: {formatNumber(recipe.fit.caloricDensity, 2)} kcal/g; dipende dalla resa effettiva in cottura.</p> : <p>Densita calorica non dichiarata: il peso finale cotto non e misurato.</p>}
                <p>{recipe.fit.nutritionSource}</p>
                <p>Valori medi stimati, non analisi del piatto. Controlla le etichette per allergeni e possibili contaminazioni. L&apos;app non prescrive diete mediche.</p>
              </div>
            </>}
            {tab === "swaps" && <>
              <div className="section-heading"><div><h2>Un ingrediente diverso?</h2><p>Ogni sostituzione crea una nuova ricetta con nuovi calcoli.</p></div></div>
              {recipe.substitutions.length === 0 ? <p className="muted">Non ci sono sostituzioni compatibili in questo catalogo. Torna al frigo per modificare gli alimenti.</p> :
                recipe.substitutions.map((swap, index) => <button disabled={busy} key={index} className="substitution-card" onClick={() => onSubstitute(swap.ingredientId, swap.replacementId)}>
                  <Shuffle size={19}/><span><strong>{getIngredient(swap.ingredientId)?.name} <span aria-hidden="true">→</span> {getIngredient(swap.replacementId)?.name}</strong><small>{swap.description}</small></span><ChevronRight size={17}/>
                </button>)}
              <p className="micro-copy bottom-note">La nuova disponibilita va confermata nel frigo. Non assumiamo equivalenza nutrizionale o assenza di allergeni.</p>
              <h3 className="variant-heading">Un&apos;altra presentazione</h3><p className="muted">{recipe.variantTip}</p>
            </>}
          </div>
        </section>
        <aside className="recipe-side">
          <div className="chef-note"><span className="eyebrow"><Sparkles size={15}/> IL TOCCO DEL CHEF</span><h2>Il gusto sta nei dettagli.</h2>{recipe.tips.map((tip, index) => <p key={index}>{tip}</p>)}</div>
          <div className="card variant-card"><h3>Rendila ancora piu tua</h3>
            <button onClick={() => onVariant("faster")} disabled={busy}><Zap size={18}/>Versione piu veloce<ChevronRight size={16}/></button>
            <button onClick={() => onVariant("protein")} disabled={busy}><Dumbbell size={18}/>Almeno 10% di proteine in piu<ChevronRight size={16}/></button>
            <button onClick={() => onVariant("lighter")} disabled={busy}><Flame size={18}/>Almeno 10% di calorie in meno<ChevronRight size={16}/></button>
            <button onClick={() => onVariant("sweet")} disabled={busy}><Sparkles size={18}/>Fammi una versione dolce<ChevronRight size={16}/></button>
            <p className="micro-copy">{mealBased ? "Le grammature del pasto rimangono fisse, anche nelle varianti. " : "Gli altri vincoli rimangono validi. "}Ti segnaliamo se la modifica non e possibile.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

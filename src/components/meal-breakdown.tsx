import { ArrowRight, LockKeyhole, Plus } from "lucide-react";
import { NUTRIENT_LABELS } from "@/lib/defaults";
import { formatNumber } from "@/lib/pantry";
import { recipeMealBreakdown } from "@/lib/meal";
import type { Recipe } from "@/lib/types";

export function MealBreakdown({ recipe }: { recipe: Recipe }) {
  const breakdown = recipeMealBreakdown(recipe);
  if (!breakdown) return null;
  const hasExtras = breakdown.extraItems.length > 0;
  return (
    <section className="card meal-breakdown" aria-labelledby="meal-breakdown-title">
      <div className="meal-breakdown-heading"><LockKeyhole size={19}/><div><h2 id="meal-breakdown-title">Il tuo pasto, con le aggiunte in chiaro</h2><p>Gli alimenti della dieta mantengono le grammature indicate. Tutti i valori qui sono per porzione.</p></div></div>
      <div className="meal-equation">
        <div><span>Pasto originale</span><strong data-testid="meal-base-kcal">{formatNumber(breakdown.base.kcal)} <small>kcal</small></strong><p>{breakdown.baseItems.map((item) => `${formatNumber(item.grams / recipe.servings, 1)} g ${item.name}`).join(" + ")}</p></div>
        <Plus size={20}/>
        <div className="meal-equation-extra"><span>Aggiunte effettive</span><strong data-testid="meal-extra-kcal">{formatNumber(breakdown.extras.kcal)} <small>kcal</small></strong><p>{hasExtras ? breakdown.extraItems.map((item) => `${formatNumber(item.grams / recipe.servings, 1)} g ${item.name}`).join(" + ") : "Nessuna aggiunta utilizzata."}</p></div>
        <ArrowRight size={20}/>
        <div><span>Ricetta completa</span><strong data-testid="meal-total-kcal">{formatNumber(recipe.nutritionPerServing.kcal)} <small>kcal</small></strong><p>Base invariata, presentazione e preparazione trasformate.</p></div>
      </div>
      <div className="meal-macro-scroll"><table className="macro-table meal-macro-table"><caption>Come cambiano i macros per porzione</caption><thead><tr><th>Nutriente</th><th>Pasto originale</th><th>Extra utilizzati</th><th>Ricetta</th></tr></thead><tbody>
        {(["protein", "carbs", "fat", "fiber"] as const).map((key) => <tr key={key}><th>{NUTRIENT_LABELS[key]}</th><td>{formatNumber(breakdown.base[key], 1)} g</td><td>+{formatNumber(breakdown.extras[key], 1)} g</td><td>{formatNumber(recipe.nutritionPerServing[key], 1)} g</td></tr>)}
      </tbody></table></div>
      <p className="micro-copy">Le aggiunte non sono nutrizionalmente gratuite e non fanno automaticamente parte della dieta prescritta. Valori medi stimati; piccoli scarti nella somma visualizzata dipendono dagli arrotondamenti.</p>
    </section>
  );
}

"use client";
import { useState } from "react";
import { INGREDIENTS } from "@/lib/catalog";
import { catalogFood, type FoodSnapshot } from "@/lib/nutrition-diary";
import { personalRecipeSchema, recipeNutrition, type PersonalRecipe } from "@/lib/personal-recipe";

type RecipeRow = { id: string; foodId: string; grams: string };
type Props = {
  recipes: PersonalRecipe[];
  personalFoods: FoodSnapshot[];
  onSave: (recipe: PersonalRecipe) => void;
  onDelete: (id: string) => void;
};

export function PersonalRecipeBuilder({ recipes, personalFoods, onSave, onDelete }: Props) {
  const [name, setName] = useState("");
  const [servings, setServings] = useState("2");
  const [cooked, setCooked] = useState("");
  const [rows, setRows] = useState<RecipeRow[]>([{ id: crypto.randomUUID(), foodId: "", grams: "" }]);
  const [error, setError] = useState("");
  const catalog = INGREDIENTS.map(item => catalogFood(item.id));
  const choices = [...personalFoods.filter(f=>!f.id.startsWith("recipe-")), ...catalog];
  const byId = new Map(choices.map(food=>[food.id,food]));
  const save = () => {
    try {
      const candidate = personalRecipeSchema.parse({
        id: crypto.randomUUID(), name, createdAt: new Date().toISOString(),
        servings: Number(servings), cookedWeightGrams: Number(cooked),
        items: rows.map(row => ({ food: byId.get(row.foodId), grams: Number(row.grams) })),
      });
      onSave(candidate);
      setName(""); setRows([{ id: crypto.randomUUID(), foodId: "", grams: "" }]);
      setCooked(""); setError("");
    } catch {
      setError("Controlla nome, ingredienti, grammi, porzioni e peso finale cotto. Non sono ammessi ingredienti duplicati.");
    }
  };
  return <section className="nf-card" aria-label="Ricette personali">
    <h2>Le mie ricette</h2>
    <p className="nf-muted">Crea una ricetta da ingredienti reali; specifica il peso finale dopo la cottura e quante porzioni ottieni. Per i pancake, indica quanti pancake produce l'impasto.</p>
    <div className="nf-grid">
      <label className="nf-field">Nome ricetta<input value={name} onChange={e=>setName(e.target.value)} placeholder="Pancake fatti in casa"/></label>
      <label className="nf-field">Numero di porzioni o pancake<input type="number" min="1" max="100" step="1" value={servings} onChange={e=>setServings(e.target.value)}/></label>
      <label className="nf-field">Peso finale cotto totale (g)<input type="number" min=".1" max="100000" step=".1" value={cooked} onChange={e=>setCooked(e.target.value)}/></label>
    </div>
    {rows.map(row => <div className="nf-food-row" key={row.id}>
      <div className="nf-grid">
        <label className="nf-field">Ingrediente<select value={row.foodId} onChange={e=>setRows(old=>old.map(x=>x.id===row.id?{...x,foodId:e.target.value}:x))}>
          <option value="">Seleziona un ingrediente</option>
          {choices.map(food=><option key={food.id} value={food.id}>{food.name} — {food.state}</option>)}
        </select></label>
        <label className="nf-field">Grammi nell'impasto<input type="number" min=".1" max="5000" step=".1" value={row.grams} onChange={e=>setRows(old=>old.map(x=>x.id===row.id?{...x,grams:e.target.value}:x))}/></label>
      </div>
      <button type="button" className="nf-text-button" onClick={()=>setRows(old=>old.filter(x=>x.id!==row.id))}>Rimuovi ingrediente</button>
    </div>)}
    <button type="button" className="nf-text-button" onClick={()=>setRows(old=>[...old,{id:crypto.randomUUID(),foodId:"",grams:""}])}>Aggiungi ingrediente</button>
    <p className="nf-muted">Se manca un prodotto, crealo prima nel Diario → I miei alimenti. I nutrienti della ricetta sono stime calcolate dai valori degli ingredienti.</p>
    <button type="button" className="nf-button" onClick={save}>Salva ricetta e alimento riutilizzabile</button>
    {error && <p className="nf-alert" role="alert">{error}</p>}
    {recipes.map(recipe=>{
      const n=recipeNutrition(recipe);
      return <div className="nf-food-row" key={recipe.id}>
        <strong>{recipe.name}</strong>
        <p>{recipe.servings} porzioni · {Math.round(n.servingGrams*10)/10} g/porzione · {Math.round(n.perServing.kcal)} kcal · P {n.perServing.protein.toFixed(1)} g · C {n.perServing.carbs.toFixed(1)} g · G {n.perServing.fat.toFixed(1)} g</p>
        <details><summary>Ingredienti</summary>{recipe.items.map(item=><p key={item.food.id}>{item.food.name}: {item.grams} g</p>)}</details>
        <button type="button" className="nf-text-button" onClick={()=>{if(window.confirm(`Eliminare "${recipe.name}"? Lo storico del diario rimane invariato.`))onDelete(recipe.id);}}>Elimina ricetta</button>
      </div>;
    })}
  </section>;
}

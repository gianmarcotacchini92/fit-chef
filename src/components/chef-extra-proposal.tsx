"use client";

import { ChefHat, Flame } from "lucide-react";
import { getIngredient } from "@/lib/catalog";
import type { ChefExtraProposal as Proposal } from "@/lib/meal";
import { formatNumber } from "@/lib/pantry";

export function ChefExtraProposal({ proposal }: { proposal: Proposal }) {
  return <div className="chef-extra-proposal">
    <div className="meal-part-title"><ChefHat size={20}/><h3>L&apos;idea dello chef</h3></div>
    <strong className="chef-proposal-title">{proposal.title}</strong>
    <p>{proposal.description}</p>
    <ul className="chef-proposal-ingredients">{proposal.extras.map((extra) => {
      const food = getIngredient(extra.ingredientId)!;
      return <li key={extra.ingredientId}><span>{food.emoji} <strong>{food.name}</strong> · fino a {formatNumber(extra.grams, 1)} g / porzione</span><small>{extra.reason}</small></li>;
    })}</ul>
    <p className="chef-proposal-energy"><Flame size={16}/>Fino a +{formatNumber(proposal.maximumKcal)} kcal per porzione, se usati tutti.</p>
    <p className="micro-copy">Nessuna aggiunta e gia autorizzata. Conferma solo cio che hai: i grammi degli alimenti della dieta restano invariati e gli extra vengono conteggiati separatamente.</p>
  </div>;
}

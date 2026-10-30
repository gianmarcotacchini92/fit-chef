"use client";

import { CalendarDays, ChevronRight } from "lucide-react";
import { WEEK_DAYS, WEEK_MEALS } from "@/lib/weekly-diet";
import type { WeekDay, WeeklyDietState } from "@/lib/types";

const byJsDay: WeekDay[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function dayForDiaryDate(date: string): WeekDay | null {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) return null;
  const day = new Date(`${date}T12:00:00`);
  return Number.isNaN(day.getTime()) ? null : byJsDay[day.getDay()];
}

/** Read-only preview: never creates diary entries or assumes meals were eaten. */
export function WeeklyPlanPreview({ date, state, onOpen }: {
  date: string; state: WeeklyDietState; onOpen: (day: WeekDay) => void;
}) {
  const day = dayForDiaryDate(date);
  const plan = day && state.plan?.[day];
  return <section className="nf-card nf-plan-preview" aria-label="Anteprima piano settimanale">
    <div className="nf-plan-preview-heading">
      <div><p className="nf-eyebrow">IL TUO PROGRAMMA</p><h2>La dieta del giorno</h2>
        <p className="nf-muted">{day ? WEEK_DAYS.find((entry) => entry.id === day)?.label : "Seleziona una data"} · pianificato, non consumato</p>
      </div>
      <button type="button" className="nf-text-button" onClick={() => day && onOpen(day)} disabled={!day}>
        <CalendarDays size={16}/> Apri la dieta <ChevronRight size={16}/>
      </button>
    </div>
    {!plan ? <p className="nf-muted">Non hai ancora importato un piano settimanale. Apri «La mia dieta» per caricarlo.</p>
      : <div className="nf-plan-preview-grid">{WEEK_MEALS.map(({ id, label }) =>
        <button type="button" key={id} className="nf-plan-preview-meal" onClick={() => onOpen(day!)}>
          <span className="nf-plan-preview-meal-label">{label}</span>
          <span className="nf-plan-preview-meal-copy">{plan[id].original}</span>
          <ChevronRight size={16} aria-hidden="true"/>
        </button>)}</div>}
  </section>;
}

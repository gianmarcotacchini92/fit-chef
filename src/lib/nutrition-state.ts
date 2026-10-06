import { z } from "zod";
import { diaryEntrySchema, savedMealSchema } from "./nutrition-diary";
import { macroTargetsSchema, profileSchema } from "./nutrition-profile";

export const nutritionCheckInSchema = z.strictObject({
  id: z.string().uuid(),
  date: diaryEntrySchema.shape.date,
  createdAt: z.iso.datetime(),
  profile: profileSchema,
  targets: macroTargetsSchema,
});

export const nutritionStateSchema = z.strictObject({
  version: z.literal(1),
  profile: profileSchema.optional(),
  targets: macroTargetsSchema.optional(),
  entries: z.array(diaryEntrySchema).max(3000),
  savedMeals: z.array(savedMealSchema).max(100),
  checkIns: z.array(nutritionCheckInSchema).max(365),
}).superRefine((state, ctx) => {
  for (const field of ["entries", "savedMeals", "checkIns"] as const) {
    if (new Set(state[field].map((item) => item.id)).size !== state[field].length) {
      ctx.addIssue({ code: "custom", path: [field], message: "Identificativi duplicati." });
    }
  }
  if (Boolean(state.profile) !== Boolean(state.targets)) {
    ctx.addIssue({ code: "custom", message: "Profilo e obiettivi devono essere confermati insieme." });
  }
});

export type NutritionState = z.infer<typeof nutritionStateSchema>;
export const emptyNutritionState = (): NutritionState => ({
  version: 1, entries: [], savedMeals: [], checkIns: [],
});

export function targetsOnDate(state: NutritionState, date: string) {
  if (!state.checkIns.length) return state.targets;
  return [...state.checkIns].filter((entry) => entry.date <= date)
    .sort((left, right) => right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt))[0]?.targets;
}

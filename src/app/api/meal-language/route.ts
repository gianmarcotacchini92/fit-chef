import { mealLanguageRequest, interpretMealLanguage } from "@/lib/server/meal-language";
import { ApiError, assertMutation, errorResponse, exclusive, getSession, hasAiConsent, rateLimit, readBoundedJson, responseJson, type Session } from "@/lib/server/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  let session: Session | undefined;
  try {
    assertMutation(request);
    if (!hasAiConsent(request)) throw new ApiError(403, "Conferma l'invio della descrizione a OpenAI prima di interpretarla con AI.");
    const parsed = mealLanguageRequest.safeParse(await readBoundedJson(request, 8192));
    if (!parsed.success) throw new ApiError(400, "Descrivi il pasto con un testo di massimo 1500 caratteri.");
    session = getSession(request);
    rateLimit(session, "text");
    const language = await exclusive(session, () => interpretMealLanguage(parsed.data.text));
    return responseJson(language, 200, session, request);
  } catch (error) { return errorResponse(error, "meal-language", session, request); }
}

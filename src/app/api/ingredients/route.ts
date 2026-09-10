import { INGREDIENTS, CATALOG_VERSION } from "@/lib/catalog";
import { assertLocalRequest, ApiError, errorResponse, responseJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "q") || params.getAll("q").length > 1) {
      throw new ApiError(400, "Parametro di ricerca non valido. Usa q.");
    }
    const query = params.get("q")?.trim() ?? "";
    if (query.length > 100 || /[\u0000-\u001f]/.test(query)) throw new ApiError(400, "Ricerca troppo lunga o non valida.");
    const needle = normalize(query);
    const ingredients = query
      ? INGREDIENTS.filter((ingredient) =>
        [ingredient.name, ...ingredient.aliases].some((name) => normalize(name).includes(needle)))
      : INGREDIENTS;
    return responseJson({ ingredients, catalogVersion: CATALOG_VERSION });
  } catch (error) { return errorResponse(error, "ingredients"); }
}

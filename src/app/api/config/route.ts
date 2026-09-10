import { CATALOG_VERSION } from "@/lib/catalog";
import { aiConfiguration } from "@/lib/server/ai";
import { assertLocalRequest, errorResponse, getSession, responseJson } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    const session = getSession(request);
    const { aiTextAvailable, aiImagesAvailable } = aiConfiguration();
    return responseJson({
      aiTextAvailable, aiImagesAvailable, catalogVersion: CATALOG_VERSION, storageMode: "browser",
    }, 200, session, request);
  } catch (error) { return errorResponse(error, "config"); }
}

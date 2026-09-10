import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertLocalRequest, errorResponse, responseJson } from "@/lib/server/security";
import { weeklyPlanSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertLocalRequest(request);
    let contents: string;
    try {
      contents = await readFile(join(process.cwd(), ".data", "weekly-diet-import.json"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return responseJson({ plan: null });
      throw error;
    }
    return responseJson({ plan: weeklyPlanSchema.parse(JSON.parse(contents)) });
  } catch (error) {
    return errorResponse(error, "weekly-diet");
  }
}

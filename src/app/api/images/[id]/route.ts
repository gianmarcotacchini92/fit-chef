import { loadImage } from "@/lib/server/images";
import { assertLocalRequest, errorResponse } from "@/lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalRequest(request);
    const { id } = await context.params;
    const image = await loadImage(id);
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(image.length),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) { return errorResponse(error, "image-file"); }
}

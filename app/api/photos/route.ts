import { json, mapsFailure, withinRequestBudget } from "@/lib/api";
import { getPhotoUrl, photoNameSchema, photosEnabled } from "@/server/photos";

export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!photosEnabled())
    return json(
      { error: "Photos are unavailable with this configuration." },
      404,
    );
  const parsed = photoNameSchema.safeParse(
    new URL(request.url).searchParams.get("name"),
  );
  if (!parsed.success)
    return json({ error: "Select a valid listing photo." }, 400);
  if (!withinRequestBudget("photos", 20))
    return json(
      {
        error: "Please wait before loading more photos.",
        retryAfterSeconds: 60,
      },
      429,
    );
  try {
    const uri = await getPhotoUrl(parsed.data, request.signal);
    return new Response(null, {
      status: 302,
      headers: { Location: uri, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return mapsFailure(error, "Photo unavailable.");
  }
}

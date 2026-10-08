import { json, mapsFailure, stopsSchema, withinRequestBudget } from "@/lib/api";
import { getRoadRoute } from "@/server/providers";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!withinRequestBudget("trip-stops", 30))
    return json(
      {
        error: "Please wait before updating the route again.",
        retryAfterSeconds: 60,
      },
      429,
    );
  const parsed = stopsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return json(
      { error: "Select valid locations and up to 9 charging stops." },
      400,
    );
  const { start, destination, stops } = parsed.data;
  try {
    return json({
      route: await getRoadRoute(start, destination, stops, request.signal),
    });
  } catch (error) {
    return mapsFailure(
      error,
      "The route could not be updated. Please try again.",
    );
  }
}

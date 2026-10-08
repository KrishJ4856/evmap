import {
  json,
  mapsFailure,
  nearbySchema,
  withinRequestBudget,
} from "@/lib/api";
import { getStations } from "@/server/providers";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!withinRequestBudget("stations", 8))
    return json(
      {
        error: "Please wait a minute before searching again.",
        retryAfterSeconds: 60,
      },
      429,
    );
  const parsed = nearbySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return json({ error: "Choose a valid starting point." }, 400);
  try {
    return json({
      ...(await getStations(
        parsed.data.start,
        parsed.data.radiusKm,
        undefined,
        request.signal,
      )),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return mapsFailure(
      error,
      "Chargers could not be loaded. Please try again.",
    );
  }
}

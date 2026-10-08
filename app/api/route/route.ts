import { json, mapsFailure, tripSchema, withinRequestBudget } from "@/lib/api";
import { haversine } from "@/shared/geo";
import { getRoadRoute, getTripStations, isMapsError } from "@/server/providers";

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
  const parsed = tripSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return json({ error: "Select a starting point and destination." }, 400);
  const { start, destination } = parsed.data;
  if (haversine(start, destination) < 0.1)
    return json(
      { error: "Choose a destination at least 100 metres from the start." },
      400,
    );
  try {
    const route = await getRoadRoute(start, destination, [], request.signal);
    try {
      return json({
        ...(await getTripStations(start, destination, route, request.signal)),
        route,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      return json({
        stations: [],
        route,
        provider: "Google Maps",
        fetchedAt: new Date().toISOString(),
        warning: isMapsError(error)
          ? error.message
          : "Chargers could not be loaded. Please try again.",
        searchStatus: "unavailable",
        ...(isMapsError(error) && error.retryAfterSeconds
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      });
    }
  } catch (error) {
    return mapsFailure(
      error,
      "The route could not be loaded. Please try again.",
    );
  }
}

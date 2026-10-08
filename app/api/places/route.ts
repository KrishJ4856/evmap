import { z } from "zod";
import { json, mapsFailure, withinRequestBudget } from "@/lib/api";
import { getPlace, searchPlaces, textSearchPlaces } from "@/server/providers";

export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!withinRequestBudget("places", 90))
    return json(
      { error: "Please wait before searching again.", retryAfterSeconds: 60 },
      429,
    );
  const parsed = z
    .object({
      q: z.string().trim().min(2).max(250).optional(),
      id: z
        .string()
        .regex(/^[a-zA-Z0-9_-]+$/)
        .max(250)
        .optional(),
      sessionToken: z.string().uuid().optional(),
      mode: z.enum(["autocomplete", "text"]).default("autocomplete"),
    })
    .refine((p) => Boolean(p.id || p.q))
    .safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success)
    return json({ error: "Enter a place name or address." }, 400);
  try {
    const { q, id, sessionToken, mode } = parsed.data;
    if (id)
      return json({ place: await getPlace(id, sessionToken, request.signal) });
    if (mode === "text")
      return json({ places: await textSearchPlaces(q!, request.signal) });
    if (!sessionToken)
      return json({ error: "A search session is required." }, 400);
    return json({
      places: await searchPlaces(q!, sessionToken, request.signal),
    });
  } catch (error) {
    return mapsFailure(error, "Place search is temporarily unavailable.");
  }
}

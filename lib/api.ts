import { z } from "zod";
import { NextResponse } from "next/server";
import { MAX_TRIP_STOPS } from "@/shared/trip";
import { isMapsError } from "@/server/google-client";

export const coordinateSchema = z.object({
  lat: z.number().finite().min(-85).max(85),
  lng: z.number().finite().min(-180).max(180),
  id: z.string().max(250).optional(),
});
export const nearbySchema = z.object({
  start: coordinateSchema,
  radiusKm: z.literal(5).default(5),
});
export const tripSchema = z.object({
  start: coordinateSchema,
  destination: coordinateSchema,
  radiusKm: z.literal(5).default(5),
});
export const stopsSchema = z.object({
  start: coordinateSchema,
  destination: coordinateSchema,
  stops: z.array(coordinateSchema).max(MAX_TRIP_STOPS),
});
export const json = (body: unknown, status = 200) => {
  const retry = (body as { retryAfterSeconds?: number } | null)
    ?.retryAfterSeconds;
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(retry ? { "Retry-After": String(retry) } : {}),
    },
  });
};
export function mapsFailure(error: unknown, fallback: string) {
  return json(
    {
      error: isMapsError(error) ? error.message : fallback,
      ...(isMapsError(error) && error.retryAfterSeconds
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    },
    isMapsError(error) ? error.status : 503,
  );
}

// A small process-wide budget bounds paid Google API requests for this experiment.
// Production at scale should use a shared rate limiter (Redis or platform equivalent).
const windows = new Map<string, { start: number; count: number }>();
export function withinRequestBudget(bucket: string, limit: number): boolean {
  const now = Date.now();
  const window = windows.get(bucket);
  if (!window || now - window.start > 60000) {
    windows.set(bucket, { start: now, count: 1 });
    return true;
  }
  window.count++;
  return window.count <= limit;
}

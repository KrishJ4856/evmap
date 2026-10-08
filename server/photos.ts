import { z } from "zod";
import { googleRequest, MapsError } from "./google-client";

export const photoNameSchema = z
  .string()
  .max(1600)
  .regex(/^places\/[a-zA-Z0-9_-]+\/photos\/[a-zA-Z0-9_-]+$/);
export const photosEnabled = () =>
  process.env.GOOGLE_MAPS_PHOTOS_ENABLED === "true";

export async function getPhotoUrl(name: string, signal?: AbortSignal) {
  const data = await googleRequest<{ photoUri?: string }>(
    `https://places.googleapis.com/v1/${photoNameSchema.parse(name)}/media?maxWidthPx=900&maxHeightPx=600&skipHttpRedirect=true`,
    "",
    undefined,
    signal,
  );
  const address = new URL(data.photoUri || "", "https://invalid.local");
  if (
    address.protocol !== "https:" ||
    !address.hostname.endsWith(".googleusercontent.com")
  )
    throw new MapsError("Photo unavailable.", 404);
  return address.href;
}

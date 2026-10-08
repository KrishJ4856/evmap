import type { Coordinate } from "./types";

function valid(lat: number, lng: number): Coordinate | null {
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 85 &&
    Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
}
/** Exact pin coordinates only. Google URLs' @lat,lng is a camera, NOT the destination. */
export function parsePin(input: string): Coordinate | null {
  const pair = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(input);
  if (pair) return valid(Number(pair[1]), Number(pair[2]));
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      !/^(www\.)?google\.(com|co\.in)$|^maps\.google\.(com|co\.in)$/.test(
        url.hostname,
      ) ||
      !url.pathname.startsWith("/maps")
    )
      return null;
    const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(
      decodeURIComponent(url.href),
    );
    if (pin) return valid(Number(pin[1]), Number(pin[2]));
    return parseCoordinateQuery(
      url.searchParams.get("query") || url.searchParams.get("q") || "",
    );
  } catch {
    return null;
  }
}
function parseCoordinateQuery(query: string): Coordinate | null {
  const match = /^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/.exec(query);
  return match ? valid(Number(match[1]), Number(match[2])) : null;
}

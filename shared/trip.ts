import type { Coordinate, Station } from "./types";

export const MAX_DETOUR_KM = 20;
export const MAX_TRIP_STOPS = 9;
// Allow 50 m for polyline precision and the offset between a listing pin and its entrance.
export const ON_ROUTE_TOLERANCE_KM = 0.05;

export function isOnRoute(station: Station) {
  return (
    station.detourKm !== undefined &&
    station.detourKm <= ON_ROUTE_TOLERANCE_KM &&
    station.offRouteKm !== undefined &&
    station.offRouteKm <= ON_ROUTE_TOLERANCE_KM
  );
}

export function withinDetour(station: Station, limitKm: number) {
  return limitKm === 0
    ? isOnRoute(station)
    : station.detourKm !== undefined && station.detourKm <= limitKm;
}

export function detourLabel(station: Station) {
  if (isOnRoute(station)) return "On route";
  if (station.detourKm === undefined) return "Detour unavailable";
  return `${station.detourKm < 0.1 ? "<0.1" : station.detourKm.toFixed(1)} km detour`;
}

export function orderStops(stops: Station[]) {
  return [
    ...new Map(stops.map((station) => [station.id, station])).values(),
  ].sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id));
}

export function googlePlaceId(point: Coordinate & { id?: string }) {
  return point.id &&
    !point.id.startsWith("pin-") &&
    point.id !== "device-location"
    ? point.id
    : undefined;
}

/** Split longer trips into continuous legs instead of dropping unsupported waypoints. */
export function googleMapsDirections(
  start: Coordinate & { id?: string },
  destination: Coordinate & { id?: string },
  stops: Station[],
  maxWaypoints = MAX_TRIP_STOPS,
) {
  const points = [start, ...orderStops(stops), destination];
  const links: string[] = [];
  const waypointLimit = Math.max(0, Math.floor(maxWaypoints));
  let index = 0;
  while (index < points.length - 1) {
    const endIndex = Math.min(index + waypointLimit + 1, points.length - 1);
    const origin = points[index],
      end = points[endIndex];
    const waypoints = points.slice(index + 1, endIndex);
    const coords = (p: Coordinate) => `${p.lat},${p.lng}`;
    const params = new URLSearchParams({
      api: "1",
      origin: coords(origin),
      destination: coords(end),
      travelmode: "driving",
    });
    const originId = googlePlaceId(origin),
      destinationId = googlePlaceId(end);
    if (originId) params.set("origin_place_id", originId);
    if (destinationId) params.set("destination_place_id", destinationId);
    if (waypoints.length) {
      params.set("waypoints", waypoints.map(coords).join("|"));
      params.set(
        "waypoint_place_ids",
        waypoints.map((p) => googlePlaceId(p)).join("|"),
      );
    }
    links.push(`https://www.google.com/maps/dir/?${params}`);
    index = endIndex;
  }
  return links;
}

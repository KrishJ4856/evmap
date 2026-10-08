import type { Coordinate } from "./types";

const EARTH_KM = 6371.0088;
const rad = (degrees: number) => (degrees * Math.PI) / 180;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function haversine(a: Coordinate, b: Coordinate): number {
  const lat = rad(b.lat - a.lat);
  const lng = rad(b.lng - a.lng);
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(lng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(clamp(h, 0, 1)));
}

function bearing(a: Coordinate, b: Coordinate): number {
  const delta = rad(b.lng - a.lng);
  return Math.atan2(
    Math.sin(delta) * Math.cos(rad(b.lat)),
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
      Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(delta),
  );
}

/** Spherical point-to-segment distance, including both endpoint caps. */
export function segmentDistance(
  point: Coordinate,
  a: Coordinate,
  b: Coordinate,
): { distanceKm: number; alongKm: number } {
  const length = haversine(a, b);
  if (length < 0.000001) return { distanceKm: haversine(point, a), alongKm: 0 };
  const angular = haversine(a, point) / EARTH_KM;
  const angle = bearing(a, point) - bearing(a, b);
  const along =
    Math.atan2(Math.sin(angular) * Math.cos(angle), Math.cos(angular)) *
    EARTH_KM;
  if (along <= 0) return { distanceKm: haversine(point, a), alongKm: 0 };
  if (along >= length)
    return { distanceKm: haversine(point, b), alongKm: length };
  return {
    distanceKm: Math.abs(
      Math.asin(clamp(Math.sin(angular) * Math.sin(angle), -1, 1)) * EARTH_KM,
    ),
    alongKm: along,
  };
}

export function routeProximity(
  point: Coordinate,
  route: Coordinate[],
): { distanceKm: number; alongKm: number } {
  if (route.length === 0) return { distanceKm: Infinity, alongKm: 0 };
  if (route.length === 1)
    return { distanceKm: haversine(point, route[0]), alongKm: 0 };
  let best = { distanceKm: Infinity, alongKm: 0 };
  let travelled = 0;
  for (let i = 1; i < route.length; i++) {
    const candidate = segmentDistance(point, route[i - 1], route[i]);
    if (candidate.distanceKm < best.distanceKm)
      best = {
        distanceKm: candidate.distanceKm,
        alongKm: travelled + candidate.alongKm,
      };
    travelled += haversine(route[i - 1], route[i]);
  }
  return best;
}

export function routeLength(route: Coordinate[]): number {
  return route
    .slice(1)
    .reduce((total, point, i) => total + haversine(route[i], point), 0);
}

/** Iterative Douglas–Peucker; tolerance is kilometres, not coordinate degrees. */
export function simplifyRoute(
  points: Coordinate[],
  toleranceKm = 0.1,
): Coordinate[] {
  if (points.length < 3) return points;
  const kept = new Set([0, points.length - 1]);
  const pending: [number, number][] = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop()!;
    let farthest = toleranceKm;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const distance = segmentDistance(
        points[i],
        points[start],
        points[end],
      ).distanceKm;
      if (distance > farthest) {
        farthest = distance;
        index = i;
      }
    }
    if (index !== -1) {
      kept.add(index);
      pending.push([start, index], [index, end]);
    }
  }
  return [...kept].sort((a, b) => a - b).map((index) => points[index]);
}

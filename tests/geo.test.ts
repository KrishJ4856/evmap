import { describe, expect, it } from "vitest";
import {
  haversine,
  routeLength,
  routeProximity,
  segmentDistance,
  simplifyRoute,
} from "../shared/geo";

describe("route corridor geometry", () => {
  const straight = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 1 },
  ];
  it("measures distance in kilometres", () => {
    expect(haversine(straight[0], straight[1])).toBeCloseTo(111.195, 2);
  });
  it("includes a station within 5 km at the midpoint, far from either endpoint", () => {
    const station = { lat: 0.04, lng: 0.5 };
    expect(haversine(station, straight[0])).toBeGreaterThan(50);
    expect(routeProximity(station, straight).distanceKm).toBeLessThan(5);
    expect(routeProximity(station, straight).alongKm).toBeCloseTo(55.5975, 2);
  });
  it("excludes stations outside the 5 km boundary", () => {
    expect(
      routeProximity({ lat: 0.046, lng: 0.5 }, straight).distanceKm,
    ).toBeGreaterThan(5);
  });
  it("includes both endpoint caps but does not extend the route infinitely", () => {
    expect(
      segmentDistance(
        { lat: 0, lng: -0.04 },
        ...(straight as [(typeof straight)[0], (typeof straight)[0]]),
      ).distanceKm,
    ).toBeLessThan(5);
    expect(
      routeProximity({ lat: 0, lng: 1.04 }, straight).distanceKm,
    ).toBeLessThan(5);
    expect(
      routeProximity({ lat: 0, lng: 1.1 }, straight).distanceKm,
    ).toBeGreaterThan(5);
  });
  it("follows road bends rather than the endpoint chord", () => {
    const bent = [straight[0], { lat: 1, lng: 0 }, { lat: 1, lng: 1 }];
    expect(
      routeProximity({ lat: 1.02, lng: 0.5 }, bent).distanceKm,
    ).toBeLessThan(5);
    expect(
      routeProximity({ lat: 0.5, lng: 0.5 }, bent).distanceKm,
    ).toBeGreaterThan(50);
    expect(routeProximity({ lat: 1, lng: 0.5 }, bent).alongKm).toBeCloseTo(
      166.78,
      1,
    );
  });
  it("handles identical points, empty routes, and the antimeridian", () => {
    expect(routeProximity(straight[0], []).distanceKm).toBe(Infinity);
    expect(routeProximity(straight[0], [straight[0]]).distanceKm).toBe(0);
    expect(
      segmentDistance(straight[1], straight[0], straight[0]).distanceKm,
    ).toBeCloseTo(111.195, 2);
    expect(
      routeProximity({ lat: 0.02, lng: 180 }, [
        { lat: 0, lng: 179 },
        { lat: 0, lng: -179 },
      ]).distanceKm,
    ).toBeLessThan(5);
  });
  it("simplifies a line while retaining significant bends and its endpoints", () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0.0001, lng: 0.1 },
      { lat: 0, lng: 0.2 },
      { lat: 0.2, lng: 0.2 },
      { lat: 0.2, lng: 0.3 },
    ];
    const simplified = simplifyRoute(points, 0.1);
    expect(simplified).toEqual([points[0], points[2], points[3], points[4]]);
    expect(routeLength(simplified)).toBeGreaterThan(50);
  });
});

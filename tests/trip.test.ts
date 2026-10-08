import { describe, expect, it } from "vitest";
import {
  googleMapsDirections,
  isOnRoute,
  orderStops,
  withinDetour,
} from "../shared/trip";
import type { Station } from "../shared/types";

const station = (
  id: string,
  distanceKm: number,
  detourKm = 0,
  offRouteKm = 0,
): Station => ({
  id,
  distanceKm,
  detourKm,
  offRouteKm,
  lat: 0,
  lng: distanceKm / 100,
  name: id,
  address: "Address",
  connectors: [],
  businessStatus: "UNKNOWN",
  sourceUrl: "",
  attributions: [],
});

describe("trip planning", () => {
  it("zero detour requires both road access and proximity, within a 50 m mapping tolerance", () => {
    expect(withinDetour(station("on-road", 1, 0.04, 0.04), 0)).toBe(true);
    expect(withinDetour(station("other-carriageway", 1, 3, 0.01), 0)).toBe(
      false,
    );
    expect(isOnRoute(station("shortcut", 1, 0, 0.1))).toBe(false);
    expect(
      withinDetour({ ...station("unknown", 1), detourKm: undefined }, 20),
    ).toBe(false);
    expect(withinDetour(station("boundary", 1, 20), 20)).toBe(true);
    expect(withinDetour(station("beyond", 1, 20.001), 20)).toBe(false);
  });
  it("deduplicates and orders stops by progress, independent of click order", () => {
    const late = station("late", 80),
      early = station("early", 10);
    const selected = [late, early, late];
    expect(orderStops(selected).map((s) => s.id)).toEqual(["early", "late"]);
    expect(selected).toHaveLength(3);
  });
  it("exports exact endpoints and ordered station place IDs without synthetic IDs", () => {
    const start = { id: "device-location", lat: 1, lng: 2 },
      destination = { id: "google-destination", lat: 3, lng: 4 };
    const [link] = googleMapsDirections(start, destination, [
      station("late", 80),
      station("early", 10),
    ]);
    const params = new URL(link).searchParams;
    expect(params.get("origin")).toBe("1,2");
    expect(params.has("origin_place_id")).toBe(false);
    expect(params.get("destination_place_id")).toBe("google-destination");
    expect(params.get("waypoint_place_ids")).toBe("early|late");
    expect(params.get("waypoints")).toBe("0,0.1|0,0.8");
  });
  it("keeps every stop in continuous mobile legs with at most three intermediate waypoints", () => {
    const start = { id: "pin-start", lat: 1, lng: 2 },
      destination = { id: "destination", lat: 3, lng: 4 };
    for (const count of [0, 3, 4, 7, 8, 9]) {
      const stops = Array.from({ length: count }, (_, i) =>
        station(`s-${i}`, i + 1),
      );
      const links = googleMapsDirections(
        start,
        destination,
        stops.reverse(),
        3,
      ).map((link) => new URL(link).searchParams);
      const visited: string[] = [];
      links.forEach((params, i) => {
        const ids = params.get("waypoint_place_ids")?.split("|") ?? [];
        expect(ids.length).toBeLessThanOrEqual(3);
        visited.push(...ids);
        if (i < links.length - 1) {
          visited.push(params.get("destination_place_id")!);
          expect(links[i + 1].get("origin")).toBe(params.get("destination"));
        }
      });
      expect(visited).toEqual(
        Array.from({ length: count }, (_, i) => `s-${i}`),
      );
      expect(links.at(-1)?.get("destination_place_id")).toBe("destination");
    }
  });
});

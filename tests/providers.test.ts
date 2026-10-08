import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPlace,
  getRoadRoute,
  getStations,
  getTripStations,
  normalizeGooglePlace,
  searchPlaces,
  textSearchPlaces,
} from "../server/providers";
import { decodePolyline, encodePolyline } from "../shared/polyline";
import { parsePin } from "../shared/location-input";
import type { TripRoute } from "../shared/types";

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
let credentialVersion = 0;
const session = "6c6f6419-31bb-47ed-adc9-d0fbef08a991";
beforeEach(() => {
  vi.stubEnv(
    "GOOGLE_MAPS_SERVER_API_KEY",
    `unit-test-private-key-${++credentialVersion}`,
  );
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Google-only providers", () => {
  it("searches businesses and landmarks without a city restriction or wrong-city bias", async () => {
    fetchMock.mockResolvedValue(
      reply({
        suggestions: [
          {
            placePrediction: {
              placeId: "temple-id",
              structuredFormat: {
                mainText: { text: "ISKCON Kolkata" },
                secondaryText: { text: "Albert Road, Kolkata" },
              },
            },
          },
        ],
      }),
    );
    expect(await searchPlaces("iskcon kolkata", session)).toEqual([
      {
        id: "temple-id",
        label: "ISKCON Kolkata",
        subtitle: "Albert Road, Kolkata",
      },
    ]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    const body = JSON.parse(options.body);
    expect(body.input).toBe("iskcon kolkata");
    expect(body.sessionToken).toBe(session);
    expect(body.includedPrimaryTypes).toBeUndefined();
    expect(body.locationBias).toBeUndefined();
    expect(body.locationRestriction).toBeUndefined();
    expect(options.cache).toBe("no-store");
  });
  it("resolves the exact selected place using the same session token", async () => {
    fetchMock.mockResolvedValue(
      reply({
        id: "temple-id",
        displayName: { text: "ISKCON Kolkata" },
        formattedAddress: "Kolkata",
        location: { latitude: 22.54, longitude: 88.35 },
      }),
    );
    expect((await getPlace("temple-id", session)).lat).toBe(22.54);
    expect(fetchMock.mock.calls[0][0]).toContain(`sessionToken=${session}`);
    expect(fetchMock.mock.calls[0][1].headers["X-Goog-FieldMask"]).toContain(
      "location",
    );
  });
  it("offers exact Google text search, with no fake fallback", async () => {
    fetchMock.mockResolvedValue(reply({ places: [] }));
    expect(await textSearchPlaces("newly added address")).toEqual([]);
    expect(fetchMock.mock.calls[0][0]).toContain("places:searchText");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).textQuery).toBe(
      "newly added address",
    );
  });
  it("keeps listing status separate from connector availability and preserves zero counts", () => {
    const station = normalizeGooglePlace({
      id: "station",
      location: { latitude: 22, longitude: 88 },
      businessStatus: "OPERATIONAL",
      evChargeOptions: {
        connectorAggregation: [
          {
            type: "EV_CONNECTOR_TYPE_CCS_COMBO_2",
            maxChargeRateKw: 60,
            count: 2,
            availableCount: 0,
            outOfServiceCount: 1,
            availabilityLastUpdateTime: "2026-10-04T08:00:00Z",
          },
          { type: "EV_CONNECTOR_TYPE_UNSPECIFIED_GB_T" },
        ],
      },
    });
    expect(station?.businessStatus).toBe("OPERATIONAL");
    expect(station).not.toHaveProperty("status");
    expect(station?.connectors[0]).toMatchObject({
      type: "CCS2",
      powerKW: 60,
      quantity: 2,
      available: 0,
      outOfService: 1,
    });
    expect(station?.connectors[1].type).toBe("GB/T");
    expect(station?.phone).toBeUndefined();
    expect(station?.hours).toBeUndefined();
    expect(station?.connectors[1].powerKW).toBeUndefined();
    expect(normalizeGooglePlace({ id: "bad" })).toBeNull();
  });
  it("fetches Google driving geometry and uses place IDs for road entrances", async () => {
    const points = [
      { lat: 22, lng: 88 },
      { lat: 22.1, lng: 88.1 },
    ];
    fetchMock.mockResolvedValue(
      reply({
        routes: [
          {
            distanceMeters: 18000,
            duration: "1200s",
            polyline: { encodedPolyline: encodePolyline(points) },
          },
        ],
      }),
    );
    const route = await getRoadRoute(
      { ...points[0], id: "place-origin" },
      { ...points[1], id: "pin-end" },
    );
    expect(route.coordinates).toEqual(points);
    expect(route.source).toBe("Google Maps");
    expect(route.durationMinutes).toBe(20);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.origin).toEqual({ placeId: "place-origin" });
    expect(body.destination.location.latLng.latitude).toBe(22.1);
  });
  it("paginates and filters stations against the whole 5 km route, deduplicating IDs", async () => {
    const coordinates = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.8 },
    ];
    const route: TripRoute = {
      coordinates,
      encodedPolyline: encodePolyline(coordinates),
      distanceKm: 89,
      durationMinutes: 100,
      source: "Google Maps",
    };
    const near = {
      id: "middle",
      displayName: { text: "Middle charger" },
      location: { latitude: 0.04, longitude: 0.4 },
    };
    const far = { id: "outside", location: { latitude: 0.05, longitude: 0.4 } };
    fetchMock.mockImplementation(async (url: string, opts: RequestInit) =>
      url.includes("searchNearby")
        ? reply({ places: [near] })
        : JSON.parse(opts.body as string).pageToken
          ? reply({ places: [far] })
          : reply({ places: [near], nextPageToken: "page-two" }),
    );
    const result = await getStations(coordinates[0], 5, route);
    expect(result.stations).toHaveLength(1);
    expect(result.stations[0].id).toBe("middle");
    expect(result.stations[0].distanceKm).toBeGreaterThan(40);
    expect(result.stations[0].offRouteKm).toBeLessThan(5);
    expect(
      fetchMock.mock.calls.some(
        ([, o]) => JSON.parse(o.body).pageToken === "page-two",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.every(([, o]) =>
        o.headers["X-Goog-FieldMask"].includes("places.evChargeOptions"),
      ),
    ).toBe(true);
  });
  it("marks ordinary result caps quietly and keeps successful pages if a later page fails", async () => {
    fetchMock.mockResolvedValue(
      reply({
        places: Array.from({ length: 20 }, (_, i) => ({
          id: `s-${i}`,
          location: { latitude: 0, longitude: i / 10000 },
        })),
      }),
    );
    const nearby = await getStations({ lat: 0, lng: 0 }, 5);
    expect(nearby.searchStatus).toBe("partial");
    expect(nearby.warning).toBeUndefined();
    const coordinates = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.1 },
    ];
    fetchMock.mockImplementation(async (_url: string, options: RequestInit) =>
      JSON.parse(options.body as string).pageToken
        ? reply({}, 429)
        : reply({
            places: [
              { id: "loaded", location: { latitude: 0, longitude: 0.05 } },
            ],
            nextPageToken: "next",
          }),
    );
    const result = await getStations(coordinates[0], 5, {
      coordinates,
      encodedPolyline: encodePolyline(coordinates),
      distanceKm: 11,
      durationMinutes: 15,
      source: "Google Maps",
    });
    expect(result.stations.map((s) => s.id)).toEqual(["loaded"]);
    expect(result.warning).toBe("Showing the chargers loaded so far.");
    expect(result.retryAfterSeconds).toBe(60);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes("searchText")),
    ).toHaveLength(2);
  });
  it("uses two driving legs for detours and excludes a nearby charger with a long road detour", async () => {
    const coordinates = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.1 },
    ];
    const route: TripRoute = {
      coordinates,
      encodedPolyline: encodePolyline(coordinates),
      distanceKm: 12,
      durationMinutes: 15,
      source: "Google Maps",
    };
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("searchNearby")
        ? reply({ places: [] })
        : reply({
            places: [
              { id: "direct", location: { latitude: 0, longitude: 0.02 } },
              {
                id: "across-barrier",
                location: { latitude: 0.001, longitude: 0.05 },
              },
            ],
            routingSummaries: [
              { legs: [{ distanceMeters: 2000 }, { distanceMeters: 10000 }] },
              { legs: [{ distanceMeters: 15000 }, { distanceMeters: 18000 }] },
            ],
          }),
    );
    const result = await getTripStations(coordinates[0], coordinates[1], route);
    expect(result.stations.map((s) => s.id)).toEqual(["direct"]);
    expect(result.stations[0].detourKm).toBe(0);
    expect(fetchMock.mock.calls).toHaveLength(1);
    const textCall = fetchMock.mock.calls.find(([url]) =>
      url.includes("searchText"),
    )!;
    expect(textCall[1].headers["X-Goog-FieldMask"]).toContain(
      "routingSummaries",
    );
  });
  it("preserves chargers and summary alignment when detours are missing, without per-charger requests", async () => {
    const coordinates = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.1 },
    ];
    const route: TripRoute = {
      coordinates,
      encodedPolyline: encodePolyline(coordinates),
      distanceKm: 12,
      durationMinutes: 15,
      source: "Google Maps",
    };
    fetchMock.mockImplementation(async (url: string, options: RequestInit) => {
      if (url.includes("searchNearby")) return reply({ places: [] });
      if (url.includes("searchText"))
        return reply({
          places: ["fallback", "summary", "failed"].map((id, i) => ({
            id,
            location: { latitude: 0, longitude: 0.02 + i * 0.02 },
          })),
          routingSummaries: [
            {},
            { legs: [{ distanceMeters: 6000 }, { distanceMeters: 9000 }] },
            {},
          ],
        });
      return JSON.parse(options.body as string).intermediates[0].placeId ===
        "fallback"
        ? reply({ routes: [{ distanceMeters: 19000 }] })
        : reply({}, 500);
    });
    const result = await getTripStations(coordinates[0], coordinates[1], route);
    expect(result.stations.map((s) => [s.id, s.detourKm])).toEqual([
      ["fallback", undefined],
      ["summary", 3],
      ["failed", undefined],
    ]);
    expect(result.warning).toBeUndefined();
    expect(result.searchStatus).toBe("partial");
    expect(fetchMock.mock.calls).toHaveLength(1);
  });
  it("preserves stop order and Google place IDs when recalculating the driving route", async () => {
    const points = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.1 },
    ];
    fetchMock.mockResolvedValue(
      reply({
        routes: [
          {
            distanceMeters: 15000,
            duration: "1200s",
            legs: [
              { distanceMeters: 0, duration: "0s" },
              { distanceMeters: 9000, duration: "600s" },
              { distanceMeters: 6000, duration: "600s" },
            ],
            polyline: { encodedPolyline: encodePolyline(points) },
          },
        ],
      }),
    );
    const route = await getRoadRoute(points[0], points[1], [
      { lat: 0, lng: 0.03, id: "early" },
      { lat: 0, lng: 0.07, id: "late" },
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).intermediates).toEqual([
      { placeId: "early" },
      { placeId: "late" },
    ]);
    expect(route.legs).toEqual([
      { distanceKm: 0, durationMinutes: 0 },
      { distanceKm: 9, durationMinutes: 10 },
      { distanceKm: 6, durationMinutes: 10 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers["X-Goog-FieldMask"]).toContain(
      "routes.legs.duration",
    );
  });
  it.each([
    [{ distanceMeters: 5000, duration: "300s" }],
    [{ distanceMeters: 5000, duration: "300s" }, { distanceMeters: 10000 }],
    [{ distanceMeters: 5000, duration: "bad" }, { distanceMeters: 10000, duration: "900s" }],
  ])("omits incomplete or misaligned leg estimates without inventing distances", async (...legs) => {
    const points = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.1 }];
    fetchMock.mockResolvedValue(reply({ routes: [{
      distanceMeters: 15000,
      duration: "1200s",
      polyline: { encodedPolyline: encodePolyline(points) },
      legs,
    }] }));
    const route = await getRoadRoute(points[0], points[1], [{ lat: 0, lng: 0.03 }]);
    expect(route.legs).toBeUndefined();
    expect(route.distanceKm).toBe(15);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("loads a long trip and 60 detours with at most four Google calls, using the full route on every page", async () => {
    const coordinates = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1.5 },
    ];
    const encodedPolyline = encodePolyline(coordinates);
    fetchMock.mockImplementation(async (url: string, options: RequestInit) => {
      if (url.includes("computeRoutes"))
        return reply({
          routes: [
            {
              distanceMeters: 180000,
              duration: "7200s",
              polyline: { encodedPolyline },
            },
          ],
        });
      const body = JSON.parse(options.body as string);
      const page = body.pageToken ? Number(body.pageToken) : 0;
      expect(body.searchAlongRouteParameters.polyline.encodedPolyline).toBe(
        encodedPolyline,
      );
      return reply({
        places: Array.from({ length: 20 }, (_, i) => ({
          id: `s-${page * 20 + i}`,
          location: { latitude: 0, longitude: (page * 20 + i) / 40 },
        })),
        routingSummaries: Array.from({ length: 20 }, () => ({
          legs: [{ distanceMeters: 100000 }, { distanceMeters: 81000 }],
        })),
        ...(page < 2 ? { nextPageToken: String(page + 1) } : {}),
      });
    });
    const route = await getRoadRoute(coordinates[0], coordinates[1]);
    const result = await getTripStations(coordinates[0], coordinates[1], route);
    expect(result.stations).toHaveLength(60);
    expect(result.stations.every((s) => s.detourKm === 1)).toBe(true);
    expect(fetchMock.mock.calls).toHaveLength(4);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes("computeRoutes")),
    ).toHaveLength(1);
    expect(result.warning).toBeUndefined();
  });
  it("does not leak credentials or raw upstream errors", async () => {
    fetchMock.mockResolvedValue(
      reply({ error: { message: "unit-test-private-key is invalid" } }, 403),
    );
    await expect(searchPlaces("Kolkata", session)).rejects.toThrow(
      "access was denied",
    );
    vi.stubEnv("GOOGLE_MAPS_SERVER_API_KEY", "");
    fetchMock.mockReset();
    await expect(getStations({ lat: 22, lng: 88 }, 5)).rejects.toThrow(
      "setup is required",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
describe("Google route polylines and exact pins", () => {
  it("roundtrips Google's published polyline example", () => {
    const encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
    const points = [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ];
    expect(decodePolyline(encoded)).toEqual(points);
    expect(encodePolyline(points)).toBe(encoded);
    expect(() => decodePolyline("_")).toThrow();
  });
  it("accepts coordinates and exact Google pins, not camera positions or untrusted URLs", () => {
    expect(parsePin("22.544, 88.351")).toEqual({ lat: 22.544, lng: 88.351 });
    expect(
      parsePin(
        "https://www.google.com/maps/place/Temple/@23,87,15z/data=!3d22.544!4d88.351",
      ),
    ).toEqual({ lat: 22.544, lng: 88.351 });
    expect(
      parsePin("https://www.google.com/maps/search/?api=1&query=22.544,88.351"),
    ).toEqual({ lat: 22.544, lng: 88.351 });
    expect(
      parsePin("https://www.google.com/maps/place/Temple/@23,87,15z"),
    ).toBeNull();
    expect(parsePin("https://evil.test/maps/data=!3d22!4d88")).toBeNull();
    expect(parsePin("100,88")).toBeNull();
  });
});

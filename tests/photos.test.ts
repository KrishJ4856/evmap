import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/photos/route";
import { getStations } from "../server/providers";

const fetchMock = vi.fn();
const photoName = "places/test-place/photos/first";
const request = (name = photoName) =>
  new Request(`http://localhost/api/photos?${new URLSearchParams({ name })}`);
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
let version = 0;
beforeEach(() => {
  vi.stubEnv(
    "GOOGLE_MAPS_SERVER_API_KEY",
    `private-photo-test-key-${++version}`,
  );
  vi.stubEnv("GOOGLE_MAPS_PHOTOS_ENABLED", "true");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("on-demand listing photos", () => {
  it("does no Google work when photo support is disabled or the resource name is invalid", async () => {
    vi.stubEnv("GOOGLE_MAPS_PHOTOS_ENABLED", "false");
    expect((await GET(request())).status).toBe(404);
    vi.stubEnv("GOOGLE_MAPS_PHOTOS_ENABLED", "true");
    expect((await GET(request("../../secret"))).status).toBe(400);
    expect((await GET(request("https://example.com/image"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("joins photo metadata to the existing station search and retains author attribution", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        places: [
          {
            id: "test-place",
            location: { latitude: 0, longitude: 0.01 },
            photos: [
              {
                name: photoName,
                authorAttributions: [
                  {
                    displayName: "Photographer",
                    uri: "//maps.google.com/maps/contrib/123",
                  },
                ],
              },
              { name: "places/other-place/photos/not-for-this-listing" },
            ],
          },
        ],
      }),
    );
    const result = await getStations({ lat: 0, lng: 0 }, 5);
    expect(result.stations[0].photos).toEqual([
      {
        name: photoName,
        authors: [
          {
            name: "Photographer",
            uri: "https://maps.google.com/maps/contrib/123",
          },
        ],
      },
    ]);
    expect(fetchMock.mock.calls[0][1].headers["X-Goog-FieldMask"]).toContain(
      "places.photos",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("redirects to Google's image without exposing the private key or caching metadata", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ photoUri: "https://lh3.googleusercontent.com/listing-photo" }),
    );
    const response = await GET(request());
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://lh3.googleusercontent.com/listing-photo",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Location")).not.toContain(
      "private-photo-test-key",
    );
    expect(fetchMock.mock.calls[0][0]).toContain(
      "maxWidthPx=900&maxHeightPx=600&skipHttpRedirect=true",
    );
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects unexpected image hosts instead of making the app an open redirect", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ photoUri: "https://attacker.example/image" }),
    );
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(response.headers.get("Location")).toBeNull();
  });
  it("shares quota cooldowns across different photo resource names", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({ error: { message: "Quota exceeded" } }, 429),
    );
    const first = await GET(request());
    expect(first.status).toBe(429);
    expect(first.headers.get("Retry-After")).toBe("60");
    expect((await GET(request("places/test-place/photos/second"))).status).toBe(
      429,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

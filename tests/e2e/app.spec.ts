import { expect, test, type Page } from "@playwright/test";
import type { SearchResult, Station } from "../../shared/types";

// Test-only fixtures. Production has no demo or fake fallback records.
const station: Station = {
  id: "test-charger",
  name: "Test Kolkata charger",
  address: "Test address, Kolkata",
  lat: 22.55,
  lng: 88.36,
  connectors: [
    {
      type: "CCS2",
      powerKW: 60,
      quantity: 2,
      available: 0,
      updatedAt: "2026-10-04T08:00:00Z",
    },
  ],
  businessStatus: "OPERATIONAL",
  phone: "+91 1234567890",
  hours: ["Monday: Open 24 hours"],
  sourceUrl: "https://www.google.com/maps/search/?api=1&query=22.55,88.36",
  attributions: [],
  distanceKm: 2.5,
  offRouteKm: 1.1,
  detourKm: 2.2,
};
const trip: SearchResult = {
  provider: "Google Maps",
  fetchedAt: "2026-10-04T08:00:00Z",
  stations: [station],
  route: {
    coordinates: [
      { lat: 22.56, lng: 88.36 },
      { lat: 22.544, lng: 88.351 },
    ],
    encodedPolyline: "test",
    distanceKm: 4.2,
    durationMinutes: 15,
    source: "Google Maps",
  },
};
async function setup(page: Page) {
  await mockMapsSdk(page);
  // The verification experiment is disabled unless a test explicitly mocks it.
  // No test may dial Retell or write to Atlas / R2.
  await page.route("**/api/verification?**", (r) => r.fulfill({ json: { configured: false, missing: [], verification: null } }));
  await page.route("**/api/verification", (r) => r.fulfill({ status: 503, json: { error: "Verification is disabled in this test." } }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (
          _success: unknown,
          error: (arg: unknown) => void,
        ) => error({ code: 1 }),
      },
    });
  });
  await page.route("**/api/health", (r) =>
    r.fulfill({
      json: {
        configured: true,
        stationProvider: "Google Maps",
        mapConfigured: false,
      },
    }),
  );
  await page.route("**/api/places?**", (r) => {
    const url = new URL(r.request().url());
    const place = {
      id: "test-temple",
      label: "ISKCON Kolkata",
      subtitle: "Albert Road, Kolkata",
      lat: 22.544,
      lng: 88.351,
    };
    if (url.searchParams.has("id")) return r.fulfill({ json: { place } });
    if (url.searchParams.get("mode") === "text")
      return r.fulfill({ json: { places: [place] } });
    return r.fulfill({
      json: {
        places: [
          { id: place.id, label: place.label, subtitle: place.subtitle },
        ],
      },
    });
  });
  await page.route("**/api/route", (r) => r.fulfill({ json: trip }));
  await page.route("**/api/route/stops", (r) =>
    r.fulfill({
      json: {
        route: {
          ...trip.route,
          coordinates: [
            trip.route!.coordinates[0],
            ...r.request().postDataJSON().stops,
            trip.route!.coordinates.at(-1),
          ],
          distanceKm: 7.5,
          durationMinutes: 22,
          legs: Array.from({ length: r.request().postDataJSON().stops.length + 1 }, (_, i) => {
            const count = r.request().postDataJSON().stops.length + 1;
            const weight = (i + 1) / (count * (count + 1) / 2);
            return { distanceKm: 7.5 * weight, durationMinutes: 22 * weight };
          }),
        },
      },
    }),
  );
  await page.route("**/api/nearby", (r) =>
    r.fulfill({ json: { ...trip, route: undefined } }),
  );
  await page.goto("/");
  // ThemeProvider enables this control after hydration; wait for the interactive shell
  // before exercising controls that can otherwise be clicked during the SSR handoff.
  await expect(
    page.getByRole("button", { name: /mode\. Switch theme/ }),
  ).toBeEnabled();
}
async function choosePin(
  page: Page,
  field = "Starting point",
  coords = "22.56, 88.36",
) {
  await page.getByRole("combobox", { name: field, exact: true }).fill(coords);
  await page.getByRole("option", { name: /Pinned location/ }).click();
}

test("manual verification only dials on click, then shows the stored recording and result", async ({ page }) => {
  await setup(page);
  let saved: object | null = null;
  let starts = 0;
  await page.route("**/api/verification?**", (r) => r.fulfill({ json: { configured: true, missing: [], verification: saved } }));
  await page.route("**/api/verification", (r) => {
    const body = r.request().postDataJSON();
    if (body.action === "start") {
      starts++;
      saved = { stationId: station.id, status: "calling", callId: "test-call", createdAt: "2026-10-08T08:00:00Z" };
    } else {
      saved = { stationId: station.id, status: "completed", callId: "test-call", createdAt: "2026-10-08T08:00:00Z", checkedAt: "2026-10-08T08:01:00Z", confidence: 8, summary: "Staff reported public charging with an app.", operational: "working", publicAccess: "public", transcript: "Agent: Is the charger working?\nUser: Yes.", audioUrl: "https://audio.example/test.wav" };
    }
    return r.fulfill({ json: { configured: true, missing: [], verification: saved } });
  });
  await choosePin(page);
  await page.getByRole("button", { name: "Find chargers", exact: true }).click();
  const panel = page.locator(".station-card .station-verification");
  await expect(panel.getByRole("button", { name: "Initiate verification" })).toBeEnabled();
  expect(starts).toBe(0);
  await panel.getByRole("button", { name: "Initiate verification" }).click();
  await expect(panel.getByRole("button", { name: "Listen live" })).toBeVisible();
  await panel.getByRole("button", { name: "Check call result" }).click();
  await expect(panel.getByText("Call saved", { exact: true })).toBeVisible();
  await expect(panel.getByText("8/10 evidence")).toBeVisible();
  await expect(panel.locator("audio")).toHaveAttribute("src", "https://audio.example/test.wav");
  await panel.getByText("Call transcript", { exact: true }).click();
  await expect(panel.getByText(/Agent: Is the charger working/)).toBeVisible();
  await page.locator(".station-card").screenshot({ path: test.info().outputPath("verification-card.png") });
  expect(starts).toBe(1);
  // Opening the same listing's details loads its persisted result, not a new call.
  await page.locator(".station-main").click();
  await expect(page.getByRole("dialog").getByText("Call saved", { exact: true })).toBeVisible();
  expect(starts).toBe(1);
});

test("manual verification disables dialing when the experiment budget is exhausted", async ({ page }) => {
  await setup(page);
  await page.route("**/api/verification?**", (r) => r.fulfill({ json: { configured: true, missing: [], verification: null, budget: { usedUsd: 1.95, limitUsd: 2, calls: 3, maxCalls: 4, minimumCallUsd: 0.65 } } }));
  await choosePin(page);
  await page.getByRole("button", { name: "Find chargers", exact: true }).click();
  await expect(page.getByRole("button", { name: "Initiate verification" })).toBeDisabled();
  await expect(page.getByText("Experiment budget reached or another call is pending")).toBeVisible();
});

// A test-only SDK double verifies our marker/route/click wiring without making paid requests.
async function mockMapsSdk(page: Page) {
  await page.addInitScript(() => {
    class MapDouble {
      constructor(public host: HTMLElement) {}
      addListener(_event: string, handler: (event: unknown) => void) {
        const listener = () =>
          handler({ latLng: { lat: () => 22.544, lng: () => 88.351 } });
        this.host.addEventListener("click", listener);
        return {
          remove: () => this.host.removeEventListener("click", listener),
        };
      }
      setCenter() {}
      setZoom() {}
      setOptions() {}
      fitBounds(bounds: { points: unknown[] }) {
        this.host.dataset.fittedPoints = String(bounds.points.length);
      }
    }
    class BoundsDouble {
      points: unknown[] = [];
      extend(point: unknown) {
        this.points.push(point);
        return this;
      }
    }
    class MarkerDouble {
      button: HTMLButtonElement;
      constructor(options: {
        map: MapDouble;
        title: string;
        content: HTMLElement;
      }) {
        this.button = document.createElement("button");
        this.button.ariaLabel = options.title;
        this.button.append(options.content);
        this.map = options.map;
      }
      set map(map: MapDouble | null) {
        this.button.remove();
        if (map) map.host.append(this.button);
      }
      addListener(_event: string, handler: () => void) {
        const listener = (event: Event) => {
          event.stopPropagation();
          handler();
        };
        this.button.addEventListener("click", listener);
        return {
          remove: () => this.button.removeEventListener("click", listener),
        };
      }
    }
    class PolylineDouble {
      constructor(options: { map: MapDouble; path: unknown[] }) {
        options.map.host.dataset.routePoints = String(options.path.length);
      }
      setMap() {}
    }
    Object.assign(window, {
      google: {
        maps: {
          Map: MapDouble,
          LatLngBounds: BoundsDouble,
          Polyline: PolylineDouble,
          marker: { AdvancedMarkerElement: MarkerDouble },
        },
      },
    });
  });
}
test("simple screen, no demos or marketing, GPS denial does not invent a location", async ({
  page,
}) => {
  await setup(page);
  await expect(
    page.getByRole("heading", { name: "EV chargers" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Starting point", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Find chargers", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Location access unavailable. Enter a starting point."),
  ).toBeVisible();
  await expect(
    page.getByText(/demo|A little charge|long way|explore the journey/i),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("theme toggle updates the app shell and persists the current theme", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => localStorage.setItem("evmap-theme", "light"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const toggle = page.getByRole("button", { name: /Light mode/ });
  await expect(toggle).toBeVisible();
  await expect(page.locator(".sidebar")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: /Dark mode/ })).toBeVisible();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(9, 9, 11)",
  );
  await expect(page.locator(".sidebar")).toHaveCSS(
    "background-color",
    "rgb(24, 24, 27)",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: /Dark mode/ })).toBeVisible();
});

test("ISKCON Kolkata autocomplete resolves exact coordinates and sends selected Google ID", async ({
  page,
}) => {
  await setup(page);
  await choosePin(page);
  await page
    .getByRole("combobox", { name: "Destination", exact: true })
    .fill("iskcon kolkata");
  const autocomplete = page.waitForRequest(
    (r) =>
      r.url().includes("/api/places?") && r.url().includes("sessionToken="),
  );
  await page.getByRole("option", { name: /ISKCON Kolkata/ }).click();
  expect(new URL((await autocomplete).url()).searchParams.get("q")).toBe(
    "iskcon kolkata",
  );
  await expect(
    page.getByRole("combobox", { name: "Destination", exact: true }),
  ).toHaveValue("ISKCON Kolkata");
  const request = page.waitForRequest("**/api/route");
  await page
    .getByRole("button", { name: "Find chargers", exact: true })
    .click();
  expect((await request).postDataJSON().destination).toMatchObject({
    id: "test-temple",
    lat: 22.544,
    lng: 88.351,
  });
  await expect(page.getByRole("heading", { name: "1 charger" })).toBeVisible();
  await expect(
    page.getByText("Up to 5 km extra driving · Chargers in travel order"),
  ).toBeVisible();
});
test("unselected destination cannot silently become a nearby-only search", async ({
  page,
}) => {
  await setup(page);
  await choosePin(page);
  await page
    .getByRole("combobox", { name: "Destination", exact: true })
    .fill("some address");
  await expect(
    page.getByRole("button", { name: "Find chargers", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Clear destination" }).click();
  await expect(
    page.getByRole("button", { name: "Find chargers", exact: true }),
  ).toBeEnabled();
});
test("explicit full-text search lets the user choose a result", async ({
  page,
}) => {
  await setup(page);
  await choosePin(page);
  await page
    .getByRole("combobox", { name: "Destination", exact: true })
    .fill("iskcon kolkata");
  await page.getByRole("button", { name: /Search Google Maps for/ }).click();
  await page.getByRole("option", { name: /ISKCON Kolkata/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Destination", exact: true }),
  ).toHaveValue("ISKCON Kolkata");
});
test("station details do not claim an operational listing is a working charger", async ({
  page,
}) => {
  await setup(page);
  await choosePin(page);
  await page
    .getByRole("button", { name: "Find chargers", exact: true })
    .click();
  await page
    .locator(".station-main")
    .filter({ hasText: "Test Kolkata charger" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".confidence-note")).toHaveText(
    "Google Maps lists this location as operational.",
  );
  await expect(dialog.getByText("Business status on Google Maps", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/0 reported available/)).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Call +91 1234567890" }),
  ).toHaveAttribute("href", "tel:+911234567890");
  await expect(
    dialog.getByRole("link", { name: "Google Maps", exact: true }),
  ).toHaveAttribute("target", "_blank");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
for (const [businessStatus, note] of [
  ["CLOSED_TEMPORARILY", "Google Maps lists this location as temporarily closed."],
  ["CLOSED_PERMANENTLY", "Google Maps lists this location as permanently closed."],
  ["UNKNOWN", "Google Maps hasn’t reported an operating status for this location."],
] as const) {
  test(`details status note follows Google's reported status: ${businessStatus}`, async ({ page }) => {
    await setup(page);
    await page.route("**/api/nearby", r => r.fulfill({
      json: { ...trip, route: undefined, stations: [{ ...station, businessStatus }] },
    }));
    await choosePin(page);
    await page.getByRole("button", { name: "Find chargers", exact: true }).click();
    await page.getByRole("button", { name: "View Test Kolkata charger details" }).click();
    await expect(page.getByRole("dialog").locator(".confidence-note")).toHaveText(note);
  });
}
for (const [label, connectors, phone, confidence] of [
  ["neither present", [], undefined, "Low"],
  ["only charger details", station.connectors, undefined, "Medium"],
  ["only phone", [], station.phone, "Medium"],
  ["both present", station.connectors, station.phone, "High"],
  ["empty placeholders", [{ type: "Unspecified" }], "   ", "Low"],
] as const) {
  test(`details pills reflect listing completeness: ${label}`, async ({
    page,
  }) => {
    await setup(page);
    await page.route("**/api/nearby", (r) =>
      r.fulfill({
        json: {
          ...trip,
          route: undefined,
          stations: [{ ...station, connectors, phone, offRouteKm: undefined }],
        },
      }),
    );
    await choosePin(page);
    await page
      .getByRole("button", { name: "Find chargers", exact: true })
      .click();
    const card = page.locator(".station-card");
    await expect(
      card.getByText(/Charger details not provided|CCS2|60 kW/),
    ).toHaveCount(0);
    await card
      .getByRole("button", { name: "View Test Kolkata charger details" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("2.5 km from the starting location", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText(
        /straight-line|Contact number not provided|Power not provided|Google Maps has not provided/,
      ),
    ).toHaveCount(0);
    await expect(
      dialog.locator(".info-pill").filter({ hasText: `${confidence} confidence` }),
    ).toHaveClass(new RegExp(`confidence-${confidence.toLowerCase()}`));
    const hasDetails = confidence !== "Low" && connectors.length > 0;
    const hasPhone = Boolean(phone?.trim());
    await expect(
      dialog.locator(".info-pill").filter({
        hasText: `Charger details ${hasDetails ? "available" : "missing"}`,
      }),
    ).toHaveClass(new RegExp(hasDetails ? "available" : "missing"));
    await expect(
      dialog.locator(".info-pill").filter({
        hasText: `Contact number ${hasPhone ? "available" : "missing"}`,
      }),
    ).toHaveClass(new RegExp(hasPhone ? "available" : "missing"));
    await expect(
      dialog.getByRole("heading", { name: "Chargers", exact: true }),
    ).toHaveCount(hasDetails ? 1 : 0);
    await expect(dialog.getByRole("link", { name: /^Call / })).toHaveCount(
      hasPhone ? 1 : 0,
    );
    await expect(
      dialog.getByText(
        "Google Maps lists this location as operational.",
        { exact: true },
      ),
    ).toBeVisible();
  });
}

test("listing photos load on opening details, retain author credits, and fail quietly", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/nearby", (r) =>
    r.fulfill({
      json: {
        ...trip,
        route: undefined,
        stations: [
          {
            ...station,
            photos: [
              {
                name: "places/test-charger/photos/first",
                authors: [
                  {
                    name: "Listing photographer",
                    uri: "https://maps.google.com/maps/contrib/123",
                  },
                ],
              },
              { name: "places/test-charger/photos/second", authors: [] },
              { name: "places/test-charger/photos/unavailable", authors: [] },
            ],
          },
        ],
      },
    }),
  );
  let photoRequests = 0;
  await page.route("**/api/photos?**", (r) => {
    photoRequests++;
    if (r.request().url().includes("unavailable")) return r.fulfill({ status: 404 });
    return r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#dceee4"/></svg>',
    });
  });
  await choosePin(page);
  await page
    .getByRole("button", { name: "Find chargers", exact: true })
    .click();
  await expect(page.locator(".station-card img")).toHaveCount(0);
  expect(photoRequests).toBe(0);
  await page
    .getByRole("button", { name: "View Test Kolkata charger details" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".station-photo-frame img")).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Listing photographer" }),
  ).toHaveAttribute("href", "https://maps.google.com/maps/contrib/123");
  await expect.poll(() => photoRequests).toBe(1);
  await expect(dialog.locator(".photo-controls")).toContainText("1 / 3");
  await dialog.getByRole("button", { name: "Next listing photo" }).click();
  await expect(dialog.locator(".station-photo-frame img")).toHaveAttribute(
    "alt", "Test Kolkata charger — Google Maps listing photo 2",
  );
  await expect(dialog.locator(".photo-controls")).toContainText("2 / 3");
  await expect.poll(() => photoRequests).toBe(2);
  await dialog.getByRole("button", { name: "Next listing photo" }).click();
  await expect(dialog.locator(".station-photos")).toHaveCount(0);
  expect(photoRequests).toBe(3);
  await expect(
    dialog.getByText("High confidence", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Google Maps", exact: true }),
  ).toBeVisible();
});
test("search failure is visible and never replaced with demo records", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/nearby", (r) =>
    r.fulfill({
      status: 503,
      json: { error: "Google Maps access was denied." },
    }),
  );
  await choosePin(page);
  await page
    .getByRole("button", { name: "Find chargers", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Google Maps access was denied." }),
  ).toHaveText("Google Maps access was denied.");
  await expect(page.getByRole("heading", { name: /charger$/ })).toHaveCount(0);
});
test("changing an endpoint clears outdated charger results", async ({
  page,
}) => {
  await setup(page);
  await choosePin(page);
  await page
    .getByRole("button", { name: "Find chargers", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "1 charger" })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Starting point", exact: true })
    .fill("22.57,88.37");
  await expect(page.getByRole("heading", { name: "1 charger" })).toHaveCount(0);
});
test("mobile map/results switch and map selection instruction", async ({
  page,
  isMobile,
}) => {
  await setup(page);
  if (!isMobile) return;
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByLabel("Charging station map")).toBeVisible();
  await page.getByRole("button", { name: "Results", exact: true }).click();
  await expect(page.getByLabel("Charging station map")).not.toBeVisible();
  await page.getByRole("button", { name: "Pick destination on map" }).click();
  await expect(page.getByLabel("Charging station map")).toBeVisible();
  await page.getByRole("button", { name: "Cancel picking location" }).click();
});

test("Google map station marker opens details and the full route is plotted", async ({
  page,
  isMobile,
}) => {
  await setup(page);
  await choosePin(page);
  await page
    .getByRole("combobox", { name: "Destination", exact: true })
    .fill("iskcon kolkata");
  await page.getByRole("option", { name: /ISKCON Kolkata/ }).click();
  await page
    .getByRole("button", { name: "Find chargers", exact: true })
    .click();
  if (isMobile)
    await page.getByRole("button", { name: "Map", exact: true }).click();
  const map = page.getByLabel("Charging station map");
  await expect(map).toHaveAttribute("data-route-points", "2");
  await expect(
    map
      .getByRole("button", { name: "Test Kolkata charger" })
      .locator(".map-marker"),
  ).toHaveClass(/charger/);
  await map.getByRole("button", { name: "Test Kolkata charger" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Test Kolkata charger" }),
  ).toBeVisible();
});

test("picking an exact map point sets a destination when address search cannot find it", async ({
  page,
}) => {
  await setup(page);
  await choosePin(page);
  await page.getByRole("button", { name: "Pick destination on map" }).click();
  await expect(
    page.getByText("Click the map to set your destination."),
  ).toBeVisible();
  await page
    .getByLabel("Charging station map")
    .click({ position: { x: 60, y: 80 } });
  await expect(
    page.getByRole("combobox", { name: "Destination", exact: true }),
  ).toHaveValue("Pinned location");
  const request = page.waitForRequest("**/api/route");
  await page
    .getByRole("button", { name: "Find chargers", exact: true })
    .click();
  expect((await request).postDataJSON().destination).toMatchObject({
    lat: 22.544,
    lng: 88.351,
  });
});

async function chooseTrip(page: Page) {
  await choosePin(page);
  await choosePin(page, "Destination", "22.50, 88.36");
  await page
    .getByRole("button", { name: "Find chargers", exact: true })
    .click();
}

const routeStations: Station[] = [
  {
    ...station,
    id: "early",
    name: "Early charger",
    distanceKm: 1,
    detourKm: 0,
    offRouteKm: 0.01,
  },
  {
    ...station,
    id: "middle",
    name: "Middle charger",
    distanceKm: 2,
    detourKm: 2,
    offRouteKm: 0.7,
  },
  {
    ...station,
    id: "late",
    name: "Late charger",
    distanceKm: 3,
    detourKm: 12,
    offRouteKm: 4,
  },
];

test("card hover and keyboard focus preview the map, then restore the selected charger", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Hover previews apply to devices with a mouse.");
  await setup(page);
  await page.route("**/api/route", (r) =>
    r.fulfill({ json: { ...trip, stations: routeStations } }),
  );
  let searches = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/route")) searches++;
  });
  await chooseTrip(page);
  await page.getByRole("slider", { name: "Maximum detour" }).fill("20");
  const earlyCard = page
    .locator(".station-card")
    .filter({ hasText: "Early charger" });
  const lateCard = page
    .locator(".station-card")
    .filter({ hasText: "Late charger" });
  const map = page.getByLabel("Charging station map");
  const earlyMarker = map
    .getByRole("button", { name: "Early charger", exact: true })
    .locator(".map-marker");
  const middleMarker = map
    .getByRole("button", { name: "Middle charger", exact: true })
    .locator(".map-marker");
  const lateMarker = map
    .getByRole("button", { name: "Late charger", exact: true })
    .locator(".map-marker");
  await earlyMarker.evaluate((marker) =>
    marker.setAttribute("data-before-hover", "true"),
  );
  await earlyCard.hover();
  await expect(earlyCard).toHaveClass(/hovered/);
  await expect(earlyCard).toHaveCSS("border-top-color", "rgb(234, 67, 53)");
  await expect(earlyMarker).toHaveClass(/selected/);
  await expect(middleMarker).toHaveClass(/muted/);
  await expect(lateMarker).toHaveClass(/muted/);
  await expect(middleMarker).toHaveCSS(
    "background-color",
    "rgb(107, 114, 128)",
  );
  await lateCard.hover();
  await expect(lateMarker).toHaveClass(/selected/);
  await expect(earlyMarker).toHaveClass(/muted/);
  await page.getByRole("heading", { name: "EV chargers", exact: true }).hover();
  await expect(map.locator(".map-marker.muted")).toHaveCount(0);
  await expect(map.locator(".map-marker.selected")).toHaveCount(0);
  await earlyCard
    .getByRole("button", { name: "View Early charger details" })
    .click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  // The fading overlay keeps the scroll lock until its exit animation finishes.
  await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked");
  await expect(earlyCard).toHaveClass(/selected/);
  await expect(earlyMarker).toHaveClass(/selected/);
  await lateCard.hover();
  await expect(lateMarker).toHaveClass(/selected/);
  await expect(earlyMarker).toHaveClass(/muted/);
  await page.getByRole("heading", { name: "EV chargers", exact: true }).hover();
  await expect(earlyMarker).toHaveClass(/selected/);
  await expect(lateMarker).toHaveClass(/muted/);
  await page.keyboard.press("Tab");
  await page
    .getByRole("button", { name: "View Middle charger details" })
    .focus();
  await expect(middleMarker).toHaveClass(/selected/);
  await page
    .getByRole("link", { name: "Open in Google Maps", exact: true })
    .focus();
  await expect(earlyMarker).toHaveClass(/selected/);
  await expect(earlyMarker).toHaveAttribute("data-before-hover", "true");
  expect(searches).toBe(1);
});

test("itinerary stop hover and keyboard focus preview the map without extra requests", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Hover previews apply to devices with a mouse.");
  await setup(page);
  await page.route("**/api/route", (r) =>
    r.fulfill({ json: { ...trip, stations: routeStations } }),
  );
  let requests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests++;
  });
  await chooseTrip(page);
  await page.getByRole("slider", { name: "Maximum detour" }).fill("20");
  await page.getByRole("button", { name: "Add Early charger to trip" }).click();
  await expect(page.locator(".trip-stops li")).toHaveCount(1);
  await page.getByRole("button", { name: "Add Late charger to trip" }).click();
  await expect(page.locator(".trip-stops li")).toHaveCount(2);
  const stops = page.getByRole("list", { name: "Charging stops in travel order" });
  const lateStop = stops.locator(".itinerary-stop").filter({ hasText: "Late charger" });
  const map = page.getByLabel("Charging station map");
  const earlyMarker = map.getByRole("button", { name: "Early charger", exact: true }).locator(".map-marker");
  const lateMarker = map.getByRole("button", { name: "Late charger", exact: true }).locator(".map-marker");
  await stops.getByRole("button", { name: "Early charger", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("body")).not.toHaveAttribute("data-scroll-locked");
  await expect(earlyMarker).toHaveClass(/selected/);
  const requestsBeforePreview = requests;
  await lateStop.hover();
  await expect(lateMarker).toHaveClass(/stop.*selected/);
  await expect(lateMarker).toHaveCSS("background-color", "rgb(234, 67, 53)");
  await expect(lateMarker).toHaveText("2");
  await expect(earlyMarker).toHaveClass(/muted/);
  await lateStop.getByRole("button", { name: "Remove Late charger from trip" }).hover();
  await expect(lateMarker).toHaveClass(/selected/);
  await page.getByRole("heading", { name: "EV chargers", exact: true }).hover();
  await expect(earlyMarker).toHaveClass(/selected/);
  await expect(lateMarker).toHaveClass(/muted/);
  await page.keyboard.press("Tab");
  await lateStop.getByRole("button", { name: "Late charger", exact: true }).focus();
  await expect(lateMarker).toHaveClass(/selected/);
  await page.getByRole("link", { name: "Open in Google Maps", exact: true }).focus();
  await expect(earlyMarker).toHaveClass(/selected/);
  expect(requests).toBe(requestsBeforePreview);
});

test("map selection persists after closing details and highlights numbered stops in red", async ({
  page,
  isMobile,
}) => {
  await setup(page);
  await page.route("**/api/route", (r) =>
    r.fulfill({ json: { ...trip, stations: routeStations } }),
  );
  await chooseTrip(page);
  await page.getByRole("button", { name: "Add Early charger to trip" }).click();
  await expect(page.locator(".trip-stops li")).toHaveCount(1);
  if (isMobile)
    await page.getByRole("button", { name: "Map", exact: true }).click();
  const map = page.getByLabel("Charging station map");
  const earlyMarker = map
    .getByRole("button", { name: "Early charger", exact: true })
    .locator(".map-marker");
  const middleMarker = map
    .getByRole("button", { name: "Middle charger", exact: true })
    .locator(".map-marker");
  await map.getByRole("button", { name: "Early charger", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(earlyMarker).toHaveClass(/stop.*selected/);
  await expect(earlyMarker).toHaveText("1");
  await expect(earlyMarker).toHaveCSS("background-color", "rgb(234, 67, 53)");
  await expect(middleMarker).toHaveClass(/muted/);
  await expect(
    map.getByRole("button", { name: "Starting point" }).locator(".map-marker"),
  ).not.toHaveClass(/muted/);
  await expect(
    map.getByRole("button", { name: "Destination" }).locator(".map-marker"),
  ).not.toHaveClass(/muted/);
  if (isMobile)
    await page.getByRole("button", { name: "Results", exact: true }).click();
  const selectedCard = page
    .locator(".station-card")
    .filter({ hasText: "Early charger" });
  await expect(selectedCard).toHaveClass(/selected/);
  await expect(selectedCard).toHaveCSS("border-top-color", "rgb(234, 67, 53)");
  await page
    .getByRole("button", { name: "Clear destination", exact: true })
    .click();
  await expect(page.locator(".station-card.selected")).toHaveCount(0);
  await expect(
    page.locator(".map-marker.selected, .map-marker.muted"),
  ).toHaveCount(0);
});

test("detour slider filters immediately, including strict on-route and the full 20 km range", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/route", (r) =>
    r.fulfill({ json: { ...trip, stations: routeStations } }),
  );
  let searches = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/route")) searches++;
  });
  await chooseTrip(page);
  await expect(page.locator(".station-card")).toHaveCount(2);
  const slider = page.getByRole("slider", { name: "Maximum detour" });
  await slider.fill("0");
  await expect(page.locator(".station-card")).toHaveCount(1);
  await expect(page.locator(".station-card")).toContainText("Early charger");
  await slider.fill("20");
  await expect(page.locator(".station-card")).toHaveCount(3);
  expect(searches).toBe(1);
  await page.getByRole("button", { name: "View Late charger details" }).click();
  await page.getByRole("button", { name: "Add to trip", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove stop 1" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await slider.fill("0");
  await expect(page.locator(".station-card")).toHaveCount(1);
  await expect(
    page.getByRole("list", { name: "Charging stops in travel order" }),
  ).toContainText("Late charger");
});

test("chargers without driving estimates remain visible separately from detour-filtered matches", async ({
  page,
}) => {
  await setup(page);
  const unknown = {
    ...station,
    id: "unknown-detour",
    name: "Charger without estimate",
    detourKm: undefined,
  };
  await page.route("**/api/route", (r) =>
    r.fulfill({
      json: {
        ...trip,
        stations: [routeStations[0], unknown],
        searchStatus: "partial",
      },
    }),
  );
  let searches = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/route")) searches++;
  });
  await chooseTrip(page);
  await expect(page.locator(".results-heading h2")).toHaveText("1 charger");
  await expect(page.locator(".unchecked-stations")).toContainText(
    "Charger without estimate",
  );
  await expect(page.locator(".unchecked-stations")).toContainText(
    "Detour unavailable",
  );
  await expect(page.locator(".result-warning")).toHaveCount(0);
  const slider = page.getByRole("slider", { name: "Maximum detour" });
  await slider.fill("0");
  await expect(page.locator(".station-card")).toHaveCount(1);
  await slider.fill("20");
  await expect(page.locator(".station-card")).toHaveCount(2);
  expect(searches).toBe(1);
});

test("a charger-provider outage is shown as unavailable rather than zero chargers", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/route", (r) =>
    r.fulfill({
      json: {
        ...trip,
        stations: [],
        searchStatus: "unavailable",
        retryAfterSeconds: 60,
        warning: "Maps is temporarily busy. Please try again shortly.",
      },
    }),
  );
  await chooseTrip(page);
  await expect(page.locator(".results-heading h2")).toHaveText(
    "Charger search unavailable",
  );
  await expect(page.locator(".result-warning")).toHaveText(
    "Maps is temporarily busy. Please try again shortly.",
  );
  await expect(page.getByText("0 chargers", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("No chargers were found along this route."),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open in Google Maps", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh chargers", exact: true })).toHaveCount(0);
});

test("failed nearby refreshes preserve successful chargers", async ({ page }) => {
  await setup(page);
  await choosePin(page);
  await page.getByRole("button", { name: "Find chargers", exact: true }).click();
  await page.route("**/api/nearby", (r) => r.fulfill({
    status: 503,
    json: { error: "Maps is temporarily busy. Please try again shortly.", retryAfterSeconds: 120 },
  }));
  await page.getByRole("button", { name: "Refresh chargers", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Maps is temporarily busy." })).toContainText("Maps is temporarily busy.");
  await expect(page.locator(".station-card")).toHaveCount(1);
});

test("quota cooldown prevents repeated route requests and expires without an automatic retry", async ({
  page,
}) => {
  await page.clock.install();
  await setup(page);
  let searches = 0;
  await page.route("**/api/route", (r) => {
    searches++;
    return r.fulfill({
      status: 429,
      json: {
        error: "Maps is temporarily busy. Please try again shortly.",
        retryAfterSeconds: 60,
      },
    });
  });
  await chooseTrip(page);
  await expect(
    page.getByRole("button", { name: /Try again in/ }),
  ).toBeDisabled();
  await page.getByRole("slider", { name: "Maximum detour" }).fill("20");
  await page
    .locator(".trip-form")
    .evaluate((form: HTMLFormElement) => form.requestSubmit());
  expect(searches).toBe(1);
  await page.clock.fastForward(61000);
  await expect(
    page.getByRole("button", { name: "Find chargers", exact: true }),
  ).toBeEnabled();
  expect(searches).toBe(1);
  await page
    .getByRole("button", { name: "Find chargers", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Try again in/ }),
  ).toBeDisabled();
  expect(searches).toBe(2);
});

test("stops added in reverse order update the route and export in travel order", async ({
  page,
  isMobile,
}) => {
  await setup(page);
  await page.route("**/api/route", (r) =>
    r.fulfill({ json: { ...trip, stations: routeStations } }),
  );
  await chooseTrip(page);
  await expect(page.locator(".trip-leg-metric")).toHaveText(["4.2 km − 15 min"]);
  await expect(page.getByRole("button", { name: "Refresh chargers", exact: true })).toHaveCount(0);
  await page.getByRole("slider", { name: "Maximum detour" }).fill("20");
  await page.getByRole("button", { name: "Add Late charger to trip" }).click();
  await expect(page.locator(".trip-stops li")).toHaveCount(1);
  const update = page.waitForRequest("**/api/route/stops");
  await page.getByRole("button", { name: "Add Early charger to trip" }).click();
  expect((await update).postDataJSON().stops.map((s: Station) => s.id)).toEqual(
    ["early", "late"],
  );
  await expect(page.locator(".trip-stops .stop-name")).toHaveText([
    "Early charger",
    "Late charger",
  ]);
  await expect(page.locator(".trip-form .trip-stops")).toBeVisible();
  await expect(page.locator(".trip-leg-metric")).toHaveText([
    "1.3 km − 4 min", "2.5 km − 7 min", "3.8 km − 11 min",
  ]);
  expect(await page.locator(".trip-itinerary .location-search, .trip-itinerary .stop-name")
    .evaluateAll(points => points.map(point => point.querySelector("label")?.textContent ?? point.textContent)))
    .toEqual(["Starting point", "Early charger", "Late charger", "Destination"]);
  await expect(page.locator(".results-heading")).toContainText("8 km · 22 min");
  const link = page.getByRole("link", {
    name: "Open in Google Maps",
    exact: true,
  });
  const params = new URL((await link.getAttribute("href"))!).searchParams;
  expect(params.get("origin")).toBe("22.56,88.36");
  expect(params.get("destination")).toBe("22.5,88.36");
  expect(params.get("waypoint_place_ids")).toBe("early|late");
  await expect(link).toHaveAttribute("target", "_blank");
  if (isMobile)
    await page.getByRole("button", { name: "Map", exact: true }).click();
  const map = page.getByLabel("Charging station map");
  await expect(map).toHaveAttribute("data-route-points", "4");
  await expect(
    map.getByRole("button", { name: "Early charger" }).locator(".map-marker"),
  ).toHaveText("1");
  if (isMobile)
    await page.getByRole("button", { name: "Results", exact: true }).click();
  await page
    .locator(".trip-stops")
    .getByRole("button", { name: "Remove Early charger from trip" })
    .click();
  await expect(page.locator(".trip-stops .stop-name")).toHaveText([
    "Late charger",
  ]);
  await page
    .locator(".trip-stops")
    .getByRole("button", { name: "Remove Late charger from trip" })
    .click();
  await expect(page.locator(".trip-stops li")).toHaveCount(0);
  await expect(page.locator(".results-heading")).toContainText("4 km · 15 min");
  await expect(page.locator(".trip-leg-metric")).toHaveText(["4.2 km − 15 min"]);
  expect(
    new URL((await link.getAttribute("href"))!).searchParams.has("waypoints"),
  ).toBe(false);
});

test("failed stop updates preserve the current trip, and endpoint changes clear stops", async ({
  page,
}) => {
  await setup(page);
  await chooseTrip(page);
  await page
    .getByRole("button", { name: "Add Test Kolkata charger to trip" })
    .click();
  await expect(page.locator(".trip-stops li")).toHaveCount(1);
  // Removal of the last stop needs no paid route request, and a failed add must not add a phantom stop.
  await page
    .locator(".trip-stops")
    .getByRole("button", { name: "Remove Test Kolkata charger from trip" })
    .click();
  await page.route("**/api/route/stops", (r) =>
    r.fulfill({
      status: 503,
      json: { error: "Google Maps could not be reached." },
    }),
  );
  await page
    .getByRole("button", { name: "Add Test Kolkata charger to trip" })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Your stops are unchanged." }),
  ).toContainText("Your stops are unchanged.");
  await expect(page.locator(".trip-stops li")).toHaveCount(0);
  await page.unroute("**/api/route/stops");
  await page.route("**/api/route/stops", (r) =>
    r.fulfill({ json: { route: trip.route } }),
  );
  await page
    .getByRole("button", { name: "Add Test Kolkata charger to trip" })
    .click();
  await expect(page.locator(".trip-stops li")).toHaveCount(1);
  await expect(page.locator(".trip-leg-metric")).toHaveText([
    "Driving estimate unavailable", "Driving estimate unavailable",
  ]);
  await page
    .getByRole("button", { name: "Clear destination", exact: true })
    .click();
  await expect(page.locator(".trip-stops li")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open in Google Maps", exact: true }),
  ).toHaveCount(0);
});

test("detour help is available on demand and the whole sidebar scrolls", async ({ page, isMobile }) => {
  await setup(page);
  await page.route("**/api/route", r => r.fulfill({
    json: { ...trip, stations: Array.from({ length: 12 }, (_, i) => ({
      ...station, id: `scroll-${i}`, name: `Scroll charger ${i + 1}`,
    })) },
  }));
  await chooseTrip(page);
  const help = page.getByRole("button", { name: "About maximum detour" });
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).not.toBeVisible();
  if (isMobile) await help.click();
  else await help.hover();
  await expect(tooltip).toHaveText("Extra driving to visit a charger. 0 km keeps only chargers on your route.");
  await help.focus();
  await page.keyboard.press("Escape");
  await expect(tooltip).not.toBeVisible();
  const startField = page.getByRole("combobox", { name: "Starting point", exact: true });
  await page.getByRole("link", { name: "Terms", exact: true }).focus();
  await expect(startField).not.toBeInViewport();
  expect(await page.locator(".sidebar").evaluate(sidebar => sidebar.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator(".results").evaluate(results => results.scrollTop)).toBe(0);
  await startField.focus();
  await expect(startField).toBeInViewport();
});

test("mobile navigation splits longer trips without dropping selected stops", async ({
  page,
  isMobile,
}) => {
  if (!isMobile) return;
  await setup(page);
  const stations = Array.from({ length: 4 }, (_, i) => ({
    ...station,
    id: `s-${i}`,
    name: `Charger ${i + 1}`,
    distanceKm: i + 1,
  }));
  await page.route("**/api/route", (r) =>
    r.fulfill({ json: { ...trip, stations } }),
  );
  await chooseTrip(page);
  for (const s of stations) {
    await page.getByRole("button", { name: `Add ${s.name} to trip` }).click();
    await expect(page.locator(".trip-stops li")).toHaveCount(s.distanceKm);
  }
  const first = new URL(
    (await page
      .getByRole("link", { name: "Open leg 1 in Google Maps" })
      .getAttribute("href"))!,
  ).searchParams;
  const second = new URL(
    (await page
      .getByRole("link", { name: "Open leg 2 in Google Maps" })
      .getAttribute("href"))!,
  ).searchParams;
  expect(first.get("waypoint_place_ids")).toBe("s-0|s-1|s-2");
  expect(first.get("destination_place_id")).toBe("s-3");
  expect(second.get("origin_place_id")).toBe("s-3");
  expect(second.get("destination")).toBe("22.5,88.36");
});

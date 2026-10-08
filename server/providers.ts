import type {
  Coordinate,
  Place,
  Prediction,
  Station,
  TripRoute,
} from "../shared/types";
import { haversine, routeProximity } from "../shared/geo";
import { decodePolyline } from "../shared/polyline";
import { googlePlaceId, MAX_DETOUR_KM } from "../shared/trip";

import { googleRequest, MapsError, isMapsError } from "./google-client";
import { photoNameSchema, photosEnabled } from "./photos";
export { MapsError, isMapsError } from "./google-client";

const PLACES = "https://places.googleapis.com/v1/";
export type GooglePlace = {
  // Internal annotation from a full-trip Search Along Route routing summary.
  detourKm?: number;
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  googleMapsUri?: string;
  businessStatus?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  photos?: {
    name?: string;
    authorAttributions?: { displayName?: string; uri?: string }[];
  }[];
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  attributions?: { provider?: string; providerUri?: string }[];
  evChargeOptions?: {
    connectorAggregation?: {
      type?: string;
      maxChargeRateKw?: number;
      count?: number;
      availableCount?: number;
      outOfServiceCount?: number;
      availabilityLastUpdateTime?: string;
    }[];
  };
};
const PLACE_FIELDS = "id,displayName,formattedAddress,location,googleMapsUri";
const STATION_FIELDS = `${PLACE_FIELDS},businessStatus,internationalPhoneNumber,nationalPhoneNumber,websiteUri,regularOpeningHours,evChargeOptions,attributions`;
const SEARCH_FIELDS = STATION_FIELDS.split(",")
  .map((field) => `places.${field}`)
  .join(",");
const stationSearchFields = () =>
  `${SEARCH_FIELDS}${photosEnabled() ? ",places.photos" : ""}`;
export async function searchPlaces(
  query: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<Prediction[]> {
  const data = await googleRequest<{
    suggestions?: {
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
      };
    }[];
  }>(
    `${PLACES}places:autocomplete`,
    "",
    {
      input: query,
      sessionToken,
      languageCode: "en",
      regionCode: "in",
      // No city-only types, country restriction, or starting-point bias.
    },
    signal,
  );
  return (data.suggestions ?? []).flatMap(({ placePrediction: p }) =>
    p?.placeId
      ? [
          {
            id: p.placeId,
            label: p.structuredFormat?.mainText?.text || p.text?.text || query,
            subtitle: p.structuredFormat?.secondaryText?.text || "",
          },
        ]
      : [],
  );
}
function toPlace(place: GooglePlace): Place {
  if (!place.id || !place.location)
    throw new MapsError(
      "Google Maps did not return an exact location for this place.",
    );
  return {
    id: place.id,
    label:
      place.displayName?.text || place.formattedAddress || "Selected place",
    subtitle: place.formattedAddress || "",
    lat: place.location.latitude,
    lng: place.location.longitude,
  };
}
export async function getPlace(
  id: string,
  sessionToken?: string,
  signal?: AbortSignal,
): Promise<Place> {
  const params = new URLSearchParams({
    languageCode: "en",
    ...(sessionToken ? { sessionToken } : {}),
  });
  return toPlace(
    await googleRequest<GooglePlace>(
      `${PLACES}places/${encodeURIComponent(id)}?${params}`,
      PLACE_FIELDS,
      undefined,
      signal,
    ),
  );
}
export async function textSearchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<Place[]> {
  const data = await googleRequest<{ places?: GooglePlace[] }>(
    `${PLACES}places:searchText`,
    PLACE_FIELDS.split(",")
      .map((f) => `places.${f}`)
      .join(","),
    { textQuery: query, languageCode: "en", regionCode: "in", pageSize: 5 },
    signal,
  );
  return (data.places ?? []).filter((p) => p.id && p.location).map(toPlace);
}
const connectorNames: Record<string, string> = {
  EV_CONNECTOR_TYPE_J1772: "Type 1",
  EV_CONNECTOR_TYPE_TYPE_2: "Type 2",
  EV_CONNECTOR_TYPE_CHADEMO: "CHAdeMO",
  EV_CONNECTOR_TYPE_CCS_COMBO_1: "CCS1",
  EV_CONNECTOR_TYPE_CCS_COMBO_2: "CCS2",
  EV_CONNECTOR_TYPE_TESLA: "Tesla",
  EV_CONNECTOR_TYPE_NACS: "NACS",
  EV_CONNECTOR_TYPE_UNSPECIFIED_GB_T: "GB/T",
  EV_CONNECTOR_TYPE_UNSPECIFIED_WALL_OUTLET: "Wall outlet",
};
export function normalizeGooglePlace(place: GooglePlace): Station | null {
  if (
    !place.id ||
    !place.location ||
    !Number.isFinite(place.location.latitude) ||
    !Number.isFinite(place.location.longitude)
  )
    return null;
  return {
    id: place.id,
    lat: place.location.latitude,
    lng: place.location.longitude,
    name: place.displayName?.text || "EV charging station",
    address: place.formattedAddress || "Address not provided",
    businessStatus: [
      "OPERATIONAL",
      "CLOSED_TEMPORARILY",
      "CLOSED_PERMANENTLY",
    ].includes(place.businessStatus || "")
      ? (place.businessStatus as Station["businessStatus"])
      : "UNKNOWN",
    connectors: (place.evChargeOptions?.connectorAggregation ?? []).map(
      (c) => ({
        type: connectorNames[c.type ?? ""] || "Unspecified",
        powerKW: c.maxChargeRateKw,
        quantity: c.count,
        available: c.availableCount,
        outOfService: c.outOfServiceCount,
        updatedAt: c.availabilityLastUpdateTime,
      }),
    ),
    phone: place.internationalPhoneNumber || place.nationalPhoneNumber,
    website: place.websiteUri,
    ...(photosEnabled() && place.photos?.length
      ? {
          photos: place.photos
            .filter(
              (photo) =>
                photoNameSchema.safeParse(photo.name).success &&
                photo.name!.startsWith(`places/${place.id}/photos/`),
            )
            .slice(0, 5)
            .map((photo) => ({
              name: photo.name!,
              authors: (photo.authorAttributions ?? []).map((author) => ({
                name: author.displayName || "Photo contributor",
                uri: author.uri?.startsWith("//")
                  ? `https:${author.uri}`
                  : author.uri,
              })),
            })),
        }
      : {}),
    hours: place.regularOpeningHours?.weekdayDescriptions,
    sourceUrl:
      place.googleMapsUri ||
      `https://www.google.com/maps/search/?api=1&query=${place.location.latitude},${place.location.longitude}&query_place_id=${encodeURIComponent(place.id)}`,
    attributions: (place.attributions ?? [])
      .map((a) => ({ name: a.provider || "", uri: a.providerUri }))
      .filter((a) => a.name),
    distanceKm: 0,
  };
}
export async function getRoadRoute(
  start: Coordinate & { id?: string },
  destination: Coordinate & { id?: string },
  stops: (Coordinate & { id?: string })[] = [],
  signal?: AbortSignal,
): Promise<TripRoute> {
  const data = await computeDrivingRoute<{
    routes?: {
      distanceMeters: number;
      duration: string;
      polyline: { encodedPolyline: string };
      legs?: { distanceMeters?: number; duration?: string }[];
    }[];
  }>(
    start,
    destination,
    stops,
    "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration",
    signal,
  );
  const route = data.routes?.[0];
  if (!route)
    throw new MapsError(
      "Google Maps found no driving route between these locations.",
      422,
    );
  if (route.distanceMeters > 3000000)
    throw new MapsError("This experiment supports routes up to 3,000 km.", 422);
  const coordinates = decodePolyline(route.polyline.encodedPolyline);
  if (coordinates.length < 2)
    throw new MapsError("Google Maps returned an incomplete route.");
  // Never divide the trip total between stops: retain only complete, ordered leg data.
  const legs = route.legs?.map((leg) => ({
    distanceKm: (leg.distanceMeters ?? NaN) / 1000,
    durationMinutes:
      leg.duration && /^\d+(?:\.\d+)?s$/.test(leg.duration)
        ? Number.parseFloat(leg.duration) / 60
        : NaN,
  }));
  const completeLegs =
    legs?.length === stops.length + 1 &&
    legs.every((leg) =>
      [leg.distanceKm, leg.durationMinutes].every(
        (value) => Number.isFinite(value) && value >= 0,
      ),
    );
  return {
    coordinates,
    encodedPolyline: route.polyline.encodedPolyline,
    distanceKm: route.distanceMeters / 1000,
    durationMinutes: Number.parseFloat(route.duration) / 60,
    ...(completeLegs ? { legs } : {}),
    source: "Google Maps",
  };
}

function computeDrivingRoute<T>(
  start: Coordinate & { id?: string },
  destination: Coordinate & { id?: string },
  stops: (Coordinate & { id?: string })[],
  fields: string,
  signal?: AbortSignal,
) {
  const waypoint = (p: Coordinate & { id?: string }) => {
    const placeId = googlePlaceId(p);
    return placeId
      ? { placeId }
      : { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
  };
  return googleRequest<T>(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    fields,
    {
      origin: waypoint(start),
      destination: waypoint(destination),
      ...(stops.length ? { intermediates: stops.map(waypoint) } : {}),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      polylineQuality: "HIGH_QUALITY",
      polylineEncoding: "ENCODED_POLYLINE",
    },
    signal,
  );
}
type StationSearch = {
  stations: Station[];
  provider: "Google Maps";
  searchStatus: "ready" | "partial";
  warning?: string;
  retryAfterSeconds?: number;
};

async function routeSearch(
  route: TripRoute,
  start: Coordinate,
  signal?: AbortSignal,
) {
  const base = {
    textQuery: "EV charging stations",
    includedType: "electric_vehicle_charging_station",
    strictTypeFiltering: true,
    languageCode: "en",
    pageSize: 20,
    searchAlongRouteParameters: {
      polyline: { encodedPolyline: route.encodedPolyline },
    },
    routingParameters: {
      origin: { latitude: start.lat, longitude: start.lng },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
    },
  };
  const places: GooglePlace[] = [];
  let pageToken: string | undefined;
  let warning: string | undefined;
  let retryAfterSeconds: number | undefined;
  // At most three sequential Places calls, always using the FULL trip for both driving legs.
  for (let page = 0; page < 3; page++) {
    signal?.throwIfAborted();
    let data: {
      places?: GooglePlace[];
      nextPageToken?: string;
      routingSummaries?: { legs?: { distanceMeters?: number }[] }[];
    };
    try {
      data = await googleRequest(
        `${PLACES}places:searchText`,
        `${stationSearchFields()},nextPageToken,routingSummaries`,
        { ...base, ...(pageToken ? { pageToken } : {}) },
        signal,
      );
    } catch (error) {
      signal?.throwIfAborted();
      if (page === 0) throw error;
      warning = "Showing the chargers loaded so far.";
      retryAfterSeconds = isMapsError(error)
        ? error.retryAfterSeconds
        : undefined;
      break; // Keep successful pages and stop immediately, especially on quota errors.
    }
    places.push(
      ...(data.places ?? []).map((place, index) => {
        const legs = data.routingSummaries?.[index]?.legs;
        if (
          legs?.length !== 2 ||
          !legs.every(
            (leg) =>
              Number.isFinite(leg.distanceMeters) && leg.distanceMeters! >= 0,
          )
        )
          return place;
        return {
          ...place,
          detourKm: Math.max(
            0,
            legs.reduce((sum, leg) => sum + leg.distanceMeters!, 0) / 1000 -
              route.distanceKm,
          ),
        };
      }),
    );
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return {
    places,
    limited: Boolean(pageToken) || places.length >= 60,
    warning,
    retryAfterSeconds,
  };
}

async function nearbySearch(
  center: Coordinate,
  radiusKm: number,
  signal?: AbortSignal,
) {
  const data = await googleRequest<{ places?: GooglePlace[] }>(
    `${PLACES}places:searchNearby`,
    stationSearchFields(),
    {
      includedTypes: ["electric_vehicle_charging_station"],
      maxResultCount: 20,
      rankPreference: "DISTANCE",
      languageCode: "en",
      locationRestriction: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: radiusKm * 1000,
        },
      },
    },
    signal,
  );
  return {
    places: data.places ?? [],
    limited: (data.places?.length ?? 0) >= 20,
    warning: undefined as string | undefined,
    retryAfterSeconds: undefined as number | undefined,
  };
}

export async function getStations(
  start: Coordinate,
  radiusKm: number,
  route?: TripRoute,
  signal?: AbortSignal,
): Promise<StationSearch> {
  const data = route
    ? await routeSearch(route, start, signal)
    : await nearbySearch(start, radiusKm, signal);
  const unique = new Map<string, Station>();
  for (const raw of data.places) {
    const station = normalizeGooglePlace(raw);
    if (!station) continue;
    const existing = unique.get(station.id);
    if (existing) {
      if (raw.detourKm !== undefined) existing.detourKm = raw.detourKm;
      continue;
    }
    if (route) {
      const proximity = routeProximity(station, route.coordinates);
      if (proximity.distanceKm > radiusKm) continue;
      station.distanceKm = proximity.alongKm;
      station.offRouteKm = proximity.distanceKm;
      station.detourKm = raw.detourKm;
    } else {
      station.distanceKm = haversine(start, station);
      if (station.distanceKm > radiusKm) continue;
    }
    unique.set(station.id, station);
  }
  return {
    stations: [...unique.values()].sort(
      (a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id),
    ),
    provider: "Google Maps",
    searchStatus: data.warning || data.limited ? "partial" : "ready",
    warning: data.warning,
    retryAfterSeconds: data.retryAfterSeconds,
  };
}

/** Detours arrive in the Places response; never issue one Routes request per charger. */
export async function getTripStations(
  start: Coordinate,
  _destination: Coordinate,
  route: TripRoute,
  signal?: AbortSignal,
): Promise<StationSearch> {
  const result = await getStations(start, MAX_DETOUR_KM, route, signal);
  // Keep discovered chargers with missing estimates. The UI separates them from filtered matches.
  const stations = result.stations.filter(
    (station) =>
      station.detourKm === undefined || station.detourKm <= MAX_DETOUR_KM,
  );
  const missing = stations.some((station) => station.detourKm === undefined);
  return {
    ...result,
    stations,
    searchStatus: missing ? "partial" : result.searchStatus,
  };
}

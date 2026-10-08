export type Coordinate = { lat: number; lng: number };
export type Prediction = { id: string; label: string; subtitle: string };
export type Place = Prediction & Coordinate;
export type Connector = {
  type: string;
  powerKW?: number;
  quantity?: number;
  available?: number;
  outOfService?: number;
  updatedAt?: string;
};
export type Attribution = { name: string; uri?: string };
export type StationPhoto = { name: string; authors: Attribution[] };
export type Station = Coordinate & {
  id: string;
  name: string;
  address: string;
  connectors: Connector[];
  businessStatus:
    "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY" | "UNKNOWN";
  phone?: string;
  hours?: string[];
  website?: string;
  photos?: StationPhoto[];
  sourceUrl: string;
  attributions: Attribution[];
  distanceKm: number;
  offRouteKm?: number;
  /** Extra driving distance for visiting this station, relative to the original trip. */
  detourKm?: number;
};
export type TripLeg = {
  distanceKm: number;
  durationMinutes: number;
};
export type TripRoute = {
  coordinates: Coordinate[];
  encodedPolyline: string;
  distanceKm: number;
  durationMinutes: number;
  /** Driving segments in source → stops → destination order, when provided. */
  legs?: TripLeg[];
  source: "Google Maps";
};
export type SearchResult = {
  stations: Station[];
  route?: TripRoute;
  provider: "Google Maps";
  fetchedAt: string;
  warning?: string;
  searchStatus?: "ready" | "partial" | "unavailable";
  retryAfterSeconds?: number;
};

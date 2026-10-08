"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Crosshair,
  ExternalLink,
  Info,
  LoaderCircle,
  MapPin,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocationSearch } from "@/components/location-search";
import { ChargingMap } from "@/components/charging-map";
import { StationCard } from "@/components/station-card";
import { StationDetails } from "@/components/station-details";
import { ThemeToggle } from "@/components/theme-toggle";
import { TripLeg } from "@/components/trip-leg";
import type { Place, SearchResult, Station, TripRoute } from "@/shared/types";
import {
  googleMapsDirections,
  MAX_DETOUR_KM,
  MAX_TRIP_STOPS,
  orderStops,
  withinDetour,
} from "@/shared/trip";

export default function EvMap() {
  const [start, setStart] = useState<Place | null>(null),
    [destination, setDestination] = useState<Place | null>(null);
  const [startEditing, setStartEditing] = useState(false),
    [destinationEditing, setDestinationEditing] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null),
    [selected, setSelected] = useState<Station | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [loading, setLoading] = useState(false),
    [locating, setLocating] = useState(false),
    [error, setError] = useState(""),
    [locationNote, setLocationNote] = useState("");
  const [picking, setPicking] = useState<"start" | "destination" | null>(null),
    [view, setView] = useState<"list" | "map">("list");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [detourKm, setDetourKm] = useState(5);
  const [detourHelpOpen, setDetourHelpOpen] = useState(false);
  const [stops, setStops] = useState<Station[]>([]);
  const [tripRoute, setTripRoute] = useState<TripRoute | undefined>();
  const [updatingStop, setUpdatingStop] = useState<string | null>(null);
  const [stopError, setStopError] = useState("");
  const [navigationLimit, setNavigationLimit] = useState(3);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const stopRequest = useRef<AbortController | null>(null);
  const request = useRef<AbortController | null>(null),
    geoVersion = useRef(0);
  const clearResults = useCallback(() => {
    request.current?.abort();
    stopRequest.current?.abort();
    setLoading(false);
    setResult(null);
    setSelected(null);
    setHoveredId(null);
    setFocusedId(null);
    setDetailsOpen(false);
    setError("");
    setStops([]);
    setTripRoute(undefined);
    setUpdatingStop(null);
    setStopError("");
    setDetourHelpOpen(false);
  }, []);
  function changeStart(place: Place | null) {
    geoVersion.current++;
    setLocating(false);
    setStart(place);
    setLocationNote("");
    clearResults();
  }
  function changeDestination(place: Place | null) {
    setDestination(place);
    clearResults();
  }
  const locate = useCallback(() => {
    const version = ++geoVersion.current;
    setLocating(true);
    setLocationNote("");
    if (!navigator.geolocation) {
      setLocating(false);
      setLocationNote("Location unavailable. Enter a starting point.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (version !== geoVersion.current) return;
        clearResults();
        setStart({
          id: "device-location",
          label: "Current location",
          subtitle: `${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setStartEditing(false);
        setLocating(false);
      },
      () => {
        if (version === geoVersion.current) {
          setLocating(false);
          setLocationNote(
            "Location access unavailable. Enter a starting point.",
          );
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [clearResults]);
  useEffect(() => {
    const update = () =>
      setWaitSeconds(
        Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)),
      );
    update();
    if (cooldownUntil <= Date.now()) return;
    const timer = window.setInterval(() => {
      update();
      if (cooldownUntil <= Date.now()) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);
  function pauseRequests(seconds?: number) {
    if (!seconds || seconds <= 0) return;
    setCooldownUntil((current) =>
      Math.max(current, Date.now() + seconds * 1000),
    );
    setWaitSeconds(Math.ceil(seconds));
  }
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const mobileBrowser =
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const update = () =>
      setNavigationLimit(mobileBrowser || media.matches ? 3 : MAX_TRIP_STOPS);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    locate();
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => setConfigured(Boolean(data.configured)))
      .catch(() => {});
    return () => {
      controller.abort();
      request.current?.abort();
      stopRequest.current?.abort();
      geoVersion.current++;
    };
  }, [locate]);
  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (
      !start ||
      startEditing ||
      destinationEditing ||
      loading ||
      (result?.route && result.searchStatus !== "unavailable") ||
      Date.now() < cooldownUntil
    )
      return;
    request.current?.abort();
    stopRequest.current?.abort();
    setUpdatingStop(null);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setPicking(null);
    try {
      const response = await fetch(destination ? "/api/route" : "/api/nearby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start,
          ...(destination ? { destination } : {}),
          radiusKm: 5,
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      pauseRequests(data.retryAfterSeconds);
      if (!response.ok) throw new Error(data.error);
      // A failed refresh preserves the last successful trip instead of replacing it with zero chargers.
      if (
        data.searchStatus === "unavailable" &&
        result &&
        result.searchStatus !== "unavailable"
      ) {
        setError(
          data.warning ||
            "Chargers could not be refreshed. Showing previous results.",
        );
        return;
      }
      setResult(data);
      setStops([]);
      setTripRoute(undefined);
      setSelected(null);
      setHoveredId(null);
      setFocusedId(null);
      setDetailsOpen(false);
      setStopError("");
    } catch (err) {
      if (!controller.signal.aborted)
        setError(
          err instanceof Error ? err.message : "Search failed. Try again.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  async function toggleStop(station: Station) {
    if (!start || !destination || !result?.route || updatingStop || loading)
      return;
    const removing = stops.some((stop) => stop.id === station.id);
    if (!removing && stops.length >= MAX_TRIP_STOPS) return;
    const nextStops = orderStops(
      removing
        ? stops.filter((stop) => stop.id !== station.id)
        : [...stops, station],
    );
    setStopError("");
    if (!nextStops.length) {
      setStops([]);
      setTripRoute(undefined);
      return;
    }
    const controller = new AbortController();
    stopRequest.current = controller;
    setUpdatingStop(station.id);
    try {
      const response = await fetch("/api/route/stops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, destination, stops: nextStops }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      pauseRequests(data.retryAfterSeconds);
      if (!response.ok) throw new Error(data.error);
      if (controller.signal.aborted) return;
      setStops(nextStops);
      setTripRoute(data.route);
    } catch (err) {
      if (!controller.signal.aborted)
        setStopError(
          err instanceof Error
            ? err.message
            : "The stop could not be updated. Try again.",
        );
    } finally {
      if (!controller.signal.aborted) setUpdatingStop(null);
    }
  }
  const visibleStations = useMemo(() => {
    const stations = result?.stations ?? EMPTY_STATIONS;
    return result?.route
      ? stations.filter((station) => withinDetour(station, detourKm))
      : stations;
  }, [result, detourKm]);
  const uncheckedStations = useMemo(
    () =>
      result?.route && detourKm > 0
        ? result.stations.filter((station) => station.detourKm === undefined)
        : EMPTY_STATIONS,
    [result, detourKm],
  );
  const mapStations = useMemo(() => {
    return [
      ...new Map(
        [...visibleStations, ...uncheckedStations, ...stops].map((station) => [
          station.id,
          station,
        ]),
      ).values(),
    ];
  }, [visibleStations, uncheckedStations, stops]);
  const highlightedId = [hoveredId, focusedId, selected?.id].find(
    (id) => id && mapStations.some((station) => station.id === id),
  );
  function selectStation(station: Station) {
    setSelected(station);
    setHoveredId(null);
    setFocusedId(null);
    setDetailsOpen(true);
  }
  const displayedRoute = tripRoute ?? result?.route;
  const directions =
    start && destination && result?.route
      ? googleMapsDirections(start, destination, stops, navigationLimit)
      : [];
  const itineraryLeg = (index: number) =>
    displayedRoute?.legs?.length === stops.length + 1
      ? displayedRoute.legs[index]
      : stops.length === 0
        ? displayedRoute
        : undefined;
  const stopNumber = (station: Station | null) => {
    const index = stops.findIndex((stop) => stop.id === station?.id);
    return index >= 0 ? index + 1 : undefined;
  };
  function renderStation(station: Station) {
    return (
      <StationCard
        key={station.id}
        station={station}
        selected={selected?.id === station.id}
        hovered={hoveredId === station.id || (!hoveredId && focusedId === station.id)}
        onSelect={() => selectStation(station)}
        onHoverChange={(hovered) =>
          setHoveredId((current) =>
            hovered ? station.id : current === station.id ? null : current,
          )
        }
        onFocusChange={(focused) =>
          setFocusedId((current) =>
            focused ? station.id : current === station.id ? null : current,
          )
        }
        stopNumber={stopNumber(station)}
        onToggleStop={result?.route ? () => toggleStop(station) : undefined}
        busy={Boolean(updatingStop) || loading}
        pending={updatingStop === station.id}
        stopLimit={stops.length >= MAX_TRIP_STOPS}
      />
    );
  }
  function pick(place: Place) {
    if (picking === "start") {
      changeStart(place);
      setStartEditing(false);
    } else {
      changeDestination(place);
      setDestinationEditing(false);
    }
    setPicking(null);
  }
  function pinButton(target: "start" | "destination") {
    return (
      <button
        type="button"
        className={`field-action ${picking === target ? "active" : ""}`}
        aria-label={`Pick ${target === "start" ? "starting point" : "destination"} on map`}
        title="Pick on map"
        onClick={() => {
          setPicking(picking === target ? null : target);
          setView("map");
        }}
      >
        <MapPin size={15} />
      </button>
    );
  }
  return (
    <main className="app-shell">
      <header className="app-header">
        <Zap size={19} />
        <h1>EV chargers</h1>
        <ThemeToggle />
      </header>
      <div className="app-body">
        <aside className={`sidebar ${view === "map" ? "mobile-map-view" : ""}`}>
          <form className="trip-form" onSubmit={search}>
            <div className="trip-itinerary" aria-label="Trip itinerary">
              <div className="itinerary-point">
                <span className="itinerary-marker start" aria-hidden="true">A</span>
                <LocationSearch
                  label="Starting point"
                  value={start}
                  onChange={changeStart}
                  onEditing={setStartEditing}
                  placeholder="Search a place or address"
                  action={
                    <div className="field-actions">
                      <button
                        type="button"
                        className="field-action"
                        aria-label="Use current location"
                        title="Use current location"
                        disabled={locating}
                        onClick={locate}
                      >
                        {locating ? (
                          <LoaderCircle size={15} className="animate-spin" />
                        ) : (
                          <Crosshair size={15} />
                        )}
                      </button>
                      {pinButton("start")}
                    </div>
                  }
                />
              </div>
              {locationNote && (
                <p className="field-note itinerary-note" role="status">
                  {locationNote}
                </p>
              )}
              <TripLeg
                leg={itineraryLeg(0)}
                from={start?.label ?? "Starting point"}
                to={stops[0]?.name ?? destination?.label ?? "Destination"}
                hasRoute={Boolean(displayedRoute)}
              />
              {stops.length > 0 && (
                <ol className="trip-stops" aria-label="Charging stops in travel order">
                  {stops.map((station, index) => (
                    <li key={station.id}>
                      <div
                        className="itinerary-stop"
                        onPointerEnter={(event) => {
                          if (event.pointerType !== "touch") setHoveredId(station.id);
                        }}
                        onPointerLeave={() =>
                          setHoveredId((current) => current === station.id ? null : current)
                        }
                        onFocus={(event) => {
                          if (event.target.matches(":focus-visible")) setFocusedId(station.id);
                        }}
                        onBlur={(event) => {
                          if (!event.currentTarget.contains(event.relatedTarget)) {
                            setFocusedId((current) => current === station.id ? null : current);
                          }
                        }}
                      >
                        <span className="stop-number" aria-hidden="true">{index + 1}</span>
                        <div className="itinerary-stop-card">
                          <button
                            className="stop-name"
                            type="button"
                            title={station.name}
                            onClick={() => selectStation(station)}
                          >
                            {station.name}
                          </button>
                          <button
                            className="remove-stop"
                            type="button"
                            disabled={Boolean(updatingStop) || loading}
                            aria-label={`Remove ${station.name} from trip`}
                            onClick={() => toggleStop(station)}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                      <TripLeg
                        leg={itineraryLeg(index + 1)}
                        from={station.name}
                        to={stops[index + 1]?.name ?? destination?.label ?? "Destination"}
                        hasRoute={Boolean(displayedRoute)}
                      />
                    </li>
                  ))}
                </ol>
              )}
              <div className="itinerary-point">
                <span className="itinerary-marker destination" aria-hidden="true">B</span>
                <LocationSearch
                  label="Destination"
                  value={destination}
                  onChange={changeDestination}
                  onEditing={setDestinationEditing}
                  placeholder="Optional — search or paste coordinates"
                  action={pinButton("destination")}
                />
              </div>
            </div>
            {updatingStop && (
              <p className="route-update-note" role="status">
                <LoaderCircle size={13} className="animate-spin" /> Updating your route…
              </p>
            )}
            {stopError && (
              <p className="error form-error" role="alert">
                {stopError} Your stops are unchanged.
              </p>
            )}
            {destination && !destinationEditing ? (
              <div className="detour-control">
                <div className="field-heading">
                  <label htmlFor="detour-limit">Maximum detour</label>
                  <div className="detour-value">
                    <output htmlFor="detour-limit">
                      {detourKm === 0 ? "On route only" : `${detourKm} km`}
                    </output>
                    <span
                      className={`detour-help ${detourHelpOpen ? "open" : ""}`}
                      onMouseEnter={() => setDetourHelpOpen(true)}
                      onMouseLeave={() => setDetourHelpOpen(false)}
                    >
                      <button
                        type="button"
                        aria-label="About maximum detour"
                        aria-describedby="detour-explanation"
                        aria-expanded={detourHelpOpen}
                        onClick={() => setDetourHelpOpen(true)}
                        onFocus={() => setDetourHelpOpen(true)}
                        onBlur={() => setDetourHelpOpen(false)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setDetourHelpOpen(false);
                        }}
                      >
                        <Info size={15} />
                      </button>
                      <span id="detour-explanation" role="tooltip">
                        Extra driving to visit a charger. 0 km keeps only chargers on your route.
                      </span>
                    </span>
                  </div>
                </div>
                <input
                  id="detour-limit"
                  type="range"
                  min="0"
                  max={MAX_DETOUR_KM}
                  step="1"
                  value={detourKm}
                  aria-valuetext={
                    detourKm === 0
                      ? "0 kilometres, on route only"
                      : `${detourKm} kilometres extra driving`
                  }
                  onChange={(event) => {
                    setHoveredId(null);
                    setFocusedId(null);
                    setDetourKm(Number(event.target.value));
                  }}
                  style={
                    {
                      "--range-progress": `${(detourKm / MAX_DETOUR_KM) * 100}%`,
                    } as React.CSSProperties
                  }
                />
                <div className="range-labels">
                  <span>0 km</span>
                  <span>20 km</span>
                </div>
              </div>
            ) : (
              <p className="field-note">
                No destination? Find chargers within 5 km of your start.
              </p>
            )}
            {directions.length > 0 ? (
              <div className="directions-links">
                {directions.length > 1 && (
                  <p className="field-note">Open each leg in order to keep all your stops.</p>
                )}
                {directions.map((href, index) => (
                  <Button asChild className="search-button" key={href}>
                    <a href={href} target="_blank" rel="noreferrer">
                      {directions.length === 1
                        ? "Open in Google Maps"
                        : `Open leg ${index + 1} in Google Maps`}
                      <ExternalLink size={14} />
                    </a>
                  </Button>
                ))}
              </div>
            ) : (
              <Button
                type="submit"
                className="search-button"
                disabled={
                  !start ||
                  startEditing ||
                  destinationEditing ||
                  loading ||
                  waitSeconds > 0
                }
              >
                {loading && <LoaderCircle className="animate-spin" />}
                {loading
                  ? "Finding chargers…"
                  : waitSeconds > 0
                    ? `Try again in ${waitSeconds >= 60 ? `${Math.ceil(waitSeconds / 60)} min` : `${waitSeconds}s`}`
                    : result
                      ? "Refresh chargers"
                      : "Find chargers"}
              </Button>
            )}
            {error && (
              <p className="error form-error" role="alert">
                {error}
              </p>
            )}
            {picking && (
              <div className="field-note">
                Select a point on the map.
                <button
                  type="button"
                  className="cancel-pick"
                  aria-label="Cancel picking location"
                  onClick={() => setPicking(null)}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </form>
          <div className="mobile-tabs">
            <button
              type="button"
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
            >
              Results
            </button>
            <button
              type="button"
              className={view === "map" ? "active" : ""}
              onClick={() => setView("map")}
            >
              Map
            </button>
          </div>
          <section
            className={`results ${view === "map" ? "mobile-hidden" : ""}`}
            aria-live="polite"
            aria-busy={loading}
          >
            {result ? (
              <>
                <div className="results-heading">
                  <h2>
                    {result.searchStatus === "unavailable"
                      ? "Charger search unavailable"
                      : !visibleStations.length && uncheckedStations.length
                        ? "Detour estimates unavailable"
                        : `${visibleStations.length} charger${visibleStations.length === 1 ? "" : "s"}`}
                  </h2>
                  {result.route && (
                    <span>
                      {Math.round(displayedRoute!.distanceKm)} km ·{" "}
                      {Math.round(displayedRoute!.durationMinutes)} min
                    </span>
                  )}
                </div>
                {result.searchStatus !== "unavailable" && (
                  <p className="results-caption">
                    {result.route
                      ? `${detourKm === 0 ? "On route only" : `Up to ${detourKm} km extra driving`} · Chargers in travel order`
                      : "Within 5 km · Straight-line distance from start"}
                  </p>
                )}
                {result.warning && (
                  <p className="result-warning" role="status">
                    {result.warning}
                  </p>
                )}
                {!visibleStations.length &&
                  !uncheckedStations.length &&
                  result.searchStatus !== "unavailable" && (
                    <p className="empty-state">
                      {result.route
                        ? result.stations.length
                          ? "No chargers match this detour limit. Try a wider range."
                          : "No chargers were found along this route."
                        : "No Google Maps chargers found in this area."}
                    </p>
                  )}
                <div className="station-list">
                  {visibleStations.map(renderStation)}
                </div>
                {uncheckedStations.length > 0 && (
                  <>
                    <h3 className="unchecked-heading">
                      {uncheckedStations.length} charger
                      {uncheckedStations.length === 1 ? "" : "s"} without detour
                      estimates
                    </h3>
                    <p className="unchecked-caption">
                      These aren’t filtered by your detour limit.
                    </p>
                    <div className="station-list unchecked-stations">
                      {uncheckedStations.map(renderStation)}
                    </div>
                  </>
                )}
                <p className="results-footnote">
                  Google Maps results may omit stations. Charger availability is
                  not guaranteed.
                </p>
              </>
            ) : (
              <p className="empty-state">
                {loading
                  ? "Searching Google Maps…"
                  : configured === false
                    ? "Google Maps setup is required before searching."
                    : "Choose your locations, then find chargers."}
              </p>
            )}
          </section>
          <footer>
            <span>Google Maps</span>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </footer>
        </aside>
        <section
          className={`map-panel ${view === "list" ? "mobile-hidden" : ""}`}
        >
          <ChargingMap
            start={start}
            destination={destination}
            stations={mapStations}
            route={displayedRoute}
            stops={stops}
            highlightedId={highlightedId ?? undefined}
            onSelect={selectStation}
            picking={picking}
            onPick={pick}
          />
        </section>
      </div>
      <StationDetails
        station={detailsOpen ? selected : null}
        onClose={() => setDetailsOpen(false)}
        stopNumber={stopNumber(selected)}
        onToggleStop={
          selected && result?.route ? () => toggleStop(selected) : undefined
        }
        busy={Boolean(updatingStop) || loading}
        stopLimit={stops.length >= MAX_TRIP_STOPS}
        error={stopError}
      />
    </main>
  );
}
const EMPTY_STATIONS: Station[] = [];

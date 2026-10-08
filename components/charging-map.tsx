"use client";
import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import type { Place, Station, TripRoute } from "@/shared/types";
import { useTheme } from "@/components/theme-provider";

let loading: Promise<void> | undefined;
function loadMaps() {
  // Reuse a Maps SDK loaded by another component rather than loading it twice.
  if (
    typeof google !== "undefined" &&
    google.maps?.Map &&
    google.maps.marker?.AdvancedMarkerElement
  )
    return Promise.resolve();
  if (!loading) {
    const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!key) return Promise.reject(new Error("Google Maps setup required"));
    setOptions({ key, v: "weekly", language: "en", region: "IN" });
    loading = Promise.all([
      importLibrary("maps"),
      importLibrary("marker"),
    ]).then(() => undefined);
  }
  return loading;
}
type Props = {
  start: Place | null;
  destination: Place | null;
  stations: Station[];
  stops: Station[];
  route?: TripRoute;
  highlightedId?: string;
  onSelect: (station: Station) => void;
  picking: "start" | "destination" | null;
  onPick: (place: Place) => void;
};
export function ChargingMap({
  start,
  destination,
  stations,
  stops,
  route,
  highlightedId,
  onSelect,
  picking,
  onPick,
}: Props) {
  const { theme } = useTheme();
  const host = useRef<HTMLDivElement>(null),
    map = useRef<google.maps.Map | null>(null);
  const camera = useRef<{
    center: google.maps.LatLngLiteral;
    zoom: number;
    heading: number;
    tilt: number;
  } | null>(null);
  const lastFit = useRef<unknown[] | null>(null);
  const stationMarkers = useRef<
    {
      id: string;
      pin: google.maps.marker.AdvancedMarkerElement;
      content: HTMLElement;
    }[]
  >([]);
  const [instance, setInstance] = useState<google.maps.Map | null>(null),
    [error, setError] = useState("");
  const ready = Boolean(instance);
  const handlers = useRef({ onSelect, onPick, picking });
  handlers.current = { onSelect, onPick, picking };
  useEffect(() => {
    if (!theme) return;
    let cancelled = false;
    let click: google.maps.MapsEventListener | undefined;
    const authWindow = window as typeof window & {
      gm_authFailure?: () => void;
    };
    const previous = authWindow.gm_authFailure;
    authWindow.gm_authFailure = () =>
      setError(
        "Google Maps access denied. Check the browser key, billing, and website restrictions.",
      );
    loadMaps()
      .then(() => {
        if (cancelled || !host.current) return;
        // Google only accepts colorScheme at construction, so restore the camera on theme changes.
        const current = new google.maps.Map(host.current, {
          center: camera.current?.center ?? { lat: 22.6, lng: 79 },
          zoom: camera.current?.zoom ?? 5,
          heading: camera.current?.heading ?? 0,
          tilt: camera.current?.tilt ?? 0,
          colorScheme: theme === "dark" ? "DARK" : "LIGHT",
          backgroundColor: theme === "dark" ? "#111827" : "#f4f4f5",
          mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        map.current = current;
        click = current.addListener(
          "click",
          (event: google.maps.MapMouseEvent) => {
            if (!handlers.current.picking || !event.latLng) return;
            const lat = event.latLng.lat(),
              lng = event.latLng.lng();
            handlers.current.onPick({
              id: `pin-${lat}-${lng}`,
              lat,
              lng,
              label: "Pinned location",
              subtitle: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
            });
          },
        );
        setInstance(current);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Google Maps could not load.",
          );
      });
    return () => {
      cancelled = true;
      click?.remove();
      const center = map.current?.getCenter?.(),
        zoom = map.current?.getZoom?.();
      if (center && zoom !== undefined)
        camera.current = {
          center: center.toJSON(),
          zoom,
          heading: map.current?.getHeading?.() ?? 0,
          tilt: map.current?.getTilt?.() ?? 0,
        };
      map.current = null;
      setInstance(null);
      authWindow.gm_authFailure = previous;
    };
  }, [theme]);
  useEffect(() => {
    if (!instance) return;
    stationMarkers.current = [];
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];
    const listeners: google.maps.MapsEventListener[] = [];
    function marker(
      place: { lat: number; lng: number },
      label: string,
      kind: string,
      select?: () => void,
      title?: string,
    ) {
      const content = document.createElement("span");
      const isCharger = kind.includes("charger");
      content.className = `map-marker ${kind}`;
      content.textContent = isCharger ? "" : label;
      if (isCharger) content.setAttribute("aria-hidden", "true");
      const pin = new google.maps.marker.AdvancedMarkerElement({
        map: instance,
        position: place,
        title: select
          ? title || label
          : kind === "start"
            ? "Starting point"
            : "Destination",
        content,
        gmpClickable: Boolean(select),
      });
      markers.push(pin);
      if (select) listeners.push(pin.addListener("click", select));
      return { pin, content };
    }
    if (start) marker(start, "A", "start");
    if (destination) marker(destination, "B", "destination");
    stations.forEach((station) => {
      const stop = stops.findIndex((s) => s.id === station.id);
      const { pin, content } = marker(
        station,
        stop >= 0 ? String(stop + 1) : "",
        stop >= 0 ? "stop" : "charger",
        () => handlers.current.onSelect(station),
        station.name,
      );
      stationMarkers.current.push({ id: station.id, pin, content });
    });
    const line = route
      ? new google.maps.Polyline({
          map: instance,
          path: route.coordinates,
          strokeColor: theme === "dark" ? "#60a5fa" : "#2563eb",
          strokeWeight: 5,
          strokeOpacity: 0.9,
        })
      : null;
    return () => {
      stationMarkers.current = [];
      markers.forEach((m) => {
        m.map = null;
      });
      listeners.forEach((l) => l.remove());
      line?.setMap(null);
    };
  }, [instance, start, destination, stations, stops, route, theme]);
  useEffect(() => {
    const hasHighlight = stationMarkers.current.some(
      ({ id }) => id === highlightedId,
    );
    stationMarkers.current.forEach(({ id, pin, content }) => {
      const highlighted = hasHighlight && id === highlightedId;
      content.classList.toggle("selected", highlighted);
      content.classList.toggle("muted", hasHighlight && !highlighted);
      pin.zIndex = highlighted
        ? 10
        : content.classList.contains("stop")
          ? 2
          : 1;
    });
  }, [
    highlightedId,
    instance,
    start,
    destination,
    stations,
    stops,
    route,
    theme,
  ]);
  useEffect(() => {
    if (!instance) return;
    const inputs = [start, destination, stations, route];
    const unchanged = lastFit.current?.every(
      (input, index) => input === inputs[index],
    );
    lastFit.current = inputs;
    if (camera.current && unchanged) return;
    const points = [
      ...(route?.coordinates ?? []),
      ...stations,
      ...(start ? [start] : []),
      ...(destination ? [destination] : []),
    ];
    if (!points.length) return;
    if (points.length === 1) {
      instance.setCenter(points[0]);
      instance.setZoom(13);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend(p));
    instance.fitBounds(bounds, 50);
  }, [instance, start, destination, stations, route]);
  useEffect(() => {
    if (instance)
      instance.setOptions({
        draggableCursor: picking ? "crosshair" : undefined,
      });
  }, [instance, picking]);
  return (
    <div className="map-wrap">
      <div
        ref={host}
        className="google-map"
        aria-label="Charging station map"
      />
      {(!ready || error) && (
        <div className="map-message">
          <strong>{error || "Loading Google Maps…"}</strong>
          {error === "Google Maps setup required" && (
            <p>
              Add the Google Maps keys in .env.local to enable the map and
              search.
            </p>
          )}
        </div>
      )}
      {picking && ready && !error && (
        <div className="pick-note">
          Click the map to set your{" "}
          {picking === "start" ? "starting point" : "destination"}.
        </div>
      )}
    </div>
  );
}

"use client";
import { Check, ChevronRight, LoaderCircle, Plus } from "lucide-react";
import { detourLabel, isOnRoute } from "@/shared/trip";
import type { Station } from "@/shared/types";
import { StationVerification } from "@/components/station-verification";

export function StationCard({
  station,
  selected,
  hovered,
  onSelect,
  onHoverChange,
  onFocusChange,
  stopNumber,
  onToggleStop,
  busy,
  pending,
  stopLimit,
}: {
  station: Station;
  selected: boolean;
  hovered: boolean;
  onSelect: () => void;
  onHoverChange: (hovered: boolean) => void;
  onFocusChange: (focused: boolean) => void;
  stopNumber?: number;
  onToggleStop?: () => void;
  busy?: boolean;
  pending?: boolean;
  stopLimit?: boolean;
}) {
  return (
    <article
      className={`station-card ${selected ? "selected" : ""} ${hovered ? "hovered" : ""} ${stopNumber ? "in-trip" : ""}`}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onHoverChange(true);
      }}
      onPointerLeave={() => onHoverChange(false)}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) onFocusChange(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          onFocusChange(false);
      }}
    >
      <button
        type="button"
        className="station-main"
        onClick={onSelect}
        aria-label={`View ${station.name} details`}
        aria-current={selected ? "true" : undefined}
      >
        <div className="station-row">
          <strong>{station.name}</strong>
          <span
            className="distance-badge"
            title={
              station.offRouteKm !== undefined
                ? "Distance from start along the original route"
                : "Straight-line distance from start"
            }
          >
            {station.distanceKm.toFixed(1)} km
          </span>
        </div>
        <p className="station-address">{station.address}</p>
        {station.businessStatus === "CLOSED_TEMPORARILY" && (
          <small className="error">Temporarily closed</small>
        )}
        {station.businessStatus === "CLOSED_PERMANENTLY" && (
          <small className="error">Permanently closed</small>
        )}
        {!onToggleStop && (
          <span className="station-more">
            View details <ChevronRight size={13} />
          </span>
        )}
      </button>
      {onToggleStop && (
        <div className="station-card-footer">
          <span
            className={`detour-badge ${isOnRoute(station) ? "on-route" : ""}`}
          >
            {detourLabel(station)}
          </span>
          <button
            type="button"
            className={`stop-button ${stopNumber ? "added" : ""}`}
            disabled={busy || (!stopNumber && stopLimit)}
            aria-label={`${stopNumber ? "Remove" : "Add"} ${station.name} ${stopNumber ? "from trip" : "to trip"}`}
            aria-pressed={Boolean(stopNumber)}
            onClick={onToggleStop}
          >
            {pending ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : stopNumber ? (
              <Check size={14} />
            ) : (
              <Plus size={14} />
            )}
            {stopNumber ? `Stop ${stopNumber}` : "Add stop"}
          </button>
        </div>
      )}
      <StationVerification station={station} />
    </article>
  );
}

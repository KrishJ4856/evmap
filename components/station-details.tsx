"use client";
import {
  Check,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Phone,
  Plus,
} from "lucide-react";
import { detourLabel } from "@/shared/trip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StationPhotos } from "@/components/station-photos";
import type { Station } from "@/shared/types";
import { StationVerification } from "@/components/station-verification";

function safeUrl(url?: string) {
  try {
    const parsed = new URL(url || "");
    return ["https:", "http:"].includes(parsed.protocol)
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function StationDetails({
  station,
  onClose,
  stopNumber,
  onToggleStop,
  busy,
  stopLimit,
  error,
}: {
  station: Station | null;
  onClose: () => void;
  stopNumber?: number;
  onToggleStop?: () => void;
  busy?: boolean;
  stopLimit?: boolean;
  error?: string;
}) {
  const connectors =
    station?.connectors.filter(
      (connector) =>
        (connector.type.trim() && connector.type !== "Unspecified") ||
        [
          connector.powerKW,
          connector.quantity,
          connector.available,
          connector.outOfService,
        ].some(Number.isFinite),
    ) ?? [];
  const phone = station?.phone?.trim();
  const hasPhone = Boolean(phone && /\d/.test(phone));
  const confidenceScore = Number(connectors.length > 0) + Number(hasPhone);
  const confidence = ["Low", "Medium", "High"][confidenceScore];
  const listingNote = station
    ? {
        OPERATIONAL: "Google Maps lists this location as operational.",
        CLOSED_TEMPORARILY: "Google Maps lists this location as temporarily closed.",
        CLOSED_PERMANENTLY: "Google Maps lists this location as permanently closed.",
        UNKNOWN: "Google Maps hasn’t reported an operating status for this location.",
      }[station.businessStatus]
    : "";
  return (
    <Dialog
      open={Boolean(station)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="station-dialog">
        {station && (
          <>
            <DialogHeader>
              <DialogTitle>{station.name}</DialogTitle>
              <DialogDescription>{station.address}</DialogDescription>
            </DialogHeader>
            {station.photos?.length ? (
              <StationPhotos
                key={station.id}
                photos={station.photos}
                name={station.name}
              />
            ) : null}
            <div className="station-location-row">
              <div className="station-distance">
                <MapPin size={14} aria-hidden="true" />
                <span>
                  {station.distanceKm.toFixed(1)} km from the starting location
                </span>
              </div>
              <span className="coordinates" aria-label="Station coordinates">
                {station.lat.toFixed(6)}, {station.lng.toFixed(6)}
              </span>
            </div>
            {station.offRouteKm !== undefined && (
              <span className="detail-detour">{detourLabel(station)}</span>
            )}
            {connectors.length > 0 && (
              <section className="charger-details">
                <h3>Chargers</h3>
                {connectors.map((c, i) => (
                  <div className="connector-detail" key={i}>
                    <div>
                      <strong>
                        {c.type === "Unspecified" ? "Connector" : c.type}
                      </strong>
                      <span>
                        {[
                          c.powerKW !== undefined
                            ? `${c.powerKW} kW`
                            : undefined,
                          c.quantity !== undefined
                            ? `${c.quantity} connector${c.quantity === 1 ? "" : "s"}`
                            : undefined,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    {c.available !== undefined && c.updatedAt && (
                      <small>
                        {c.available} reported available · Updated{" "}
                        {new Date(c.updatedAt).toLocaleString()}
                      </small>
                    )}
                    {c.outOfService !== undefined && c.updatedAt && (
                      <small>{c.outOfService} reported out of service</small>
                    )}
                  </div>
                ))}
              </section>
            )}
            {station.hours?.length ? (
              <details className="opening-hours">
                <summary>
                  Opening hours <ChevronDown size={14} aria-hidden="true" />
                </summary>
                {station.hours.map((hour) => (
                  <p key={hour} className="hours">
                    {hour}
                  </p>
                ))}
              </details>
            ) : null}
            <div className="listing-signals">
              <div
                className="availability-pills"
                aria-label="Listing information and confidence"
              >
                <span
                  className={`info-pill ${connectors.length ? "available" : "missing"}`}
                >
                  <span className="pill-emoji" aria-hidden="true">
                    {connectors.length ? "✅" : "❌"}
                  </span>
                  <span>
                    Charger details {connectors.length ? "available" : "missing"}
                  </span>
                </span>
                <span
                  className={`info-pill ${hasPhone ? "available" : "missing"}`}
                >
                  <span className="pill-emoji" aria-hidden="true">
                    {hasPhone ? "✅" : "❌"}
                  </span>
                  <span>Contact number {hasPhone ? "available" : "missing"}</span>
                </span>
                <span
                  className={`info-pill confidence-${confidence.toLowerCase()}`}
                >
                  <span className="pill-emoji" aria-hidden="true">
                    🎯
                  </span>
                  <span>{confidence} confidence</span>
                </span>
              </div>
              <p className={`confidence-note ${station.businessStatus.startsWith("CLOSED") ? "listing-closed" : ""}`}>
                {listingNote}
              </p>
            </div>
            <StationVerification key={station.id} station={station} />
            <div
              className={`detail-actions ${onToggleStop ? "with-trip" : ""}`}
            >
              {onToggleStop && (
                <Button
                  onClick={onToggleStop}
                  disabled={busy || (!stopNumber && stopLimit)}
                >
                  {busy ? (
                    <LoaderCircle className="animate-spin" />
                  ) : stopNumber ? (
                    <Check />
                  ) : (
                    <Plus />
                  )}
                  {stopNumber ? `Remove stop ${stopNumber}` : "Add to trip"}
                </Button>
              )}
              <Button asChild variant={onToggleStop ? "outline" : "default"}>
                <a
                  href={safeUrl(station.sourceUrl)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Google Maps <ExternalLink />
                </a>
              </Button>
              {hasPhone ? (
                <Button asChild variant="outline">
                  <a
                    className="contact-action"
                    aria-label={`Call ${phone}`}
                    href={`tel:${phone!.replace(/[^+\d]/g, "")}`}
                  >
                    <Phone />
                    {phone}
                  </a>
                </Button>
              ) : null}
            </div>
            {error && (
              <p className="error" role="alert">
                {error} Your stops are unchanged.
              </p>
            )}
            <div className="station-detail-footer">
              {safeUrl(station.website) && (
                <a
                  className="text-link"
                  href={safeUrl(station.website)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Station website
                </a>
              )}
              <span className="google-credit">Google Maps</span>
            </div>
            {station.attributions.length > 0 && (
              <div className="station-attributions">
                {station.attributions.map((a, i) =>
                  safeUrl(a.uri) ? (
                    <a
                      key={i}
                      href={safeUrl(a.uri)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {i > 0 && " · "}
                      {a.name}
                    </a>
                  ) : (
                    <span key={i}>
                      {i > 0 && " · "}
                      {a.name}
                    </span>
                  ),
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

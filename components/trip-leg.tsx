import { Car } from "lucide-react";
import type { TripLeg as Leg } from "@/shared/types";

export function TripLeg({
  leg,
  from,
  to,
  hasRoute,
}: {
  leg?: Leg;
  from: string;
  to: string;
  hasRoute: boolean;
}) {
  const minutes = leg ? Math.round(leg.durationMinutes) : 0;
  const duration =
    minutes >= 60
      ? `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`
      : leg && leg.durationMinutes > 0 && minutes === 0
        ? "<1 min"
        : `${minutes} min`;
  return (
    <div
      className="trip-leg"
      aria-label={hasRoute ? `Driving from ${from} to ${to}` : undefined}
    >
      {hasRoute && (
        <span className="trip-leg-metric">
          <Car size={13} aria-hidden="true" />
          {leg
            ? `${leg.distanceKm > 0 && leg.distanceKm < 0.1 ? "<0.1" : Number(leg.distanceKm.toFixed(1))} km − ${duration}`
            : "Driving estimate unavailable"}
        </span>
      )}
    </div>
  );
}

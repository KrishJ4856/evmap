"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { StationPhoto } from "@/shared/types";

export function StationPhotos({
  photos,
  name,
}: {
  photos: StationPhoto[];
  name: string;
}) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed || !photos.length) return null;
  const photo = photos[index % photos.length];
  const authorLink = (uri?: string) => {
    try {
      const address = new URL(uri || "");
      return address.protocol === "https:" ? address.href : undefined;
    } catch {
      return undefined;
    }
  };
  return (
    <figure className="station-photos">
      <div className="station-photo-frame">
        {/* The signed Google media redirect stays outside Next's image cache. */}
        <img
          key={photo.name}
          src={`/api/photos?${new URLSearchParams({ name: photo.name })}`}
          alt={`${name} — Google Maps listing photo ${index + 1}`}
          width={900}
          height={600}
          loading="lazy"
          onError={() => setFailed(true)}
        />
        {photos.length > 1 && (
          <div className="photo-controls">
            <button
              type="button"
              aria-label="Previous listing photo"
              onClick={() =>
                setIndex(
                  (current) => (current + photos.length - 1) % photos.length,
                )
              }
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              {index + 1} / {photos.length}
            </span>
            <button
              type="button"
              aria-label="Next listing photo"
              onClick={() =>
                setIndex((current) => (current + 1) % photos.length)
              }
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>
      <figcaption className="photo-attributions">
        Google Maps{photo.authors.length > 0 && " · Photo by "}
        {photo.authors.map((author, i) => (
          <span key={i}>
            {i > 0 && ", "}
            {authorLink(author.uri) ? (
              <a href={authorLink(author.uri)} target="_blank" rel="noreferrer">
                {author.name}
              </a>
            ) : (
              author.name
            )}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

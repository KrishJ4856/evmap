"use client";
import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { parsePin } from "@/shared/location-input";
import type { Place, Prediction } from "@/shared/types";

type Props = {
  label: string;
  value: Place | null;
  onChange: (place: Place | null) => void;
  onEditing: (editing: boolean) => void;
  placeholder: string;
  action?: React.ReactNode;
};
export function LocationSearch({
  label,
  value,
  onChange,
  onEditing,
  placeholder,
  action,
}: Props) {
  const id = useId(),
    container = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(value?.label ?? ""),
    [open, setOpen] = useState(false);
  const [places, setPlaces] = useState<(Prediction | Place)[]>([]),
    [loading, setLoading] = useState(false),
    [resolving, setResolving] = useState(false);
  const [error, setError] = useState(""),
    [active, setActive] = useState(-1),
    [textMode, setTextMode] = useState(false);
  const editing = useRef(false),
    token = useRef(""),
    selection = useRef<AbortController | null>(null);
  function session() {
    return (token.current ||= crypto.randomUUID());
  }
  useEffect(() => {
    if (value) {
      setText(value.label);
      editing.current = false;
    } else if (!editing.current) setText("");
  }, [value]);
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      selection.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!open || textMode || text === value?.label) return;
    const controller = new AbortController();
    setActive(-1);
    setError("");
    setPlaces([]);
    const pin = parsePin(text);
    if (pin) {
      setPlaces([
        {
          ...pin,
          id: `pin-${pin.lat}-${pin.lng}`,
          label: "Pinned location",
          subtitle: `${pin.lat}, ${pin.lng}`,
        },
      ]);
      setLoading(false);
      return;
    }
    if (text.trim().length < 2) {
      setLoading(false);
      return;
    }
    if (/^https?:\/\//i.test(text)) {
      setError(
        "Paste the pin's latitude, longitude, or a full Google Maps link containing pin coordinates.",
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/places?${new URLSearchParams({ q: text.trim(), sessionToken: session() })}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setPlaces(data.places);
      } catch (err) {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error
              ? err.message
              : "Google Maps search unavailable.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, open, value?.label, textMode]);

  function commit(place: Place) {
    editing.current = false;
    onEditing(false);
    onChange(place);
    setText(place.label);
    setOpen(false);
    setError("");
    token.current = "";
    setTextMode(false);
  }
  async function select(place: Prediction | Place) {
    if ("lat" in place) {
      commit(place);
      return;
    }
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setResolving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/places?${new URLSearchParams({ id: place.id, sessionToken: session() })}`,
        { signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!controller.signal.aborted) commit(data.place);
    } catch (err) {
      if (!controller.signal.aborted)
        setError(
          err instanceof Error ? err.message : "Could not locate this place.",
        );
    } finally {
      if (!controller.signal.aborted) setResolving(false);
    }
  }
  async function exactSearch() {
    if (text.trim().length < 2 || /^https?:\/\//i.test(text)) return;
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setTextMode(true);
    setLoading(true);
    setError("");
    setPlaces([]);
    setActive(-1);
    try {
      const response = await fetch(
        `/api/places?${new URLSearchParams({ q: text.trim(), mode: "text" })}`,
        { signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (controller.signal.aborted) return;
      setPlaces(data.places);
      if (!data.places.length)
        setError(
          "No Google Maps results. Try the full address or paste pin coordinates.",
        );
    } catch (err) {
      if (!controller.signal.aborted)
        setError(
          err instanceof Error
            ? err.message
            : "Google Maps search unavailable.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  return (
    <div className="location-search" ref={container}>
      <div className="field-heading">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      <div className="input-wrap">
        <Input
          id={id}
          placeholder={placeholder}
          value={text}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={
            open && active >= 0 ? `${id}-option-${active}` : undefined
          }
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            selection.current?.abort();
            setResolving(false);
            editing.current = true;
            setText(event.target.value);
            setTextMode(false);
            onChange(null);
            onEditing(Boolean(event.target.value.trim()));
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, places.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            }
            if (event.key === "Enter" && open) {
              event.preventDefault();
              if (resolving) return;
              const pin = parsePin(text);
              if (pin) {
                commit({
                  ...pin,
                  id: `pin-${pin.lat}-${pin.lng}`,
                  label: "Pinned location",
                  subtitle: `${pin.lat}, ${pin.lng}`,
                });
                return;
              }
              if (active >= 0 && places[active]) void select(places[active]);
              else void exactSearch();
            }
          }}
        />
        {text && (
          <button
            type="button"
            className="clear-input"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              selection.current?.abort();
              editing.current = false;
              onChange(null);
              onEditing(false);
              setText("");
              setPlaces([]);
              setError("");
              setResolving(false);
              token.current = "";
              setTextMode(false);
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>
      {open && text && text !== value?.label && (
        <div
          className="location-dropdown"
          id={`${id}-options`}
          role="listbox"
          aria-label={`${label} suggestions`}
        >
          {(loading || resolving) && (
            <p className="search-note">
              <LoaderCircle size={15} className="animate-spin" />
              {resolving ? "Getting exact location…" : "Searching…"}
            </p>
          )}
          {!loading &&
            places.map((place, i) => (
              <button
                type="button"
                role="option"
                aria-selected={active === i}
                id={`${id}-option-${i}`}
                key={place.id}
                className={`place-option ${active === i ? "active" : ""}`}
                disabled={resolving}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void select(place)}
              >
                <strong>{place.label}</strong>
                <small>{place.subtitle}</small>
              </button>
            ))}
          {error && (
            <p className="search-note error" role="alert">
              {error}
            </p>
          )}
          {!loading &&
            !resolving &&
            text.trim().length >= 2 &&
            !parsePin(text) &&
            !/^https?:\/\//i.test(text) &&
            !textMode && (
              <button
                type="button"
                className="text-search"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void exactSearch()}
              >
                Search Google Maps for “{text}”
              </button>
            )}
          <div className="google-credit">Google Maps</div>
        </div>
      )}
    </div>
  );
}

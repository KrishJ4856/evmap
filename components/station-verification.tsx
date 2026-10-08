"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, LoaderCircle, PhoneCall } from "lucide-react";
import type { MonitorSession } from "retell-client-js-sdk";
import type { Station } from "@/shared/types";
import { activeVerification, type VerificationResponse } from "@/shared/verification";

const labels = { starting: "Starting call…", calling: "Call in progress", processing: "Saving call result…", completed: "Call saved", failed: "Call not verified" };

export function StationVerification({ station }: { station: Station }) {
  const [state, setState] = useState<VerificationResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [polling, setPolling] = useState(true);
  const listener = useRef<MonitorSession | null>(null);
  const verification = state?.verification;
  const active = activeVerification(verification);
  const budgetReached = Boolean(state?.budget && (state.budget.calls >= state.budget.maxCalls || state.budget.usedUsd + state.budget.minimumCallUsd > state.budget.limitUsd + 0.000001));

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/verification?stationId=${encodeURIComponent(station.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load verification.");
        setState(data);
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => { controller.abort(); listener.current?.disconnect(); };
  }, [station.id]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh", stationId: station.id }), signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not check the result.");
    setState(data);
    setError("");
  }, [station.id]);

  useEffect(() => {
    if (!active || !polling) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const until = Date.now() + Math.max(180_000, (verification?.durationLimitSeconds ?? 0) * 1000 + 120_000);
    const poll = async () => {
      try { await refresh(controller.signal); } catch (error) {
        if (!controller.signal.aborted) { setError((error as Error).message); setPolling(false); }
      }
      if (!controller.signal.aborted && Date.now() < until) timer = setTimeout(poll, 5000);
      else if (!controller.signal.aborted) setPolling(false);
    };
    timer = setTimeout(poll, 4000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [active, polling, refresh, verification?.durationLimitSeconds]);

  useEffect(() => {
    if (verification?.status && verification.status !== "calling") {
      listener.current?.disconnect();
      listener.current = null;
    }
  }, [verification?.status]);

  async function start() {
    if (busy || verification) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", station }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start verification.");
      setState(data); setPolling(true);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  async function listen() {
    if (listening) { listener.current?.disconnect(); listener.current = null; setListening(false); return; }
    setConnecting(true); setError("");
    try {
      const { RetellClient } = await import("retell-client-js-sdk");
      const client = new RetellClient({
        key: "server-proxied",
        // Audio-only monitoring needs just this REST request; media signaling
        // uses the scoped listener token. No workspace key reaches the browser.
        fetch: async () => fetch("/api/verification/listen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stationId: station.id }) }),
      });
      listener.current = client.monitorCall({ call_id: verification!.callId!, transcript: false, hooks: {
        onEnd: () => setListening(false),
        onError: () => { setListening(false); setError("Could not listen live. Try again after connection or open Retell Live Monitoring."); },
      } });
      await listener.current.listen();
      setListening(true);
    } catch {
      listener.current?.disconnect(); listener.current = null;
      setError("Live audio is not ready. Try again once the call connects, or open Retell Live Monitoring.");
    } finally { setConnecting(false); }
  }

  return (
    <section className="station-verification" aria-label={`Verification for ${station.name}`}>
      {!verification ? (
        <>
          <button type="button" className="verification-button" onClick={start} disabled={busy || !station.phone?.trim() || budgetReached || state?.configured === false}>
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : <PhoneCall size={14} />}
            {busy ? "Starting call…" : "Initiate verification"}
          </button>
          {!station.phone?.trim() ? <small>No phone number provided</small> : state?.configured === false ? <small>Calling setup required</small> : budgetReached ? <small>Experiment budget reached or another call is pending</small> : <small>One test call · uses the remaining experiment budget</small>}
        </>
      ) : (
        <>
          <div className="verification-heading" role="status">
            {active && <LoaderCircle size={13} className="animate-spin" />}
            <strong>{labels[verification.status]}</strong>
            {verification.confidence !== undefined && <span>{verification.confidence}/10 evidence</span>}
          </div>
          <small>{new Date(verification.checkedAt || verification.createdAt).toLocaleString()}{verification.durationSeconds !== undefined ? ` · ${verification.durationSeconds}s` : ""}{verification.costUsd !== undefined ? ` · $${verification.costUsd.toFixed(3)}` : ""}</small>
          {verification.summary && <p>{verification.summary}</p>}
          {verification.operational && <p className="verification-facts">Charger: {verification.operational.replaceAll("_", " ")} · Access: {verification.publicAccess}</p>}
          {verification.chargingProcess && <p>{verification.chargingProcess}</p>}
          {verification.chargerDetails && <p>{verification.chargerDetails}</p>}
          {verification.audioUrl && <audio controls preload="none" src={verification.audioUrl} aria-label={`Verification recording for ${station.name}`} />}
          {verification.transcript && <details><summary>Call transcript</summary><p className="verification-transcript">{verification.transcript}</p></details>}
          {verification.status === "calling" && <button type="button" className="verification-button" disabled={connecting} onClick={listen}><Headphones size={14} />{connecting ? "Connecting audio…" : listening ? "Stop listening" : "Listen live"}</button>}
          {active && <a className="text-link" href="https://dashboard.retellai.com" target="_blank" rel="noreferrer">Open Retell Live Monitoring ↗</a>}
          {verification.callId && verification.status !== "completed" && <button type="button" className="text-link verification-check" disabled={busy} onClick={async () => {
            setBusy(true);
            try { await refresh(); setPolling(true); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
          }}>Check call result</button>}
          {active && !polling && <small>Automatic checking paused. Check the result when ready.</small>}
          {verification.error && <p className="error">{verification.error}</p>}
          {verification.recordingError && <p className="error">{verification.recordingError}</p>}
        </>
      )}
      {state?.budget && <small className="verification-budget">${state.budget.usedUsd.toFixed(2)} / $2 used or reserved · {state.budget.calls} / {state.budget.maxCalls} attempts</small>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

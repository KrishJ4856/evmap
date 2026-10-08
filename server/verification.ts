import { MongoClient } from "mongodb";
import { z } from "zod";
import type { Verification, VerificationResponse } from "../shared/verification";
import { retellClient } from "./verification-agent";
import { checkRecordingStorage, recordingPlaybackUrl, saveRecording } from "./verification-storage";

export class VerificationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const verificationInput = z.object({
  id: z.string().trim().min(1).max(250),
  name: z.string().trim().min(1).max(300),
  address: z.string().trim().max(1000),
  phone: z.string().trim().min(1).max(40),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});
type Target = z.infer<typeof verificationInput>;
type Record = Omit<Verification, "audioUrl"> & {
  _id: string;
  reservedUsd: number;
  recordingKey?: string;
  analysisReady?: boolean;
  providerFinished?: boolean;
};

const required = ["RETELL_API_KEY", "RETELL_AGENT_ID", "RETELL_FROM_NUMBER", "MONGODB_URI", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"];
export function missingVerificationConfig() { return required.filter((key) => !process.env[key]?.trim()); }

// A fixed small experiment: no queue, background worker, retries, or expiry.
export const SPEND_LIMIT_USD = 2;
export const MAX_CALLS = 4;
// Conservative combined carrier + voice rate, not a fixed per-call time limit.
// Retell requires a minimum 60s maximum-duration setting, so at least this much
// budget must remain before dialing. Each call reserves the remaining balance.
export const ESTIMATED_USD_PER_MINUTE = 0.65;

let mongo: Promise<MongoClient> | undefined;
export async function verificationCollection() {
  if (!process.env.MONGODB_URI) throw new VerificationError("Add MONGODB_URI to .env.local.", 503);
  mongo ??= new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, ignoreUndefined: true }).connect().catch((error) => { mongo = undefined; throw error; });
  return (await mongo).db(process.env.MONGODB_DATABASE || "evmap").collection<Record>("verifications");
}

export function indiaPhoneNumber(value: string) {
  const cleaned = value.replace(/[\s().-]/g, "");
  const digits = cleaned.replace(/^\+/, "");
  const national = /^\d{10}$/.test(digits) ? digits : /^0\d{10}$/.test(digits) ? digits.slice(1) : /^91\d{10}$/.test(digits) ? digits.slice(2) : "";
  if (!national || !/^[1-9]\d{9}$/.test(national) || (cleaned.startsWith("+") && !cleaned.startsWith("+91"))) {
    throw new VerificationError("This experiment supports Indian 10-digit numbers only. Toll-free and extension numbers are not supported.");
  }
  return `+91${national}`;
}

const text = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 6000) : "";
export function extractVerification(data: { [key: string]: unknown } = {}) {
  const identity = data.station_identity_confirmed === true;
  const operational = ["working", "partly_working", "not_working"].includes(text(data.operational)) ? text(data.operational) : "unknown";
  const publicAccess = ["public", "restricted", "private"].includes(text(data.public_access)) ? text(data.public_access) : "unknown";
  const chargingProcess = text(data.charging_process);
  // Confidence is evidence completeness, not charger health or a probability.
  const confidence = identity ? 2 +
    (data.knowledgeable_respondent === true ? 2 : 0) +
    (operational !== "unknown" ? 2 : 0) +
    (publicAccess !== "unknown" ? 1 : 0) +
    (chargingProcess ? 1 : 0) +
    (data.answers_consistent === true ? 2 : 0) : undefined;
  return { confidence, operational: identity ? operational : "unknown", publicAccess: identity ? publicAccess : "unknown", chargingProcess: identity ? chargingProcess : "", chargerDetails: identity ? text(data.charger_details) : "" };
}

async function publicRecord(record: Record | null): Promise<Verification | null> {
  if (!record) return null;
  const { _id, reservedUsd, recordingKey, analysisReady, providerFinished, ...view } = record;
  void _id; void reservedUsd; void analysisReady; void providerFinished;
  return { ...view, ...(recordingKey ? { audioUrl: await recordingPlaybackUrl(recordingKey) } : {}) };
}

export async function verificationState(stationId: string): Promise<VerificationResponse> {
  const missing = missingVerificationConfig();
  if (!process.env.MONGODB_URI) return { configured: false, missing, verification: null };
  const collection = await verificationCollection();
  const records = await collection.find({}).toArray();
  const usedUsd = records.reduce((sum, record) => sum + Math.max(record.reservedUsd, record.costUsd ?? 0), 0);
  return {
    configured: missing.length === 0,
    missing,
    verification: await publicRecord(records.find((record) => record._id === stationId) ?? null),
    budget: { usedUsd, limitUsd: SPEND_LIMIT_USD, calls: records.length, maxCalls: MAX_CALLS, minimumCallUsd: ESTIMATED_USD_PER_MINUTE },
  };
}

let startingCall = false;
export async function initiateVerification(target: Target) {
  // One local process / one user. Just prevent overlapping button requests from
  // reading the same budget before their reservations are saved.
  if (startingCall) throw new VerificationError("A call is being started. Wait a moment before starting another.", 409);
  startingCall = true;
  try { return await startManualCall(target); } finally { startingCall = false; }
}

async function startManualCall(target: Target) {
  const missing = missingVerificationConfig();
  if (missing.length) throw new VerificationError(`Add ${missing.join(", ")} to .env.local.`, 503);
  const phone = indiaPhoneNumber(target.phone);
  const state = await verificationState(target.id);
  if (state.verification) return state; // One manual attempt per listing, forever.
  if (state.budget!.calls >= MAX_CALLS || state.budget!.usedUsd + ESTIMATED_USD_PER_MINUTE > SPEND_LIMIT_USD + 0.000001) {
    throw new VerificationError("The $2 / 4-call experiment limit has been reached.", 409);
  }
  const remainingUsd = Math.max(0, SPEND_LIMIT_USD - state.budget!.usedUsd);
  const durationLimitSeconds = Math.floor((remainingUsd + 1e-9) / ESTIMATED_USD_PER_MINUTE * 60);
  // Discover invalid storage credentials before spending money on a call.
  try { await checkRecordingStorage(); } catch { throw new VerificationError("Cannot access the R2 bucket. Check its name and credentials before calling.", 503); }
  const collection = await verificationCollection();
  const record: Record = { _id: target.id, stationId: target.id, status: "starting", createdAt: new Date().toISOString(), reservedUsd: remainingUsd, durationLimitSeconds };
  await collection.insertOne(record);
  try {
    const call = await retellClient().call.createPhoneCall({
      from_number: process.env.RETELL_FROM_NUMBER!,
      to_number: phone,
      override_agent_id: process.env.RETELL_AGENT_ID!,
      agent_override: { agent: { max_call_duration_ms: durationLimitSeconds * 1000, ring_duration_ms: 15_000 } },
      retell_llm_dynamic_variables: {
        station_name: target.name,
        station_address: target.address,
        station_coordinates: `${target.lat}, ${target.lng}`,
      },
      metadata: { evmap_station_id: target.id },
    });
    await collection.updateOne({ _id: target.id }, { $set: { callId: call.call_id, status: "calling" } });
  } catch {
    // A timeout may mean the provider accepted the call. Keep the reservation and
    // never offer an automatic retry; inspect Retell's history to resolve it.
    await collection.updateOne({ _id: target.id }, { $set: { status: "failed", error: "The call could not be confirmed. Check Retell call history before trying another listing; the budget reservation is retained." } });
  }
  return verificationState(target.id);
}

export async function refreshVerification(stationId: string) {
  const collection = await verificationCollection();
  const record = await collection.findOne({ _id: stationId });
  if (!record?.callId) return verificationState(stationId);
  if (record.status === "completed") return verificationState(stationId);
  const call = await retellClient().call.retrieve(record.callId);
  const finished = ["ended", "error", "not_connected"].includes(call.call_status);
  const update: Partial<Record> = {
    status: finished ? "processing" : "calling",
    providerFinished: finished,
  };
  if (call.call_cost && Number.isFinite(call.call_cost.combined_cost)) update.costUsd = call.call_cost.combined_cost / 100;
  if (finished) {
    // Release unused budget only after the provider has ended the call and
    // supplied a cost; an unknown/ongoing call keeps its full reservation.
    if (update.costUsd !== undefined) update.reservedUsd = update.costUsd;
    update.checkedAt = new Date(call.end_timestamp || Date.now()).toISOString();
    update.durationSeconds = Math.round((call.duration_ms || 0) / 1000);
    update.transcript = call.transcript || "";
    if (call.call_analysis) {
      const custom = call.call_analysis.custom_analysis_data;
      Object.assign(update, extractVerification(custom && typeof custom === "object" ? custom as { [key: string]: unknown } : {}), {
        summary: text(call.call_analysis.call_summary), analysisReady: true,
      });
    }
    if (call.recording_url && !record.recordingKey) {
      try {
        update.recordingKey = await saveRecording(record.callId, call.recording_url);
        update.recordingError = "";
      } catch {
        update.recordingError = "Audio could not be saved to R2. Check storage settings, then check the result again; this will not make another call.";
      }
    }
    if (call.call_status === "error" || call.call_status === "not_connected") {
      update.status = "failed";
      update.error = `Call did not complete (${call.disconnection_reason || call.call_status}). No charger status was verified.`;
    } else if ((update.analysisReady || record.analysisReady) && (update.recordingKey || record.recordingKey)) {
      update.status = "completed";
    }
  }
  await collection.updateOne({ _id: stationId }, { $set: update });
  return verificationState(stationId);
}

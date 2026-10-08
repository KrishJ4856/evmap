import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  records: new Map<string, { [key: string]: any }>(),
  dial: vi.fn(), retrieve: vi.fn(), listen: vi.fn(), storageCheck: vi.fn(), save: vi.fn(), playback: vi.fn(),
}));
vi.mock("mongodb", () => ({ MongoClient: class {
  async connect() { return this; }
  db() { return { collection: () => ({
    find: () => ({ toArray: async () => [...doubles.records.values()] }),
    findOne: async ({ _id }: { _id: string }) => doubles.records.get(_id) ?? null,
    insertOne: async (record: { _id: string }) => { doubles.records.set(record._id, { ...record }); },
    updateOne: async ({ _id }: { _id: string }, update: { $set: object }) => { Object.assign(doubles.records.get(_id)!, update.$set); },
  }) }; }
} }));
vi.mock("../server/verification-agent", async (importOriginal) => ({
  ...await importOriginal<typeof import("../server/verification-agent")>(),
  retellClient: () => ({ call: { createPhoneCall: doubles.dial, retrieve: doubles.retrieve, listenLive: doubles.listen } }),
}));
vi.mock("../server/verification-storage", () => ({ checkRecordingStorage: doubles.storageCheck, saveRecording: doubles.save, recordingPlaybackUrl: doubles.playback }));

import { extractVerification, indiaPhoneNumber, initiateVerification, refreshVerification, verificationState } from "../server/verification";
import { agentDefinition } from "../server/verification-agent";
import { POST } from "../app/api/verification/route";
import { POST as listen } from "../app/api/verification/listen/route";

const target = { id: "place-a", name: "Charger A", address: "Kolkata", phone: "+91 98765 43210", lat: 22.55, lng: 88.36 };
const confirmed = { station_identity_confirmed: true, knowledgeable_respondent: true, operational: "not_working", public_access: "private", charging_process: "Ask reception", answers_consistent: true };

beforeEach(() => {
  doubles.records.clear();
  vi.clearAllMocks();
  for (const key of ["RETELL_API_KEY", "RETELL_AGENT_ID", "RETELL_FROM_NUMBER", "MONGODB_URI", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]) vi.stubEnv(key, `test-${key}`);
  doubles.storageCheck.mockResolvedValue(undefined);
  doubles.dial.mockResolvedValue({ call_id: "call-a" });
  doubles.save.mockResolvedValue("verifications/call-a.wav");
  doubles.playback.mockResolvedValue("https://audio.example/recording.wav");
});

describe("manual verification experiment", () => {
  it("normalizes Indian mobile / landline formats and rejects international / toll-free / extension numbers", () => {
    expect(indiaPhoneNumber("09876543210")).toBe("+919876543210");
    expect(indiaPhoneNumber("+91 (33) 2345-6789")).toBe("+913323456789");
    for (const number of ["+1 9876543210", "18001234567", "+91 9876543210 ext 2", "", "+919999"]) expect(() => indiaPhoneNumber(number)).toThrow();
  });

  it("does not dial when viewing a listing or when credentials are missing", async () => {
    vi.stubEnv("MONGODB_URI", "");
    expect((await verificationState(target.id)).configured).toBe(false);
    await expect(initiateVerification(target)).rejects.toThrow("MONGODB_URI");
    expect(doubles.dial).not.toHaveBeenCalled();
  });

  it("has no fixed one-minute cutoff and explicitly enables Hindi and Indian English", () => {
    const agent = agentDefinition("llm-a");
    expect(agent.language).toEqual(["hi-IN", "en-IN"]);
    expect(agent.max_call_duration_ms).toBeUndefined();
    expect(agent.ivr_option).toBeNull();
  });

  it("checks storage before spending, and fails without dialing when R2 is unavailable", async () => {
    doubles.storageCheck.mockRejectedValueOnce(new Error("credentials"));
    await expect(initiateVerification(target)).rejects.toThrow("R2");
    expect(doubles.dial).not.toHaveBeenCalled();
    expect(doubles.records.size).toBe(0);
  });

  it("starts only once and reuses the saved attempt on subsequent clicks", async () => {
    const first = await initiateVerification(target);
    await initiateVerification(target);
    expect(first.verification?.status).toBe("calling");
    expect(doubles.dial).toHaveBeenCalledTimes(1);
    expect(doubles.dial.mock.calls[0][0].to_number).toBe("+919876543210");
    expect(doubles.dial.mock.calls[0][0].agent_override.agent.max_call_duration_ms).toBe(184_000);
    // Persist a Place ID and our call data, not a Google listing snapshot.
    expect(doubles.records.get(target.id)).not.toHaveProperty("address");
    expect(doubles.records.get(target.id)).not.toHaveProperty("phone");
  });

  it("retains the budget reservation after an ambiguous call failure and never retries", async () => {
    doubles.dial.mockRejectedValueOnce(new Error("timeout"));
    const result = await initiateVerification(target);
    expect(result.verification?.status).toBe("failed");
    expect(result.budget?.usedUsd).toBe(2);
    await initiateVerification(target);
    expect(doubles.dial).toHaveBeenCalledTimes(1);
  });

  it("reserves the available budget and blocks another call until the cost is known", async () => {
    await initiateVerification(target);
    await expect(initiateVerification({ ...target, id: "place-two" })).rejects.toThrow("$2");
    expect(doubles.dial).toHaveBeenCalledTimes(1);
  });

  it("releases unused budget after a finished call and adjusts the next call's allowance", async () => {
    await initiateVerification(target);
    doubles.retrieve.mockResolvedValue({ call_status: "ended", duration_ms: 90_000, call_cost: { combined_cost: 50 } });
    const result = await refreshVerification(target.id);
    expect(result.budget?.usedUsd).toBe(0.5);
    await initiateVerification({ ...target, id: "place-two" });
    expect(doubles.dial.mock.calls[1][0].agent_override.agent.max_call_duration_ms).toBe(138_000);
  });

  it("never starts more than four attempts even if earlier calls cost nothing", async () => {
    doubles.retrieve.mockResolvedValue({ call_status: "not_connected", call_cost: { combined_cost: 0 } });
    for (let i = 0; i < 4; i++) {
      await initiateVerification({ ...target, id: `place-${i}` });
      await refreshVerification(`place-${i}`);
    }
    await expect(initiateVerification({ ...target, id: "place-five" })).rejects.toThrow("4-call");
    expect(doubles.dial).toHaveBeenCalledTimes(4);
  });

  it("issues a listener token only for the selected listing's existing call", async () => {
    await initiateVerification(target);
    doubles.listen.mockResolvedValue({ access_token: "scoped-listener-token", transport: "gateway", participant_id: "listener-a" });
    const request = (stationId: string) => new Request("http://localhost:3000/api/verification/listen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stationId }) });
    const response = await listen(request(target.id));
    expect(await response.json()).toMatchObject({ access_token: "scoped-listener-token" });
    expect(doubles.listen).toHaveBeenCalledWith("call-a");
    expect((await listen(request("another-place"))).status).toBe(409);
    expect(doubles.listen).toHaveBeenCalledTimes(1);
  });

  it("does not equate private / broken chargers with weak evidence", () => {
    expect(extractVerification(confirmed)).toMatchObject({ confidence: 10, operational: "not_working", publicAccess: "private" });
    expect(extractVerification({ operational: "working", public_access: "public" })).toMatchObject({ confidence: undefined, operational: "unknown", publicAccess: "unknown" });
  });

  it("waits for delayed analysis, retries only audio storage, and restores playback after reload", async () => {
    await initiateVerification(target);
    doubles.retrieve.mockResolvedValueOnce({ call_status: "ended", end_timestamp: 1_700_000_000_000, duration_ms: 45_000, recording_url: "https://retell.example/audio.wav", transcript: "A real conversation" });
    doubles.save.mockRejectedValueOnce(new Error("R2 unavailable"));
    expect((await refreshVerification(target.id)).verification).toMatchObject({ status: "processing", recordingError: expect.stringContaining("R2") });
    doubles.retrieve.mockResolvedValue({ call_status: "ended", end_timestamp: 1_700_000_000_000, duration_ms: 45_000, recording_url: "https://retell.example/audio.wav", transcript: "A real conversation", call_cost: { combined_cost: 31 }, call_analysis: { call_summary: "Station is private and down.", custom_analysis_data: confirmed } });
    expect((await refreshVerification(target.id)).verification).toMatchObject({ status: "completed", confidence: 10, costUsd: 0.31, durationSeconds: 45, audioUrl: "https://audio.example/recording.wav" });
    expect((await verificationState(target.id)).verification?.audioUrl).toBe("https://audio.example/recording.wav");
    await refreshVerification(target.id);
    expect(doubles.retrieve).toHaveBeenCalledTimes(2);
    expect(doubles.dial).toHaveBeenCalledTimes(1);
  });

  it("leaves failed/no-answer calls unverified", async () => {
    await initiateVerification(target);
    doubles.retrieve.mockResolvedValue({ call_status: "not_connected", disconnection_reason: "dial_no_answer", call_cost: { combined_cost: 0 } });
    const result = await refreshVerification(target.id);
    expect(result.verification).toMatchObject({ status: "failed", error: expect.stringContaining("dial_no_answer") });
    expect(result.verification?.confidence).toBeUndefined();
    expect(doubles.save).not.toHaveBeenCalled();
  });

  it("rejects cross-origin call initiation before reaching Retell", async () => {
    const response = await POST(new Request("http://localhost:3000/api/verification", { method: "POST", headers: { origin: "https://another-site.example", "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", station: target }) }));
    expect(response.status).toBe(403);
    expect(doubles.dial).not.toHaveBeenCalled();
  });
});

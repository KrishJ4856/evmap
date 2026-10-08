import { json } from "@/lib/api";
import { retellClient } from "@/server/verification-agent";
import { verificationCollection } from "@/server/verification";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Open this app to listen." }, 403);
  const body = await request.json().catch(() => null);
  if (typeof body?.stationId !== "string" || body.stationId.length > 250) return json({ error: "Choose a station." }, 400);
  try {
    const record = await (await verificationCollection()).findOne({ _id: body.stationId });
    if (!record?.callId || record.status !== "calling") return json({ error: "The call must be connected before you can listen." }, 409);
    // A short-lived, subscribe-only token for this call, never the Retell API key.
    return json(await retellClient().call.listenLive(record.callId));
  } catch {
    return json({ error: "Live listening is not ready. Wait for the call to connect, or open Retell Live Monitoring." }, 503);
  }
}

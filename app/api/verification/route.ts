import { z } from "zod";
import { json } from "@/lib/api";
import { initiateVerification, refreshVerification, verificationInput, verificationState, VerificationError } from "@/server/verification";

export const runtime = "nodejs";
const stationId = z.string().trim().min(1).max(250);

function failure(error: unknown) {
  return json({ error: error instanceof VerificationError ? error.message : "Verification could not be loaded. Check MongoDB, Retell, and R2 settings." }, error instanceof VerificationError ? error.status : 503);
}

export async function GET(request: Request) {
  const id = stationId.safeParse(new URL(request.url).searchParams.get("stationId"));
  if (!id.success) return json({ error: "Choose a station." }, 400);
  try { return json(await verificationState(id.data)); } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  // A browser on another origin must not be able to spend the experiment budget.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "Use the verification button in this app." }, 403);
  const body = await request.json().catch(() => null);
  try {
    if (body?.action === "start") {
      const target = verificationInput.safeParse(body.station);
      if (!target.success) return json({ error: "This listing needs a valid phone number and location." }, 400);
      return json(await initiateVerification(target.data));
    }
    if (body?.action === "refresh") {
      const id = stationId.safeParse(body.stationId);
      if (!id.success) return json({ error: "Choose a station." }, 400);
      return json(await refreshVerification(id.data));
    }
    return json({ error: "Unknown verification action." }, 400);
  } catch (error) { return failure(error); }
}

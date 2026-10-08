import { json } from "@/lib/api";
export const runtime = "nodejs";
export async function GET() {
  return json({
    ok: true,
    stationProvider: "Google Maps",
    configured: Boolean(process.env.GOOGLE_MAPS_SERVER_API_KEY),
    mapConfigured: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
  });
}

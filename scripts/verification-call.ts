import nextEnv from "@next/env";
import { parseArgs } from "node:util";
import { initiateVerification, refreshVerification, verificationInput, VerificationError } from "../server/verification";

nextEnv.loadEnvConfig(process.cwd());
const { values } = parseArgs({ options: {
  id: { type: "string" }, phone: { type: "string" }, name: { type: "string" },
  address: { type: "string", default: "" }, lat: { type: "string" }, lng: { type: "string" },
  refresh: { type: "boolean" }, dial: { type: "boolean" },
} });

try {
  if (values.refresh && values.id) {
    console.log(JSON.stringify(await refreshVerification(values.id), null, 2));
  } else {
    const target = verificationInput.safeParse({ id: values.id, name: values.name, address: values.address, phone: values.phone, lat: Number(values.lat), lng: Number(values.lng) });
    if (!target.success) throw new VerificationError("Supply --id, --name, --phone, --lat, and --lng. Use --refresh --id <place-id> to collect a result.");
    if (!values.dial) console.log("Dry run only. Add --dial to place ONE real outbound call using the same $2 / 4-attempt limits as the UI.");
    else console.log(JSON.stringify(await initiateVerification(target.data), null, 2));
  }
} catch (error) {
  console.error(error instanceof VerificationError ? error.message : "Verification failed. Check local credentials and provider dashboards.");
  process.exitCode = 1;
} finally {
  // Mongo's connection pool keeps CLI scripts alive; web routes reuse it normally.
  process.exit(process.exitCode || 0);
}

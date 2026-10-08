import nextEnv from "@next/env";
import { createVerificationAgent, retellClient, VERIFICATION_PROMPT } from "../server/verification-agent";

nextEnv.loadEnvConfig(process.cwd());
try {
  if (process.argv.includes("--voices")) {
    const voices = await retellClient().voice.list();
    console.table(voices.map(({ voice_id, voice_name, accent }) => ({ voice_id, voice_name, accent })));
  } else if (process.argv.includes("--create")) {
    const result = await createVerificationAgent();
    console.log(`Created the agent (no phone call placed).\nRETELL_AGENT_ID=${result.agentId}\nRetell LLM: ${result.llmId}\nAdd RETELL_AGENT_ID to .env.local. Test Audio is available in Retell's dashboard.`);
  } else {
    console.log(VERIFICATION_PROMPT);
    console.log("\n--voices lists available voices. --create creates a Retell agent. Neither command places a phone call.");
  }
} catch {
  console.error("Agent setup failed. Check RETELL_API_KEY / RETELL_VOICE_ID and the Retell dashboard.");
  process.exitCode = 1;
}

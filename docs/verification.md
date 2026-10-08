# Manual verification experiment

This is a single-user local experiment. Searching never makes calls. Click **Initiate verification** on a charger card to make one call. The result is kept by Google Place ID in MongoDB Atlas; the audio goes to Cloudflare R2 and plays on the card and in station details. There are no jobs, automatic retries, or scheduled reverification.

## Set up once

1. Create a Retell account and get a private API key. Put `RETELL_API_KEY` in `.env.local` (or the existing `.env`). Never prefix it with `NEXT_PUBLIC_`.
2. Get an outbound number in Retell that can call India. An existing imported number also works. Set `RETELL_FROM_NUMBER` in international format. Confirm India calling is enabled in the workspace/carrier settings.
3. Review the agent in [server/verification-agent.ts](../server/verification-agent.ts). Run `npm run verification:agent -- --voices` to list voices. Optionally change `RETELL_VOICE_ID` to a Hindi/English-capable voice before creating the agent.
4. Run `npm run verification:agent -- --create`. Copy its `RETELL_AGENT_ID` output into the same env file. This creates the LLM and agent, and places no call. To change the deployed prompt/settings later, rerun `--create` and use the new ID. The agent's **Test Audio** panel in the Retell dashboard lets you talk to it independently of this app (voice testing is billable).
5. Create an Atlas free cluster, database user, and network access entry for this machine's IP. Set `MONGODB_URI` and optionally `MONGODB_DATABASE=evmap`.
6. Create an R2 bucket and S3 API credentials with Object Read & Write access for that bucket. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`. Keep the bucket private; the app generates one-hour playback URLs. No custom domain or public bucket is needed.
7. Restart `npm run dev`. Search for a charger with a phone number, then click its verification button.

See [.env.example](../.env.example) for the complete variable list. No provider credentials are currently included in the repo.

## Cost boundaries

There is **no fixed one-minute cutoff**. Each call reserves the remaining **$2 total** balance. Its duration allowance is calculated using a conservative **$0.65/minute combined voice/carrier estimate**: a fresh budget permits about 3 minutes, rather than forcing the conversation to stop after one. Only after Retell ends the call and reports its cost does the app release the unused reservation for the next call. An unknown/ambiguous call keeps the full reservation. There can be at most **four attempts**. Because Retell requires a maximum duration setting of at least 60 seconds, at least $0.65 must remain to start another call. Reported costs are converted from cents to dollars. Starting a call is never automatically retried.

These are local experiment controls, not a provider billing guarantee. Retell/carrier pricing, analysis, account charges, and number rental are outside the app's authority. Retell lists managed numbers at $2/month; phone-number subscriptions are charged separately from trial credits, and require a payment method. New accounts currently receive $10 in trial credits for metered usage. Test the voice agent in the dashboard using trial credits first. Actual outbound phone calls need an existing/imported number or a number purchase within your cash budget. If you choose a paid number for the test, release it afterwards to stop recurring rental, and keep auto-recharge off. Retell currently lists India carrier rates of $0.15/minute (Twilio) or $0.25/minute (Telnyx), in addition to voice-agent usage. No numbers are purchased by these scripts.

## Listen and collect results

- After the call connects, **Listen live** joins as a silent audio-only listener. Your microphone is not used. The browser receives a token scoped to this call, not the Retell API key. The current Retell Web SDK handles both supported media transports.
- For the live transcript, IVR/tool actions, or a fallback audio view, open the linked Retell dashboard and choose **Live Monitoring**.
- While the card is open, it checks the result every five seconds through the call's budget allowance plus two minutes for processing. Once Retell supplies the recording, the app uploads it to R2 and saves the result in MongoDB. Analysis and recording can arrive at different times.
- Closing the page does not end the agent's call, but pauses result collection. Return to the same listing or use the CLI refresh command to collect it. There is intentionally no background worker/webhook.
- **Check call result** refreshes analysis and retries an unsuccessful R2 upload. It never dials again. Reopening the listing refreshes playback URLs when needed.
- A completed attempt is reused forever. A failed attempt is also retained; there is no retry button. For a lost/ambiguous call ID, look up the call in Retell history using its `evmap_station_id` metadata, and set `callId` / `status: "calling"` on its Mongo record before refreshing. Do not delete the reservation and redial blindly.

## Separate agent and CLI

Print/review the prompt without making provider requests:

```sh
npm run verification:agent
```

The same calling flow can be tested without the browser. This is a dry run unless `--dial` is explicitly supplied. Replace the example with the exact station and target you intend to test:

```sh
npm run verification:call -- --id PLACE_ID --name 'Station name' --address 'Station address' --phone '+91XXXXXXXXXX' --lat 22.55 --lng 88.36
```

To actually dial, add `--dial`. To collect an already initiated call without dialing again:

```sh
npm run verification:call -- --refresh --id PLACE_ID
```

## Result and confidence

MongoDB stores the Place ID, call ID, date, status, duration, cost, summary, extracted answers, transcript, confidence, and R2 object key. It does not persist the original Google listing snapshot or coordinates/phone; the selected listing context is supplied to Retell for this one call. Independently spoken information remains in the transcript and analysis.

Retell extracts identity, respondent knowledge, working status, public access, charging process, and consistency. Application code calculates a 0–10 evidence-completeness score: identity 2, knowledgeable respondent 2, operational answer 2, access answer 1, charging process 1, consistency 2. Without confirmed station identity the score remains unassigned. A private or broken charger can have strong evidence. No answer is not evidence of a broken charger. This experimental score is not a probability or live socket availability.

This setup has no accounts or production access controls. Use it locally. Signed audio links can be played by anyone who receives them until they expire. The call introduction identifies the AI and discloses recording; it does not pretend to be a nearby driver. A small test does not establish an exemption from provider terms or applicable calling/recording requirements.

Tests mock Retell, Atlas, R2, and Google. Running tests makes no real calls and uses no provider credit.

Official references: [Retell India calling](https://docs.retellai.com/deploy/international-call), [live monitoring](https://docs.retellai.com/features/live-monitoring), [pricing](https://www.retellai.com/pricing), [Cloudflare R2 SDK](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

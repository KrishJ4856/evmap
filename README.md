# EV chargers

A deliberately small Next.js + TypeScript app: starting point, optional destination, Google map, charger results. Tailwind and shadcn-style Radix components. Node route handlers keep the server API key private. Search works without a database; optional manual phone verification uses Retell, MongoDB Atlas, and Cloudflare R2.

## Manual charger verification

Each charger has an **Initiate verification** button. Once configured, it starts one Hindi/English call, supports IVR keypad navigation and live listening, then saves the transcript, evidence score, date, and audio for playback on that listing. There is no fixed one-minute cutoff: call allowance is calculated from the remaining $2 experiment budget, with up to four attempts and no automatic retries or reverification.

See [verification setup and independent agent testing](docs/verification.md). The agent is defined in [server/verification-agent.ts](server/verification-agent.ts). Credentials are optional for map search and required only for calling. Tests use provider doubles and never make real calls.

## Google Maps setup

The app requires Google credentials and does not substitute another provider or fake station records if Google is unavailable. Google offers a no-cost prototype key for evaluation; production keys require billing.

### No-cost local experiment

Google's [Maps Demo Key](https://developers.google.com/maps/documentation/javascript/demo-key) supports map rendering, Places API (New), and Compute Routes without a billing account. This is an actual Google credential using real Google data, **not fabricated station/demo fixtures**. Photos and reviews are unavailable on this key; photo support defaults to off and the app never requests reviews. Google's daily quotas stop requests rather than incur charges. Google may change or withdraw these quotas; this key is strictly for testing, not production.

1. Open [Google's free key setup](https://console.cloud.google.com/google/maps-hosted/tos?ref=https%3A%2F%2Fdevelopers.google.com%2Fmaps%2F) and accept the [Maps Demo Project Terms](https://cloud.google.com/terms/maps-platform/demo-project-terms) to generate the key.
2. Put the prototype key in both `GOOGLE_MAPS_SERVER_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `.env.local`. The shared prototype key is visible in browser requests by design; it is not a private production server key. Never use this shared-key approach with a paid production credential.
3. Restart `npm run dev`, or rebuild for production-style local testing, to pick up the browser key.

Current local setup is a **zero-spend experiment**: keep the free prototype key, leave billing disabled, and keep `GOOGLE_MAPS_PHOTOS_ENABLED=false`. Do not switch to a billing-enabled key for photos. The gallery implementation remains available for future use, but live Google listing photos are disabled. No billing commitment was made. A prototype key has a daily usage allowance; once exhausted, the app cannot restore that allowance. Google must reset it before live requests can succeed again.

### Production / paid-project setup

1. Complete billing setup for the project. Do not enable a paid subscription unnecessarily; choose usage-based billing if appropriate for your experiment.
2. Enable **Maps JavaScript API**, **Places API (New)**, and **Routes API**.
3. Create **two separate, restricted keys** in the same project:
   - Browser key: only Maps JavaScript API, with HTTP referrers `http://localhost:3000/*` and `http://127.0.0.1:3000/*`. Add the actual production domain when deployed.
   - Server key: only Places API (New) and Routes API; restrict to the server's public egress IP where available. A website-referrer-restricted key will not work for server REST calls.
4. Copy [.env.example](.env.example) to `.env.local` and supply both keys. Keep `.env.local` out of Git. The server key is never exposed through health/config endpoints.
5. Set API quotas and billing alerts in Google Cloud. Alerts are not hard spending caps. EV connector metadata uses higher-tier Places fields; even autocomplete sessions and paginated route searches can incur charges. Do not deploy unrestricted public endpoints with this prototype's process-local limiter.
6. Restart the dev server. Public keys are embedded at build time: rebuild after changing the browser key for production.
7. Optionally set `GOOGLE_MAPS_PHOTOS_ENABLED=true` with a photo-capable Places key. Photo metadata joins the existing station search; the first image loads only when details are opened, and further images load only when requested. The server redirects to signed Google image URLs without exposing its key. Photo names and URLs use `no-store`, author credits are displayed, and missing/expired images disappear without disrupting details. Photo requests also use the shared limiter and quota cooldowns. Leave this option off with the free demo key.

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000).

## Search and data

- **Places Autocomplete (New)** handles addresses, businesses, and landmarks. It is not restricted to cities or biased towards the starting point. Each field uses its own session token and resolves the selected Google place ID to exact coordinates. Predictions are debounced and obsolete requests are cancelled.
- Press Enter or use **Search Google Maps for …** for explicit Text Search when suggestions aren't the desired match. Explicit search results are still selected by the user—never silently choose the first result.
- Device GPS supplies the starting point with permission; denied permission leaves the starting field empty, rather than inventing a city.
- Paste `latitude, longitude` or a full Google Maps place URL with exact `!3d…!4d…` pin coordinates. Short share URLs and URLs containing only an `@lat,lng` camera position cannot determine an exact pin. Alternatively, use the pin button next to either field and click the map. A newly added/private Google Maps address is not guaranteed to appear in the public Places API.
- **Routes API** supplies the driving route with one request. Search Along Route uses that **full trip polyline**, with up to three sequential Places pages and deduplication by place ID. Each page includes Google's two-leg routing summaries. A trip search therefore costs **2–4 Google requests**, regardless of its charger count or length: no section fan-out, endpoint searches, or per-charger route calculations. Nearby-only search costs one request and returns at most 20 results. Trips over 3,000 km are rejected to bound experiment costs.
- Route discovery checks **every segment of the full driving polyline**, using spherical point-to-segment distance and a 20-km candidate corridor with endpoint caps. Actual detour estimates use Google driving distances: origin → charger → destination, minus the original trip distance, clamped to zero. Chargers with missing driving summaries appear in a separate, explicitly unfiltered group for nonzero detour limits. They are excluded from the count of verified matches and from the strict zero-detour view; missing estimates never trigger additional paid requests.
- The **0–20 km maximum detour** slider filters the verified results and map immediately without another search. Zero keeps on-route chargers only, allowing 50 metres for pin/entrance and polyline precision in both proximity and driving detour. Detours are estimates relative to the original trip, not cumulative costs after adding other stops. Charger cards stay ordered by progress from the source along that original route; nearby badges use straight-line distance.
- **Add stop** works on charger cards and in station details. Selected stops sit between the starting point and destination in the sidebar itinerary. The existing Routes request also returns each segment’s driving distance and duration; no separate per-leg calls are made. Missing segment data is labelled unavailable rather than inferred from the trip total. Up to nine charging stops are deduplicated and sorted in travel order, then Google recalculates the route, distance, and driving time with one request. Removing the last stop reuses the original route. Route updates commit only on success; failure preserves the previous trip. Tightening the filter retains selected stops and their numbered map markers. Editing endpoints or successfully refreshing clears the trip; failed refreshes preserve previous chargers and stops.
- **Open in Google Maps** includes exact source/destination coordinates, real place IDs when present, and selected stops in travel order. Mobile layouts split trips with more than three intermediate stops into continuous navigation legs to respect Google's Maps URL limits; desktop exports up to nine stops in one link. Google Maps may choose a different route when opened. Micro animations respect reduced-motion preferences.
- Google search is ranked and limited to 60 route results, **not an exhaustive charging-station inventory**. Even below explicit caps, stations may be omitted. The existing footnote explains this without large technical banners. Failed later pages retain successful pages with a short status; failed first-page discovery is labelled unavailable, never presented as a successful zero-charger search.
- All server Google calls share a process-wide limiter: **two concurrent requests**, starts at least 150 ms apart, a bounded queue, a 25-second timeout, and cancellation through to Google. Identical in-flight requests share work; completed Places content is not cached. HTTP 429 opens a per-service cooldown, honours `Retry-After`, and stops pagination. Daily-quota errors use a longer cooldown. The UI disables search during the reported wait and never retries automatically. Production with multiple workers needs a shared limiter and cooldown store; this prototype's protections are process-local.
- Connector types, count, kW, phone, hours, address, coordinates and Google Maps link are shown when Google provides them. `businessStatus=OPERATIONAL` is a business listing status, **not proof that a charger works**. Connector availability counts are labelled as reported and show the provider's update timestamp. Missing fields are not invented. Confirm availability with the operator.
- List cards omit charger metadata; details show compact availability pills and Low/Medium/High listing confidence for zero/one/two of charger details and phone information present. An unspecified empty connector and whitespace-only phone do not count. Confidence describes listing completeness, not live availability or whether a charger works. A dynamic note below the pills reflects Google’s reported business status, including temporarily/permanently closed and unknown. This remains a location listing status, not a charger health check. Opening hours are expandable in a bordered control. Coordinates sit beside the distance, and the footer aligns the station website with the Google Maps credit. The whole sidebar scrolls, including the itinerary and charger results. Once a trip is loaded, Open in Google Maps replaces the refresh button; the maximum-detour slider filters locally without additional requests, and its explanation is available from the info button on hover, keyboard focus or tap. Photo-enabled listings use a 200–240 px gallery below the heading, with on-demand arrows and a photo counter for multiple images.
- All geographical providers are Google. The old Photon, OSRM, OpenStreetMap/Overpass, Open Charge Map, Leaflet, and fake station/demo data have been removed. Google's `DEMO_MAP_ID` is a developer map-style ID, not demo charging data.

Google Maps SDK attribution is left intact. Results also show Google Maps and any returned third-party attribution. [Privacy](/privacy) and [Terms](/terms) are linked from the app. Google responses use `no-store`; verification persists the Place ID and our call results rather than a copy of the Google listing.

## Checks

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Unit tests use mocked Google responses and cover sessions, field masks, status semantics, full-trip pagination, request budgets, concurrency, deduplication, cancellation, cooldowns, route geometry, exact pin parsing and secret-safe errors. Browser tests mock **both app endpoints and the Maps SDK** on desktop and mobile, so automated checks consume no Google quota. They cannot prove Google's live catalogue contains a particular address. Live verification requires a working Google key with available quota.

Official references: [Autocomplete (New)](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete), [Search Along Route](https://developers.google.com/maps/documentation/places/web-service/search-along-route), [Places fields](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places), [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), [API security](https://developers.google.com/maps/api-security-best-practices).

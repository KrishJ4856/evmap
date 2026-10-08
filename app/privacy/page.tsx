import Link from "next/link";
export default function Privacy() {
  return (
    <main className="legal-page">
      <Link href="/">← EV chargers</Link>
      <h1>Privacy</h1>
      <p>
        This local experiment uses your device location only with browser
        permission. You can instead enter a starting point manually. Location
        searches, selected locations, and route requests are sent to this app's
        server and Google Maps Platform to provide suggestions, directions, and
        charging stations.
      </p>
      <p>
        The app does not create accounts or save trip history. Google search
        results and search session tokens are kept
        temporarily in your browser while the page is open. The hosting provider
        and Google may keep their own request logs.
      </p>
      <p>
        Starting manual charger verification sends the selected listing context
        and phone number to Retell AI to make a recorded call. The Google Place
        ID and call result, date, transcript, and analysis are saved in MongoDB.
        Call audio is saved in Cloudflare R2 and can be played on this site. The
        app does not automatically call stations from search results.
      </p>
      <p>
        Google Maps use is subject to{" "}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noreferrer"
        >
          Google's Privacy Policy
        </a>
        . Closing the page clears the app's in-memory trip state.
      </p>
    </main>
  );
}

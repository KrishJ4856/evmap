import Link from "next/link";
export default function Terms() {
  return (
    <main className="legal-page">
      <Link href="/">← EV chargers</Link>
      <h1>Terms</h1>
      <p>
        This is an experimental charger finder, not a charging operator, booking
        service, or guarantee of coverage. Google Maps listings may be
        incomplete or outdated. Connector details, hours, contact information,
        and reported availability are shown only when provided.
      </p>
      <p>
        Business listing status does not prove that a charger is working.
        Confirm charger compatibility and availability with the station before
        travelling. Route detours estimate the extra driving distance to visit a
        charger compared with the original trip. Nearby distances are
        straight-line estimates. Google Maps may choose a different route when
        you open navigation.
      </p>
      <p>
        Use of Google Maps is subject to the{" "}
        <a
          href="https://maps.google.com/help/terms_maps/"
          target="_blank"
          rel="noreferrer"
        >
          Google Maps Additional Terms of Service
        </a>{" "}
        and{" "}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noreferrer"
        >
          Google Privacy Policy
        </a>
        .
      </p>
    </main>
  );
}

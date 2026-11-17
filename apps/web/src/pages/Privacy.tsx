export function Privacy() {
  return (
    <article className="prose" aria-labelledby="privacy-h">
      <h1 id="privacy-h" className="page-title">
        Privacy
      </h1>
      <p>SWU TCC is a small fan-made tool. It collects as little as it can. Here is exactly what happens to your data.</p>

      <h2>What we do not do</h2>
      <ul>
        <li>No accounts or sign-in.</li>
        <li>No cookies.</li>
        <li>No analytics, advertising or tracking scripts.</li>
      </ul>

      <h2>Stored on your device</h2>
      <p>
        The site saves two things in your browser&apos;s local storage, and nothing else: your light or dark theme choice, and the player you
        last picked for each tournament, so you land back on your page. These never leave your device. Clearing your site data for this
        site removes them.
      </p>

      <h2>Tournament data</h2>
      <p>
        Standings and pairings come from Melee.gg&apos;s public tournament pages. Your browser asks our server, which fetches them from
        Melee.gg and keeps a copy at Cloudflare so many players at one event share it: up to 24 hours for finished rounds, 30 seconds for a
        round in progress and 60 seconds for tournament info. We do not add anything to that data and do not keep it anywhere else.
      </p>

      <h2>Hosting and logs</h2>
      <p>
        The site runs on Cloudflare. For requests that reach our server code, Cloudflare records request metadata, including your IP
        address, and keeps it for 3 days (7 days from 1 December 2026). We cannot turn that off. The log line our own code writes holds only
        the kind of request, the result, whether it was cached and how long it took: no IP address and no headers. The page also loads its
        fonts from Google Fonts, so your browser contacts Google to fetch them.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or concerns: open an issue on the{' '}
        <a href="https://github.com/wavemoran/swu-tcc/issues" rel="noreferrer">
          project&apos;s GitHub page
        </a>
        .
      </p>
    </article>
  );
}

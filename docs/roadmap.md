# Roadmap

## In scope now

- **Single-day events** (up to 128 players): Swiss rounds, then a top cut of
  4, 8, 16 or 32 (Comprehensive Event Guide v1.5, Appendix D).
- Final-round intentional draw (ID) analysis from Melee.gg data, with
  pairings read from Melee or predicted from standings (CEG 10.4).
- Two rounds remaining: Monte Carlo over random Swiss pairings.

## Next

- **API access from Melee.gg.** We have asked Melee for an API key; the
  official API is the intended long-term data source
  (`docs/melee-api-switchover.md`).
- **Manual / paste entry.** Enter or paste standings and pairings when Melee
  data is unavailable or the event is not on Melee.
- PNG app icons (180, 192, 512) for the PWA manifest.
- ~~Privacy statement~~ Done: the `/privacy` page (linked from the footer) covers local storage, caching, Cloudflare log retention and self-hosted fonts (no third-party requests). Keep it in sync with the code when any of that changes.
- Deploy to Cloudflare Workers (free plan; see `docs/free-tier.md`).

## Out of scope for now

- **Day 2 events** (over 128 players). These usually qualify players for
  Day 2 by match points (for example, 6 match wins) rather than a top-N cut,
  which is a different question: "how many points do I need" instead of
  "where will I rank". The engine flags these events as not modeled and the
  site shows a notice. A future points-threshold mode could cover them.
- Events of 8 or fewer players (the CEG gives them no top cut; we assume a top 4).

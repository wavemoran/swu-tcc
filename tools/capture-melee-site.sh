#!/usr/bin/env bash
# Saves a finished Melee.gg tournament's public pages as test fixtures in
# fixtures/melee/<id>/raw/ (same layout as fixtures/README.md).
#
#   tools/capture-melee-site.sh [--page-only] <tournament-id>...
#
# Be a good guest: one request at a time, DELAY seconds apart (default 10;
# robots.txt asks for at least 5), curl's default User-Agent, no retries. Stops
# at the first refusal (403/429/5xx). Files already saved are skipped, so a
# stopped run can be resumed. Only for building test fixtures, never for
# serving the site.
#
# REQUIRED after capturing: the saved JSON holds real player names, ids and
# pronouns. Run
#   node --experimental-strip-types tools/pseudonymize-fixtures.ts
# before committing (see fixtures/README.md). Never commit raw captures.
set -euo pipefail

DELAY="${DELAY:-10}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAGE_ONLY=0
first=1

polite() { if [ "$first" = 1 ]; then first=0; else sleep "$DELAY"; fi; }

# fetch <out-file> <curl args...>: skip if saved; fail on non-200 or wrong type.
fetch() {
  local out="$1"; shift
  if [ -s "$out" ]; then echo "  skip  $(basename "$out")"; return; fi
  polite
  local code
  code="$(curl -sS -o "$out.part" -w '%{http_code}' --max-time 60 "$@")"
  if [ "$code" != 200 ]; then
    rm -f "$out.part"
    echo "  STOP  HTTP $code for $(basename "$out"); not retrying." >&2
    exit 1
  fi
  case "$out" in
    *.json)
      if ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$out.part" 2>/dev/null; then
        rm -f "$out.part"; echo "  STOP  $(basename "$out") is not JSON." >&2; exit 1
      fi ;;
  esac
  mv "$out.part" "$out"
  echo "  saved $(basename "$out") ($(wc -c < "$out" | tr -d ' ') bytes)"
}

for arg in "$@"; do
  if [ "$arg" = --page-only ]; then PAGE_ONLY=1; continue; fi
  [[ "$arg" =~ ^[0-9]{1,10}$ ]] || { echo "Not a tournament id: $arg" >&2; exit 2; }
  id="$arg"
  dir="$ROOT/fixtures/melee/$id/raw"
  mkdir -p "$dir"
  echo "Tournament $id"
  fetch "$dir/tournament.html" "https://melee.gg/Tournament/View/$id"
  [ "$PAGE_ONLY" = 1 ] && continue
  fetch "$dir/standings-config.json" "https://melee.gg/Standing/GetStandingsConfig/$id"
  # Round ids from the standings round selector, in page order, de-duplicated.
  rounds="$(grep -o 'round-selector" data-id="[0-9]*"' "$dir/tournament.html" | grep -o '[0-9]*' | awk '!seen[$0]++')"
  [ -n "$rounds" ] || { echo "  no rounds found on the page" >&2; continue; }
  for r in $rounds; do
    fetch "$dir/standings-$r.json" -X POST https://melee.gg/Standing/GetRoundStandings \
      --data "draw=1&start=0&length=-1&roundId=$r"
    fetch "$dir/matches-$r.json" -X POST "https://melee.gg/Match/GetRoundMatches/$r" \
      --data "draw=1&start=0&length=-1"
  done
done
echo "Done."

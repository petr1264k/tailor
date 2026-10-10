#!/usr/bin/env bash
# HTML-only offline copy of every demo page that has a url in demo/pages.json (CONTEXT.txt §7: copies by 16:00).
# The ⌘S "Webpage, Complete" copy (demo/README.md) is the one to demo from; this is the fast fallback and is enough
# for the eval harness, which reads only text and links. Existing files are kept unless you pass -f.
# GET only. Never sends anything to a site's agent endpoints.
set -euo pipefail
cd "$(dirname "$0")/.."

FORCE=0
[[ "${1:-}" == "-f" ]] && FORCE=1
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

node -e 'for (const p of JSON.parse(require("fs").readFileSync("demo/pages.json", "utf8"))) if (p.url && p.file) console.log(p.url + "\t" + p.file)' |
  while IFS=$'\t' read -r url file; do
    if [[ -s "$file" && $FORCE -eq 0 ]]; then
      echo "keep  $file (exists; -f to overwrite)"
      continue
    fi
    mkdir -p "$(dirname "$file")"
    if curl -fsSL --compressed --max-time 30 -A "$UA" \
      -H 'Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' -H 'Accept-Language: en-US,en;q=0.9' \
      -o "$file.tmp" "$url"; then
      mv "$file.tmp" "$file"
      echo "saved $file ($(wc -c <"$file" | tr -d ' ') bytes) <- $url"
    else
      rm -f "$file.tmp"
      echo "FAIL  $url (blocked or offline: save it with ⌘S, see demo/README.md)" >&2
    fi
  done

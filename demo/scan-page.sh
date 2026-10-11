#!/usr/bin/env bash
# Rendered offline copy of one page: the DOM after a full scroll, saved from Chrome via agent-browser
# (npm i -g agent-browser && agent-browser install). demo/save-offline.sh (curl) gets only the server HTML; this gets lazy
# sections, carousels and prices, which is what src/sites profiles and the eval harness need. GET only; never touches a
# site's agent endpoints. Used Oct 10 2026 for demo/pages/5-anker.html, 6-yeti.html and 7-patagonia.html.
#
#   demo/scan-page.sh <url> <file> [--headed]
#   demo/scan-page.sh https://www.yeti.com/ demo/pages/6-yeti.html --headed
#
# --headed opens a visible Chrome window with automation flags off: yeti.com (PerimeterX) and patagonia.com (Akamai)
# serve a bot wall or a "Sit tight" page to headless Chrome and to curl; both pass headed. anker.com is fine headless.
#
# Two fixture fixes, code only, so the copy behaves like the live page under jsdom (no CSS there):
# - every element Chrome does not render (computed display:none: inactive tab panes, closed modals, mobile-only
#   blocks) gets a `hidden` attribute (+ data-tailor-scan-hidden); src/tailor/segments.ts isVisible honours it;
# - <base href="<origin>/"> is injected so the copy renders with the site's own CSS and images when online.
# Also written next to the copy (gitignored): <file>.png (full page) and <file>.map.json (top-level regions with
# headings, sizes, repeated-card shapes and prices), the raw material for a src/sites profile.
set -uo pipefail
URL=${1:?url}; FILE=${2:?file}; MODE=${3:-}
SESSION="scan-$$"
AB="agent-browser --session $SESSION"
[[ "$MODE" == "--headed" ]] && AB="$AB --headed --args --disable-blink-features=AutomationControlled"
mkdir -p "$(dirname "$FILE")"
trap '$AB close >/dev/null 2>&1 || true' EXIT

$AB open "$URL" >/dev/null 2>&1 || { echo "FAIL  could not open $URL" >&2; exit 1; }
$AB set viewport 1440 900 >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1 || true
$AB wait 1500 >/dev/null 2>&1

# Cookie banners and sign-up modals: click the plain dismiss buttons (never a country switch).
dismiss() {
cat <<'EOF' | $AB eval --stdin 2>/dev/null
(() => {
  const words = /^(accept( all)?( cookies)?|allow all|i agree|agree|got it|ok|okay|close|no,? thanks|continue|accept & close|accept and close|dismiss)$/i;
  const clicked = [];
  for (const b of document.querySelectorAll('button, [role="button"], a')) {
    const t = (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    const r = b.getBoundingClientRect();
    if (words.test(t) && r.width > 0 && r.height > 0) { try { b.click(); clicked.push(t); } catch {} }
  }
  return clicked.join(' | ');
})()
EOF
}
echo "dismissed: $(dismiss)"

# Scroll end to end in steps so IntersectionObserver-driven sections render, then back to the top.
for _ in $(seq 1 80); do
  $AB scroll down 800 >/dev/null 2>&1
  $AB wait 350 >/dev/null 2>&1
  at=$($AB eval "window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4" 2>/dev/null | tr -d '"[:space:]')
  [[ "$at" == "true" ]] && break
done
$AB wait --load networkidle >/dev/null 2>&1 || true
$AB wait 1500 >/dev/null 2>&1
echo "dismissed: $(dismiss)"
$AB eval "window.scrollTo(0,0)" >/dev/null 2>&1
$AB wait 800 >/dev/null 2>&1
$AB screenshot --full "${FILE%.html}.png" >/dev/null 2>&1 && echo "saved ${FILE%.html}.png"

# Structural map for writing a site profile: top-level children of the content root.
cat <<'EOF' | $AB eval --stdin 2>/dev/null | tr -d '"[:space:]' | base64 -d > "${FILE%.html}.map.json" 2>/dev/null && echo "saved ${FILE%.html}.map.json"
(() => {
  const skip = /^(script|style|svg|template|noscript|link)$/i;
  const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const key = (el) => el.tagName.toLowerCase() + '.' + ((el.getAttribute('class') || '').trim().split(/\s+/)[0] || '');
  const repeated = (root) => {
    const q = [root]; let steps = 0;
    while (q.length && steps++ < 500) {
      const e = q.shift();
      const ch = Array.from(e.children).filter((c) => !skip.test(c.tagName));
      if (ch.length >= 3) {
        const k = key(ch[0]); const alike = ch.filter((c) => key(c) === k);
        if (alike.length >= 3 && alike.length >= ch.length * 0.6 && alike.filter((c) => c.querySelector('a[href]') && txt(c).length >= 8).length >= 3) {
          return { parent: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ' .' + (e.getAttribute('class') || '').slice(0, 100), card: k, n: alike.length,
            sample: alike.slice(0, 3).map((c) => ({ cls: (c.getAttribute('class') || '').slice(0, 120), text: txt(c).slice(0, 200), href: c.querySelector('a[href]')?.getAttribute('href') || '' })) };
        }
      }
      q.push(...ch);
    }
    return null;
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const attrs = {};
    for (const a of el.attributes) if (/^(data-|id$|class$|role$|aria-label$)/.test(a.name)) attrs[a.name] = a.value.slice(0, 160);
    const text = txt(el);
    return { tag: el.tagName.toLowerCase(), attrs, top: Math.round(r.top + scrollY), height: Math.round(r.height),
      headings: Array.from(el.querySelectorAll('h1,h2,h3,h4,h5')).map((x) => x.tagName.toLowerCase() + ' ' + txt(x).slice(0, 80)).filter((s) => s.length > 3).slice(0, 12),
      textLen: text.length, textStart: text.slice(0, 240), links: el.querySelectorAll('a[href]').length, imgs: el.querySelectorAll('img, picture, video').length,
      repeated: repeated(el), prices: (text.match(/\$\s?\d[\d,]*(?:\.\d{2})?/g) || []).slice(0, 10) };
  };
  const out = { url: location.href, title: document.title, scrollHeight: document.documentElement.scrollHeight, roots: {} };
  for (const sel of ['main', '[role="main"]', '#MainContent', '#main', '#maincontent', '.main-content', 'body']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    out.roots[sel] = { tag: el.tagName.toLowerCase(), id: el.id, cls: (el.getAttribute('class') || '').slice(0, 160), children: Array.from(el.children).filter((c) => !skip.test(c.tagName)).map(describe) };
  }
  out.navWords = Array.from(document.querySelectorAll('header a, nav a')).map((a) => txt(a)).filter((t) => t && t.length < 40).slice(0, 150);
  out.jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent.slice(0, 600));
  return btoa(unescape(encodeURIComponent(JSON.stringify(out))));
})()
EOF

# Fixture fix 1: mark what Chrome does not render; drop lingering modal backdrops.
cat <<'EOF' | $AB eval --stdin 2>/dev/null | tr -d '"[:space:]' | { read -r n; echo "hidden-marked: ${n:-0}"; }
(() => {
  let n = 0;
  for (const el of document.body.querySelectorAll('*')) {
    if (/^(script|style|template|noscript|link|meta)$/i.test(el.tagName)) continue;
    if (getComputedStyle(el).display === 'none' && !el.hasAttribute('hidden')) { el.setAttribute('hidden', ''); el.setAttribute('data-tailor-scan-hidden', ''); n++; }
  }
  for (const b of document.querySelectorAll('.modal-backdrop')) b.remove();
  return n;
})()
EOF

# Fixture fix 2 + the dump itself, in base64 chunks (robust to the CLI's quoting of long strings).
$AB eval "window.__tailorDump = '<!DOCTYPE html>\n<!-- tailor demo copy of ' + location.href + ' saved ' + new Date().toISOString() + ' by demo/scan-page.sh (rendered DOM after a full scroll; display:none elements carry hidden) -->\n' + document.documentElement.outerHTML.replace(/<head([^>]*)>/i, (m) => m + '<base href=\"' + location.origin + '/\">'); window.__tailorDump.length" 2>/dev/null | tr -d '"[:space:]' > "$FILE.len"
LEN=$(cat "$FILE.len"); LEN=${LEN:-0}; rm -f "$FILE.len"
: > "$FILE.tmp"
CH=600000; a=0
while [[ $a -lt $LEN ]]; do
  b=$((a + CH))
  $AB eval "btoa(unescape(encodeURIComponent(window.__tailorDump.slice($a, $b))))" 2>/dev/null | tr -d '"[:space:]' | base64 -d >> "$FILE.tmp"
  a=$b
done
if [[ $LEN -gt 20000 && -s "$FILE.tmp" ]]; then
  mv "$FILE.tmp" "$FILE"
  echo "saved $FILE ($(wc -c <"$FILE" | tr -d ' ') bytes) <- $URL  title: $($AB get title 2>/dev/null)"
else
  rm -f "$FILE.tmp"
  echo "FAIL  $URL gave only $LEN chars (bot wall? try --headed; check the title: $($AB get title 2>/dev/null))" >&2
  exit 1
fi

# Demo pages (CONTEXT.txt §7, §9)

Pick by 16:00. Every page gets an offline copy in `demo/pages/` (gitignored) so the demo never depends on Wi-Fi.
`demo/pages.json` is the list the eval harness reads (`id`, `url`, `file`). Stage script: [`script.md`](script.md).

| # | Page | Who | What the tailored version shows |
|---|------|-----|---------------------------------|
| 1 | long product page (TV or laptop) | both | PS5 compatibility first, budget checked, marketing collapsed |
| 2 | dense docs page | both | examples reordered for your stack and level |
| 3 | recipe page | both | diet, allergens, cooking time |
| 4 | https://www.coframe.com | Mikhail (CTO) vs Petr (frontend) | the finale, then the share with consent |
| 5 | https://www.anker.com (storefront) | both | the page rebuilds itself: the shelf that fits moves up, matching cards jump to the front with "For you" tags, membership and promos fold; the scorecard chip gives the numbers (src/sites/anker.ts is the site profile) |

## Save a copy with ⌘S (the one we demo from)

1. Open the page in the clean demo Chrome profile. Dismiss cookie banners, close pop-ups, scroll to the bottom once so lazy content loads, scroll back up.
2. Press **⌘S** (File › Save Page As…).
3. **Format:** "Webpage, Complete".
4. **Save As:** the exact file name from `demo/pages.json` (e.g. `1-product.html`). **Where:** `tailor/demo/pages/`.
5. Click **Save**. Chrome writes the `.html` plus a `<name>_files/` folder next to it; keep both.
6. Put the live URL in that page's `url` in `demo/pages.json` (links and the cache key use it).
7. Check: open the copy as `file://…/demo/pages/1-product.html` with "Allow access to file URLs" on the extension card, click Tailor; then `npm run eval -- gate` must not list the page under "no saved copy".

## Fast fallback: HTML only

`demo/save-offline.sh` curls every page with a `url` into its `file` with a browser User-Agent (no images or CSS; enough for the eval harness, not pretty on stage). It keeps existing copies unless you pass `-f`. Pages rendered by JavaScript may come back nearly empty: check the byte count it prints.

Fallbacks on stage: cached tailored versions, these offline copies, the cached Coframe reply, the backup video.

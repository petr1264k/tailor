# Demo pages (CONTEXT.txt §7, §9)

Pick by 16:00. Every page gets an offline copy in `demo/pages/` (gitignored) so the demo never depends on Wi-Fi.
`demo/pages.json` is the list the eval harness reads (`id`, `url`, `file`). Stage script: [`script.md`](script.md).

| # | Page | Who | What the tailored version shows |
|---|------|-----|---------------------------------|
| 1 | long product page (TV or laptop) | both | PS5 compatibility first, budget checked, marketing collapsed |
| 2 | dense docs page | both | examples reordered for your stack and level |
| 3 | recipe page | both | diet, allergens, cooking time |
| 4 | https://www.coframe.com | Mikhail (CTO) vs Petr (frontend) | the finale, then the share with consent |
| 5 | https://www.anker.com (storefront) | both | the page rebuilds itself: the shelf that fits moves up, matching cards jump to the front with "For you" tags, membership and promos move down; the popup gives the numbers (src/sites/anker.ts is the site profile: 17 regions, 29 priced cards) |
| 6 | https://www.yeti.com (storefront) | both | same engine, second site: hero, four category tiles, the Offers shelf (priced tiles with crossed-out prices), Fandom / New & Trending / colour / category carousels, benefits list, founders' story (src/sites/yeti.ts: 12 regions) |
| 7 | https://www.patagonia.com/home/ (storefront, editorial) | both | hero, category and activity routers, the vote campaign, Latest Stories, the values strip; no prices on a first visit, so the notes are about fit and interests (src/sites/patagonia.ts: 6 regions) |

## Save a copy with ⌘S (the one we demo from)

1. Open the page in the clean demo Chrome profile. Dismiss cookie banners, close pop-ups, scroll to the bottom once so lazy content loads, scroll back up.
2. Press **⌘S** (File › Save Page As…).
3. **Format:** "Webpage, Complete".
4. **Save As:** the exact file name from `demo/pages.json` (e.g. `1-product.html`). **Where:** `tailor/demo/pages/`.
5. Click **Save**. Chrome writes the `.html` plus a `<name>_files/` folder next to it; keep both.
6. Put the live URL in that page's `url` in `demo/pages.json` (links and the cache key use it).
7. Check: open the copy as `file://…/demo/pages/1-product.html` with "Allow access to file URLs" on the extension card and let it tailor on load (or click Tailor); then `npm run eval -- gate` must not list the page under "no saved copy".

## Rendered copy with `demo/scan-page.sh` (what 5-anker, 6-yeti and 7-patagonia are)

```
demo/scan-page.sh https://www.anker.com/ demo/pages/5-anker.html
demo/scan-page.sh https://www.yeti.com/ demo/pages/6-yeti.html --headed
demo/scan-page.sh https://www.patagonia.com/home/ demo/pages/7-patagonia.html --headed
```

Needs `agent-browser` (`npm i -g agent-browser && agent-browser install`). It opens the page in Chrome, dismisses cookie
banners and sign-up modals, scrolls to the bottom so lazy sections load, then saves the rendered DOM with two code-only
fixes: everything Chrome does not render (inactive tab panes, closed modals, mobile-only blocks) gets a `hidden` attribute so
the eval harness (jsdom, no CSS) sees the same page as the live extension, and a `<base href>` makes the copy render with the
site's own assets when online. It also writes `<file>.png` (full page) and `<file>.map.json` (regions, headings, card shapes,
prices), the raw material for a `src/sites` profile. `--headed` opens a visible window with automation flags off: yeti.com
(PerimeterX) and patagonia.com (Akamai) serve a bot wall or a "Sit tight" page to headless Chrome and to curl. Check with
`npm run eval -- regions` that the profile still matches (anker 17 regions / 29 priced, yeti 12 / 14, patagonia 6 / 0).

## Fast fallback: HTML only

`demo/save-offline.sh` curls every page with a `url` into its `file` with a browser User-Agent (no images or CSS; enough for the eval harness, not pretty on stage). It keeps existing copies unless you pass `-f`. Pages rendered by JavaScript may come back nearly empty: check the byte count it prints.

Fallbacks on stage: cached tailored versions, these offline copies, the cached Coframe reply, the backup video.

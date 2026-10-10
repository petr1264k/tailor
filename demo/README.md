# Demo pages (CONTEXT.txt §7, §9)

Pick by 16:00. Save an offline copy of each into `demo/pages/` (gitignored) so the demo never depends on Wi-Fi.
Load `file://` copies with "Allow access to file URLs" enabled on the extension card.

| # | Page | Who | What the tailored version shows |
|---|------|-----|---------------------------------|
| 1 | long product page (TV or laptop) | both | PS5 compatibility first, budget checked, marketing collapsed |
| 2 | dense docs page | both | examples reordered for your stack and level |
| 3 | recipe page | both | diet, allergens, cooking time |
| 4 | https://www.coframe.com | Mikhail (CTO) vs Petr (frontend) | the finale, then the share with consent |

Save a copy: open the page in Chrome → ⌘S → "Webpage, Complete" → `demo/pages/<n>-<name>.html`.
Keep `demo/pages.json` as the list the eval harness reads.

Fallbacks: cached tailored versions, offline copies, the cached Coframe reply, the backup video.

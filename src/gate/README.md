# Fidelity gate (CONTEXT.txt §3.6): code only, no model
`runFidelityGate({ blocks, visibleText, links, userFactValues })` runs after the rewrite model and before render.
It re-validates every block (BlockSchema), pulls out claims, checks each against the VISIBLE page text, strips what
fails, and returns new blocks plus `{ checked, stripped[] }`. The input is never mutated. Tests: `gate.test.ts`.

## What is a claim
- Price: `$1,299`, `1299 USD`, `USD 1,299`, `€999`, `999 EUR`, `£…`.
- Number with a unit (any digit count): Hz, nits, lbs, inch (`65"`, `65-inch`), ft, GB, W, %, minutes, days, years, cups, °F…;
  also `3840x2160`, `4K`, `1080p`, `1.5x`. Any other number with ≥ 2 digits: `2024`, `2.1`, `1,000`.
- Spec token from a fixed list: HDMI (+version), eARC, Wi-Fi (+gen), Bluetooth, USB/USB-C, Thunderbolt, DisplayPort,
  OLED/QD-OLED/QLED/Neo QLED/Mini-LED/Micro-LED, Dolby Vision/Atmos, HDR/HDR10/HDR10+/HLG, VRR, ALLM, FreeSync, G-Sync, NVMe, PCIe, DDR.
- Model name: a token with ≥ 1 digit, ≥ 2 letters, length ≥ 3 (`QN90D`, `S95D`, `PS5`) or `RTX 4070` style. Not `M3`, `2nd`, `10am`.
- Quote: ≥ 3 words inside straight or curly double quotes (or « »). Link: every `cta.href`.
- Read from every string of every block (text, heading, label, reason, rows, columns, items, cta.label), except
  `from_site`: the site's own words, shown labeled as the site's (the share module checks its links). Deduped per block.

## The check (both sides go through `normalizeForMatch`)
Normalization: NFKC, lowercase, one dash and quote form, `1,299` → `1299`, one form for currencies, inches and units, collapsed spaces.
- Number / price: must appear as a whole token. `20` is not in `120`; `$1,299` is not in `$1,299.99`; `120 Hz` needs the unit.
- Spec / model name: whole token, `-` or space between parts optional (`WiFi 6E` = `Wi-Fi 6E`), versions exact (`HDMI 2.0` ≠ `2.1`).
- Quote: appears verbatim after normalization. Link: equals a page link after dropping `#hash` and trailing `/`; absolute links must be http(s).
- The user's own facts: ONLY in `for_you` / `warning` (the blocks labeled as the user's), a claim matching a `userFactValues`
  entry (fact values + evidence quotes; whole-token substring, quotes one way) passes off-page, e.g. "your $1,000 budget".
  Everywhere else it must be on the page, so the user's wish ("144 Hz") cannot pose as a page fact.

## On failure
Text fields lose the sentence holding the claim (split on . ! ? and newlines); a field left empty drops the block.
key_facts / compare / steps lose the row or item; a failing compare column header drops the table. A cta is dropped
(`link_not_on_page` for a bad href). A block that fails the schema is dropped (`invalid_block`).
Each failed claim is logged once per block with its ORIGINAL block index: that list is the gate log on stage.

## What it does NOT catch (say this when asked)
- False relations between true tokens: "120 Hz on all four HDMI ports" passes if the page has "120 Hz" and "four HDMI ports".
- Claims with no number, spec, model name or quote: "brighter than last year's model", "great for sports".
- Number words and single-digit counts without a unit: "six HDMI ports", "6 speakers".
- Whether a matching token refers to the same thing (the price of another size on the same page passes).
- Numbers glued to letters that are not model names (`v18`, `M3`); space-separated thousands (in `1 299 ₽` only `299` is checked).
- Inside for_you / warning, a user value worded as if the page said it (labeled as the user's, but intent is not checked).
- Anything the content script put in `visibleText` counts as "on the page", even if it was hidden from the user.
Strict on purpose (stripped, not missed): synonyms ("PlayStation 5" vs "PS5") and rounding ("$1,300" vs "$1,299.99").

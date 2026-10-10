# Measurement (CONTEXT.txt §8)

`npm run eval -- <task> [flags]` (Node via tsx; fake IndexedDB; jsdom loads the saved pages in `demo/pages.json`).
Each task writes `eval/out/<task>-<iso>.{json,md}` (gitignored), prints the markdown, and prints N next to every number.
A module that still throws TODO prints `BLOCKED: <module>` instead of crashing.
Key: `ANTHROPIC_API_KEY` in `.env` at the repo root (see `.env.example`); it is handed to `src/settings`, never printed.

| # | Task | Number for the write-up (§13) |
|---|------|-------------------------------|
| 0 | `profile --id <name> [--chats a.json,b.json] [--cutoff YYYY-MM-DD]` | builds `data/profiles/<name>.json`: facts from chats before the cutoff, questions after (held out) |
| 1 | `first-screen [--offline] [--profile id] [--lang en]` | questions answered on the first screen: original [a]/[n] vs tailored [b]/[n] |
| 2 | `precision [--profile id]`, then `precision --score <csv>` | owners rated [P]% of extracted facts correct |
| 3 | `blind [--profile id]` | own page picked [A] of [B] times (order-swapped LLM judges, chance 25%; human protocol printed, chance 50%) |
| 4 | `gate` | across [N] pages the gate caught [X] unsupported claims and showed 0 (re-gated) |
| 5 | `speed [--profile id]` | time to tailored blocks (non-streaming); words before vs after |
| 6 | `learning [--profile id]` | facts changed after N interactions; how the next page differed |

## Order of work (16:00 → 18:30)

1. Save the demo pages (`demo/README.md`).
2. Put each owner's export in `data/<name>/` (gitignored), then `npm run eval -- profile --id mikhail` and `--id petr`.
   Default cutoff: 30 days before the newest message. The tailor never sees the held-out questions.
3. `npm run eval -- first-screen` (live). It tailors every (person, page), caches `eval/out/tailored/<person>-<page>.json`,
   and writes `eval/out/answers-template.json`.
4. Copy the template to `eval/answers.json`. For each question, copy the answer from the ORIGINAL page, before looking at the
   tailored page; leave it blank if the page does not answer it. Code refuses any answer that is not exact page text
   (case and whitespace ignored), any question the person did not actually ask, and answers under 3 characters; it keeps
   the 5 newest answerable questions per pair. Then `npm run eval -- first-screen --offline`.
5. `precision` → each owner fills `correct` with y/n → `precision --score eval/out/precision-<name>.csv`.
6. `gate`, `blind`, `speed`, `learning`.

`eval/answers.json` holds questions mined from your own chats: the owner reviews it before it is committed.

## Rules the numbers follow

- First screen = the first 1,500 characters (original: visible text; tailored: blocks as plain text). A strict variant hides
  long sections the renderer starts collapsed. Both are reported.
- Language is pinned to the page's language for every eval run (§8.3), so a blind pair never compares Russian with English.
- Sample size: 10 trials (5 pages × 2 people). One-sided binomial, p < 0.05: 9 of 10 at 50% chance, 6 of 10 at 25%.
  The harness also prints the exact p for the N actually run.
- Gate: re-running the gate on what was shown proves nothing slipped past it; it does not prove claims the gate cannot
  recognize are true. The md says both.

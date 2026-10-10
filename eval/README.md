# Measurement (CONTEXT.txt §8)

Run with `npm run eval -- <task>`. Outputs go to `eval/out/` (gitignored). State N out loud.

| # | Task | Number for the write-up |
|---|------|-------------------------|
| 1 | `first-screen` | questions answered on the first screen: original [a]/[n] vs tailored [b]/[n] |
| 2 | `precision` | owners rated [P]% of extracted facts correct |
| 3 | `blind` | people picked their own page [A] of [B] times (chance 25% order-swapped LLM, 50% human) |
| 4 | `gate` | across [N] pages the gate caught [X] unsupported claims and showed 0 |
| 5 | `speed` | time to first tailored content; words before vs after |
| 6 | `learning` | profile change after N interactions; how the next page differed |

Sample size: 10 trials (5 pages × 2 people). One-sided binomial, p < 0.05: 9 of 10 at 50% chance, 6 of 10 at 25%.
Hold language constant across both versions.

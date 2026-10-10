# Tailor

**Your ChatGPT and Claude history knows you better than any website does.**
Tailor turns it into a private profile, and a Chrome extension rewrites any page for you. Every change cites your words, and code checks every fact. When a site asks what you need (coframe.com already does), Tailor answers with three facts, with your consent.

Built in one day at **The Living Internet Build Day** (AGI House × Coframe, Hillsborough, Oct 10 2026).

## Run it

```bash
npm install
npm run dev        # writes an unpacked extension to dist/ with HMR
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick `dist/`.
2. Click the Tailor icon → paste an Anthropic API key (stored locally in `chrome.storage`; never sent anywhere but api.anthropic.com).
3. Open the profile page (**Open profile** in the popup) → drop in `conversations.json` from your ChatGPT export (Settings › Data controls › Export data) or your Claude export (Settings › Privacy › Export data).
4. Visit any page and press **Tailor**.

Other scripts: `npm run build`, `npm run typecheck`, `npm run test`, `npm run eval`, `npm run check` (all three).

## How it works

```
import → extract → profile → tailor → fidelity gate → render → learn → share
  §3.1     §3.2      §3.4     §3.5       §3.6          §3.7     §3.8    §3.9
```

- **Local-first.** The archive and the profile stay in the browser. No server, no account.
- **The model proposes, code decides.** Model output is validated against a fixed block list (`src/schemas.ts`) and every number, price, spec and link is checked against the original page (`src/gate`). Anything unsupported is stripped and counted.
- **Every change cites your words.** Each fact carries the conversation it came from. "Why" chips show the quote.
- **Sites are untrusted.** A site's reply is shown as plain text, labeled as the site's, never fed to the model as instructions.

Section numbers refer to `CONTEXT.txt`, the single source of truth for this build. `CLAUDE.md` has the repo rules and ownership.

## Layout

See the layout table in `CLAUDE.md`. Short version: one directory per pipeline stage under `src/`, frozen types in `src/types.ts`, React pages in `src/ui/`, measurement in `eval/`.

## Measurement (§8)

All numbers are measured on the day with N stated: first-screen questions answered before vs after, profile precision, an order-swapped blind test (chance 25%), invented facts shown (target 0) plus claims the gate stripped, time to first tailored content, and how the profile changed after N interactions.

## Not building

Accounts, sync, mobile, payments.

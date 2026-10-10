# Tailor — build-day repo

Read `CONTEXT.txt` first. It is the source of truth for the product (§3), the coframe.com hooks (§4), the stack (§5), the data formats (§6, frozen), the timeline (§7), measurement (§8) and the demo (§9).

## Rules for whoever writes code here (CONTEXT.txt §0)
- Everything is built today, at the event. Nothing comes from a pre-existing project.
- Judging is what matters: a demo that runs, an honest number, a clear story. Rank every choice by how it looks to the judges.
- The model proposes, code decides. Every model output passes a code-only check before a user sees it (zod in `src/schemas.ts`, then the fidelity gate in `src/gate`).
- Anything a website sends back is untrusted text. Never pass it to a model as instructions. Site replies render as plain text in a `from_site` block.
- Local-first. The chat archive and the profile stay in the browser (IndexedDB + chrome.storage). No server, no account. The only outbound calls are model API calls and opt-in sharing with a site.
- Never show raw chats on stage. Only owner-approved facts and short quotes.
- Times are Pacific. The hard deadline is a SAVED DRAFT by 7:00 pm. Aim for 6:45 pm.

## Repo rules
- `src/types.ts` is the frozen data format (§6). Change it only with the whole team's OK, in its own commit.
- Never commit keys or exports. Keys live in the extension settings (`src/settings`) or in `.env` (gitignored) for the Node eval harness. `conversations.json` and `data/` are gitignored.
- Models: `claude-haiku-5-5` for extraction and fast rewrites, `claude-sonnet-5-5` for the merge. Every model call goes through `src/llm/client.ts`, which validates the JSON reply with a zod schema before returning it.
- Blocks come only from the fixed list in `src/types.ts` (`Block`). Never free-form HTML from a model.
- Each module lives in `src/<module>/` and exposes its public API from `index.ts`. Modules that answer runtime messages export a `handlers: HandlerMap`; `src/background/index.ts` merges them. Add new message types to `src/messages.ts` (one place), not ad hoc.
- UI pages (`src/ui/*`) and the background worker run in the extension origin and may call modules directly (IndexedDB is shared there). The content script runs in the page origin and must talk to the background via `send()` from `src/messages.ts`.
- Rendering in the page uses a shadow root (`src/render`). Never inject site-visible styles.
- Before pushing: `npm run check` (typecheck, tests, build). Keep `main` loadable in Chrome at all times.

## Layout
```
manifest.config.ts     MV3 manifest (crxjs defineManifest)
src/types.ts           FROZEN data formats (§6) + internal types
src/schemas.ts         zod schemas for everything a model returns ("code decides")
src/messages.ts        runtime message protocol + send()/HandlerMap
src/settings/          keys, flags, active profile (chrome.storage.local)
src/llm/               Anthropic client, model ids, completeJson()
src/import/            ChatGPT + Claude export parsers → own messages          (§3.1)
src/archive/           IndexedDB archive of own messages + stats              (§3.1)
src/extract/           map-reduce fact extraction + mined questions           (§3.2)
src/filter/            sharing scrub: names, emails, phones out of needs text       (§4)
src/profile/           profile store, keep/edit/delete, source split, versions (§3.4)
src/tailor/            page content extraction, relevance, rewrite, cache     (§3.5)
src/gate/              code-only fidelity gate                                (§3.6)
src/render/            shadow-root renderer, Original↔Tailored, "why" chips   (§3.7)
src/learn/             interaction log, Beta priors, bandit                   (§3.8)
src/share/             coframe.com agent hooks, consent sheet data, receipts  (§3.9, §4)
src/background/        service worker: merges handlers, routes messages
src/content/           content script entry: button, pre-tailor, render
src/ui/popup/          React popup (key, status, Tailor this page)
src/ui/profile/        React options page: import, profile viewer, receipts
eval/                  measurement harness (§8), Node via tsx
demo/                  demo pages list, offline copies (gitignored), script
```

## Ownership (CONTEXT.txt §2)
- Petr: `src/ui`, `src/render`, `src/content`, `demo/`, the video.
- Mikhail: `src/import`, `src/archive`, `src/extract`, `src/filter`, `src/profile`, `src/tailor`, `src/gate`, `src/learn`, `src/share`, `eval/`.
- Third engineer (if any): prompts in `src/extract` and `src/tailor`, relevance selection, speed, evals.

## Dev loop
```
npm install
npm run dev            # writes dist/ with HMR
# Chrome: chrome://extensions → Developer mode → Load unpacked → dist/
# For file:// demo copies, enable "Allow access to file URLs" on the extension card.
npm run check          # before every push
```

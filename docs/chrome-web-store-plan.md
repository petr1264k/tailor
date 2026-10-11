# Plan: publish Tailor to the Chrome Web Store

Written Oct 10, 2026. Goal: Tailor listed in the Chrome Web Store, installable in one click, linked from https://ai-tailor.pages.dev.

Rough cost: $5 one-time registration, about one day of work, then a review wait of a few days to a few weeks.

## 0. Decisions first

| # | Decision | Options | Recommendation |
|---|---|---|---|
| D1 | Which Google account publishes | Mikhail's account, Petr's account, or a group publisher account | The person who accepts the developer agreement and pays owns the listing. Pick that before anything else. |
| D2 | Access to every website | **Keep**: the content script runs on all http/https pages and pre-tailors on load. **On-click**: inject only when the user presses Tailor (`activeTab` + `chrome.scripting`). | On-click gets a faster, simpler review. Keep only if pre-tailoring on load is worth a longer in-depth review. |
| D3 | How reviewers and users get a model | Bring your own Anthropic key (as now), or a hosted proxy | Keep bring-your-own-key for v1. Give reviewers a capped test key (see section 5). |

## 1. Developer account (owner: publisher from D1)

- [ ] Turn on 2-Step Verification on the Google account.
- [ ] Register in the Chrome Web Store Developer Dashboard and pay the fee ($5 one-time per a 2026 checklist; confirm at registration).
- [ ] Verify the contact email. All review and policy notices go there.
- [ ] Fill in the publisher profile, including the trader / non-trader declaration if the dashboard asks for it.
- [ ] Check the extension limit for new accounts (reported in 2026 as 2 by default).

## 2. Manifest and code (owner: Mikhail, with Claude Code)

File: `manifest.config.ts`.

- [ ] **Shorten the description to 132 characters or fewer.** It is 151 now and the upload would fail. Draft (118 characters):
      > Rewrites any page for you from your ChatGPT and Claude history. Every change cites your words; code checks every fact.
- [ ] **Remove unused host permissions:** `https://generativelanguage.googleapis.com/*` and `https://openrouter.ai/*`. The code only calls Anthropic. Also remove the unused Gemini and OpenRouter key fields in `src/settings`.
- [ ] **Remove `file:///*`** from the content script matches. It exists only for offline demo copies.
- [ ] **Check whether `tabs` is needed.** The code uses only `chrome.tabs.query` (popup) and `chrome.tabs.sendMessage`; `activeTab` likely covers both. Remove it if the popup still works without it.
- [ ] **Apply D2.** If on-click: drop `content_scripts`, inject with `chrome.scripting.executeScript` from the popup or the action click, add the `scripting` permission, and drop pre-tailor on load.
- [ ] Bump `version` in `package.json`.
- [ ] Optional: regenerate `src/assets/icons/icon-{16,32,48,128}.png` from the new 533 px logo (`site/logo.png`).
- [ ] Run `npm run check` (typecheck, tests, build) and load `dist/` unpacked for a smoke test.

Already fine:
- Manifest V3.
- No remotely hosted code: no `eval`, `new Function` or remote scripts (checked Oct 10).

## 3. Privacy (owner: Mikhail)

Tailor reads chat history, the most sensitive data a browser extension can touch. This section decides the review.

### 3.1 Privacy policy page

- [ ] Publish `site/privacy.html` at `https://ai-tailor.pages.dev/privacy` and link it from the landing page footer. It must say:
  - Chat exports, the archive and the profile stay in the browser (IndexedDB and `chrome.storage`). No Tailor server, no account.
  - The user's own Anthropic API key is stored locally and sent only to api.anthropic.com.
  - Message text and page text are sent to Anthropic to extract facts and rewrite pages. Anthropic's terms apply to that processing.
  - The needs text goes to coframe.com only after the user approves it on the consent sheet. A receipt is kept.
  - Sensitive topics (health, religion, politics, sexuality, exact location, detailed finances, legal matters, other people's names) are not extracted.
  - Nothing is sold or used for advertising. How to delete everything: remove the extension, or use the delete buttons on the profile page.

### 3.2 Privacy practices tab (drafts)

- [ ] **Single purpose:**
      > Tailor rewrites the web pages you visit to fit you, using a private profile built from your own ChatGPT and Claude chat exports.
- [ ] **Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves settings, the user's API key and the profile locally. |
| `unlimitedStorage` | The imported chat archive in IndexedDB can exceed the default quota. |
| `activeTab` | Reads and edits the current page when the user presses Tailor. |
| `tabs` (only if kept) | Sends the popup's command to the current tab. |
| `https://api.anthropic.com/*` | Model calls for fact extraction and page rewriting, with the user's own key. |
| `https://www.coframe.com/*`, `https://coframe.com/*` | Sends the needs text the user approves to coframe.com's agent endpoint. |
| Content script on all sites (only if D2 = keep) | Reads the visible page text so it can tailor the page as it loads. |

- [ ] **Data categories:** personal communications (chat exports), website content (page text sent for rewriting). Consider authentication information (the user's API key, stored locally).
- [ ] **Certifications:** Limited Use; no sale of data; no use unrelated to the single purpose; no remote code.

## 4. Store listing assets (owner: Petr for visuals)

- [ ] Name: Tailor.
- [ ] Short description: the 132-character line from section 2.
- [ ] Full description: adapt the landing page copy (how it works, the four rules, install-free use).
- [ ] Icon: 128×128 PNG.
- [ ] Screenshots: 1 to 5 at 1280×800. Suggested set: the import screen, the profile with "why" quotes, a page before and after tailoring, the consent sheet, the receipt.
- [ ] Small promo tile: 440×280.
- [ ] Category, language, homepage URL (`https://ai-tailor.pages.dev`), support URL (GitHub issues).

## 5. Reviewer kit (owner: Mikhail)

Tailor does nothing without an API key and an imported export, so the reviewer needs both.

- [ ] A test Anthropic API key with a low spending cap, used only for review. Revoke it after approval.
- [ ] A small synthetic `conversations.json` with made-up messages. No real chats.
- [ ] Test instructions for the dashboard's test-instructions field: paste the key in the popup, import the sample on the profile page, press Extract, open a product page, press Tailor.

## 6. Build, upload, submit (owner: publisher)

- [ ] `npm run build`.
- [ ] Zip the contents of `dist/` so that `manifest.json` is at the top level of the zip.
- [ ] Upload in the dashboard, fill sections 3 to 5, and submit for review.
- [ ] Watch the contact email. Answer reviewer questions quickly; a rejection names the policy, so fix and resubmit.

## 7. After approval

- [ ] Replace "Install from source" on https://ai-tailor.pages.dev with an "Add to Chrome" button, and redeploy.
- [ ] Add the store link to `README.md`.
- [ ] Revoke the reviewer API key.
- [ ] For each update: bump the version, build, zip, upload. Each update is reviewed again.

## Timeline

| Step | Effort |
|---|---|
| Decisions D1 to D3 | 15 minutes |
| Account | 30 minutes |
| Manifest and code | 2 to 3 hours (more if D2 = on-click) |
| Privacy policy and privacy tab | 2 hours |
| Listing assets | 2 hours |
| Reviewer kit | 1 hour |
| Review | a few days to a few weeks |

## Risks

- **All-sites access plus chat data means an in-depth review.** D2 = on-click lowers this.
- **Unused permissions can cause a rejection.** Section 2 removes them.
- **A reviewer without a working key may reject Tailor as broken.** Section 5 prevents this.
- **Sensitive inferences.** The extraction prompts exclude sensitive topics again (merged Oct 10). Keep it that way.
- **Policy changes in 2026** (stricter data rules from Aug 1, reported in secondary sources). Re-read the current program policies before submitting.

## Sources

- [Chrome Web Store review process](https://developer.chrome.com/docs/webstore/review-process)
- [Fill out the privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Chrome Web Store updates: faster reviews, new publication limits (2026)](https://developer.chrome.com/blog/cws-review-updates-2026)
- [Chrome Web Store publishing requirements 2026 checklist](https://extensionbooster.net/blog/chrome-web-store-publishing-requirements-2026-complete-checklist/)
- [Chrome Web Store publisher extension limits](https://techstoriesindia.com/google-chrome-web-store-publisher-extension-limits/)
- [Chrome Web Store privacy rules, August 2026](https://www.superchargebrowser.com/library/chrome-web-store-privacy-rules-august-2026/)

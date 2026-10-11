# Finalist demo: 3 minutes, ends on coframe.com (CONTEXT.txt §9)

Rules on stage: never show raw chats, only owner-approved facts and short quotes. Say N with every number.
Fallbacks for everything: offline copies (`demo/pages/`), cached tailored versions, the cached Coframe reply, the backup video.

## Before going on (5 min)

- [ ] Clean Chrome profile, Developer mode on, `dist/` loaded, "Allow access to file URLs" on, API key set in the popup.
- [ ] Popup: "Tailor pages automatically as they load" on, "Demo mode: play the changes top to bottom" on (both are the defaults). Demo mode is what makes the page rebuild itself in front of the judges: one pass down the page and back (lazy content loads), promoted shelves fly up, then every change plays down the page (rewrites type in, what does not matter slides down to the bottom, notes press on, tags pop), the window comes back to the top and a report opens: N changes, first thing for you X screens down → first screen, words before → after, the list of changes, the fact check. Click OK. Do not touch the mouse wheel while it plays: scrolling by hand hands the viewport back to you and the changes keep playing where they are. Nothing of ours stays on the page: Show original / Tailor this page / Share live in the popup, and the popup's status shows the step, errors and "Learned: …".
- [ ] Both owners reviewed every fact and quote today (keep/delete) and deleted anything they do not want on a projector. Nothing filters health, finances, other people's names or similar topics any more, so this review is the only guard. Active profile: Mikhail.
- [ ] Every demo page tailored once for each profile (cache warm). Offline copies open in tabs, in order.
- [ ] anker.com tailored once per profile at the demo window size (the scorecard measures screens from the live viewport). Check the map still matches the live site: `npm run eval -- regions` prints regions and cards per saved page; anker should show hero / categories / products (29 cards with prices) / membership / reviews.
- [ ] Numbers filled from `eval/out/*.md` on one slide, each with its N.
- [ ] Backup video open in a paused tab. Notifications off, font size up, Wi-Fi joined (but nothing depends on it).

## Script

- [ ] **0:00–0:20 Hook.** "Your ChatGPT and Claude history knows you better than any website does."
  Show the archive: N conversations, M messages, two sources. Show the split: what ChatGPT knows, what Claude knows, the overlap.
  *Fallback:* a screenshot of the archive stats and the split, taken at rehearsal.
- [ ] **0:20–0:45 Profile.** Facts with source quotes. Delete one live.
  *Fallback:* if delete hangs, skip it and move on; do not open raw chats.
- [ ] **0:45–1:25 Tailor.** Open the TV page. The moment the result lands the page re-fits itself in front of everyone, top to bottom (no click): the headline types itself over, the marketing block slides down to the bottom, the PS5 note presses onto the ports line, the window following each change, then back to the top and the report. Click OK. Popup → Show original to show what everyone else sees, Tailor this page to play it again.
  "For you" notes: PS5 compatibility first, budget checked, marketing collapsed. Hover a "why" chip to show the quote.
  *Fallback:* the `file://` copy (`demo/pages/1-product.html`) with the cached tailored version; if the extension fails, cut to the video at this segment.
- [ ] **Storefront (anker.com), slot it before or instead of the TV page.** Open https://www.anker.com/ as everyone sees it: a sale banner, a stats strip, category tiles, a 29-card "Must-Have" shelf four screens down. Tailoring starts on load; nothing to click.
  The page REBUILDS itself, change by change: the shelf (or the collection that fits this person) flies up from four screens down to under the hero and gets a "Moved up for you" strip; the 1–3 cards that fit their devices and budget jump to the front of the shelf; cards get "For you" tags quoting the page's own watts and prices; the membership pitch, partner promos and reviews slide down to the bottom of the page (nothing is hidden). Hover a tag's "why" chip.
  Read the report that opens at the end out loud: "First thing marked for you: 3.6 screens down → first screen. Words: 2,870 → 1,140." Every row is measured by code on this page at the same scroll position, before and after, with N (the marked elements). Click OK.
  Say: "The site profile is code: it knows anker.com's anatomy (hero, shelf, cards, prices). What goes where comes from this person's facts, every one with its quote. Nothing is scripted: switch the profile and the page rebuilds differently."
  *Fallback:* `demo/pages/5-anker.html` (offline copy) with the cached tailored version; if the extension fails, cut to the video at this segment.
- [ ] **1:25–1:45 Loop.** Expand the collapsed specs twice (Expand, Collapse, Expand). The popup's status shows e.g. "Learned: specs first (67%)", then "(75%)" (exact numbers depend on the chat seed). The next product shows specs first.
  "Your chats are the prior, your clicks are the evidence."
  Specs tables with more than 5 rows start collapsed; make sure the TV page's key facts have 6 or more rows in the rehearsal.
  *Fallback:* the table from `npm run eval -- learning` (greedy layout before → after; specs-first share of Thompson draws).
- [ ] **1:45–2:05 Trust.** Read a real strip from the gate log, e.g. "The model wrote '144 Hz'. The page says 120 Hz, so code stripped it."
  Do NOT use the CONTEXT.txt line "120 Hz on all four HDMI ports": when the page has "120 Hz" and "four HDMI ports" separately, the gate passes it (it checks tokens, not how they relate; see src/gate/README.md).
  Gate log: checked N, stripped X, shown 0.
  *Fallback:* the stripped-claims list in `eval/out/gate-*.md`. Only quote a strip that really happened today.
- [ ] **2:05–2:40 coframe.com.** Tailor the homepage for Mikhail (CTO: fits the existing stack, integration time, SOC 2, approval before go-live, fallbacks).
  Switch profile, tailor for Petr (frontend: generated components and layouts). One tap shares 3 facts through the consent sheet; Coframe's reply appears inside the tailored page, labeled as theirs.
  *Fallback:* `demo/pages/4-coframe.html` plus the cached Coframe reply, labeled as cached (say so out loud).
- [ ] **2:40–3:00 Numbers and close.** First-screen answers before vs after, profile precision, blind test vs 25% chance, 0 invented facts, each with N.
  Close: "Coframe taught sites to ask what a visitor needs. Tailor is how the visitor answers: with consent, every fact traced to their own words. You just watched it happen."
  Say "taught sites" ONLY if Coframe confirmed the endpoint runs beyond coframe.com. Otherwise: "Coframe's own site asks what a visitor needs. Tailor is how the visitor answers..."
  *Fallback:* the numbers slide alone.

## 30-second pitch (§10, 71 words)

- 0:00–0:05 "Your ChatGPT and Claude history knows you better than any website does."
- 0:05–0:15 "Tailor turns it into a private profile, and a Chrome extension rewrites any page for you. Every change cites your words. Code checks every fact."
- 0:15–0:25 "Coframe's own site already asks your agent what you need. Tailor is how you answer: three facts, with consent. Live on coframe.com tonight."
- 0:25–0:30 "We need one engineer who's shipped LLM agents. Find us after."

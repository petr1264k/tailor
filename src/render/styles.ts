/**
 * All in-page styles (CONTEXT.txt §3.7). Lives ONLY inside Tailor's shadow roots: never injected into the site.
 * Look: coframe.com. The tokens below mirror src/ui/theme.css (the site's --brand-* values); change both together.
 * Fonts: coframe's NB International Pro / Basis Grotesque Mono Pro first (used if installed), then system faces.
 * Nothing is fetched. Readable on a projector (§9): 16px base, high contrast.
 *
 * PANEL_CSS: the floating bar, the gate popover, the fallback panel and the consent sheet (the main shadow root).
 * INPLACE_CSS / WHY_CSS: notes, fold stubs and "why" chips inserted INTO the page (their own shadow roots).
 */
import { markSvg } from '@/brand/geometry' // React-free on purpose: this bundle runs in every page

const SANS = `'NB International Pro', 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, 'Helvetica Neue', Arial, sans-serif`
const MONO = `'Basis Grotesque Mono Pro', 'SF Mono', ui-monospace, Menlo, Consolas, 'Liberation Mono', monospace`

export const PANEL_CSS = `
  :host {
    all: initial;
    --t-sans: ${SANS};
    --t-mono: ${MONO};
    --t-ink: #1f212f;
    --t-ink-2: #353742;
    --t-indigo: #2d2860;
    --t-indigo-2: #534aa3;
    --t-accent: #5a52ec;
    --t-accent-soft: #eeedfd;
    --t-bg: #f7f8fb;
    --t-bg-2: #f4f5f9;
    --t-card: #ffffff;
    --t-line: #d3ddf5;
    --t-line-2: #e6e9f2;
    --t-muted: #6b7084;
    --t-muted-on-dark: #b1bac2;
    --t-amber: #b45309;
    --t-amber-soft: #fff7e6;
    --t-amber-fg: #7c3f0a;
    --t-danger: #b42318;
    --t-shadow-1: 0 0 0 1px rgba(0,0,0,.04), 0 2px 2px 0 rgba(0,0,0,.04);
    --t-shadow-modal: 0 24px 48px -12px rgba(31,33,47,.35);
    --t-ease: cubic-bezier(.4,0,.2,1);
  }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; margin: 0; }
  button[disabled] { opacity: .55; cursor: default; }
  button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
  a { color: var(--t-accent); }

  /* ── Floating bar: coframe's bottom-center "HUMAN / AGENT" pill ── */
  .bar { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 2147483647; max-width: calc(100vw - 32px);
         display: flex; align-items: center; gap: 6px; padding: 6px; font: 500 13.5px/1.2 var(--t-sans); color: var(--t-ink);
         background: var(--t-card); border-radius: 999px;
         box-shadow: 0 0 0 1px rgba(31,33,47,.08), 0 2px 6px rgba(31,33,47,.08), 0 12px 32px -8px rgba(31,33,47,.35); }
  .bar::before { content: ''; display: block; width: 24px; height: 24px; margin-left: 4px; flex: none;
                 background: url("data:image/svg+xml,${encodeURIComponent(markSvg(24))}") center / 24px 24px no-repeat; }
  .bar button { padding: 9px 14px; border-radius: 999px; white-space: nowrap;
                transition: background .15s var(--t-ease), color .15s var(--t-ease), box-shadow .15s var(--t-ease); }
  .bar button.primary { background: var(--t-ink); color: #fff; }
  .bar button.primary:hover:not(:disabled) { background: var(--t-ink-2); }
  .bar button.primary::after { content: '→'; margin-left: 7px; font-weight: 400; }
  .bar button.primary:disabled::after { content: none; }
  .bar button.secondary { background: transparent; color: var(--t-ink); box-shadow: inset 0 0 0 1px var(--t-line); }
  .bar button.secondary:hover:not(:disabled) { background: var(--t-bg); box-shadow: inset 0 0 0 1px #b9c5ea; }

  /* The Original ↔ Tailored toggle is ONE button whose text is the view you switch to; CSS draws the other segment
     (the active one, with a dot) from data-mode on the bar, so it reads as a two-segment pill. */
  .bar .view { display: inline-flex; align-items: center; gap: 2px; padding: 3px 12px 3px 3px; background: var(--t-bg-2);
               box-shadow: inset 0 0 0 1px var(--t-line-2); color: var(--t-muted);
               font: 500 11px/1 var(--t-mono); letter-spacing: .08em; text-transform: uppercase; }
  .bar .view:hover:not(:disabled) { color: var(--t-ink); background: var(--t-bg-2); box-shadow: inset 0 0 0 1px var(--t-line-2); }
  .bar .view::before, .bar .view::after { display: none; padding: 7px 12px 7px 22px; border-radius: 999px; color: #fff;
       background: radial-gradient(circle, #fff 2.5px, transparent 3px) 10px 50% / 8px 8px no-repeat, var(--t-ink); }
  .bar[data-mode='original'] .view::before { content: 'Original'; display: inline-block; }
  .bar[data-mode='tailored'] .view { padding: 3px 3px 3px 12px; }
  .bar[data-mode='tailored'] .view::after { content: 'Tailored'; display: inline-block; margin-left: 10px; }
  .bar[data-mode='original'] .view::before { margin-right: 10px; }

  .bar .status { padding: 0 10px 0 6px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                 font: 500 11.5px/1.3 var(--t-mono); letter-spacing: .04em; text-transform: uppercase; color: var(--t-muted);
                 background: none; border-radius: 0; cursor: default; }
  .bar .status:empty { display: none; }
  .bar .status.is-error { color: var(--t-danger); }
  .bar .status.has-log { text-decoration: underline dotted; text-underline-offset: 3px; cursor: pointer; }
  .bar .status.has-log:hover { color: var(--t-ink); }

  /* Fact-check popover above the bar (§9 "Trust") */
  .gate-pop { position: fixed; left: 50%; bottom: 76px; transform: translateX(-50%); z-index: 2147483647;
              width: min(500px, calc(100vw - 32px)); max-height: 50vh; overflow-y: auto; padding: 14px 16px;
              background: var(--t-ink); color: #fff; border-radius: 14px; font: 14.5px/1.45 var(--t-sans);
              box-shadow: var(--t-shadow-modal); }
  .gate-pop .gate-title { font: 500 11px/1.3 var(--t-mono); letter-spacing: .08em; text-transform: uppercase;
                          color: var(--t-muted-on-dark); margin-bottom: 8px; }
  .gate-pop ul { margin: 0; padding-left: 1.2em; }
  .gate-pop li + li { margin-top: 5px; }
  .gate-pop .claim { text-decoration: line-through; font-weight: 600; }

  /* ── Fallback panel: a fixed column over a dimmed, blurred backdrop ── */
  .overlay { position: fixed; inset: 0; z-index: 2147483646; background: rgba(9,11,21,.55);
             backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
             font: 16px/1.55 var(--t-sans); color: var(--t-ink); -webkit-font-smoothing: antialiased; }
  .panel { position: absolute; top: 16px; bottom: 16px; left: 0; right: 0; margin: 0 auto; width: min(760px, calc(100vw - 32px));
           overflow-y: auto; overscroll-behavior: contain; background: var(--t-bg); border-radius: 24px;
           box-shadow: var(--t-shadow-modal); padding: 0 28px 96px; outline: none; }
  .panel-head { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; justify-content: space-between; gap: 16px;
                padding: 18px 0 14px; background: var(--t-bg); border-bottom: 1px solid var(--t-line-2); }
  .eyebrow { display: inline-flex; align-items: center; padding: 6px 9px; border-radius: 6px; border: 1px solid var(--t-line);
             background: var(--t-card); color: var(--t-accent); font: 500 11px/1 var(--t-mono); letter-spacing: .08em; text-transform: uppercase; }
  .meta { display: block; margin-top: 8px; font: 500 12px/1.3 var(--t-mono); letter-spacing: .04em; color: var(--t-muted); }
  .ghost { padding: 9px 14px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--t-line); background: var(--t-card);
           font-weight: 500; font-size: 14px; white-space: nowrap; }
  .ghost:hover { box-shadow: inset 0 0 0 1px #b9c5ea; }
  .gate-log { margin: 14px 0 0; font-size: 14px; color: var(--t-muted); }
  .gate-log summary { cursor: pointer; font: 500 11.5px/1.4 var(--t-mono); letter-spacing: .06em; text-transform: uppercase; }
  .gate-log ul { margin: 8px 0 0; padding-left: 1.2em; }
  .gate-log .claim { color: var(--t-ink); text-decoration: line-through; }

  .blocks { display: flex; flex-direction: column; gap: 12px; padding-top: 14px; }
  .block { position: relative; padding: 18px 20px; border-radius: 16px; background: var(--t-card); border: 1px solid var(--t-line-2);
           box-shadow: var(--t-shadow-1); }
  .block p { margin: 0; }
  .text, .body { white-space: pre-line; overflow-wrap: anywhere; }
  .kicker { font: 500 11px/1.3 var(--t-mono); letter-spacing: .1em; text-transform: uppercase; margin-bottom: 8px; color: var(--t-muted); }

  .block--summary { border: 0; box-shadow: none; background: none; padding: 8px 0 4px; font-size: 21px; line-height: 1.4;
                    font-weight: 500; letter-spacing: -.015em; }

  .block--for_you { border-color: #c9c6f7; background: #f3f2fe; box-shadow: none; padding-right: 52px; }
  .block--for_you .kicker { color: var(--t-accent); }
  .block--warning { border-color: #f3d9a4; background: var(--t-amber-soft); color: var(--t-amber-fg); box-shadow: none; padding-right: 52px; }
  .block--warning .kicker { color: var(--t-amber-fg); }
  .dismiss { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 999px; font-size: 15px;
             line-height: 32px; text-align: center; color: var(--t-muted); }
  .dismiss:hover { background: rgba(31,33,47,.07); }

  table { width: 100%; border-collapse: collapse; font-size: 15.5px; }
  th, td { text-align: left; vertical-align: top; padding: 9px 10px; border-bottom: 1px solid var(--t-line-2); }
  tbody tr:last-child > * { border-bottom: 0; }
  th { font: 500 11.5px/1.4 var(--t-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--t-muted); }
  .kv th { width: 38%; padding-top: 11px; }
  td { font-variant-numeric: tabular-nums; }
  .table-wrap { overflow-x: auto; }
  .compare thead th { border-bottom: 1px solid var(--t-ink); }

  .block--steps ol { list-style: none; counter-reset: step; margin: 0; padding: 0; display: grid; gap: 10px; }
  .block--steps li { display: flex; gap: 12px; align-items: flex-start; }
  .block--steps li::before { counter-increment: step; content: counter(step); flex: none; width: 24px; height: 24px; border-radius: 50%;
                             display: inline-grid; place-items: center; background: var(--t-accent); color: #fff;
                             font: 500 12px/1 var(--t-mono); margin-top: 1px; }

  .block--section h3 { margin: 0 0 6px; font-size: 18px; line-height: 1.3; font-weight: 500; letter-spacing: -.01em; }
  .block--section.is-collapsed .body { max-height: 6.2em; overflow: hidden;
    -webkit-mask-image: linear-gradient(#000 40%, transparent); mask-image: linear-gradient(#000 40%, transparent); }
  .block--key_facts.is-collapsed tbody tr:nth-child(n+6),
  .block--compare.is-collapsed tbody tr:nth-child(n+6) { display: none; } /* TABLE_ROWS_SHOWN = 5 */
  .toggle { margin-top: 10px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--t-line); background: var(--t-card);
            color: var(--t-accent); font: 500 11px/1 var(--t-mono); letter-spacing: .08em; text-transform: uppercase; }
  .toggle:hover { border-color: #b9c5ea; }

  .block--hidden { background: transparent; border: 1px dashed var(--t-line); box-shadow: none; padding: 10px 14px; color: var(--t-muted); font-size: 14.5px; }
  .block--hidden .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .block--hidden .toggle { margin-top: 0; white-space: nowrap; }
  .block--hidden .body { margin-top: 8px; }
  .block--hidden.is-collapsed .body { display: none; }

  .block--cta { border: 0; box-shadow: none; padding: 4px 0; background: none; }
  .cta-link { display: inline-block; padding: 12px 20px; border-radius: 10px; background: var(--t-ink); color: #fff;
              font-weight: 500; text-decoration: none; transition: background .15s var(--t-ease); }
  .cta-link::after { content: '→'; margin-left: 8px; }
  .cta-link:hover { background: var(--t-ink-2); }
  .cta-link.is-disabled { background: var(--t-bg-2); color: var(--t-muted); }

  .block--from_site { border: 1px dashed var(--t-indigo-2); background: var(--t-card); box-shadow: none; }
  .block--from_site .kicker { color: var(--t-indigo-2); text-transform: none; letter-spacing: .02em; font-size: 12px; }
  .site-claim { text-decoration: underline dotted; text-underline-offset: 3px; font-weight: 600; cursor: help; }

  /* ── "why" chips: hover previews, click pins (and reports open_why) ── */
  .why-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .why-wrap { position: relative; display: inline-block; }
  .why { padding: 5px 8px; border-radius: 6px; background: var(--t-card); color: var(--t-accent); box-shadow: inset 0 0 0 1px var(--t-line);
         font: 500 10.5px/1 var(--t-mono); letter-spacing: .1em; text-transform: uppercase; }
  .why:hover { box-shadow: inset 0 0 0 1px var(--t-accent); }
  .why[aria-expanded="true"] { background: var(--t-accent); color: #fff; box-shadow: none; }
  .why-pop { position: absolute; z-index: 4; top: calc(100% + 6px); left: 0; width: max-content; max-width: 440px;
             padding: 12px 14px; border-radius: 12px; background: var(--t-ink); color: #fff; font: 400 14px/1.45 var(--t-sans);
             letter-spacing: 0; text-transform: none; box-shadow: var(--t-shadow-modal); }
  .why-wrap:hover .why-pop[hidden] { display: block !important; }
  .why-value { display: block; font-weight: 600; margin-bottom: 4px; }
  .why-quote { display: block; color: var(--t-muted-on-dark); }

  /* ── Consent sheet (§4 step 3) ── */
  .sheet-backdrop { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 16px;
                    background: rgba(9,11,21,.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
                    font: 15.5px/1.55 var(--t-sans); color: var(--t-ink); -webkit-font-smoothing: antialiased; }
  .sheet { width: min(580px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; background: var(--t-card);
           border-radius: 20px; padding: 28px; box-shadow: var(--t-shadow-modal); }
  .sheet-title { margin: 0 0 14px; font-size: 24px; line-height: 1.2; font-weight: 500; letter-spacing: -.02em; }
  .sheet-label { margin: 16px 0 8px; font: 500 11px/1.4 var(--t-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--t-muted); }
  .quote-box { margin: 0; padding: 12px 16px; border-left: 3px solid var(--t-accent); border-radius: 0 10px 10px 0; background: var(--t-bg);
               white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; }
  .sheet-facts { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
  .sheet-facts li { padding: 10px 14px; border: 1px solid var(--t-line-2); border-radius: 10px; }
  .sheet-facts strong { font-weight: 500; }
  .sheet-facts .ev { display: block; color: var(--t-muted); font-size: 14px; margin-top: 2px; }
  .sheet-meta { margin: 16px 0 0; font: 500 11px/1.4 var(--t-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--t-muted); }
  .sheet-fallback { margin: 6px 0 0; font-size: 14px; color: var(--t-amber-fg); font-weight: 500; }
  .sheet-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
  .sheet-actions button { padding: 11px 18px; border-radius: 10px; font-weight: 500; font-size: 15px;
                          transition: background .15s var(--t-ease), box-shadow .15s var(--t-ease); }
  .sheet-actions .primary { background: var(--t-ink); color: #fff; }
  .sheet-actions .primary::after { content: '→'; margin-left: 8px; font-weight: 400; }
  .sheet-actions .primary:hover { background: var(--t-ink-2); }
  .sheet-actions .secondary { box-shadow: inset 0 0 0 1px var(--t-line); }
  .sheet-actions .secondary:hover { box-shadow: inset 0 0 0 1px #b9c5ea; }
`

/**
 * Styles for the elements we insert INTO the page (each has its own shadow root, so nothing here reaches the site):
 * notes, fold stubs and "why" chips. They inherit the site's font family (no \`all: initial\`) so they read as part of
 * the page, but fix their own colors and background so they stay legible on any section, dark or light.
 */
export const INPLACE_CSS = `
  :host { display: block; margin: 14px 0; max-width: 72ch; text-align: left; opacity: 1; transform: none; }
  *, *::before, *::after { box-sizing: border-box; }
  :host([hidden]), [hidden] { display: none !important; }
  button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; margin: 0; }
  button:focus-visible { outline: 2px solid #5a52ec; outline-offset: 2px; }

  .note { position: relative; font-family: inherit; font-size: clamp(14px, 1rem, 18px); line-height: 1.5; font-weight: 400;
          letter-spacing: normal; text-transform: none; color: #1f212f; background: #fff; border-radius: 12px; padding: 14px 52px 14px 18px;
          border: 1px solid #d3ddf5; border-left: 4px solid #5a52ec; box-shadow: 0 8px 24px -8px rgba(31,33,47,.3); }
  .note.is-warn { border-color: #f3d9a4; border-left-color: #b45309; background: #fff7e6; color: #7c3f0a; }
  .note.is-site { border: 1px dashed #534aa3; background: #f7f8fb; color: #1f212f; padding-right: 18px; }
  .kicker { font: 500 11px/1.3 ${MONO}; letter-spacing: .1em; text-transform: uppercase; color: #5a52ec; margin-bottom: 6px; }
  .is-warn .kicker { color: #7c3f0a; }
  .is-site .kicker { color: #534aa3; text-transform: none; letter-spacing: .02em; font-size: 12px; }
  .text { margin: 0; white-space: pre-line; overflow-wrap: anywhere; }
  .dismiss { position: absolute; top: 8px; right: 8px; width: 32px; height: 32px; border-radius: 999px; font-size: 15px;
             line-height: 32px; text-align: center; color: #6b7084; }
  .dismiss:hover { background: rgba(31,33,47,.07); }
  .site-claim { text-decoration: underline dotted; text-underline-offset: 3px; font-weight: 600; cursor: help; }

  .fold { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-family: inherit;
          font-size: 13.5px; line-height: 1.4; font-weight: 400; letter-spacing: normal; text-transform: none; color: #6b7084;
          background: #f7f8fb; border: 1px dashed #d3ddf5; border-radius: 10px; padding: 8px 8px 8px 14px; }
  .fold .label { overflow-wrap: anywhere; }
  .fold .label b { color: #1f212f; font-weight: 600; }
  .fold .toggle { flex: none; padding: 6px 10px; border-radius: 6px; border: 1px solid #d3ddf5; background: #fff; color: #5a52ec;
                  font: 500 11px/1 ${MONO}; letter-spacing: .08em; text-transform: uppercase; text-decoration: none; white-space: nowrap; }
  .fold .toggle:hover { border-color: #b9c5ea; }

  .why-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
`

/** The inline "why" chip appended to a rewritten element (own shadow root). */
export const WHY_CSS = `
  :host { display: inline-block; vertical-align: middle; margin-left: .4em; position: relative; line-height: 1;
          font-size: 12px; letter-spacing: normal; text-transform: none; opacity: 1; transform: none; }
  :host([hidden]), [hidden] { display: none !important; }
  button { font: inherit; cursor: pointer; border: 0; background: none; padding: 0; margin: 0; }
  button:focus-visible { outline: 2px solid #5a52ec; outline-offset: 2px; }
  .why { padding: 5px 8px; border-radius: 6px; background: #fff; color: #5a52ec; box-shadow: inset 0 0 0 1px #d3ddf5; white-space: nowrap;
         font: 500 10.5px/1 ${MONO}; letter-spacing: .1em; text-transform: uppercase; }
  .why:hover { box-shadow: inset 0 0 0 1px #5a52ec; }
  .why[aria-expanded="true"] { background: #5a52ec; color: #fff; box-shadow: none; }
  .why-pop { position: absolute; z-index: 2147483000; top: calc(100% + 6px); left: 0; width: max-content; max-width: 440px;
             padding: 12px 14px; border-radius: 12px; background: #1f212f; color: #fff; text-align: left;
             font: 400 14px/1.45 ${SANS}; letter-spacing: normal; text-transform: none; white-space: normal;
             box-shadow: 0 24px 48px -12px rgba(31,33,47,.35); }
  :host(:hover) .why-pop[hidden] { display: block !important; }
  .why-value { display: block; font-weight: 600; margin-bottom: 4px; }
  .why-quote { display: block; color: #b1bac2; }
`

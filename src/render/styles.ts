/**
 * All in-page styles (CONTEXT.txt §3.7). Lives ONLY inside the Tailor shadow root: never injected into the site.
 * Self-contained: system font, 15px base, high contrast, readable on a projector (§9).
 * Restyle here. Colors are CSS variables on :host (`all: initial` does not reset custom properties).
 */
export const PANEL_CSS = `
  :host {
    all: initial;
    --t-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --t-fg: #0b0d12;
    --t-muted: #3f4552;
    --t-bg: #ffffff;
    --t-soft: #f3f4f7;
    --t-border: #c9cdd6;
    --t-accent: #3730a3;
    --t-accent-soft: #eef0ff;
    --t-amber: #d97706;
    --t-amber-soft: #fff4dc;
    --t-amber-fg: #7c2d12;
    --t-site: #0f5e57;
    --t-site-soft: #effaf8;
    --t-focus: #2563eb;
  }
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }
  button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; margin: 0; }
  button[disabled] { opacity: .55; cursor: default; }
  button:focus-visible, a:focus-visible, summary:focus-visible { outline: 3px solid var(--t-focus); outline-offset: 2px; }
  a { color: var(--t-accent); }

  /* ── Floating control bar ── */
  .bar { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; gap: 8px; align-items: center;
         font: 600 14px/1.2 var(--t-font); background: #111318; color: #fff; padding: 8px; border-radius: 999px;
         box-shadow: 0 8px 28px rgba(0,0,0,.3); }
  .bar button { padding: 8px 14px; border-radius: 999px; background: #fff; color: #111318; }
  .bar button.secondary { background: transparent; color: #fff; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.65); }
  .bar .status { padding: 0 8px; font-weight: 500; opacity: .85; max-width: 320px; overflow: hidden;
                 text-overflow: ellipsis; white-space: nowrap; }
  .bar .status:empty { display: none; }
  .bar .status.is-error { color: #fca5a5; opacity: 1; }

  /* ── Tailored panel: fixed column over a dimmed backdrop ── */
  .overlay { position: fixed; inset: 0; z-index: 2147483646; background: rgba(17,19,24,.55);
             font: 15px/1.55 var(--t-font); color: var(--t-fg); }
  .panel { position: absolute; top: 16px; bottom: 16px; left: 0; right: 0; margin: 0 auto; width: min(720px, calc(100vw - 32px));
           overflow-y: auto; overscroll-behavior: contain; background: var(--t-bg); border-radius: 16px;
           box-shadow: 0 24px 64px rgba(0,0,0,.35); padding: 0 28px 96px; outline: none; }
  .panel-head { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; justify-content: space-between; gap: 16px;
                padding: 18px 0 14px; background: var(--t-bg); border-bottom: 1px solid var(--t-border); }
  .eyebrow { display: block; font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--t-accent); }
  .meta { display: block; font-size: 14px; color: var(--t-muted); }
  .ghost { padding: 8px 14px; border-radius: 999px; box-shadow: inset 0 0 0 1.5px var(--t-border); font-weight: 600; white-space: nowrap; }
  .gate-log { margin: 12px 0 0; font-size: 14px; color: var(--t-muted); }
  .gate-log summary { cursor: pointer; font-weight: 600; }
  .gate-log ul { margin: 6px 0 0; padding-left: 1.2em; }
  .gate-log .claim { color: var(--t-fg); text-decoration: line-through; }

  .blocks { display: flex; flex-direction: column; gap: 14px; padding-top: 14px; }
  .block { position: relative; padding: 16px 18px; border-radius: 12px; background: var(--t-bg); border: 1px solid var(--t-border); }
  .block p { margin: 0; }
  .text, .body { white-space: pre-line; overflow-wrap: anywhere; }
  .kicker { font-size: 13px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 6px; color: var(--t-muted); }

  .block--summary { border: 0; padding: 4px 0; font-size: 18px; line-height: 1.5; }

  .block--for_you { border: 0; border-left: 5px solid var(--t-accent); background: var(--t-accent-soft); padding-right: 52px; }
  .block--for_you .kicker { color: var(--t-accent); }
  .block--warning { border: 0; border-left: 5px solid var(--t-amber); background: var(--t-amber-soft); color: var(--t-amber-fg); padding-right: 52px; }
  .block--warning .kicker { color: var(--t-amber-fg); }
  .dismiss { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 999px; font-size: 16px;
             line-height: 32px; text-align: center; color: var(--t-muted); }
  .dismiss:hover { background: rgba(0,0,0,.07); }

  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--t-border); }
  tbody tr:last-child > * { border-bottom: 0; }
  .kv th { width: 38%; font-weight: 600; color: var(--t-muted); }
  .table-wrap { overflow-x: auto; }
  .compare thead th { background: var(--t-soft); font-weight: 700; border-bottom: 2px solid var(--t-fg); }

  .block--steps ol { margin: 0; padding-left: 1.4em; }
  .block--steps li + li { margin-top: 6px; }

  .block--section h3 { margin: 0 0 6px; font-size: 18px; line-height: 1.3; }
  .block--section.is-collapsed .body { max-height: 6.2em; overflow: hidden;
    -webkit-mask-image: linear-gradient(#000 40%, transparent); mask-image: linear-gradient(#000 40%, transparent); }
  .block--key_facts.is-collapsed tbody tr:nth-child(n+6),
  .block--compare.is-collapsed tbody tr:nth-child(n+6) { display: none; } /* TABLE_ROWS_SHOWN = 5 */
  .toggle { margin-top: 8px; font-weight: 600; color: var(--t-accent); text-decoration: underline; text-underline-offset: 3px; }

  .block--hidden { background: var(--t-soft); border-style: dashed; padding: 10px 14px; color: var(--t-muted); }
  .block--hidden .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .block--hidden .toggle { margin-top: 0; white-space: nowrap; }
  .block--hidden .body { margin-top: 6px; }
  .block--hidden.is-collapsed .body { display: none; }

  .block--cta { border: 0; padding: 0; background: none; }
  .cta-link { display: inline-block; padding: 12px 20px; border-radius: 10px; background: var(--t-fg); color: #fff;
              font-weight: 700; text-decoration: none; }
  .cta-link.is-disabled { background: var(--t-soft); color: var(--t-muted); }

  .block--from_site { border: 2px dashed var(--t-site); background: var(--t-site-soft); }
  .block--from_site .kicker { color: var(--t-site); text-transform: none; letter-spacing: 0; font-size: 14px; }
  .site-claim { text-decoration: underline dotted; text-underline-offset: 3px; font-weight: 600; cursor: help; }

  /* ── "why" chips: hover previews, click pins (and reports open_why) ── */
  .why-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .why-wrap { position: relative; display: inline-block; }
  .why { padding: 3px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; background: #fff; color: var(--t-accent);
         box-shadow: inset 0 0 0 1.5px var(--t-accent); }
  .why[aria-expanded="true"] { background: var(--t-accent); color: #fff; }
  .why-pop { position: absolute; z-index: 4; top: calc(100% + 6px); left: 0; width: max-content; max-width: 440px;
             padding: 10px 12px; border-radius: 10px; background: #111318; color: #fff; font-size: 14px; line-height: 1.45;
             box-shadow: 0 10px 30px rgba(0,0,0,.3); }
  .why-wrap:hover .why-pop[hidden] { display: block !important; }
  .why-value { display: block; font-weight: 700; margin-bottom: 4px; }
  .why-quote { display: block; opacity: .92; }

  /* ── Consent sheet (§4 step 3) ── */
  .sheet-backdrop { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 16px;
                    background: rgba(17,19,24,.6); font: 15px/1.55 var(--t-font); color: var(--t-fg); }
  .sheet { width: min(560px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; background: var(--t-bg);
           border-radius: 16px; padding: 24px; box-shadow: 0 24px 64px rgba(0,0,0,.4); }
  .sheet-title { margin: 0 0 12px; font-size: 22px; line-height: 1.25; }
  .sheet-label { margin: 14px 0 6px; font-weight: 600; color: var(--t-muted); font-size: 14px; }
  .quote-box { margin: 0; padding: 12px 14px; border-left: 4px solid var(--t-accent); background: var(--t-accent-soft);
               white-space: pre-wrap; overflow-wrap: anywhere; font-size: 16px; }
  .sheet-facts { margin: 0; padding-left: 1.2em; }
  .sheet-facts li + li { margin-top: 6px; }
  .sheet-facts .ev { display: block; color: var(--t-muted); font-size: 14px; }
  .sheet-meta { margin: 14px 0 0; font-size: 14px; color: var(--t-muted); }
  .sheet-fallback { margin: 6px 0 0; font-size: 14px; color: var(--t-amber-fg); font-weight: 600; }
  .sheet-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
  .sheet-actions button { padding: 10px 18px; border-radius: 10px; font-weight: 700; }
  .sheet-actions .primary { background: var(--t-accent); color: #fff; }
  .sheet-actions .secondary { box-shadow: inset 0 0 0 1.5px var(--t-border); }
`

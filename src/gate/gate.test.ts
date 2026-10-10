import { describe, expect, it } from 'vitest'
import type { Block, PageLink } from '@/types'
import { claimOnPage, extractClaims, normalizeForMatch, runFidelityGate, type Claim, type GateInput } from './index'

// A TV product page as the content script would hand it over (PageContent.visibleText + links).
const PAGE = [
  'Samsung 65" Class QN90D Neo QLED 4K Smart TV',
  'Price: $1,299.99. Was $1,499.99.',
  'Refresh rate: 120 Hz. Four HDMI ports. HDMI 2.1 on ports 3 and 4. Wi‑Fi 6E. Dolby Atmos.',
  'Peak brightness 1,000 nits. Resolution 3840 x 2160. Weight 55.1 lbs.',
  'Reviewers call it “the brightest picture we have tested this year”.',
].join('\n')
const LINKS: PageLink[] = [
  { text: 'Buy now', href: 'https://shop.example.com/tv/qn90d/' },
  { text: 'Specs', href: 'https://shop.example.com/tv/qn90d#specs' },
]
const page = normalizeForMatch(PAGE)

function gate(blocks: Block[], userFactValues: string[] = []) {
  const input: GateInput = { blocks, visibleText: PAGE, links: LINKS, userFactValues }
  return runFidelityGate(input)
}
const on = (kind: Claim['kind'], text: string, visible = PAGE, links = LINKS) =>
  claimOnPage({ kind, text }, normalizeForMatch(visible), links)

describe('normalizeForMatch', () => {
  it('applies NFKC and lowercase', () => {
    expect(normalizeForMatch('１２０Ｈｚ')).toBe('120 hz')
    expect(normalizeForMatch('QN90D')).toBe('qn90d')
  })
  it('unifies unicode dashes and curly quotes', () => {
    expect(normalizeForMatch('Wi‑Fi – — −')).toBe('wi-fi - - -')
    expect(normalizeForMatch('“great” ‘ok’ «da»')).toBe('"great" \'ok\' "da"')
  })
  it('strips thousands separators inside numbers only', () => {
    expect(normalizeForMatch('$1,299')).toBe('$1299')
    expect(normalizeForMatch('1,000,000 units')).toBe('1000000 units')
    expect(normalizeForMatch('12,5 and 1,23')).toBe('12,5 and 1,23')
    expect(normalizeForMatch('$1,299.00')).toBe('$1299')
  })
  it('collapses whitespace including non-breaking spaces', () => {
    expect(normalizeForMatch('  a  \n\t b  ')).toBe('a b')
  })
  it('normalizes unit spacing', () => {
    for (const s of ['120Hz', '120 Hz', '120-hz', '120  HZ']) expect(normalizeForMatch(s)).toBe('120 hz')
    expect(normalizeForMatch('1,000 nits')).toBe(normalizeForMatch('1000nit'))
    expect(normalizeForMatch('5 lbs')).toBe(normalizeForMatch('5 pounds'))
    expect(normalizeForMatch('2-year')).toBe(normalizeForMatch('2 years'))
  })
  it('maps every inch form to one form', () => {
    for (const s of ['65"', '65″', '65”', '65-inch', '65 inch', '65 in', '65in', '65 inches'])
      expect(normalizeForMatch(s), s).toBe('65 inch')
  })
  it('maps currency forms to one form', () => {
    for (const s of ['$1,299', '1,299 USD', 'USD 1,299', '$ 1,299', 'US$1,299', '1299 dollars']) expect(normalizeForMatch(s), s).toBe('$1299')
    for (const s of ['€999', '999 EUR', 'EUR 999', '999 €']) expect(normalizeForMatch(s), s).toBe('€999')
  })
  it('unifies resolutions and drops trademark signs', () => {
    expect(normalizeForMatch('3840 × 2160')).toBe('3840x2160')
    expect(normalizeForMatch('QN90D™ Neo QLED®')).toBe('qn90d neo qled')
  })
})

describe('extractClaims', () => {
  const kinds = (b: Block) => extractClaims(b).map((c) => `${c.kind}:${c.text}`)

  it('finds prices, measurements, specs, model names and quotes', () => {
    expect(
      kinds({ type: 'summary', text: 'The QN90D has 120 Hz, HDMI 2.1 and Wi-Fi 6E for $1,299. It is 65" and "the brightest we tested".' }),
    ).toEqual(['model_name:QN90D', 'number:120 Hz', 'spec:HDMI 2.1', 'spec:Wi-Fi 6E', 'price:$1,299', 'number:65"', 'quote:the brightest we tested'])
  })
  it('finds every listed number form', () => {
    expect(kinds({ type: 'steps', items: ['1299 USD', '€999', '3840x2160', '4K', '1,000 nits', '5 lbs', '10 ft', '25%', '2.1', '2024', '1.5x'] })).toEqual([
      'price:1299 USD', 'price:€999', 'number:3840x2160', 'number:4K', 'number:1,000 nits', 'number:5 lbs',
      'number:10 ft', 'number:25%', 'number:2.1', 'number:2024', 'number:1.5x',
    ])
  })
  it('model names need a digit, two letters and length ≥ 3', () => {
    expect(kinds({ type: 'summary', text: 'RTX 4070, S95D, PS5, XR-65A95L, M3, 2nd, 10am, A4.' })).toEqual([
      'model_name:RTX 4070', 'model_name:S95D', 'model_name:PS5', 'model_name:XR-65A95L',
    ])
  })
  it('ignores single-digit counts and quotes under 3 words', () => {
    expect(kinds({ type: 'summary', text: 'Follow 3 steps. It is "very good".' })).toEqual([])
  })
  it('does not count a spec version or a price twice', () => {
    expect(kinds({ type: 'summary', text: 'HDMI 2.1 for $1,299' })).toEqual(['spec:HDMI 2.1', 'price:$1,299'])
  })
  it('does not mistake inch marks for quotes', () => {
    expect(kinds({ type: 'summary', text: 'The 65" and 75" models are "bright and sharp today".' })).toEqual([
      'number:65"', 'number:75"', 'quote:bright and sharp today',
    ])
  })
  it('dedupes within a block across fields and formats', () => {
    const b: Block = { type: 'key_facts', rows: [{ label: 'Price', value: '$1,299' }, { label: 'Sale', value: '$1299' }, { label: 'Hz', value: '120Hz / 120 Hz' }] }
    expect(kinds(b)).toEqual(['price:$1,299', 'number:120Hz'])
  })
  it('walks headings, labels, reasons, columns and rows', () => {
    expect(kinds({ type: 'section', heading: 'QN90D ports', text: 'HDMI 2.1' })).toEqual(['model_name:QN90D', 'spec:HDMI 2.1'])
    expect(kinds({ type: 'hidden', label: '120 Hz marketing', reason: 'You skip 2024 promos' })).toEqual(['number:120 Hz', 'number:2024'])
    expect(kinds({ type: 'compare', columns: ['QN90D', 'S95D'], rows: [['$1,299', '$2,199']] })).toEqual([
      'model_name:QN90D', 'model_name:S95D', 'price:$1,299', 'price:$2,199',
    ])
  })
  it('skips from_site entirely; cta.href becomes a link claim', () => {
    expect(extractClaims({ type: 'from_site', text: 'Our plan is $99 for 10 seats, "the best deal in town".', siteUrl: 'https://x.com' })).toEqual([])
    expect(extractClaims({ type: 'cta', label: 'Buy now', href: 'https://shop.example.com/tv/qn90d' })).toEqual([
      { kind: 'link', text: 'https://shop.example.com/tv/qn90d' },
    ])
  })
})

describe('claimOnPage', () => {
  it('number with unit: needs number + unit, flexible spacing', () => {
    expect(on('number', '120 Hz')).toBe(true)
    expect(on('number', '120Hz')).toBe(true)
    expect(on('number', '144 Hz')).toBe(false)
    expect(on('number', '120 nits')).toBe(false)
    expect(on('number', '1000 nits')).toBe(true)
  })
  it('bare number must be a whole token', () => {
    expect(on('number', '20', 'refresh 120 Hz')).toBe(false)
    expect(on('number', '120', 'refresh 120 Hz')).toBe(true)
    expect(on('number', '55.1', PAGE)).toBe(true)
    expect(on('number', '55', PAGE)).toBe(false)
  })
  it('prices: exact amount in any currency form', () => {
    expect(on('price', '$1,199', 'Price $1,299')).toBe(false)
    expect(on('price', '$1,299', 'Price $1,299')).toBe(true)
    expect(on('price', '$1,299', 'Price 1,299 USD')).toBe(true)
    expect(on('price', '1299 USD', 'Price $1,299.00')).toBe(true)
    expect(on('price', '$1,299', 'Price $1,299.99')).toBe(false)
    expect(on('price', '€1,299', 'Price $1,299')).toBe(false)
  })
  it('inch forms match each other', () => {
    expect(on('number', '65"', 'A 65-inch class TV')).toBe(true)
    expect(on('number', '65-inch', PAGE)).toBe(true)
    expect(on('number', '75"', PAGE)).toBe(false)
  })
  it('specs and model names: separators optional, versions exact', () => {
    expect(on('spec', 'Wi-Fi 6E', 'WiFi 6E built in')).toBe(true)
    expect(on('spec', 'HDMI 2.1', PAGE)).toBe(true)
    expect(on('spec', 'HDMI 2.1', 'HDMI 2.0 ports')).toBe(false)
    expect(on('spec', 'OLED', PAGE)).toBe(false) // the page says Neo QLED
    expect(on('model_name', 'RTX 4070', 'GeForce RTX4070 laptop')).toBe(true)
    expect(on('model_name', 'QN90D', PAGE)).toBe(true)
    expect(on('model_name', 'QN90', PAGE)).toBe(false)
  })
  it('quotes must appear verbatim (after normalization)', () => {
    expect(on('quote', 'the brightest picture we have tested this year', PAGE)).toBe(true)
    expect(on('quote', 'the brightest picture we have ever tested', PAGE)).toBe(false)
  })
  it('links: exact href, ignoring trailing slash and hash; http(s) only', () => {
    expect(on('link', 'https://shop.example.com/tv/qn90d')).toBe(true)
    expect(on('link', 'https://shop.example.com/tv/qn90d/#reviews')).toBe(true)
    expect(on('link', 'https://shop.example.com/tv/qn85d')).toBe(false)
    expect(on('link', 'https://evil.example.com/tv/qn90d')).toBe(false)
    expect(on('link', 'javascript:alert(1)', PAGE, [{ text: 'x', href: 'javascript:alert(1)' }])).toBe(false)
    expect(on('link', '/buy', PAGE, [{ text: 'Buy', href: '/buy/' }])).toBe(true)
    expect(on('link', '#specs', PAGE, [{ text: 'Specs', href: '#specs' }])).toBe(false)
  })
})

describe('runFidelityGate', () => {
  it('stage example: strips the 144 Hz sentence, keeps the 120 Hz one', () => {
    const out = gate([{ type: 'summary', text: 'Refresh rate is 120 Hz on this set. Gaming runs at 144 Hz on all four HDMI ports.' }])
    expect(out.blocks).toEqual([{ type: 'summary', text: 'Refresh rate is 120 Hz on this set.' }])
    expect(out.gate).toEqual({ checked: 3, stripped: [{ blockIndex: 0, blockType: 'summary', claim: '144 Hz', reason: 'not_on_page' }] })
  })

  it('strips a wrong price and keeps the right one', () => {
    const out = gate([
      { type: 'summary', text: 'On sale for $1,199 today.' },
      { type: 'summary', text: 'It costs $1,299.99 right now.' },
    ])
    expect(out.blocks).toEqual([{ type: 'summary', text: 'It costs $1,299.99 right now.' }])
    expect(out.gate.stripped).toEqual([{ blockIndex: 0, blockType: 'summary', claim: '$1,199', reason: 'not_on_page' }])
    expect(out.gate.checked).toBe(2)
  })

  it("allows and counts the user's budget in a for_you note", () => {
    const out = gate([{ type: 'for_you', text: 'At $1,299.99 it is over your $1,000 budget.', factIds: ['f1'] }], ['budget under $1,000 for a TV'])
    expect(out.blocks).toEqual([{ type: 'for_you', text: 'At $1,299.99 it is over your $1,000 budget.', factIds: ['f1'] }])
    expect(out.gate).toEqual({ checked: 2, stripped: [] })
  })

  it("does not let a user fact pass as a page fact outside for_you / warning", () => {
    const out = gate(
      [{ type: 'key_facts', rows: [{ label: 'Refresh rate', value: '144 Hz' }, { label: 'Price', value: '$1,299.99' }] }],
      ['wants 144 Hz for gaming'],
    )
    expect(out.blocks).toEqual([{ type: 'key_facts', rows: [{ label: 'Price', value: '$1,299.99' }] }])
    expect(out.gate.stripped.map((s) => s.claim)).toEqual(['144 Hz'])
  })

  it("allows the user's own quoted words when evidence quotes are passed as fact values", () => {
    const out = gate(
      [{ type: 'for_you', text: 'You asked “will it work with my PS5?” Yes: HDMI 2.1 on ports 3 and 4.', factIds: ['f2'] }],
      ['owns a PS5', 'will it work with my PS5?'],
    )
    expect(out.gate).toEqual({ checked: 3, stripped: [] })
    expect(out.blocks).toHaveLength(1)
  })

  it('drops a cta whose href is not on the page, keeps one whose href is', () => {
    const out = gate([
      { type: 'cta', label: 'Buy now', href: 'https://shop.example.com/tv/qn90d/' },
      { type: 'cta', label: 'Get a deal', href: 'https://deals.example.net/qn90d' },
    ])
    expect(out.blocks).toEqual([{ type: 'cta', label: 'Buy now', href: 'https://shop.example.com/tv/qn90d/' }])
    expect(out.gate).toEqual({
      checked: 2,
      stripped: [{ blockIndex: 1, blockType: 'cta', claim: 'https://deals.example.net/qn90d', reason: 'link_not_on_page' }],
    })
  })

  it('drops a cta whose label carries an unsupported claim', () => {
    const out = gate([{ type: 'cta', label: 'Buy for $999', href: 'https://shop.example.com/tv/qn90d' }])
    expect(out.blocks).toEqual([])
    expect(out.gate.stripped).toEqual([{ blockIndex: 0, blockType: 'cta', claim: '$999', reason: 'not_on_page' }])
  })

  it('matches 65" in a block against 65-inch on the page', () => {
    const out = runFidelityGate({ blocks: [{ type: 'summary', text: 'A 65" screen.' }], visibleText: 'Size: 65-inch class', links: [], userFactValues: [] })
    expect(out.gate).toEqual({ checked: 1, stripped: [] })
  })

  it('matches across thousands separators', () => {
    const out = gate([{ type: 'key_facts', rows: [{ label: 'Brightness', value: '1000 nits' }, { label: 'Was', value: '1499.99 USD' }] }])
    expect(out.gate).toEqual({ checked: 2, stripped: [] })
  })

  it('strips the sentence holding a quote the page never says', () => {
    const out = gate([
      { type: 'section', heading: 'Reviews', text: 'Critics agree. One called it "the best TV ever made" last week. Brightness is 1,000 nits.' },
    ])
    expect(out.blocks).toEqual([{ type: 'section', heading: 'Reviews', text: 'Critics agree. Brightness is 1,000 nits.' }])
    expect(out.gate.stripped).toEqual([{ blockIndex: 0, blockType: 'section', claim: 'the best TV ever made', reason: 'not_on_page' }])
  })

  it('leaves from_site untouched and uncounted', () => {
    const site: Block = { type: 'from_site', text: 'We offer 144 Hz for $9 and "the best deal in town".', siteUrl: 'https://www.coframe.com/' }
    const out = gate([site])
    expect(out.blocks).toEqual([site])
    expect(out.gate).toEqual({ checked: 0, stripped: [] })
  })

  it('drops a compare row with a wrong number and keeps the other rows', () => {
    const out = gate([
      {
        type: 'compare',
        columns: ['Spec', 'QN90D'],
        rows: [['Refresh', '120 Hz'], ['Brightness', '2,000 nits'], ['Price', '$1,299.99']],
      },
    ])
    expect(out.blocks).toEqual([{ type: 'compare', columns: ['Spec', 'QN90D'], rows: [['Refresh', '120 Hz'], ['Price', '$1,299.99']] }])
    expect(out.gate).toEqual({ checked: 4, stripped: [{ blockIndex: 0, blockType: 'compare', claim: '2,000 nits', reason: 'not_on_page' }] })
  })

  it('drops a compare table whose column names a model the page never mentions', () => {
    const out = gate([{ type: 'compare', columns: ['QN90D', 'S95D'], rows: [['120 Hz', '144 Hz']] }])
    expect(out.blocks).toEqual([])
    expect(out.gate.stripped.map((s) => s.claim)).toEqual(['S95D', '144 Hz'])
  })

  it('drops a step with an unsupported claim; drops the block when nothing is left', () => {
    const out = gate([
      { type: 'steps', items: ['Plug into HDMI 2.1 port 3.', 'Enable 144 Hz in settings.'] },
      { type: 'summary', text: 'Runs at 240 Hz.' },
      { type: 'section', heading: 'S95D comparison', text: 'Brighter.' },
    ])
    expect(out.blocks).toEqual([{ type: 'steps', items: ['Plug into HDMI 2.1 port 3.'] }])
    expect(out.gate.stripped.map((s) => [s.blockIndex, s.claim])).toEqual([[0, '144 Hz'], [1, '240 Hz'], [2, 'S95D']])
  })

  it('counts checked and stripped exactly, with ORIGINAL block indexes', () => {
    const out = gate(
      [
        { type: 'summary', text: 'The QN90D: 120 Hz, 4K, Neo QLED, $1,299.99.' }, // 5 claims, all on page
        { type: 'hidden', label: 'Marketing', reason: 'You skip promo copy.' }, // 0 claims
        { type: 'summary', text: 'Rated 4.8 by 2,300 owners.' }, // 2 claims, both stripped → block dropped
        { type: 'for_you', text: 'Fits your $1,000 budget? No. It works with your PS5.', factIds: ['f1', 'f2'] }, // 2, user facts
        { type: 'key_facts', rows: [{ label: 'HDMI', value: 'Four HDMI ports' }, { label: 'Weight', value: '60 lbs' }] }, // 2, one stripped
        { type: 'cta', label: 'See specs', href: 'https://shop.example.com/tv/qn90d#specs' }, // 1 link, ok
      ],
      ['budget $1,000', 'owns a PS5'],
    )
    expect(out.gate.checked).toBe(5 + 0 + 2 + 2 + 2 + 1)
    expect(out.gate.stripped).toEqual([
      { blockIndex: 2, blockType: 'summary', claim: '4.8', reason: 'not_on_page' },
      { blockIndex: 2, blockType: 'summary', claim: '2,300', reason: 'not_on_page' },
      { blockIndex: 4, blockType: 'key_facts', claim: '60 lbs', reason: 'not_on_page' },
    ])
    expect(out.blocks.map((b) => b.type)).toEqual(['summary', 'hidden', 'for_you', 'key_facts', 'cta'])
  })

  it('never mutates or aliases the input', () => {
    const blocks: Block[] = [
      { type: 'summary', text: 'Runs at 120 Hz. Or 144 Hz.' },
      { type: 'key_facts', rows: [{ label: 'Price', value: '$999' }, { label: 'Hz', value: '120 Hz' }] },
      { type: 'compare', columns: ['A', 'B'], rows: [['120 Hz', '1,000 nits']] },
      { type: 'cta', label: 'Buy', href: 'https://nope.example.com' },
    ]
    const before = structuredClone(blocks)
    const out = gate(blocks)
    expect(blocks).toEqual(before)
    const compare = out.blocks.find((b) => b.type === 'compare')
    expect(compare).toEqual(blocks[2])
    expect(compare).not.toBe(blocks[2])
    if (compare?.type === 'compare') compare.rows[0]![0] = 'changed'
    expect(blocks).toEqual(before)
  })

  it('drops blocks that fail the schema with reason invalid_block', () => {
    const out = gate([{ type: 'html', html: '<b>x</b>' } as unknown as Block, { type: 'summary', text: '120 Hz.' }])
    expect(out.blocks).toEqual([{ type: 'summary', text: '120 Hz.' }])
    expect(out.gate.stripped).toEqual([{ blockIndex: 0, blockType: 'summary', claim: 'invalid block (html)', reason: 'invalid_block' }])
  })

  it('checks numbers in the model output against the VISIBLE text, not its own source', () => {
    const out = runFidelityGate({ blocks: [{ type: 'summary', text: 'Setup takes 15 minutes.' }], visibleText: 'Setup is quick.', links: [], userFactValues: [] })
    expect(out.blocks).toEqual([])
  })

  // Documented limits (README.md "What it does NOT catch"). These pin the gate's honest scope.
  it('does NOT catch a false relation between true tokens', () => {
    const out = gate([{ type: 'summary', text: '120 Hz on all four HDMI ports.' }])
    expect(out.gate).toEqual({ checked: 2, stripped: [] })
  })
  it('treats guillemet quotes as quotes; a unit outside the table still checks the number', () => {
    expect(extractClaims({ type: 'summary', text: 'Обзор: «самый яркий экран года» и 120 Гц.' }).map((c) => `${c.kind}:${c.text}`)).toEqual([
      'quote:самый яркий экран года',
      'number:120',
    ])
  })
  it('is strict on synonyms and rounding: stripped, not missed', () => {
    const out = runFidelityGate({
      blocks: [{ type: 'summary', text: 'Great with a PS5. About $1,300.' }],
      visibleText: 'Works with PlayStation 5. Price $1,299.99.',
      links: [],
      userFactValues: [],
    })
    expect(out.blocks).toEqual([])
    expect(out.gate.stripped.map((s) => s.claim)).toEqual(['PS5', '$1,300'])
  })
  it('does NOT check single-digit counts or number words', () => {
    expect(extractClaims({ type: 'summary', text: 'Six HDMI ports, 6 speakers.' }).map((c) => c.text)).toEqual(['HDMI'])
  })
})

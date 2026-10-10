import { describe, expect, it } from 'vitest'
import type { SiteShare } from '@/types'
import { LINK_REMOVED, fromSiteLabel, toFromSiteBlock } from './block'

const share = (response: string): SiteShare => ({
  url: 'https://www.coframe.com/',
  needsText: 'The visitor is a CTO.',
  factIds: ['f1'],
  response,
  at: '2026-10-10T20:00:00.000Z',
})

describe('toFromSiteBlock', () => {
  it('removes a link that is not on the page and keeps an allowed one, verbatim otherwise', () => {
    const links = [{ text: 'Book a demo', href: 'https://start.coframe.com/demo/' }]
    const block = toFromSiteBlock(
      share('Start with a 2-week test. Book: https://start.coframe.com/demo. Or see https://evil.example/x?y=1 now.'),
      links,
    )
    expect(block).toEqual({
      type: 'from_site',
      text: `Start with a 2-week test. Book: https://start.coframe.com/demo. Or see ${LINK_REMOVED} now.`,
      siteUrl: 'https://www.coframe.com/',
    })
  })

  it('resolves relative page links and ignores #fragments', () => {
    const block = toFromSiteBlock(share('See https://www.coframe.com/pricing#plans'), [{ text: 'Pricing', href: '/pricing' }])
    expect(block.type === 'from_site' && block.text).toBe('See https://www.coframe.com/pricing#plans')
  })

  it('labels the block as the site’s own words', () => {
    expect(fromSiteLabel('https://www.coframe.com/')).toBe("From coframe.com · the site's own words")
  })
})

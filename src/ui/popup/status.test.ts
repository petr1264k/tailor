import { describe, expect, it } from 'vitest'
import { describeStatus } from './status'

describe('describeStatus', () => {
  it('shows the mode and the gate counts', () => {
    expect(describeStatus({ url: 'u', mode: 'original', hasAgentHooks: false })).toBe('Showing the original')
    expect(describeStatus({ url: 'u', mode: 'loading', hasAgentHooks: false })).toBe('Tailoring…')
    expect(
      describeStatus({
        url: 'u',
        mode: 'tailored',
        hasAgentHooks: true,
        gate: { checked: 14, stripped: [{ blockIndex: 2, blockType: 'key_facts', claim: '120 Hz on all four HDMI ports', reason: 'not_on_page' }] },
      }),
    ).toBe('Tailored · gate checked 14 claims, stripped 1')
  })
})

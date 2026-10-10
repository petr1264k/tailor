/** Popup status line (pure, tested). Gate counts come from the content script's ContentStatus (§3.6). */
import type { ContentStatus } from '@/messages'

export function describeStatus(status: ContentStatus): string {
  const mode = status.mode === 'loading' ? 'Tailoring…' : status.mode === 'tailored' ? 'Tailored' : 'Showing the original'
  const gate = status.gate
    ? ` · gate checked ${status.gate.checked} ${status.gate.checked === 1 ? 'claim' : 'claims'}, stripped ${status.gate.stripped.length}`
    : ''
  return mode + gate
}

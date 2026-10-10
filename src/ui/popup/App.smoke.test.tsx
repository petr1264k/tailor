/** Popup smoke test: renders without `chrome` (jsdom) and shows the "not running" line instead of crashing. */
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { App } from './App'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('renders the popup and degrades without a content script', async () => {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  await act(async () => root.render(<App />))
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 0)))
  expect(el.textContent).toContain('Tailor this page')
  expect(el.textContent).toContain('Tailor pages automatically as they load')
  expect(el.textContent).toContain('Demo mode: play the changes top to bottom')
  expect(el.querySelector('.error')?.textContent).toContain('Tailor is not on this tab')
  await act(async () => root.unmount())
})

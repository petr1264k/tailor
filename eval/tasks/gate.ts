/**
 * §8.4 Invented facts shown to users: 0, plus how many unsupported claims the gate caught and stripped.
 * Aggregates over every cached TailoredPage (eval/out/tailored/), then RE-RUNS runFidelityGate on the final,
 * already-gated blocks against the saved page. Any new strip is a claim that reached the user unsupported.
 */
import type { Fact } from '@/types'
import { runFidelityGate } from '@/gate'
import { selectRelevantFacts, userFactValues } from '@/tailor'
import {
  blockedReason,
  listTailored,
  loadEvalProfiles,
  loadPageContents,
  mdTable,
  type TaskArgs,
  type TaskReport,
} from '../lib/common'

export const GATE_SCOPE =
  'What this proves: every claim the gate can recognize (numbers, prices, specs, model names, quoted text, links) in the ' +
  'blocks that were shown appears on the visible page, i.e. nothing slipped past the gate. What it does NOT prove: it re-uses ' +
  "the same code, so a claim the gate's extractor cannot see would be missed in both runs; a statement stitched from words that " +
  'are each on the page ("120 Hz on all four HDMI ports" when the page says "120 Hz" and "four HDMI ports" separately) can pass; ' +
  'reworded claims without a number, spec or name are not checked; and the check is against the saved copy, not the live page. ' +
  'An independent check is a human reading each key_facts row against the page.'

export async function run(args: TaskArgs): Promise<TaskReport> {
  void args
  const { pages, contents, notes } = await loadPageContents()
  const cached = await listTailored(pages)
  const profiles = new Map((await loadEvalProfiles()).map((p) => [p.id, p]))

  const rows: (string | number)[][] = []
  const strippedExamples: string[] = []
  const newStripExamples: string[] = []
  let checked = 0
  let stripped = 0
  let recheckedPages = 0
  let newStrips = 0
  for (const { profileId, page, tailored } of cached) {
    checked += tailored.gate.checked
    stripped += tailored.gate.stripped.length
    for (const s of tailored.gate.stripped) strippedExamples.push(`${profileId} × ${page.id} [${s.blockType}, ${s.reason}]: ${s.claim}`)
    const content = contents.get(page.id)
    let recheck = 'no saved page'
    if (content) {
      try {
        // Same user facts tailorPage passed (selectRelevantFacts is deterministic code). Without the profile: none,
        // which is stricter (the person's own budget would then count as a new strip).
        const profile = profiles.get(profileId)
        const facts: Fact[] = profile ? await selectRelevantFacts(profile.profile, content) : []
        const again = runFidelityGate({
          blocks: tailored.blocks,
          visibleText: content.visibleText,
          links: content.links,
          userFactValues: userFactValues(facts),
        })
        recheckedPages++
        newStrips += again.gate.stripped.length
        for (const s of again.gate.stripped) newStripExamples.push(`${profileId} × ${page.id} [${s.blockType}]: ${s.claim}`)
        recheck = `${again.gate.checked} checked, ${again.gate.stripped.length} new strips${profile ? '' : ' (no profile: strict)'}`
      } catch (err) {
        recheck = blockedReason(err)
      }
    }
    rows.push([profileId, page.id, tailored.blocks.length, tailored.gate.checked, tailored.gate.stripped.length, recheck])
  }

  const shown = recheckedPages ? String(newStrips) : 'n/a'
  const md = [
    '# Fidelity gate (CONTEXT.txt §8.4)',
    '',
    `N = ${cached.length} cached tailored pages (eval/out/tailored/); ${recheckedPages} re-checked against the saved page.`,
    '',
    `**Checked ${checked} claims, stripped ${stripped}, invented facts shown: ${shown}** (new strips when the final blocks are gated again).`,
    '',
    mdTable(['Person', 'Page', 'Blocks', 'Checked', 'Stripped', 'Re-gate of what was shown'], rows),
    '',
    `Write-up (§13): "across ${cached.length} tailored pages it caught ${stripped} unsupported claims and showed ${shown}."`,
    '',
    '## What the stripped claims were (model output the page never says)',
    '',
    ...(strippedExamples.length ? strippedExamples.slice(0, 30).map((s) => `- ${s}`) : ['- none']),
    ...(newStripExamples.length ? ['', '## NEW strips on re-check (these reached the user)', '', ...newStripExamples.map((s) => `- ${s}`)] : []),
    '',
    '## Scope',
    '',
    GATE_SCOPE,
    ...(cached.length === 0 ? ['', 'No cached pages yet: run `npm run eval -- first-screen` (live) or `npm run eval -- speed` first.'] : []),
    ...(notes.length ? ['', '## Notes', '', ...notes.map((n) => `- ${n}`)] : []),
  ].join('\n')
  return {
    json: { pages: cached.length, rechecked: recheckedPages, checked, stripped, newStrips, rows, strippedExamples, newStripExamples, scope: GATE_SCOPE, notes },
    md,
  }
}

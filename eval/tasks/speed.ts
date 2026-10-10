/**
 * §8.5 Speed: time to tailored content, and words before vs after. Live only (it times the model call).
 * tailorPage is NOT streaming, so the number is ms until ALL blocks are ready (select → rewrite → gate → cache),
 * from Node over the event Wi-Fi. That is an upper bound on time to FIRST tailored content in the extension;
 * pre-tailor on load hides it entirely. Each run also refreshes eval/out/tailored/ for the other tasks.
 */
import { blockToPlainText } from '@/render'
import { argString, loadEvalProfiles, loadPageContents, mdTable, requireApiKey, type TaskArgs, type TaskReport } from '../lib/common'
import { countWords, median } from '../lib/stats'
import { getTailored } from './first-screen'

export async function run(args: TaskArgs): Promise<TaskReport> {
  await requireApiKey()
  const lang = argString(args, 'lang')
  const { pages, contents, notes } = await loadPageContents()
  const profiles = await loadEvalProfiles(argString(args, 'profile'))
  if (profiles.length === 0) throw new Error('no profiles in data/profiles/: run `npm run eval -- profile --id <name>` first')

  const rows: (string | number)[][] = []
  const runs: { profileId: string; pageId: string; ms: number; before: number; after: number; blocks: number }[] = []
  for (const profile of profiles) {
    for (const page of pages) {
      const content = contents.get(page.id)
      if (!content) continue
      const { tailored, ms, note } = await getTailored(profile, page.id, content, { offline: false, lang })
      if (!tailored || ms === undefined) {
        rows.push([profile.id, page.id, '-', '-', '-', note ?? 'failed'])
        console.log(`${profile.id} × ${page.id}: ${note}`)
        continue
      }
      const before = countWords(content.visibleText)
      const after = countWords(tailored.blocks.map(blockToPlainText).join('\n'))
      runs.push({ profileId: profile.id, pageId: page.id, ms, before, after, blocks: tailored.blocks.length })
      rows.push([profile.id, page.id, `${(ms / 1000).toFixed(1)} s`, before, after, `${tailored.blocks.length} blocks`])
      console.log(`${profile.id} × ${page.id}: ${(ms / 1000).toFixed(1)} s`)
    }
  }

  const msList = runs.map((r) => r.ms)
  const wordsBefore = median(runs.map((r) => r.before))
  const wordsAfter = median(runs.map((r) => r.after))
  const sec = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : 'n/a')
  const md = [
    '# Speed (CONTEXT.txt §8.5)',
    '',
    `N = ${runs.length} tailorPage runs (${profiles.length} people × pages with a saved copy).`,
    '',
    `**Time to tailored blocks: median ${sec(median(msList))}, max ${sec(msList.length ? Math.max(...msList) : NaN)}.** ` +
      `Words on the page: median ${wordsBefore} before (visible text) → ${wordsAfter} after (tailored blocks).`,
    '',
    mdTable(['Person', 'Page', 'Time', 'Words before', 'Words after', 'Note'], rows),
    '',
    'Method: tailorPage is non-streaming, so this is ms until every block is ready (relevance → rewrite → gate → cache), ' +
      'measured from Node over the event Wi-Fi, one run each. With pre-tailor on load the user sees the cached result instantly.',
    ...(notes.length ? ['', '## Notes', '', ...notes.map((n) => `- ${n}`)] : []),
  ].join('\n')
  return { json: { runs, medianMs: median(msList), medianWordsBefore: wordsBefore, medianWordsAfter: wordsAfter, notes }, md }
}

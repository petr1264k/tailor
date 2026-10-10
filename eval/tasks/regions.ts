/**
 * The page map per saved demo page (src/sites): which site profile applied, the regions with their roles, and the cards
 * with their prices. Offline, code only. Use it before the demo to check that a site profile still matches the live
 * site (anker.com: hero / categories / products with 29 priced cards / membership / reviews).
 */
import { regionPromptLines } from '@/sites'
import { blockedReason, loadPageContents, mdTable, type TaskArgs, type TaskReport } from '../lib/common'

export async function run(args: TaskArgs): Promise<TaskReport> {
  void args
  const { pages, contents, notes } = await loadPageContents()
  const rows: (string | number)[][] = []
  const maps: string[] = []
  const json: Record<string, unknown> = {}
  for (const page of pages) {
    const content = contents.get(page.id)
    if (!content) continue
    try {
      const regions = content.regions ?? []
      const items = regions.reduce((n, r) => n + (r.items?.length ?? 0), 0)
      const priced = regions.reduce((n, r) => n + (r.items?.filter((i) => i.price).length ?? 0), 0)
      const roles = [...new Set(regions.map((r) => r.role))].join(', ')
      rows.push([page.id, content.site ? `${content.site.name} (${content.site.kind})` : 'generic', regions.length, items, priced, content.segments.length, roles])
      maps.push(`### ${page.id}\n\n` + regionPromptLines(regions).map((l) => `- ${l.length > 400 ? l.slice(0, 400) + '…' : l}`).join('\n'))
      json[page.id] = { site: content.site ?? null, regions }
    } catch (err) {
      notes.push(`page "${page.id}": ${blockedReason(err)}`)
    }
  }
  const md = [
    '# Page maps (src/sites)',
    '',
    'Regions and cards found by code from each saved page, with the site profile that applied. N = pages with a saved copy: ' + rows.length + '.',
    '',
    mdTable(['page', 'site profile', 'regions', 'cards', 'cards with a price', 'segments', 'roles'], rows),
    '',
    ...maps,
    '',
    ...(notes.length ? ['Notes:', ...notes.map((n) => `- ${n}`)] : []),
  ].join('\n')
  return { json: { pages: json, notes }, md }
}

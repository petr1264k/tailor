/**
 * Sharing scrub (CONTEXT.txt §4 step 2). Owner: Mikhail.
 *
 * Runs on the needs string before it is shown on the consent sheet and sent to a site: never other people's names,
 * emails or phone numbers. Nothing here touches extraction: the profile keeps every fact the model proposed and
 * code verified.
 */

export type ScrubbedCategory = 'names' | 'contact'

export const SCRUBBED_CATEGORIES: readonly ScrubbedCategory[] = ['names', 'contact']

// Non-global regexes; scrubForSharing builds global copies for replace().

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/
/** US (415) 555-1234 / 415.555.1234 / +1 415 555 1234, and +7 999 123 45 67 style. */
const PHONE_RE = /(?<![\w.+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-]?)\d{3}[\s.-]?\d{2}[\s.-]?\d{2}(?!\w)/

const RELATIONS =
  'wife|husband|partner|spouse|boss|manager|best friend|friend|son|daughter|kid|child|mom|mum|mother|dad|father|brother|sister|sibling|girlfriend|boyfriend|fianc[eé]e?|colleague|coworker|co-worker|cofounder|co-founder|roommate|neighbou?r|cousin|aunt|uncle|grandma|grandpa|grandmother|grandfather|niece|nephew|teacher|doctor|therapist'
/** "my wife Anna", "my boss, Dmitry", "my son is called Max". Group 1 = "my wife", group 2 = the name. */
const RELATION_NAME_RE = new RegExp(
  `\\b([Mm]y\\s+(?:${RELATIONS}))(?:'s)?,?\\s+(?:(?:is\\s+)?(?:named|called)\\s+|is\\s+)?([A-Z][a-z]+)\\b`,
)

/** For needs strings (§4): strip names, emails, phone numbers. Returns what was removed so the consent sheet can say so. */
export function scrubForSharing(text: string): { text: string; removed: ScrubbedCategory[] } {
  const removed = new Set<ScrubbedCategory>()
  const global = (re: RegExp) => new RegExp(re.source, re.flags + 'g')
  let out = text
    .replace(global(EMAIL_RE), () => (removed.add('contact'), ''))
    .replace(global(PHONE_RE), () => (removed.add('contact'), ''))
    // "my wife Anna" → "my wife": keep the relation, drop the name
    .replace(global(RELATION_NAME_RE), (_m: string, relation: string) => (removed.add('names'), relation))
  if (removed.size === 0) return { text, removed: [] }
  out = out
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=[,.;:!?])/g, '')
    .trim()
  return { text: out, removed: SCRUBBED_CATEGORIES.filter((c) => removed.has(c)) }
}

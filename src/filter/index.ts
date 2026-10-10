/**
 * Sensitive filter (CONTEXT.txt §3.3). Owner: Mikhail.
 *
 * Never extract: health, religion, politics, sexuality, exact location, detailed finances, other people's names.
 * Enforced by code rules first, then a classifier as a second line. The UI shows a "never extracted" list with counts.
 * Also used on needs strings before sharing (§4): never names, emails or phone numbers.
 */
import type { Fact } from '@/types'
import { todo } from '@/todo'

export type SensitiveCategory =
  | 'health'
  | 'religion'
  | 'politics'
  | 'sexuality'
  | 'location'
  | 'finances'
  | 'names'
  | 'contact'

export const SENSITIVE_CATEGORIES: readonly SensitiveCategory[] = [
  'health',
  'religion',
  'politics',
  'sexuality',
  'location',
  'finances',
  'names',
  'contact',
]

export interface FilterResult {
  kept: Fact[]
  removed: { fact: Fact; category: SensitiveCategory; by: 'rule' | 'classifier' }[]
  /** For the "never extracted" list in the profile viewer. */
  counts: Record<SensitiveCategory, number>
}

export function emptyCounts(): Record<SensitiveCategory, number> {
  return { health: 0, religion: 0, politics: 0, sexuality: 0, location: 0, finances: 0, names: 0, contact: 0 }
}

/** Code rules: keyword lists + regexes (emails, phones, street addresses, dollar amounts with account context, ...). */
export function ruleCheck(text: string): SensitiveCategory | null {
  void text
  return todo('filter.ruleCheck')
}

/** Second line: Haiku classifies the survivors in one call (SensitiveVerdictSchema). */
export async function classifyFacts(facts: Fact[]): Promise<Map<string, SensitiveCategory>> {
  void facts
  return todo('filter.classifyFacts')
}

export async function filterSensitive(facts: Fact[]): Promise<FilterResult> {
  void facts
  return todo('filter.filterSensitive', 'rules first, then classifier; count both')
}

/** For needs strings (§4): strip names, emails, phone numbers. Returns what was removed so the consent sheet can say so. */
export function scrubForSharing(text: string): { text: string; removed: SensitiveCategory[] } {
  void text
  return todo('filter.scrubForSharing')
}

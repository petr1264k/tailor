/**
 * Learn (CONTEXT.txt §3.8). Owner: Mikhail.
 *
 * Log interactions: expand, collapse, toggle back to the original, open "why", ignore a note, dwell time.
 * Signals update the profile as behavior facts (source 'behavior'), each with evidence (page url, title, date, what happened).
 * Each layout choice (specs first, marketing collapsed, ...) is a small per-person bandit with a Beta prior.
 * Seed it with a WEAK prior from the chats and let clicks override it quickly.
 * Stage line: "Your chats are the prior, your clicks are the evidence."
 */
import type { Fact, Interaction, Profile } from '@/types'
import type { HandlerMap } from '@/messages'
import { todo } from '@/todo'

export type LayoutChoice = 'specs_first' | 'marketing_collapsed' | 'steps_expanded' | 'compare_table' | 'summary_only'

export interface BetaPrior {
  alpha: number
  beta: number
}

/** Weak prior: a chat fact with confidence c starts at roughly alpha = 1 + c, beta = 1. */
export function seedPriorFromChats(fact: Fact): BetaPrior {
  void fact
  return todo('learn.seedPriorFromChats')
}

export function updatePrior(prior: BetaPrior, reward: boolean): BetaPrior {
  return reward ? { alpha: prior.alpha + 1, beta: prior.beta } : { alpha: prior.alpha, beta: prior.beta + 1 }
}

/** Thompson sampling over the layout facts in the profile. Deterministic when `rng` is given (tests, evals). */
export function sampleLayout(profile: Profile, rng: () => number = Math.random): LayoutChoice[] {
  void profile
  void rng
  return todo('learn.sampleLayout')
}

/** Append to the archive's `interactions` store. */
export async function logInteraction(interaction: Interaction): Promise<void> {
  void interaction
  return todo('learn.logInteraction')
}

/** Turn one interaction into prior updates and behavior facts. Returns the facts that changed, for the on-screen update in the demo. */
export async function applyInteraction(profile: Profile, interaction: Interaction): Promise<{ profile: Profile; changed: Fact[] }> {
  void profile
  void interaction
  return todo('learn.applyInteraction')
}

export const handlers: HandlerMap = {
  'learn/log': async (msg) => {
    void msg
    return todo('learn.handlers[learn/log]', 'logInteraction → applyInteraction → profile.saveProfile → {profileVersion, changed}')
  },
}

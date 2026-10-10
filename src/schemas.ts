/**
 * zod schemas for everything a model returns. "The model proposes, code decides."
 * Every model reply is parsed with one of these before any other code touches it.
 * The Block schema must stay in lockstep with the FROZEN `Block` type in types.ts;
 * the type-level assertion at the bottom fails the build if they drift.
 */
import { z } from 'zod'
import type { Block, FactCategory } from './types'
import { FACT_CATEGORIES } from './types'

export const FactCategorySchema = z.enum(FACT_CATEGORIES as [FactCategory, ...FactCategory[]])

export const BlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('summary'), text: z.string() }),
  z.object({ type: z.literal('for_you'), text: z.string(), factIds: z.array(z.string()) }),
  z.object({
    type: z.literal('key_facts'),
    rows: z.array(z.object({ label: z.string(), value: z.string() })),
  }),
  z.object({ type: z.literal('compare'), columns: z.array(z.string()), rows: z.array(z.array(z.string())) }),
  z.object({ type: z.literal('steps'), items: z.array(z.string()) }),
  z.object({ type: z.literal('warning'), text: z.string(), factIds: z.array(z.string()) }),
  z.object({ type: z.literal('section'), heading: z.string(), text: z.string() }),
  z.object({ type: z.literal('hidden'), label: z.string(), reason: z.string() }),
  z.object({ type: z.literal('cta'), label: z.string(), href: z.string() }),
  z.object({ type: z.literal('from_site'), text: z.string(), siteUrl: z.string() }),
])

/** What the rewrite model must return (§3.5). */
export const RewriteOutputSchema = z.object({
  blocks: z.array(BlockSchema).min(1).max(40),
})
export type RewriteOutput = z.infer<typeof RewriteOutputSchema>

/** What the Haiku "map" step proposes per chunk (§3.2). Code assigns ids, dates and origins; the model never does. */
export const CandidateFactSchema = z.object({
  category: FactCategorySchema,
  value: z.string().min(3).max(200),
  /** Verbatim quote from one of the user's own messages in the chunk. Code verifies it appears there. */
  quote: z.string().min(3).max(300),
  /** The message id the quote came from (ids are given in the prompt). */
  messageId: z.string(),
})
export const CandidateFactsOutputSchema = z.object({ facts: z.array(CandidateFactSchema).max(60) })
export type CandidateFact = z.infer<typeof CandidateFactSchema>

/** What the Sonnet "reduce" step returns (§3.2): merged facts that point back at candidate indices. */
export const MergedFactSchema = z.object({
  category: FactCategorySchema,
  value: z.string().min(3).max(200),
  /** Indices into the candidate list given in the prompt. Code rebuilds evidence from these. */
  candidateIndices: z.array(z.number().int().nonnegative()).min(1),
  /** 0..1, the model's score for frequency + recency. Code may rescale. */
  confidence: z.number().min(0).max(1),
})
export const MergedFactsOutputSchema = z.object({ facts: z.array(MergedFactSchema).max(120) })
export type MergedFact = z.infer<typeof MergedFactSchema>

/** Relevance selection (§3.5): which profile facts matter for this page. */
export const RelevantFactIdsSchema = z.object({ factIds: z.array(z.string()).max(12) })

/** Needs text for a site (§4). Code runs the sensitive filter on it afterwards regardless. */
export const NeedsTextSchema = z.object({ needs: z.string().min(1).max(2000), constraints: z.string().max(1000).optional() })

/** The "never extracted" categories (§3.3). Defined here, not in '@/filter', because filter imports this file. */
export const SENSITIVE_CATEGORY_VALUES = [
  'health',
  'religion',
  'politics',
  'sexuality',
  'location',
  'finances',
  'names',
  'contact',
] as const

/** Sensitive classifier (§3.3). A second line of defense after the code rules. */
export const SensitiveVerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      sensitive: z.boolean(),
      // An unknown category degrades to undefined (code then maps `reason`) instead of failing the whole reply,
      // which would turn off the classifier for every fact in the call.
      category: z.enum(SENSITIVE_CATEGORY_VALUES).optional().catch(undefined),
      reason: z.string().max(80).optional(),
    }),
  ),
})

// ── Type-level lock between BlockSchema and the frozen Block type ──
type SchemaBlock = z.infer<typeof BlockSchema>
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _blockSchemaMatchesFrozenType: MutuallyAssignable<SchemaBlock, Block> = true
void _blockSchemaMatchesFrozenType

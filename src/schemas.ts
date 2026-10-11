/**
 * zod schemas for everything a model returns. "The model proposes, code decides."
 * Every model reply is parsed with one of these before any other code touches it.
 * The Block schema must stay in lockstep with the FROZEN `Block` type in types.ts;
 * the type-level assertion at the bottom fails the build if they drift.
 */
import { z } from 'zod'
import type { Block, FactCategory, OmittedItem, PageEdit, Profile } from './types'
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

/** In-place edits keyed to PageSegment ids (types.ts PageEdit). The type-level lock at the bottom keeps them in sync. */
export const PageEditSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rewrite'), id: z.string(), text: z.string(), factIds: z.array(z.string()).optional() }),
  z.object({ op: z.literal('hide'), ids: z.array(z.string()), label: z.string(), reason: z.string() }),
  z.object({ op: z.literal('note'), after: z.string(), text: z.string(), factIds: z.array(z.string()) }),
  z.object({ op: z.literal('warn'), after: z.string(), text: z.string(), factIds: z.array(z.string()) }),
  z.object({ op: z.literal('promote'), id: z.string(), reason: z.string(), factIds: z.array(z.string()) }),
  z.object({ op: z.literal('badge'), id: z.string(), label: z.string(), factIds: z.array(z.string()) }),
])

/** What the in-place edit model must return (§3.5, §3.7). An empty list is valid: the page is already right for this person. */
export const EditOutputSchema = z.object({
  edits: z.array(PageEditSchema).max(80),
})
export type EditOutput = z.infer<typeof EditOutputSchema>

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

/** Needs text for a site (§4). Code scrubs names, emails and phone numbers from it afterwards regardless (scrubForSharing). */
export const NeedsTextSchema = z.object({ needs: z.string().min(1).max(2000), constraints: z.string().max(1000).optional() })

/**
 * A saved profile file the owner drops on the Import tab (e.g. profiles/processed/mik/claude.profile.json): a §6 Profile.
 * Not model output, but it comes from outside the extension, so code checks it the same way before it is stored.
 */
const EvidenceSchema = z.object({ origin: z.string(), title: z.string(), date: z.string(), quote: z.string() })
const FactSchema = z.object({
  id: z.string().min(1),
  category: FactCategorySchema,
  value: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source: z.enum(['chat', 'behavior']),
  evidence: z.array(EvidenceSchema),
  userStatus: z.enum(['kept', 'deleted', 'edited']).optional(),
  prior: z.object({ alpha: z.number().positive(), beta: z.number().positive() }).optional(),
})
const SiteShareSchema = z.object({
  url: z.string(),
  needsText: z.string(),
  factIds: z.array(z.string()),
  response: z.string(),
  at: z.string(),
})
export const ProfileFileSchema = z.object({
  version: z.number().int().nonnegative(),
  facts: z
    .array(FactSchema)
    .refine((facts) => new Set(facts.map((f) => f.id)).size === facts.length, 'fact ids must be unique'),
  shares: z.array(SiteShareSchema),
  stats: z.object({ conversations: z.number(), messages: z.number(), from: z.string(), to: z.string() }),
})

/** Optional "Left out on purpose" list a profile file may carry next to the profile (types.ts OmittedItem). */
export const OmittedListSchema = z
  .array(z.object({ category: z.string().min(1), count: z.number().int().nonnegative(), kinds: z.string() }))
  .max(50)

// ── Type-level lock between BlockSchema and the frozen Block type ──
type SchemaBlock = z.infer<typeof BlockSchema>
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const _blockSchemaMatchesFrozenType: MutuallyAssignable<SchemaBlock, Block> = true
void _blockSchemaMatchesFrozenType
type SchemaEdit = z.infer<typeof PageEditSchema>
const _editSchemaMatchesType: MutuallyAssignable<SchemaEdit, PageEdit> = true
void _editSchemaMatchesType
type SchemaProfile = z.infer<typeof ProfileFileSchema>
const _profileSchemaMatchesFrozenType: MutuallyAssignable<SchemaProfile, Profile> = true
void _profileSchemaMatchesFrozenType
const _omittedSchemaMatchesType: MutuallyAssignable<z.infer<typeof OmittedListSchema>, OmittedItem[]> = true
void _omittedSchemaMatchesType

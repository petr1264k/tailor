/** Marks scaffolding that is not built yet. Grep for `todo(` to find every open piece. */
export function todo(where: string, hint?: string): never {
  throw new Error(`TODO(${where})${hint ? `: ${hint}` : ''} — see CONTEXT.txt`)
}

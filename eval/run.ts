/**
 * Measurement harness (CONTEXT.txt §8). Owner: Mikhail. Node, run with `npm run eval`.
 * Every number is measured on the day and N is stated out loud.
 *
 *  1. first-screen   Questions answered on the first screen, original vs tailored (the main number).
 *                    5 questions per person and page from their mined questions; answers must be text copied
 *                    exactly from the page; profile from older chats, questions from newer ones (held out).
 *  2. precision      Each owner marks every extracted fact right or wrong.
 *  3. blind          Order-swapped pairs. Humans: alternate sides, report picks by side. LLM judges: both orders,
 *                    count only consistent verdicts, chance 25%. 10 trials: need 9/10 at 50%, 6/10 at 25% (p < .05).
 *                    Hold language constant.
 *  4. gate           Invented facts shown: 0. Plus claims the gate stripped.
 *  5. speed          Time to first tailored content; words before vs after.
 *  6. learning       How the profile changed after N interactions, and how the next page differed.
 */
const task = process.argv[2] ?? 'help'

const TASKS: Record<string, () => Promise<void>> = {
  async help() {
    console.log('npm run eval -- <first-screen|precision|blind|gate|speed|learning>')
    console.log('Results are written to eval/out/ (gitignored). Fill the write-up (CONTEXT.txt §13) from them at 18:30.')
  },
}

const run = TASKS[task]
if (!run) {
  console.error(`Unknown eval task: ${task}`)
  process.exit(1)
}
await run()

export {}

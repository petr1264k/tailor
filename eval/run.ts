/**
 * Measurement harness (CONTEXT.txt §8). Owner: Mikhail. Node, run with `npm run eval -- <task> [flags]`.
 * Every number is measured on the day and N is stated next to it. Results: eval/out/<task>-<iso>.{json,md} (gitignored).
 *
 *  profile       Build a held-out profile: facts from chats BEFORE a cutoff, questions from chats after (§8.1).
 *  1. first-screen   Questions answered on the first screen, original vs tailored (the main number).
 *  2. precision      Each owner marks every extracted fact right or wrong (CSV), then --score it.
 *  3. blind          Order-swapped pairs. LLM judges in both orders, consistent verdicts only (chance 25%);
 *                    human protocol (alternate sides, report by side). 10 trials: 9/10 at 50%, 6/10 at 25% (p < .05).
 *  4. gate           Invented facts shown: 0 (re-gate what was shown). Plus claims the gate stripped.
 *  5. speed          Time to tailored blocks (non-streaming); words before vs after.
 *  6. learning       How the profile changed after N interactions, and how the next page differed.
 *
 * Modules may still throw TODO: every task prints 'BLOCKED: <module>' instead of crashing.
 */
import 'fake-indexeddb/auto' // no Chrome here: IndexedDB for tailorPage's cache and anything else that opens the DB
import { parseArgs } from 'node:util'
import type { TaskArgs, TaskReport } from './lib/common'
import { blockedReason, writeReport } from './lib/common'

type TaskModule = { run: (args: TaskArgs) => Promise<TaskReport | null> }

// Lazy imports: a module that fails to load blocks only the tasks that need it.
const TASKS: Record<string, { load: () => Promise<TaskModule>; usage: string }> = {
  profile: {
    load: () => import('./tasks/profile'),
    usage: 'profile --id <name> [--chats a.json,b.json] [--cutoff YYYY-MM-DD]   (default chats: data/<name>/*.json)',
  },
  'first-screen': {
    load: () => import('./tasks/first-screen'),
    usage: 'first-screen [--offline] [--profile <id>] [--lang en]',
  },
  precision: { load: () => import('./tasks/precision'), usage: 'precision [--profile <id>]  |  precision --score <csv>' },
  blind: { load: () => import('./tasks/blind'), usage: 'blind [--profile <id>]   (uses cached tailored pages)' },
  gate: { load: () => import('./tasks/gate'), usage: 'gate   (uses cached tailored pages)' },
  speed: { load: () => import('./tasks/speed'), usage: 'speed [--profile <id>] [--lang en]   (live only)' },
  learning: { load: () => import('./tasks/learning'), usage: 'learning [--profile <id>]' },
  regions: { load: () => import('./tasks/regions'), usage: 'regions   (offline: the page map per saved page, from src/sites)' },
}

function help(): void {
  console.log('npm run eval -- <task> [flags]\n')
  for (const t of Object.values(TASKS)) console.log(`  ${t.usage}`)
  console.log('\nOutputs: eval/out/ (gitignored). Fill the write-up (CONTEXT.txt §13) from them at 18:30. Say N out loud.')
}

const task = process.argv[2] ?? 'help'
const entry = TASKS[task]
if (!entry) {
  if (task !== 'help' && task !== '--help') console.error(`Unknown eval task: ${task}\n`)
  help()
  process.exitCode = task === 'help' || task === '--help' ? 0 : 1
} else {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(3),
    strict: false,
    allowPositionals: true,
    options: {
      offline: { type: 'boolean' },
      profile: { type: 'string' },
      id: { type: 'string' },
      chats: { type: 'string' },
      cutoff: { type: 'string' },
      score: { type: 'string' },
      lang: { type: 'string' },
    },
  })
  try {
    const mod = await entry.load()
    const report = await mod.run({ values, positionals })
    if (report) {
      console.log(`\n${report.md}`)
      const paths = await writeReport(task, report)
      console.log(`\nWrote ${paths.md}\n      ${paths.json}`)
    }
  } catch (err) {
    // The one line a teammate sees at 18:30 when a module is not built yet. Exit 0: the dispatcher itself works.
    console.log(blockedReason(err))
  }
}

export {}

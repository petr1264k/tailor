/**
 * React binding for the page-level extraction job (extractJob.ts). useSyncExternalStore re-checks the store when it
 * subscribes, so a change between render and subscription is never missed. With `tick` (default on) the component
 * also re-renders once a second while a run is going, for the elapsed seconds, and expires a dead run from another
 * page; pass { tick: false } where only the final state matters (ProfileTab).
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getExtractJob, subscribeExtractJob, syncExtractJob, type ExtractJob } from './extractJob'

export function useExtractJob(opts: { tick?: boolean } = {}): ExtractJob {
  const job = useSyncExternalStore(subscribeExtractJob, getExtractJob)
  const [, setNow] = useState(0)
  const ticking = opts.tick !== false && job.status === 'running'
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => {
      void syncExtractJob()
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(t)
  }, [ticking])
  return job
}

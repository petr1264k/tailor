/** React binding for the page-level extraction job (extractJob.ts). Re-renders on every state change and once a second while running. */
import { useEffect, useState } from 'react'
import { getExtractJob, subscribeExtractJob, syncExtractJob, type ExtractJob } from './extractJob'

export function useExtractJob(): ExtractJob {
  const [job, setJob] = useState<ExtractJob>(getExtractJob)
  useEffect(() => subscribeExtractJob(setJob), [])
  // A 1 s tick keeps the elapsed seconds moving and turns a stale foreign run into "interrupted".
  const [, setTick] = useState(0)
  useEffect(() => {
    if (job.status !== 'running') return
    const t = setInterval(() => {
      syncExtractJob()
      setTick((n) => n + 1)
    }, 1000)
    return () => clearInterval(t)
  }, [job.status])
  return job
}

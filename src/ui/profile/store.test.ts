import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, resetDbForTests } from '@/archive'
import { createProfile, loadNeverExtracted, resetNeverExtractedForTests, saveNeverExtracted } from './store'

beforeEach(() => {
  indexedDB = new IDBFactory()
  resetDbForTests()
  resetNeverExtractedForTests()
})

describe('createProfile', () => {
  it('writes an empty StoredProfile with a unique id from the name', async () => {
    const a = await createProfile('Petr', new Date('2026-10-10T20:00:00Z'))
    const b = await createProfile('Petr')
    expect(a).toMatchObject({ id: 'petr', name: 'Petr', version: 0, facts: [], shares: [], updatedAt: '2026-10-10T20:00:00.000Z' })
    expect(b.id).toBe('petr-2')
    const db = await getDb()
    expect((await db.getAllKeys('profiles')).sort()).toEqual(['petr', 'petr-2'])
  })

  it('rejects an empty name', async () => {
    await expect(createProfile('   ')).rejects.toThrow('name')
  })
})

describe('never extracted counts', () => {
  it('stores counts per profile', async () => {
    expect(await loadNeverExtracted('petr')).toBeNull()
    await saveNeverExtracted('petr', { health: 2 }, '2026-10-10T20:00:00Z')
    await saveNeverExtracted('mikhail', { names: 5 })
    expect(await loadNeverExtracted('petr')).toEqual({ counts: { health: 2 }, at: '2026-10-10T20:00:00Z' })
    expect((await loadNeverExtracted('mikhail'))!.counts).toEqual({ names: 5 })
  })
})

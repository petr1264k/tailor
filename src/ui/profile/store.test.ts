import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, resetDbForTests } from '@/archive'
import { createProfile } from './store'

beforeEach(() => {
  indexedDB = new IDBFactory()
  resetDbForTests()
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

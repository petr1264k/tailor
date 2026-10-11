import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, resetDbForTests } from '@/archive'
import { createProfile, renameProfile } from './store'

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

describe('renameProfile', () => {
  it('changes only the name of a stored profile', async () => {
    const created = await createProfile('Petr')
    const db = await getDb()
    await db.put('profiles', { ...created, version: 3, facts: [] })
    const renamed = await renameProfile('petr', '  Petr (laptop)  ', new Date('2026-10-10T21:00:00Z'))
    expect(renamed).toMatchObject({ id: 'petr', name: 'Petr (laptop)', version: 3, updatedAt: '2026-10-10T21:00:00.000Z' })
    expect(await db.get('profiles', 'petr')).toMatchObject({ name: 'Petr (laptop)', version: 3 })
  })

  it('creates the row when the profile was never written', async () => {
    const r = await renameProfile('default', 'Mikhail')
    expect(r).toMatchObject({ id: 'default', name: 'Mikhail', version: 0, facts: [] })
    const db = await getDb()
    expect(await db.getAllKeys('profiles')).toEqual(['default'])
  })

  it('rejects an empty name', async () => {
    await expect(renameProfile('default', ' ')).rejects.toThrow('name')
  })
})

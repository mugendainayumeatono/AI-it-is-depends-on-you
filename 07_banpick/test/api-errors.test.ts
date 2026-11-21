import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST as configPost } from '@/app/api/config/route'
import { POST as membersPost } from '@/app/api/members/route'
import { POST as pickPost } from '@/app/api/pick/route'
import { POST as randomizePost } from '@/app/api/randomize/route'
import { GET as stateGet } from '@/app/api/state/route'
import { GET as mediaGet } from '@/app/api/members/[id]/media/route'
import { setStateStore, type StateStore } from '@/lib/stateStore'

function makeFailingStore(message = 'DB Error'): StateStore {
  return {
    getStoreKind: () => 'memory',
    getSnapshot: vi.fn().mockRejectedValue(new Error(message)),
    mutate: vi.fn().mockRejectedValue(new Error(message)),
    getMedia: vi.fn().mockRejectedValue(new Error(message)),
    getEventsSince: vi.fn().mockRejectedValue(new Error(message)),
  }
}

describe('API Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 500 across all endpoints when the backing StateStore throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setStateStore(makeFailingStore('Simulated outage'))

    const cfgRes = await configPost(
      new Request('http://localhost/api/config', { method: 'POST', body: '{}' })
    )
    expect(cfgRes.status).toBe(500)

    const memRes = await membersPost(
      new Request('http://localhost/api/members', {
        method: 'POST',
        body: JSON.stringify({ action: 'ADD', name: 'Alice' }),
      })
    )
    expect(memRes.status).toBe(500)

    const pickRes = await pickPost(
      new Request('http://localhost/api/pick', { method: 'POST', body: '{}' })
    )
    expect(pickRes.status).toBe(500)

    const rndRes = await randomizePost()
    expect(rndRes.status).toBe(500)

    const stateRes = await stateGet(new Request('http://localhost/api/state'))
    expect(stateRes.status).toBe(500)

    const mediaRes = await mediaGet(
      new Request('http://localhost/api/members/m1/media?field=avatar'),
      { params: Promise.resolve({ id: 'm1' }) }
    )
    expect(mediaRes.status).toBe(500)

    errSpy.mockRestore()
  })

  it('returns 400 INVALID_JSON on malformed JSON request bodies', async () => {
    const cfgRes = await configPost(
      new Request('http://localhost/api/config', { method: 'POST', body: '{bad-json' })
    )
    expect(cfgRes.status).toBe(400)
    expect((await cfgRes.json()).code).toBe('INVALID_JSON')

    const memRes = await membersPost(
      new Request('http://localhost/api/members', { method: 'POST', body: '{bad-json' })
    )
    expect(memRes.status).toBe(400)
    expect((await memRes.json()).code).toBe('INVALID_JSON')

    const pickRes = await pickPost(
      new Request('http://localhost/api/pick', { method: 'POST', body: '{bad-json' })
    )
    expect(pickRes.status).toBe(400)
    expect((await pickRes.json()).code).toBe('INVALID_JSON')

    const rndRes = await randomizePost(
      new Request('http://localhost/api/randomize', { method: 'POST', body: '{bad-json' })
    )
    expect(rndRes.status).toBe(400)
    expect((await rndRes.json()).code).toBe('INVALID_JSON')
  })

  it('validates /api/members action and required member id', async () => {
    const badAction = await membersPost(
      new Request('http://localhost/api/members', {
        method: 'POST',
        body: JSON.stringify({ action: 'UNKNOWN' }),
      })
    )
    expect(badAction.status).toBe(400)
    expect((await badAction.json()).code).toBe('INVALID_ACTION')

    const missingId = await membersPost(
      new Request('http://localhost/api/members', {
        method: 'POST',
        body: JSON.stringify({ action: 'UPDATE', name: 'Bob' }),
      })
    )
    expect(missingId.status).toBe(400)
    expect((await missingId.json()).code).toBe('MISSING_MEMBER_ID')
  })
})

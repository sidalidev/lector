import { test, expect } from '@playwright/test'

test.describe('API : santé', () => {
  test('GET /v1/health répond ok', async ({ request }) => {
    const res = await request.get('/v1/health')
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('les routes retirées répondent 404', async ({ request }) => {
    for (const [methode, route] of [
      ['get', '/v1/sync/manifest'], ['get', '/v1/sync/stream'], ['post', '/v1/auth/login'],
      ['post', '/v1/chat/ask'], ['post', '/v1/tts/synthesize'], ['post', '/v1/chain/begin'], ['post', '/v1/chain/reset'],
    ]) {
      expect((await request[methode](route)).status(), `${methode} ${route}`).toBe(404)
    }
  })
})

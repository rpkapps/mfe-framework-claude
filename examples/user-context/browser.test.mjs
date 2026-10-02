import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { createDemoUserContext } from './src/browser.ts'

test('browser transport preserves backend ownership and conflict error codes', async () => {
  const options = createDemoUserContext()
  const operation = {
    scope: options.scope,
    id: 'fieldwork',
    expectedRevision: 0,
    operationId: 'forbidden',
    value: { 'inspection:showCompleted': true },
  }
  for (const [status, code] of [
    [400, 'unauthorized-owner'],
    [409, 'conflict'],
  ]) {
    const fetch = mock.method(globalThis, 'fetch', async (url, request) => {
      assert.equal(url, 'http://localhost:3010/api/user-context/write')
      assert.deepEqual(JSON.parse(request.body), operation)
      return Response.json(
        { code: `user-context/${code}`, id: 'fieldwork', message: 'Rejected' },
        { status },
      )
    })
    try {
      await assert.rejects(options.adapter.write(operation, new AbortController().signal), {
        code: `user-context/${code}`,
        id: 'fieldwork',
      })
    } finally {
      fetch.mock.restore()
    }
  }
})

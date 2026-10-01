import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createDemoBackend } from './server.mjs'

test('saved selections survive reopening and partial writes preserve comparison', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shared-state-demo-'))
  try {
    const file = join(directory, 'records.json')
    const signal = new AbortController().signal
    const scope = 'shared-state-example'
    const id = 'well:selection'
    const backend = createDemoBackend(file)
    await backend.write(
      {
        scope,
        id,
        expectedRevision: 0,
        operationId: 'choose',
        value: { wellId: '42', runId: '7', comparisonMode: 'overlay' },
      },
      signal,
    )
    const reopened = createDemoBackend(file)
    const write = {
      scope,
      id,
      expectedRevision: 1,
      operationId: 'change-run',
      value: { runId: '8' },
    }
    const result = await reopened.write(write, signal)
    assert.deepEqual(result.value, { wellId: '42', runId: '8', comparisonMode: 'overlay' })
    assert.deepEqual(await reopened.write(write, signal), result)
    assert.deepEqual(await reopened.hydrate(scope, [id], signal), [result])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('concurrent saves cannot overwrite a newer revision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shared-state-demo-'))
  try {
    const backend = createDemoBackend(join(directory, 'records.json'))
    const signal = new AbortController().signal
    const write = {
      scope: 'shared-state-example',
      id: 'display:units',
      expectedRevision: 0,
      value: 'imperial',
    }
    const results = await Promise.allSettled([
      backend.write({ ...write, operationId: 'first' }, signal),
      backend.write({ ...write, operationId: 'second' }, signal),
    ])
    assert.equal(results[0].status, 'fulfilled')
    assert.equal(results[1].status, 'rejected')
    assert.equal(results[1].reason.code, 'shared-state/conflict')
    await assert.rejects(
      backend.hydrate('another-workspace', ['display:units'], signal),
      /Unknown demo workspace/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

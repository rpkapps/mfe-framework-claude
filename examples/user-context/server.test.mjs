import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createDemoBackend } from './server.mjs'

test('saved selections survive reopening and partial writes preserve comparison', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'user-context-demo-'))
  try {
    const file = join(directory, 'records.json')
    const signal = new AbortController().signal
    const scope = 'user-context-example'
    const id = 'lab'
    const backend = createDemoBackend(file)
    await backend.write(
      {
        scope,
        id,
        expectedRevision: 0,
        operationId: 'choose',
        value: { 'well:selection': { wellId: '42', runId: '7', comparisonMode: 'overlay' } },
      },
      signal,
    )
    const reopened = createDemoBackend(file)
    const write = {
      scope,
      id,
      expectedRevision: 1,
      operationId: 'change-run',
      value: { 'well:selection': { runId: '8' } },
    }
    const result = await reopened.write(write, signal)
    assert.deepEqual(result.value, {
      'display:units': 'metric',
      'well:selection': { wellId: '42', runId: '8', comparisonMode: 'overlay' },
    })
    assert.deepEqual(await reopened.write(write, signal), result)
    assert.deepEqual(await reopened.hydrate(scope, [id], signal), [result])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('concurrent saves cannot overwrite a newer revision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'user-context-demo-'))
  try {
    const backend = createDemoBackend(join(directory, 'records.json'))
    const signal = new AbortController().signal
    const write = {
      scope: 'user-context-example',
      id: 'lab',
      expectedRevision: 0,
      value: { 'display:units': 'imperial' },
    }
    const results = await Promise.allSettled([
      backend.write({ ...write, operationId: 'first' }, signal),
      backend.write({ ...write, operationId: 'second' }, signal),
    ])
    assert.equal(results[0].status, 'fulfilled')
    assert.equal(results[1].status, 'rejected')
    assert.equal(results[1].reason.code, 'user-context/conflict')
    await assert.rejects(
      backend.hydrate('another-workspace', ['lab'], signal),
      /Unknown demo workspace/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// Request data cannot choose the authenticated writer, including otherwise valid owned slices.
test('forged owner fields cannot write another MFE slice', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'user-context-demo-'))
  try {
    const backend = createDemoBackend(join(directory, 'records.json'))
    const signal = new AbortController().signal
    for (const ownerId of ['lab', 'fieldwork']) {
      await assert.rejects(
        backend.write(
          {
            scope: 'user-context-example',
            id: 'fieldwork',
            ownerId,
            expectedRevision: 0,
            operationId: `forge-${ownerId}`,
            value: { 'inspection:showCompleted': true },
          },
          signal,
        ),
        { code: 'user-context/unauthorized-owner' },
      )
    }
    assert.deepEqual(await backend.hydrate('user-context-example', ['fieldwork'], signal), [
      { id: 'fieldwork', revision: 0 },
    ])
    await assert.rejects(
      backend.write(
        {
          scope: 'another-workspace',
          id: 'lab',
          expectedRevision: 0,
          operationId: 'wrong-scope',
          value: { 'display:units': 'imperial' },
        },
        signal,
      ),
      /Unknown demo workspace/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

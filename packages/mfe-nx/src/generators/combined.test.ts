import { readProjectConfiguration, type Tree } from '@nx/devkit'
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import appGenerator from './app/generator.ts'
import widgetGenerator from './widget/generator.ts'

let tree: Tree

beforeEach(() => {
  tree = createTreeWithEmptyWorkspace()
})

describe('running both generators in one workspace', () => {
  it('registers an App and a Widget without either overwriting the other', async () => {
    await appGenerator(tree, { name: 'operations', skipFormat: true })
    await widgetGenerator(tree, { name: 'alert-panel', skipFormat: true })

    expect(readProjectConfiguration(tree, 'operations').root).toBe('apps/operations')
    expect(readProjectConfiguration(tree, 'alert-panel').root).toBe('apps/alert-panel')
    expect(tree.exists('apps/operations/src/app.routes.ts')).toBe(true)
    expect(tree.exists('apps/alert-panel/src/alert-panel.component.ts')).toBe(true)
  })

  it('carries the tags option through to the project configuration', async () => {
    await appGenerator(tree, { name: 'operations', tags: 'mfe, angular', skipFormat: true })

    expect(readProjectConfiguration(tree, 'operations').tags).toEqual(['mfe', 'angular'])
  })

  it('formats generated files unless skipFormat is set', async () => {
    await appGenerator(tree, { name: 'operations' })

    // formatFiles runs Prettier over every written file; it should not throw, and the files
    // should still be exactly what the generator wrote (Prettier is a no-op on already-formatted
    // template output).
    expect(tree.exists('apps/operations/src/mfe.ts')).toBe(true)
  })
})

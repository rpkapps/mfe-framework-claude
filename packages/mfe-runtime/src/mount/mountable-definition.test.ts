/**
 * A host reads a foreign definition only through this guard before mounting it, so the guard
 * has to refuse every record that would otherwise fail half-way through a mount.
 */

import { describe, expect, it } from 'vitest'

import { DEFINITION_BRAND } from '@company/mfe-core'

import { isMountableDefinition } from './mountable-definition.ts'

const mount = (): Promise<never> => Promise.reject(new Error('never mounted by the guard'))

function widget(overrides: Record<PropertyKey, unknown> = {}): Record<PropertyKey, unknown> {
  return {
    [DEFINITION_BRAND]: true,
    kind: 'widget',
    id: 'alert-panel',
    framework: 'angular',
    contract: { inputSchema: {}, outputSchema: { shape: {} } },
    mount,
    ...overrides,
  }
}

function app(overrides: Record<PropertyKey, unknown> = {}): Record<PropertyKey, unknown> {
  return {
    [DEFINITION_BRAND]: true,
    kind: 'app',
    id: 'reports',
    framework: 'angular',
    contributesBreadcrumbs: true,
    mount,
    ...overrides,
  }
}

describe('isMountableDefinition', () => {
  it('accepts an App and a Widget from any adapter that can mount themselves', () => {
    expect(isMountableDefinition(app())).toBe(true)
    expect(isMountableDefinition(widget())).toBe(true)
    expect(isMountableDefinition(widget({ framework: 'react' }))).toBe(true)
  })

  it('refuses a definition that cannot mount itself', () => {
    expect(isMountableDefinition(widget({ mount: undefined }))).toBe(false)
    expect(isMountableDefinition(app({ mount: 'mount' }))).toBe(false)
  })

  it('refuses a record without the brand', () => {
    const unbranded = widget()
    delete unbranded[DEFINITION_BRAND]

    expect(isMountableDefinition(unbranded)).toBe(false)
  })

  /** The host reads the breadcrumb flag before it mounts, to know whether to expect a trail. */
  it('refuses an App that does not say whether it contributes breadcrumbs', () => {
    expect(isMountableDefinition(app({ contributesBreadcrumbs: undefined }))).toBe(false)
  })

  /** The host routes outputs by the names in the contract, so it must be able to read them. */
  it('refuses a Widget whose contract names no outputs a host could route', () => {
    const contract = (value: unknown) => widget({ contract: value })
    expect(isMountableDefinition(contract(undefined))).toBe(false)
    expect(isMountableDefinition(contract({ inputSchema: {} }))).toBe(false)
    expect(isMountableDefinition(contract({ inputSchema: {}, outputSchema: null }))).toBe(false)
    // A record of payload schemas rather than a z.object: there is no shape to read names from.
    expect(isMountableDefinition(contract({ inputSchema: {}, outputSchema: {} }))).toBe(false)
    expect(isMountableDefinition(contract({ outputSchema: { shape: {} } }))).toBe(false)
  })

  it('refuses values that are not records', () => {
    expect(isMountableDefinition(null)).toBe(false)
    expect(isMountableDefinition(mount)).toBe(false)
    expect(isMountableDefinition('alert-panel')).toBe(false)
  })
})

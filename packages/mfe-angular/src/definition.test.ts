import { Component, EventEmitter, Input, Output } from '@angular/core'
import type { Routes } from '@angular/router'
import { DEFINITION_BRAND, isBrandedDefinition } from '@company/mfe-core'
import { isMountableDefinition } from '@company/mfe-host'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget, isAngularDefinition } from './definition.ts'
import { MfeAppRootComponent } from './routing/app-root.component.ts'

@Component({ selector: 'test-badge', template: '{{ label }}' })
class BadgeComponent {
  @Input() label = ''
  @Output() readonly activated = new EventEmitter<{ at: string }>()
}

@Component({ selector: 'test-page', template: 'page' })
class PageComponent {}

const routes: Routes = [{ path: '', component: PageComponent }]

describe('createApp', () => {
  it('returns a branded, self-mounting record the neutral host recognises', () => {
    const app = createApp({ id: 'reports', version: '1.2.0', routes })

    expect(app[DEFINITION_BRAND]).toBe(true)
    expect(app).toMatchObject({ kind: 'app', framework: 'angular', id: 'reports', version: '1.2.0' })
    expect(app.routes).toBe(routes)
    expect(app.contributesBreadcrumbs).toBe(true)
    expect(isBrandedDefinition(app)).toBe(true)
    expect(isMountableDefinition(app)).toBe(true)
    expect(isAngularDefinition(app)).toBe(true)
  })

  it('renders the routes in a router outlet unless the App names its own root', () => {
    expect(createApp({ id: 'reports', routes }).component).toBe(MfeAppRootComponent)
    expect(createApp({ id: 'reports', routes, component: PageComponent }).component).toBe(
      PageComponent,
    )
  })

  it('records a breadcrumb opt-out and carries the App’s providers', () => {
    const providers = [{ provide: 'token', useValue: 1 }]
    const app = createApp({ id: 'reports', routes, breadcrumbs: false, providers })

    expect(app.contributesBreadcrumbs).toBe(false)
    expect(app.providers).toBe(providers)
  })

  it('rejects an id outside the definition id rule', () => {
    expect(() => createApp({ id: 'Reports', routes })).toThrowError(
      /Reports failed to createApp: expected lower-case letters/,
    )
  })

  it('rejects routes that are not an array, naming what arrived', () => {
    expect(() =>
      createApp({ id: 'reports', routes: undefined as unknown as Routes }),
    ).toThrowError(/expected an array of Angular routes, received nothing/)
  })

  it('rejects a root component that is not a class', () => {
    expect(() =>
      createApp({ id: 'reports', routes, component: 'page' as unknown as typeof PageComponent }),
    ).toThrowError(/expected a standalone component class, received a string/)
  })
})

describe('createWidget', () => {
  const contract = {
    inputs: z.object({ label: z.string() }),
    events: { activated: z.object({ at: z.string() }) },
  }

  it('returns a branded record carrying its contract and component', () => {
    const widget = createWidget({ id: 'badge', ...contract, component: BadgeComponent })

    expect(widget).toMatchObject({ kind: 'widget', framework: 'angular', id: 'badge' })
    expect(widget.contract.inputs).toBe(contract.inputs)
    expect(widget.contract.events).toBe(contract.events)
    expect(widget.component).toBe(BadgeComponent)
    expect(widget.providers).toEqual([])
    expect(isMountableDefinition(widget)).toBe(true)
    expect(isAngularDefinition(widget)).toBe(true)
  })

  it('rejects an event name that is not lower camel case', () => {
    expect(() =>
      createWidget({
        id: 'badge',
        inputs: contract.inputs,
        events: { 'was-activated': z.object({}) },
        component: BadgeComponent,
      }),
    ).toThrowError(/declare event 'was-activated': expected a lower-camel-case event name/)
  })

  it('rejects a missing component', () => {
    expect(() =>
      createWidget({
        id: 'badge',
        ...contract,
        component: undefined as unknown as typeof BadgeComponent,
      }),
    ).toThrowError(/badge failed to create Widget definition: expected a standalone component class, received nothing/)
  })

  it('rejects providers that are not an array', () => {
    expect(() =>
      createWidget({
        id: 'badge',
        ...contract,
        component: BadgeComponent,
        providers: {} as unknown as [],
      }),
    ).toThrowError(/expected an array of providers, received a object/)
  })
})

describe('isAngularDefinition', () => {
  it('does not claim a mountable definition another adapter built', () => {
    const foreign = {
      [DEFINITION_BRAND]: true,
      kind: 'widget',
      framework: 'react',
      id: 'badge',
      contract: { inputs: z.object({}), events: {} },
      mount: () => Promise.reject(new Error('not mounted in this test')),
    }

    expect(isMountableDefinition(foreign)).toBe(true)
    expect(isAngularDefinition(foreign)).toBe(false)
  })
})

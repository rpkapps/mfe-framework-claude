import { Component, EventEmitter, Input, Output } from '@angular/core'
import {
  PreloadAllModules,
  withComponentInputBinding,
  withEnabledBlockingInitialNavigation,
  withInMemoryScrolling,
  withPreloading,
  withRouterConfig,
  type RouterFeatures,
  type Routes,
} from '@angular/router'
import { DEFINITION_BRAND, isBrandedDefinition } from '@company/mfe-core'
import { isMountableDefinition } from '@company/mfe-runtime'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createApp, createWidget } from './definition.ts'
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
    expect(app).toMatchObject({
      kind: 'app',
      framework: 'angular',
      id: 'reports',
      version: '1.2.0',
    })
    expect(app.routes).toBe(routes)
    expect(app.contributesBreadcrumbs).toBe(true)
    expect(isBrandedDefinition(app)).toBe(true)
    expect(isMountableDefinition(app)).toBe(true)
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
    expect(() => createApp({ id: 'reports', routes: undefined as unknown as Routes })).toThrowError(
      /expected an array of Angular routes, received nothing/,
    )
  })

  it('rejects a root component that is not a class', () => {
    expect(() =>
      createApp({ id: 'reports', routes, component: 'page' as unknown as typeof PageComponent }),
    ).toThrowError(/expected a standalone component class, received a string/)
  })

  it('refuses the router features that start only in a bootstrapped application', () => {
    const withFeatures = (routerFeatures: RouterFeatures[]) => () =>
      createApp({ id: 'reports', routes, routerFeatures })

    expect(
      withFeatures([withComponentInputBinding(), withEnabledBlockingInitialNavigation()]),
    ).toThrowError(
      'reports failed to create App definition routerFeatures[1]: expected a router feature that runs in an application created without a bootstrap, received withEnabledBlockingInitialNavigation(), which holds every navigation until a bootstrap that never comes. Remove it; the host shows its loading state until the App has mounted.',
    )
    expect(withFeatures([withPreloading(PreloadAllModules)])).toThrowError(
      /routerFeatures\[0\]: .* received withPreloading\(\), which starts preloading only on a bootstrap/,
    )
    expect(withFeatures([withInMemoryScrolling()])).toThrowError(
      /routerFeatures\[0\]: .* received withInMemoryScrolling\(\), which restores scroll only on a bootstrap/,
    )
    expect(() => withFeatures([withComponentInputBinding(), withRouterConfig({})])()).not.toThrow()
  })
})

describe('createWidget', () => {
  const contract = {
    inputSchema: z.object({ label: z.string() }),
    outputSchema: z.object({ activated: z.object({ at: z.string() }) }),
  }

  it('returns a branded record carrying its contract and component', () => {
    const widget = createWidget({ id: 'badge', ...contract, component: BadgeComponent })

    expect(widget).toMatchObject({ kind: 'widget', framework: 'angular', id: 'badge' })
    expect(widget.contract.inputSchema).toBe(contract.inputSchema)
    expect(widget.contract.outputSchema).toBe(contract.outputSchema)
    expect(widget.component).toBe(BadgeComponent)
    expect(widget.providers).toEqual([])
    expect(isMountableDefinition(widget)).toBe(true)
  })

  it('rejects an event name that is not lower camel case', () => {
    expect(() =>
      createWidget({
        id: 'badge',
        inputSchema: contract.inputSchema,
        outputSchema: z.object({ 'was-activated': z.object({}) }),
        component: BadgeComponent,
      }),
    ).toThrowError(/declare output 'was-activated': expected a lower-camel-case output name/)
  })

  it('rejects a missing component', () => {
    expect(() =>
      createWidget({
        id: 'badge',
        ...contract,
        component: undefined as unknown as typeof BadgeComponent,
      }),
    ).toThrowError(
      /badge failed to create Widget definition: expected a standalone component class, received nothing/,
    )
  })

  it('rejects providers that are not an array', () => {
    expect(() =>
      createWidget({
        id: 'badge',
        ...contract,
        component: BadgeComponent,
        providers: {} as unknown as [],
      }),
    ).toThrowError(/expected an array of providers, received an object/)
  })
})

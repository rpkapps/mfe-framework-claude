import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { planContainer } from './plan.ts'
import { angularProfile } from './profile.ts'
import { cleanupContainers, createContainer } from './testing/containers.ts'

afterEach(cleanupContainers)

const APP_ENTRY = `
import { createApp } from '@company/mfe-angular'

import { routes } from './app.routes'

export default createApp({ id: 'reports', version: '1.2.0', title: 'Reports', routes })
`

const APP_ROUTES = `
import type { Routes } from '@angular/router'
import { mfeRouteData } from '@company/mfe-angular'

class OverviewComponent {}
class SettingsComponent {}

export const routes: Routes = [
  { path: '', component: OverviewComponent },
  {
    path: 'settings',
    component: SettingsComponent,
    data: mfeRouteData({ capability: 'settings', label: 'Report settings', icon: 'settings' }),
  },
]
`

const CONFIG = `
import { env } from '@company/mfe-nx/env'
import { z } from 'zod'

export default {
  apiBaseUrl: env('API_BASE_URL', z.string().url(), { api: true }),
}
`

function generatedFile(root: string, name: string): string {
  const plan = planContainer({ containerRoot: root })
  const file = plan.generated.files.find(candidate => candidate.path === join(root, '.mfe', name))
  if (file === undefined) throw new Error(`Expected the plan to generate .mfe/${name}.`)
  return file.contents
}

describe('the Angular profile', () => {
  it('reads definitions and route data from the Angular adapter only', () => {
    const profile = angularProfile()

    expect(profile.framework).toBe('angular')
    expect(profile.generator).toBe('@company/mfe-nx')
    expect(profile.definitions.factoryModules).toEqual(['@company/mfe-angular'])
    expect(profile.adapterModule).toBe('@company/mfe-angular')
    expect(profile.envModules).toEqual(['@company/mfe-nx/env'])
    expect(profile.containerRootOption).toBe('withMfe({ containerRoot })')
  })

  it('has Tailwind scan the templates Angular components keep in .ts and .html files', () => {
    expect(angularProfile().stylesheet.sources).toBe('**/*.{ts,html}')
  })

  it("re-exports the author's definition unchanged, with no style root of its own", () => {
    expect(angularProfile().exposeDefinition).toBeUndefined()
  })
})

describe('planning an Angular container', () => {
  it('exposes the App and publishes it as an Angular definition', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY, 'src/app.routes.ts': APP_ROUTES })

    const plan = planContainer({ containerRoot: root })

    expect(plan.exposes).toEqual({ './app': join(root, '.mfe/entries/app.ts') })
    expect(plan.scopes).toEqual(['reports'])
    expect(plan.generated.frameworkMetadata.framework).toBe('angular')
    expect(plan.generated.descriptor.framework).toBe('angular')
    expect(plan.entryStub).toBe(join(root, '.mfe/entries/container.ts'))
  })

  it("finds the App's capability routes from its route data", () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY, 'src/app.routes.ts': APP_ROUTES })

    const plan = planContainer({ containerRoot: root })

    expect(plan.capabilities).toEqual([
      { name: 'settings', label: 'Report settings', icon: 'settings', path: '/settings' },
    ])
  })

  it('has the generated #mfe/fetch take its transport from the Angular adapter', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY, 'src/app.routes.ts': APP_ROUTES })

    expect(generatedFile(root, 'fetch.ts')).toContain(
      "import { createContainerTransport } from '@company/mfe-angular'",
    )
  })

  it('types #mfe/config from the env module an Angular container declares it with', () => {
    const root = createContainer({
      'src/mfe.ts': APP_ENTRY,
      'src/app.routes.ts': APP_ROUTES,
      'src/mfe.config.ts': CONFIG,
    })

    expect(generatedFile(root, 'config.ts')).toContain(
      "import type { InferEnvConfig } from '@company/mfe-nx/env'",
    )
  })

  it("imports the container's own global stylesheet into the generated one", () => {
    const root = createContainer({
      'src/mfe.ts': APP_ENTRY,
      'src/app.routes.ts': APP_ROUTES,
      'src/styles.css': '.panel { color: red; }\n',
    })

    const stylesheet = generatedFile(root, 'styles.css')

    expect(stylesheet).toContain('@import "../src/styles.css";')
    expect(stylesheet).toContain('@source "../src/**/*.{ts,html}";')
    // After Tailwind's layers, so an author's unlayered rule wins over a utility.
    expect(stylesheet.indexOf('../src/styles.css')).toBeGreaterThan(
      stylesheet.indexOf('tailwindcss/utilities.css'),
    )
  })

  it('has every exposed entry import the stylesheet the way Angular compiles a global one', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY, 'src/app.routes.ts': APP_ROUTES })

    expect(generatedFile(root, 'entries/app.ts')).toContain("import '../styles.css?ngGlobalStyle'")
    expect(generatedFile(root, 'css.d.ts')).toContain("declare module '*?ngGlobalStyle'")
  })

  it('imports no global stylesheet when the container has deleted it', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY, 'src/app.routes.ts': APP_ROUTES })

    expect(generatedFile(root, 'styles.css')).not.toContain('src/styles.css')
  })

  it('is a pure function of the sources, so a watching build never rewrites its own input', () => {
    const root = createContainer({ 'src/mfe.ts': APP_ENTRY, 'src/app.routes.ts': APP_ROUTES })

    const first = planContainer({ containerRoot: root, buildTime: '2026-01-02T03:04:05.000Z' })
    const second = planContainer({ containerRoot: root, buildTime: '2026-01-02T03:04:05.000Z' })

    expect(second.generated.files).toEqual(first.generated.files)
  })
})

import { afterEach, describe, expect, it } from 'vitest'

import { resolveShared, SINGLETON } from '@company/mfe-build/federation'

import { planContainer } from '../plan.ts'
import { cleanupContainers, createContainer } from '../testing/containers.ts'
import {
  adapterCarriedShares,
  ANGULAR_FRAMEWORK_POLICY,
  ANGULAR_SHARING_POLICY,
  assertShareable,
  NEVER_SHARED,
  PAGE_POLICY,
} from './sharing.ts'

afterEach(cleanupContainers)

const WIDGET_ENTRY = `
import { createWidget } from '@company/mfe-angular'
import { z } from 'zod'

class PanelComponent {}

export const panel = createWidget({
  id: 'panel',
  inputs: z.object({ label: z.string() }),
  events: {},
  component: PanelComponent,
})
`

describe('the Angular sharing policy', () => {
  it('shares Angular, the CDK, RxJS and the adapter as strict singletons', () => {
    for (const name of [
      '@angular/core',
      '@angular/common',
      '@angular/platform-browser',
      '@angular/router',
      '@angular/forms',
      '@angular/animations',
      '@angular/cdk',
      'rxjs',
      '@company/mfe-angular',
    ]) {
      expect(ANGULAR_FRAMEWORK_POLICY[name], name).toEqual(SINGLETON)
    }
  })

  it('shares the entry points of Common, the CDK and RxJS through prefix entries', () => {
    expect(ANGULAR_FRAMEWORK_POLICY['@angular/common/']).toEqual(SINGLETON)
    expect(ANGULAR_FRAMEWORK_POLICY['@angular/cdk/']).toEqual(SINGLETON)
    expect(ANGULAR_FRAMEWORK_POLICY['rxjs/']).toEqual(SINGLETON)
  })

  it('keeps the neutral packages as page singletons, apart from the framework group', () => {
    expect(PAGE_POLICY).toEqual({
      '@company/mfe-core': SINGLETON,
      '@company/mfe-runtime': SINGLETON,
    })
    expect(Object.keys(ANGULAR_FRAMEWORK_POLICY)).not.toContain('@company/mfe-core')
    expect(ANGULAR_SHARING_POLICY).toEqual({ ...ANGULAR_FRAMEWORK_POLICY, ...PAGE_POLICY })
  })

  it('never offers PrimeNG or its theme engine as a candidate', () => {
    expect(NEVER_SHARED).toEqual([
      'primeng',
      '@primeng/themes',
      '@primeuix/styled',
      '@primeuix/utils',
    ])
    for (const name of NEVER_SHARED) {
      expect(Object.keys(ANGULAR_SHARING_POLICY).some(key => key.startsWith(name))).toBe(false)
    }
  })

  it('resolves a PrimeNG container to Angular shares only, with the common/http prefix', () => {
    const shared = resolveShared({
      policy: ANGULAR_SHARING_POLICY,
      dependencies: {
        '@angular/common': '19.2.25',
        '@angular/core': '19.2.25',
        '@primeng/themes': '19.1.4',
        primeng: '19.1.4',
      },
      installedVersion: name => (name === '@angular/common' ? '19.2.25' : undefined),
    })

    expect(Object.keys(shared)).toEqual(['@angular/common', '@angular/common/', '@angular/core'])
    expect(shared['@angular/common/']).toMatchObject({ singleton: true, version: '19.2.25' })
  })
})

describe('the page singletons the adapter carries', () => {
  it('are shared at the ranges the installed adapter declares, though the container lists neither', () => {
    const root = createContainer({ 'src/mfe.ts': WIDGET_ENTRY })

    const shared = adapterCarriedShares(root)

    expect(shared).toEqual({
      '@company/mfe-core': { singleton: true, strictVersion: true, requiredVersion: '^0.1.0' },
      '@company/mfe-runtime': { singleton: true, strictVersion: true, requiredVersion: '^0.1.0' },
    })
  })

  it("join the plan's shares, where the container's own entry for a package wins", () => {
    const root = createContainer(
      { 'src/mfe.ts': WIDGET_ENTRY },
      {
        manifest: {
          dependencies: { '@company/mfe-angular': '^0.1.0', '@company/mfe-core': '~0.1.3' },
        },
      },
    )

    const plan = planContainer({ containerRoot: root })

    expect(Object.keys(plan.shared)).toEqual([
      '@company/mfe-angular',
      '@company/mfe-core',
      '@company/mfe-runtime',
    ])
    expect(plan.shared['@company/mfe-core']?.requiredVersion).toBe('~0.1.3')
    expect(plan.shared['@company/mfe-runtime']?.requiredVersion).toBe('^0.1.0')
  })
})

describe('an author adding shares', () => {
  it.each(['primeng', 'primeng/button', '@primeng/themes/aura', '@primeuix/styled'])(
    'is refused %s, whose module state must stay private to each container',
    name => {
      expect(() => {
        assertShareable({ [name]: '^19.0.0' }, '/workspace/apps/reports')
      }).toThrowError(/Angular sharing policy.*Remove '.*' from withMfe\(\{ shared \}\)/s)
    },
  )

  it('may add any other package, which the plan then shares as a singleton', () => {
    const root = createContainer({ 'src/mfe.ts': WIDGET_ENTRY })

    const plan = planContainer({ containerRoot: root, shared: { '@acme/auth-client': '^3.0.0' } })

    expect(plan.shared['@acme/auth-client']).toMatchObject({
      singleton: true,
      requiredVersion: '^3.0.0',
    })
  })

  it('is refused before the container is read, naming the package and the option', () => {
    expect(() =>
      planContainer({ containerRoot: '/nonexistent/container', shared: { primeng: '19.1.4' } }),
    ).toThrowError(/'primeng' added through withMfe\(\{ shared \}\)/)
  })
})

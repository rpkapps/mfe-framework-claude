import { afterEach, describe, expect, it } from 'vitest'

import {
  PAGE_POLICY,
  PAGE_SINGLETON,
  resolveShared,
  SINGLETON,
  withPagePolicy,
} from '@company/mfe-build/federation'

import { planContainer } from '../plan.ts'
import {
  ANGULAR_CORE_VERSION,
  cleanupContainers,
  createContainer,
  writeFile,
} from '../testing/containers.ts'
import { ANGULAR_SHARING_POLICY, assertShareable, NEVER_SHARED } from './sharing.ts'

afterEach(cleanupContainers)

const ANGULAR_SCOPE = `angular@${ANGULAR_CORE_VERSION}`

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
      expect(ANGULAR_SHARING_POLICY[name], name).toEqual(SINGLETON)
    }
  })

  it('shares the entry points of Common, the CDK and RxJS through prefix entries', () => {
    expect(ANGULAR_SHARING_POLICY['@angular/common/']).toEqual(SINGLETON)
    expect(ANGULAR_SHARING_POLICY['@angular/cdk/']).toEqual(SINGLETON)
    expect(ANGULAR_SHARING_POLICY['rxjs/']).toEqual(SINGLETON)
  })

  it('keeps the neutral packages as page singletons, apart from the framework group', () => {
    expect(PAGE_POLICY).toEqual({
      '@company/mfe-core': PAGE_SINGLETON,
      '@company/mfe-runtime': PAGE_SINGLETON,
    })
    expect(Object.keys(ANGULAR_SHARING_POLICY)).not.toContain('@company/mfe-core')
    expect(withPagePolicy(ANGULAR_SHARING_POLICY)).toEqual({
      ...ANGULAR_SHARING_POLICY,
      ...PAGE_POLICY,
    })
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
      frameworkScope: ANGULAR_SCOPE,
    })

    expect(Object.keys(shared)).toEqual(['@angular/common', '@angular/common/', '@angular/core'])
    expect(shared['@angular/common/']).toMatchObject({
      singleton: true,
      version: '19.2.25',
      shareScope: ANGULAR_SCOPE,
    })
  })
})

describe('the Angular share scope', () => {
  it('holds the framework group, keyed by the installed @angular/core, and nothing page-wide', () => {
    const root = createContainer(
      { 'src/mfe.ts': WIDGET_ENTRY },
      {
        manifest: {
          dependencies: {
            '@angular/common': '19.2.25',
            '@angular/core': '19.2.25',
            '@angular/router': '19.2.25',
            '@company/mfe-angular': '^0.1.0',
            rxjs: '^7.8.0',
          },
        },
      },
    )

    const plan = planContainer({ containerRoot: root })

    const scopes = Object.fromEntries(
      Object.entries(plan.shared).map(([name, entry]) => [name, entry.shareScope]),
    )
    expect(scopes).toEqual({
      '@angular/common': ANGULAR_SCOPE,
      '@angular/common/': ANGULAR_SCOPE,
      '@angular/core': ANGULAR_SCOPE,
      '@angular/router': ANGULAR_SCOPE,
      '@company/mfe-angular': ANGULAR_SCOPE,
      '@company/mfe-core': 'default',
      '@company/mfe-runtime': 'default',
      rxjs: ANGULAR_SCOPE,
      'rxjs/': ANGULAR_SCOPE,
    })
    expect(plan.generated.descriptor).toMatchObject({
      framework: 'angular',
      shareScopes: ['default', ANGULAR_SCOPE],
    })
  })

  it('gives a container on another Angular version its own scope, and the same page singletons', () => {
    const current = createContainer({ 'src/mfe.ts': WIDGET_ENTRY })
    const previous = createContainer({ 'src/mfe.ts': WIDGET_ENTRY })
    writeFile(
      previous,
      'node_modules/@angular/core/package.json',
      JSON.stringify({ name: '@angular/core', version: '18.2.13' }),
    )

    const currentPlan = planContainer({ containerRoot: current })
    const previousPlan = planContainer({ containerRoot: previous })

    expect(currentPlan.shared['@company/mfe-angular']?.shareScope).toBe(ANGULAR_SCOPE)
    expect(previousPlan.shared['@company/mfe-angular']?.shareScope).toBe('angular@18.2.13')
    expect(previousPlan.shared['@company/mfe-core']).toEqual(
      currentPlan.shared['@company/mfe-core'],
    )
  })

  it('never shares PrimeNG or its theme engine, even for a container that depends on them', () => {
    const root = createContainer(
      { 'src/mfe.ts': WIDGET_ENTRY },
      {
        manifest: {
          dependencies: {
            '@company/mfe-angular': '^0.1.0',
            '@primeng/themes': '19.1.4',
            '@primeuix/styled': '0.7.0',
            primeng: '19.1.4',
          },
        },
      },
    )

    const plan = planContainer({ containerRoot: root })

    for (const name of NEVER_SHARED) {
      expect(
        Object.keys(plan.shared).some(key => key.startsWith(name)),
        name,
      ).toBe(false)
    }
  })

  it('refuses a container with no @angular/core installed, naming the package to add', () => {
    const root = createContainer({ 'src/mfe.ts': WIDGET_ENTRY })
    writeFile(root, 'node_modules/@angular/core/package.json', '{ not json')

    expect(() => planContainer({ containerRoot: root })).toThrowError(
      /name the angular share scope: expected @angular\/core installed.*Add @angular\/core to the dependencies/s,
    )
  })
})

describe('the page singletons the adapter carries', () => {
  it('are shared page-wide at the ranges the installed adapter declares, though the container lists neither', () => {
    const root = createContainer({ 'src/mfe.ts': WIDGET_ENTRY })

    const { shared } = planContainer({ containerRoot: root })

    expect(shared['@company/mfe-core']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^0.1.0',
      shareScope: 'default',
    })
    expect(shared['@company/mfe-runtime']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '^0.1.0',
      shareScope: 'default',
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
      shareScope: ANGULAR_SCOPE,
    })
  })

  it('may tighten a page singleton, which stays in the page scope', () => {
    const root = createContainer({ 'src/mfe.ts': WIDGET_ENTRY })

    const plan = planContainer({ containerRoot: root, shared: { '@company/mfe-core': '~0.1.3' } })

    expect(plan.shared['@company/mfe-core']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '~0.1.3',
      shareScope: 'default',
    })
  })

  it('is refused before the container is read, naming the package and the option', () => {
    expect(() =>
      planContainer({ containerRoot: '/nonexistent/container', shared: { primeng: '19.1.4' } }),
    ).toThrowError(/'primeng' added through withMfe\(\{ shared \}\)/)
  })
})

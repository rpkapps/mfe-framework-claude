import rule from './stable-definitions.ts'
import { createRuleTester } from '../__tests__/rule-tester.ts'

const REACT = "import { createApp, createWidget, lazyWidget } from '@company/mfe-react'\n"

createRuleTester().run('mfe/stable-definitions', rule, {
  valid: [
    // The shape the framework expects: one definition per module, built once.
    `${REACT}export const app = createApp({ id: 'reports' })`,
    `${REACT}export const widget = createWidget({ id: 'reports/summary' })`,
    `${REACT}export const Chart = lazyWidget(() => import('./chart.ts'))`,
    // An aliased import at module scope is still module scope.
    "import { createWidget as mk } from '@company/mfe-react'\nexport const widget = mk({ id: 'a' })",
    // A namespace import at module scope.
    "import * as mfe from '@company/mfe-react'\nexport const widget = mfe.createWidget({ id: 'a' })",
    // Referencing the definition inside a component is exactly right.
    `${REACT}const widget = createWidget({ id: 'a' })\nexport function Panel() {\n  return render(widget)\n}`,
    // Shadowing: a local function of the same name has nothing to do with the
    // framework export, so calling it in a component is fine.
    "function createWidget(config: unknown) {\n  return config\n}\nexport function Panel() {\n  return createWidget({ id: 'a' })\n}",
    // Shadowing by parameter, with the framework import present in the module.
    `${REACT}export function makeWidget(createWidget: (c: unknown) => unknown) {\n  return createWidget({ id: 'a' })\n}`,
    // A same-named factory imported from somewhere else entirely.
    "import { createWidget } from './local-factory.ts'\nexport function Panel() {\n  return createWidget({ id: 'a' })\n}",
    // A namespace object from another module.
    "import * as local from './local-factory.ts'\nexport function Panel() {\n  return local.createWidget({ id: 'a' })\n}",
    // A type-only import cannot be called at all.
    "import type { WidgetDefinition } from '@company/mfe-react'\nexport function use(w: WidgetDefinition) {\n  return w\n}",
    // A different export of the framework may be called anywhere.
    "import { useMfeStorage } from '@company/mfe-react'\nexport function Panel() {\n  return useMfeStorage()\n}",
    // Options can narrow the guarded modules.
    {
      code: `${REACT}export function Panel() {\n  return createWidget({ id: 'a' })\n}`,
      options: [{ modules: ['@company/other'] }],
    },
  ],

  invalid: [
    {
      code: `${REACT}export function Panel() {\n  return createWidget({ id: 'a' })\n}`,
      errors: [
        {
          messageId: 'notModuleScope',
          data: {
            local: 'createWidget',
            name: 'createWidget',
            source: '@company/mfe-react',
            where: 'the body of `Panel`',
          },
        },
      ],
    },
    {
      // Aliased import, caught under its alias.
      code: "import { createWidget as mk } from '@company/mfe-react'\nexport const Panel = () => mk({ id: 'a' })",
      errors: [
        {
          messageId: 'notModuleScope',
          data: {
            local: 'mk',
            name: 'createWidget',
            source: '@company/mfe-react',
            where: 'the body of `Panel`',
          },
        },
      ],
    },
    {
      // Namespace import, called inside a hook.
      code: "import * as mfe from '@company/mfe-react'\nexport function useWidget() {\n  return mfe.createWidget({ id: 'a' })\n}",
      errors: [
        {
          messageId: 'notModuleScope',
          data: {
            local: 'mfe.createWidget',
            name: 'createWidget',
            source: '@company/mfe-react',
            where: 'the body of `useWidget`',
          },
        },
      ],
    },
    {
      // Re-aliased locally, then called in a closure.
      code: `${REACT}const mk = createWidget\nexport function Panel() {\n  return mk({ id: 'a' })\n}`,
      errors: [
        {
          messageId: 'notModuleScope',
          data: {
            local: 'mk',
            name: 'createWidget',
            source: '@company/mfe-react',
            where: 'the body of `Panel`',
          },
        },
      ],
    },
    {
      // The classic: a definition rebuilt inside a memo on every render.
      code: `${REACT}export function Panel() {\n  const widget = useMemo(() => lazyWidget(load), [])\n  return widget\n}`,
      errors: [
        {
          messageId: 'notModuleScope',
          data: {
            local: 'lazyWidget',
            name: 'lazyWidget',
            source: '@company/mfe-react',
            where: 'the body of `useMemo(...)`',
          },
        },
      ],
    },
    {
      // A class field initialiser runs per construction, not per module.
      code: `${REACT}export class Holder {\n  app = createApp({ id: 'reports' })\n}`,
      errors: [
        {
          messageId: 'notModuleScope',
          data: {
            local: 'createApp',
            name: 'createApp',
            source: '@company/mfe-react',
            where: 'a class field initialiser',
          },
        },
      ],
    },
    {
      // A class static block is still not module scope.
      code: `${REACT}export class Holder {\n  static app: unknown\n  static {\n    Holder.app = createApp({ id: 'reports' })\n  }\n}`,
      errors: [
        {
          messageId: 'notModuleScope',
          data: {
            local: 'createApp',
            name: 'createApp',
            source: '@company/mfe-react',
            where: 'a class static block',
          },
        },
      ],
    },
    {
      // TypeScript syntax around the call does not move it to module scope.
      code: `${REACT}export function Panel(): unknown {\n  return createWidget({ id: 'a' }) satisfies unknown\n}`,
      errors: [{ messageId: 'notModuleScope' }],
    },
    {
      // An object method is a function body like any other.
      code: `${REACT}export const registry = {\n  build() {\n    return createWidget({ id: 'a' })\n  },\n}`,
      errors: [
        {
          messageId: 'notModuleScope',
          data: {
            local: 'createWidget',
            name: 'createWidget',
            source: '@company/mfe-react',
            where: 'the body of `build`',
          },
        },
      ],
    },
    {
      // A definition built inside a plain arrow with no name to report.
      code: `${REACT}export const build = [1].map(() => createWidget({ id: 'a' }))`,
      errors: [
        {
          messageId: 'notModuleScope',
          data: {
            local: 'createWidget',
            name: 'createWidget',
            source: '@company/mfe-react',
            where: 'an arrow function',
          },
        },
      ],
    },
    {
      // An extra factory name can be guarded through options.
      code: "import { defineWidget } from '@company/mfe-react'\nexport function Panel() {\n  return defineWidget({ id: 'a' })\n}",
      options: [{ factories: ['defineWidget'] }],
      errors: [
        {
          messageId: 'notModuleScope',
          data: {
            local: 'defineWidget',
            name: 'defineWidget',
            source: '@company/mfe-react',
            where: 'the body of `Panel`',
          },
        },
      ],
    },
  ],
})

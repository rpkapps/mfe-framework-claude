import rule from './no-global-patching.ts'
import { createRuleTester } from '../__tests__/rule-tester.ts'

createRuleTester().run('mfe/no-global-patching', rule, {
  valid: [
    // Reading a global is not patching it.
    'const original = globalThis.fetch',
    'const request = window.fetch.bind(window)',
    // Calling the APIs is someone else's rule.
    "window.addEventListener('resize', onResize)",
    "history.pushState(null, '', '/reports')",
    'function withFakeWindow(window: { fetch: unknown }) { window.fetch = stub }',
    'const window = { fetch: null }\nwindow.fetch = stub',
    "import { history } from './router.ts'\nhistory.pushState = noop",
    "import { document } from './virtual-dom.ts'\ndocument.addEventListener = noop",
    'element.addEventListener = spy',
    'this.fetch = stub',
    'const transport = { fetch: stub, addEventListener: noop }',
    "Object.defineProperty(target, 'fetch', { value: stub })",
    'globalThis.__MFE_DEVTOOLS__ = devtools',
  ],

  invalid: [
    {
      code: 'globalThis.fetch = instrumentedFetch',
      errors: [{ messageId: 'fetch', data: { target: 'globalThis.fetch' } }],
    },
    {
      code: 'window.fetch = instrumentedFetch',
      errors: [{ messageId: 'fetch' }],
    },
    {
      code: "window['fetch'] = instrumentedFetch",
      errors: [{ messageId: 'fetch' }],
    },
    {
      code: 'self.fetch = instrumentedFetch',
      errors: [{ messageId: 'fetch' }],
    },
    {
      code: '(globalThis as unknown as { fetch: unknown }).fetch = instrumentedFetch',
      errors: [{ messageId: 'fetch' }],
    },
    {
      code: 'delete window.fetch',
      errors: [{ messageId: 'fetch' }],
    },
    {
      code: "Object.defineProperty(globalThis, 'fetch', { value: instrumentedFetch })",
      errors: [{ messageId: 'fetch', data: { target: 'globalThis.fetch' } }],
    },
    {
      code: "Reflect.defineProperty(window, 'fetch', { value: instrumentedFetch })",
      errors: [{ messageId: 'fetch' }],
    },
    {
      code: 'history.pushState = patchedPushState',
      errors: [{ messageId: 'history', data: { target: 'history.pushState' } }],
    },
    {
      code: 'window.history.replaceState = patchedReplaceState',
      errors: [{ messageId: 'history' }],
    },
    {
      code: 'window.history = fakeHistory',
      errors: [{ messageId: 'history' }],
    },
    {
      code: 'window.addEventListener = patchedAdd',
      errors: [{ messageId: 'listeners', data: { target: 'window.addEventListener' } }],
    },
    {
      code: 'document.removeEventListener = patchedRemove',
      errors: [{ messageId: 'listeners' }],
    },
    {
      code: 'globalThis.addEventListener = patchedAdd',
      errors: [{ messageId: 'listeners' }],
    },
    {
      code: 'export function bootstrap() {\n  window.fetch = instrumentedFetch\n}',
      errors: [{ messageId: 'fetch' }],
    },
  ],
})

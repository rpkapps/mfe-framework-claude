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
    // A local binding that happens to be spelled like the global.
    'function withFakeWindow(window: { fetch: unknown }) { window.fetch = stub }',
    'const window = { fetch: null }\nwindow.fetch = stub',
    // An imported object named `history` is the router's, not the realm's.
    "import { history } from './router.ts'\nhistory.pushState = noop",
    "import { document } from './virtual-dom.ts'\ndocument.addEventListener = noop",
    // A DOM element is not a global.
    'element.addEventListener = spy',
    'this.fetch = stub',
    // Declaring a property on an unrelated object.
    'const transport = { fetch: stub, addEventListener: noop }',
    // Defining a property on something that is not a global.
    "Object.defineProperty(target, 'fetch', { value: stub })",
    // A different property on the global object.
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
      // TypeScript spelling: the assertion wrapper does not change the target.
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
      // Inside a framework bootstrap the patch is just as shared.
      code: 'export function bootstrap() {\n  window.fetch = instrumentedFetch\n}',
      errors: [{ messageId: 'fetch' }],
    },
  ],
})

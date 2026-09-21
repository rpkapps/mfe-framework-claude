import rule from './no-widget-global-effects.ts'
import { createRuleTester } from '../__tests__/rule-tester.ts'

const WIDGET_SCOPES = [{ widgetScopes: ['examples/*/src/widgets/**', 'src/widgets/**'] }]
const WIDGET_FILE = 'examples/reports/src/widgets/summary/panel.ts'
const APP_FILE = 'examples/reports/src/app/routes/index.ts'

createRuleTester().run('mfe/no-widget-global-effects', rule, {
  valid: [
    // With no Widget scopes configured the rule is inert: ownership is declared, never guessed.
    {
      code: "history.pushState(null, '', '/reports')",
      filename: WIDGET_FILE,
    },
    {
      code: "document.title = 'Reports'",
      filename: 'src/widgets/summary/panel.ts',
    },
    {
      code: "history.pushState(null, '', '/reports')\ndocument.title = 'Reports'",
      filename: APP_FILE,
      options: WIDGET_SCOPES,
    },
    {
      code: "export function Panel({ emit }) {\n  return () => emit('navigate', { to: '/reports' })\n}",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    {
      code: "import { useNavigate } from '@tanstack/react-router'\nexport function Panel() {\n  const navigate = useNavigate()\n  return () => navigate({ to: '/reports' })\n}",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    {
      code: "const history = createMemoryHistory()\nhistory.pushState(null, '', '/reports')",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    {
      code: "import { history } from './router.ts'\nhistory.replaceState(null, '', '/reports')",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    {
      code: "export function render(document: Document) {\n  document.title = 'ignored'\n}",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    // Querying and mutating the Widget's own subtree is exactly what a Widget is for.
    {
      code: "const root = document.querySelector('.mfe-widget-root')",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    {
      code: "const row = document.querySelector('[data-row-title]')",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    {
      code: "container.appendChild(node)\nnode.title = 'Total revenue'",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    // Reading page state is not mutating it.
    {
      code: 'export const current = document.title',
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
  ],

  invalid: [
    {
      code: "history.pushState(null, '', '/reports')",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [{ messageId: 'history', data: { access: 'history.pushState' } }],
    },
    {
      code: "window.history.replaceState(null, '', '/reports')",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [{ messageId: 'history', data: { access: 'window.history.replaceState' } }],
    },
    {
      code: 'history.back()',
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [{ messageId: 'history', data: { access: 'history.back' } }],
    },
    {
      code: 'globalThis.history.go(-1)',
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [{ messageId: 'history', data: { access: 'globalThis.history.go' } }],
    },
    {
      code: "export function Panel() {\n  document.title = 'Reports'\n}",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [{ messageId: 'title', data: { access: 'document.title' } }],
    },
    {
      code: "window.document.title = 'Reports'",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [{ messageId: 'title', data: { access: 'window.document.title' } }],
    },
    {
      code: 'const icon = document.querySelector(\'link[rel="icon"]\')',
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [
        {
          messageId: 'headMetadata',
          data: { access: 'document.querySelector(\'link[rel="icon"]\')' },
        },
      ],
    },
    {
      code: 'const tag = document.querySelector(\'meta[name="description"]\')',
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [
        {
          messageId: 'headMetadata',
          data: { access: 'document.querySelector(\'meta[name="description"]\')' },
        },
      ],
    },
    {
      code: 'document.head.appendChild(iconLink)',
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [{ messageId: 'headMetadata', data: { access: 'document.head.appendChild' } }],
    },
    {
      code: "document.head.innerHTML = '<title>Reports</title>'",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [{ messageId: 'headMetadata', data: { access: 'document.head.innerHTML' } }],
    },
    {
      code: "(window as Window).history.pushState(null, '', '/reports')",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [{ messageId: 'history', data: { access: '(window as Window).history.pushState' } }],
    },
    {
      code: "document.title = 'Reports'",
      filename: 'src/widgets/summary/panel.ts',
      options: WIDGET_SCOPES,
      errors: [{ messageId: 'title', data: { access: 'document.title' } }],
    },
  ],
})

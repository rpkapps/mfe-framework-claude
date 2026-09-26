import rule from './no-widget-global-router.ts'
import { createRuleTester } from '../__tests__/rule-tester.ts'

const WIDGET_SCOPES = [{ widgetScopes: ['examples/*/src/widgets/**', 'src/widgets/**'] }]
const WIDGET_FILE = 'examples/reports/src/widgets/summary/panel.ts'
const APP_FILE = 'examples/reports/src/app/routes/index.ts'
const IMPORTS = "import { inject } from '@angular/core'\nimport { Router } from '@angular/router'\n"

createRuleTester().run('mfe/no-widget-global-router', rule, {
  valid: [
    // With no Widget scopes configured the rule is inert: ownership is declared, never guessed.
    {
      code: `${IMPORTS}const router = inject(Router)\nrouter.navigate(['/reports'])`,
      filename: WIDGET_FILE,
    },
    {
      code: `${IMPORTS}const router = inject(Router)\nrouter.navigate(['/reports'])`,
      filename: APP_FILE,
      options: WIDGET_SCOPES,
    },
    // Reading Router state, or building a URL without navigating, is not this rule's concern.
    {
      code: `${IMPORTS}const router = inject(Router)\nconst tree = router.createUrlTree(['/reports'])`,
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    // The repair the message asks for: emit a declared event and let the owning App navigate.
    {
      code: "import { injectWidgetEmit } from '@company/mfe-angular'\nexport function useNavigate() {\n  const emit = injectWidgetEmit()\n  return () => emit('navigate', { to: '/reports' })\n}",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    // Shadowing: a same-named local `Router` from somewhere else entirely.
    {
      code: "import { inject } from '@angular/core'\nimport { Router } from './local-router.ts'\nconst router = inject(Router)\nrouter.navigate(['/reports'])",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    // Shadowing: `inject` from somewhere other than `@angular/core`.
    {
      code: "import { inject } from './my-di.ts'\nimport { Router } from '@angular/router'\nconst router = inject(Router)\nrouter.navigate(['/reports'])",
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    // A field of the same name on an unrelated class does not make every `this.router` a Router.
    {
      code: `${IMPORTS}class Other {\n  router = { navigate: () => {} }\n}\nclass Item {\n  readonly other = new Other()\n  go(): void {\n    this.other.router.navigate(['/reports'])\n  }\n}`,
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
    // A private `#router` is a different member from a public `router`.
    {
      code: `${IMPORTS}class Item {\n  readonly #router = inject(Router)\n  router = { navigate: () => {} }\n  go(): void {\n    this.router.navigate(['/reports'])\n  }\n}`,
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
    },
  ],

  invalid: [
    {
      code: `${IMPORTS}const router = inject(Router)\nrouter.navigate(['/reports'])`,
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [
        {
          messageId: 'navigate',
          data: { access: 'router.navigate', emitAccess: '`injectWidgetEmit()`' },
        },
      ],
    },
    {
      code: `${IMPORTS}const router = inject(Router)\nrouter.navigateByUrl('/reports')`,
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [
        {
          messageId: 'navigate',
          data: { access: 'router.navigateByUrl', emitAccess: '`injectWidgetEmit()`' },
        },
      ],
    },
    {
      code: `${IMPORTS}inject(Router).navigate(['/reports'])`,
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [
        {
          messageId: 'navigate',
          data: { access: 'inject(Router).navigate', emitAccess: '`injectWidgetEmit()`' },
        },
      ],
    },
    {
      code: `${IMPORTS}class Item {\n  private readonly router = inject(Router)\n  open(): void {\n    this.router.navigate(['/reports'])\n  }\n}`,
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [
        {
          messageId: 'navigate',
          data: { access: 'this.router.navigate', emitAccess: '`injectWidgetEmit()`' },
        },
      ],
    },
    {
      code: `${IMPORTS}class Item {\n  readonly router = inject(Router)\n  open(): void {\n    this.router.navigateByUrl('/reports')\n  }\n}`,
      filename: WIDGET_FILE,
      options: [
        { widgetScopes: WIDGET_SCOPES[0]!.widgetScopes, emitAccess: 'the widget emit token' },
      ],
      errors: [
        {
          messageId: 'navigate',
          data: { access: 'this.router.navigateByUrl', emitAccess: 'the widget emit token' },
        },
      ],
    },
    {
      code: `${IMPORTS}class Item {\n  readonly #router = inject(Router)\n  open(): void {\n    void this.#router.navigate(['/reports'])\n  }\n}`,
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [
        {
          messageId: 'navigate',
          data: { access: 'this.#router.navigate', emitAccess: '`injectWidgetEmit()`' },
        },
      ],
    },
    // A method declared above the field it navigates through.
    {
      code: `${IMPORTS}class Item {\n  open(): void {\n    void this.router.navigateByUrl('/reports')\n  }\n  private readonly router = inject(Router)\n}`,
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [
        {
          messageId: 'navigate',
          data: { access: 'this.router.navigateByUrl', emitAccess: '`injectWidgetEmit()`' },
        },
      ],
    },
    // A function declared above the variable it navigates through.
    {
      code: `${IMPORTS}function open(): void {\n  void router.navigate(['/reports'])\n}\nconst router = inject(Router)\nopen()`,
      filename: WIDGET_FILE,
      options: WIDGET_SCOPES,
      errors: [
        {
          messageId: 'navigate',
          data: { access: 'router.navigate', emitAccess: '`injectWidgetEmit()`' },
        },
      ],
    },
  ],
})

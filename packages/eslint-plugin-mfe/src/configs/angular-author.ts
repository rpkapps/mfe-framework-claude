/**
 * The `angular` author preset, for Angular 19 zoneless MFE Apps and Widgets: the mirror of the
 * `react` preset's `author()`, built on the same neutral layers and the five MFE rules — including
 * the Router analogue of `no-widget-global-effects` — with Angular's own APIs named in their
 * messages and Angular's own lifecycle boundaries in place of React's.
 */

import type { Linter } from 'eslint'
import {
  asParser,
  authorBase,
  mfePlugin,
  testScopeOverrides,
  typeScriptPlugins,
  type PresetOptions,
} from './shared.ts'
import {
  applicationBoundaryPaths,
  authorTelemetryPatterns,
  deepImportPattern,
  MODULE_FEDERATION_PATTERN,
  restrictedImports,
  singleSpaPattern,
} from './restricted-imports.ts'
import {
  ANGULAR_TEMPLATE_RECOMMENDED_RULES,
  ANGULAR_TS_RECOMMENDED_RULES,
  loadAngularPeers,
} from './angular-peers.ts'
import {
  ANGULAR_ADAPTER_MODULE,
  ANGULAR_EMIT_ACCESS,
  ANGULAR_TELEMETRY_HOOK,
  angularMfeRules,
} from './angular-naming.ts'

/** Where the inline-template processor's virtual `.html` fragments, and real template files, land. */
export const DEFAULT_ANGULAR_TEMPLATE_FILES: readonly string[] = ['**/*.html']

export interface AngularPresetOptions extends PresetOptions {
  readonly templateFiles?: readonly string[] | undefined
}

const ZONELESS_MESSAGE =
  "Lifecycle boundary: the Angular adapter runs zoneless — every mount is its own application with its own change-detection scheduler. `zone.js` is never installed, and importing it, even for its side effects, reintroduces a page-wide zone that fights the adapter's scheduler."

const NG_ZONE_MESSAGE =
  'Lifecycle boundary: `NgZone` assumes zone.js is already patching the page, which the adapter never does. Read `injectMfeSignal()` (@company/mfe-angular) for cancellation, and let the adapter schedule change detection around each mount.'

const APPLICATION_OWNERSHIP_MESSAGE =
  'Lifecycle boundary: the host owns the Angular application. An MFE that calls `bootstrapApplication` or `createApplication` itself detaches from the mount lifecycle, so unmount and error handling stop working. Export a definition from `createApp` or `createWidget` (@company/mfe-angular) and let the host mount it.'

const PLATFORM_BROWSER_DYNAMIC_MESSAGE =
  'Lifecycle boundary: `platformBrowserDynamic` bootstraps a whole browser platform, which the host already owns for every mount on the page. Export a definition from `createApp` or `createWidget` (@company/mfe-angular) and let the host mount it.'

export function angular(options: AngularPresetOptions = {}): Linter.Config[] {
  const base = authorBase(options, 'angular')
  const { files, widgetScopes, storageAllowedScopes, extraPaths, extraPatterns } = base
  const templateFiles = options.templateFiles ?? DEFAULT_ANGULAR_TEMPLATE_FILES

  const peers = loadAngularPeers()

  return [
    ...base.layers,
    {
      // The template plugin is registered here too, only so `processor` can reference it by name;
      // its rules apply through the separate `.html`-scoped object below, angular-eslint's own split.
      name: 'mfe/angular-eslint-ts-recommended',
      files: [...files],
      plugins: {
        '@angular-eslint': peers.tsPlugin,
        '@angular-eslint/template': peers.templatePlugin,
      },
      processor: '@angular-eslint/template/extract-inline-html',
      rules: { ...ANGULAR_TS_RECOMMENDED_RULES },
    },
    {
      name: 'mfe/angular-eslint-template-recommended',
      files: [...templateFiles],
      languageOptions: { parser: asParser(peers.templateParser) },
      plugins: { '@angular-eslint/template': peers.templatePlugin },
      rules: { ...ANGULAR_TEMPLATE_RECOMMENDED_RULES },
    },
    {
      // One config object, and one `no-restricted-imports` call: flat config keeps only the last
      // matching object's setting for a given rule id, so the zoneless bans and the application
      // boundary have to be one call, not two objects that would silently cancel each other out.
      name: 'mfe/angular/boundaries',
      files: [...files],
      plugins: typeScriptPlugins,
      rules: {
        '@typescript-eslint/no-restricted-imports': restrictedImports(
          [
            { name: 'zone.js', message: ZONELESS_MESSAGE },
            { name: '@angular/core', importNames: ['NgZone'], message: NG_ZONE_MESSAGE },
            {
              name: '@angular/platform-browser',
              importNames: ['bootstrapApplication', 'createApplication'],
              message: APPLICATION_OWNERSHIP_MESSAGE,
            },
            {
              name: '@angular/platform-browser-dynamic',
              message: PLATFORM_BROWSER_DYNAMIC_MESSAGE,
            },
            ...applicationBoundaryPaths([ANGULAR_ADAPTER_MODULE]),
            ...extraPaths,
          ],
          [
            { group: ['zone.js/*'], message: ZONELESS_MESSAGE },
            deepImportPattern([ANGULAR_ADAPTER_MODULE]),
            singleSpaPattern([ANGULAR_ADAPTER_MODULE]),
            MODULE_FEDERATION_PATTERN,
            ...authorTelemetryPatterns(ANGULAR_ADAPTER_MODULE, ANGULAR_TELEMETRY_HOOK),
            ...extraPatterns,
          ],
        ),
      },
    },
    {
      name: 'mfe/angular/rules',
      files: [...files],
      plugins: { mfe: mfePlugin },
      rules: {
        ...angularMfeRules(storageAllowedScopes),
        'mfe/no-widget-global-effects': [
          'error',
          { widgetScopes: [...widgetScopes], emitAccess: ANGULAR_EMIT_ACCESS },
        ],
        'mfe/no-widget-global-router': [
          'error',
          { widgetScopes: [...widgetScopes], emitAccess: ANGULAR_EMIT_ACCESS },
        ],
      },
    },
    base.generated,
    testScopeOverrides(files, 'mfe/angular/tests'),
  ]
}

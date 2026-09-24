/**
 * The generated container's own `package.json`. The build reads it (`containerRoot/package.json`)
 * for the container's name and version and for the dependency list its federation sharing is
 * intersected with, so this is a real manifest, not a stub — matching how `examples/alert-panel`
 * and `examples/operations` each carry their own in this repository. It has no scripts: the Nx
 * targets in `project.json` are how the container is built, served and tested.
 */

import type { NormalizedSchema } from './normalize.ts'
import type { MfeTemplate } from './schema.ts'
import {
  ANALOG_VITE_PLUGIN_ANGULAR_VERSION,
  ANALOG_VITEST_ANGULAR_VERSION,
  ANGULAR_CDK_VERSION,
  ANGULAR_DEVKIT_VERSION,
  ANGULAR_ESLINT_VERSION,
  ANGULAR_VERSION,
  ESLINT_VERSION,
  FRAMEWORK_PACKAGE_VERSION,
  JITI_VERSION,
  JSDOM_VERSION,
  PRIMENG_VERSION,
  RXJS_VERSION,
  TYPESCRIPT_VERSION,
  VITE_VERSION,
  VITEST_VERSION,
  ZOD_VERSION,
} from './versions.ts'

export interface ProjectPackageJson {
  readonly name: string
  readonly version: string
  readonly private: true
  readonly type: 'module'
  readonly mfe: { readonly port: number; readonly definitions: readonly string[] }
  readonly exports?: Readonly<Record<string, string>>
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
}

export interface ProjectDependencies {
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
}

/** Sorted so a container's manifest reads the way a human would have typed it. */
function sorted(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)))
}

/**
 * The container imports its adapter and nothing beneath it: `@company/mfe-core` and
 * `@company/mfe-runtime` reach it through `@company/mfe-angular`, and the build shares them on the
 * adapter's behalf, so listing them here would only invite a second, drifting version.
 */
export function projectDependencies(nxAngularVersion: string): ProjectDependencies {
  return {
    dependencies: sorted({
      // `provideNoopAnimations()` for PrimeNG's overlays lives here.
      '@angular/animations': ANGULAR_VERSION,
      '@angular/cdk': ANGULAR_CDK_VERSION,
      '@angular/common': ANGULAR_VERSION,
      '@angular/core': ANGULAR_VERSION,
      '@angular/forms': ANGULAR_VERSION,
      '@angular/platform-browser': ANGULAR_VERSION,
      '@angular/router': ANGULAR_VERSION,
      '@company/mfe-angular': FRAMEWORK_PACKAGE_VERSION,
      primeng: PRIMENG_VERSION,
      rxjs: RXJS_VERSION,
      zod: ZOD_VERSION,
    }),
    devDependencies: sorted({
      '@analogjs/vite-plugin-angular': ANALOG_VITE_PLUGIN_ANGULAR_VERSION,
      // Not imported directly in vitest.config.mts; @analogjs/vite-plugin-angular's JIT
      // transform resolves it as a peer at run time.
      '@analogjs/vitest-angular': ANALOG_VITEST_ANGULAR_VERSION,
      // What @nx/angular:webpack-browser and :dev-server delegate to.
      '@angular-devkit/build-angular': ANGULAR_DEVKIT_VERSION,
      '@angular-eslint/eslint-plugin': ANGULAR_ESLINT_VERSION,
      '@angular-eslint/eslint-plugin-template': ANGULAR_ESLINT_VERSION,
      '@angular-eslint/template-parser': ANGULAR_ESLINT_VERSION,
      '@angular/compiler': ANGULAR_VERSION,
      '@angular/compiler-cli': ANGULAR_VERSION,
      // withMfe() and the generate executor run at build time.
      '@company/mfe-nx': FRAMEWORK_PACKAGE_VERSION,
      // The generated eslint.config.ts imports its `angular` subpath.
      '@company/eslint-plugin-mfe': FRAMEWORK_PACKAGE_VERSION,
      '@nx/angular': nxAngularVersion,
      eslint: ESLINT_VERSION,
      // How ESLint loads the generated eslint.config.ts.
      jiti: JITI_VERSION,
      jsdom: JSDOM_VERSION,
      typescript: TYPESCRIPT_VERSION,
      vite: VITE_VERSION,
      vitest: VITEST_VERSION,
    }),
  }
}

export function buildProjectPackageJson(
  options: NormalizedSchema,
  template: MfeTemplate,
  dependencies: ProjectDependencies,
): ProjectPackageJson {
  return {
    name: options.packageName,
    version: '0.1.0',
    private: true,
    type: 'module',
    mfe: { port: options.port, definitions: [options.id] },
    ...(template === 'widget'
      ? { exports: { './contracts': `./.mfe/widgets/${options.id}.contract.ts` } }
      : {}),
    ...dependencies,
  }
}

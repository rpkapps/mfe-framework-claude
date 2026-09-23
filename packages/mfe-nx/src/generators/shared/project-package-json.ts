/**
 * The generated container's own `package.json`. `@company/mfe-rspack` reads this file at build
 * time (`containerRoot/package.json`) for `mfe.port` and for the dependency list its federation
 * sharing config intersects against, so this is a real manifest, not a stub — matching how
 * `examples/alert-panel` and `examples/operations` each carry their own in this repository.
 */

import {
  ANALOG_VITE_PLUGIN_ANGULAR_VERSION,
  ANALOG_VITEST_ANGULAR_VERSION,
  ANGULAR_VERSION,
  FRAMEWORK_PACKAGE_VERSION,
  JSDOM_VERSION,
  MODULE_FEDERATION_ENHANCED_VERSION,
  RSPACK_VERSION,
  RXJS_VERSION,
  TAILWIND_VERSION,
  TYPESCRIPT_VERSION,
  VITE_VERSION,
  VITEST_VERSION,
  ZOD_VERSION,
} from './versions.ts'
import type { NormalizedSchema } from './normalize.ts'
import type { MfeTemplate } from './schema.ts'

export interface ProjectPackageJson {
  readonly name: string
  readonly version: string
  readonly private: true
  readonly type: 'module'
  readonly mfe: { readonly port: number; readonly definitions: readonly string[] }
  readonly exports?: Readonly<Record<string, string>>
  readonly scripts: Readonly<Record<string, string>>
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
}

/** Sorted so a container's manifest reads the way a human would have typed it. */
function sorted(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)))
}

const SCRIPTS: Readonly<Record<string, string>> = {
  generate: 'mfe-generate',
  build: 'mfe-generate && rspack build --mode production',
  serve: 'mfe-generate && rspack serve',
  test: 'mfe-generate && vitest run',
  typecheck: 'mfe-generate && tsc --noEmit',
}

export function projectDependencies(): {
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
} {
  return {
    dependencies: sorted({
      '@angular/common': ANGULAR_VERSION,
      '@angular/core': ANGULAR_VERSION,
      '@angular/platform-browser': ANGULAR_VERSION,
      '@angular/router': ANGULAR_VERSION,
      '@company/mfe-angular': FRAMEWORK_PACKAGE_VERSION,
      '@company/mfe-core': FRAMEWORK_PACKAGE_VERSION,
      '@company/mfe-host': FRAMEWORK_PACKAGE_VERSION,
      rxjs: RXJS_VERSION,
      zod: ZOD_VERSION,
    }),
    devDependencies: sorted({
      '@analogjs/vite-plugin-angular': ANALOG_VITE_PLUGIN_ANGULAR_VERSION,
      // Not imported directly in vitest.config.mts; @analogjs/vite-plugin-angular's JIT
      // transform resolves it as a peer at run time.
      '@analogjs/vitest-angular': ANALOG_VITEST_ANGULAR_VERSION,
      // `@nx/angular-rspack` only peers `@angular/build` (its AOT compiler pipeline); left
      // unpinned, npm's resolver is free to satisfy that peer with the newest version in range —
      // which tracks a newer Angular major and pulls in an `@angular/compiler` peer this
      // project's own pinned 19.2.25 cannot satisfy. Pinning it here keeps that resolution on
      // Angular 19.
      '@angular/build': ANGULAR_VERSION,
      '@angular/compiler': ANGULAR_VERSION,
      '@angular/compiler-cli': ANGULAR_VERSION,
      '@company/mfe-rspack': FRAMEWORK_PACKAGE_VERSION,
      '@module-federation/enhanced': MODULE_FEDERATION_ENHANCED_VERSION,
      '@rspack/cli': RSPACK_VERSION,
      '@rspack/core': RSPACK_VERSION,
      jsdom: JSDOM_VERSION,
      tailwindcss: TAILWIND_VERSION,
      typescript: TYPESCRIPT_VERSION,
      vite: VITE_VERSION,
      vitest: VITEST_VERSION,
    }),
  }
}

export function buildProjectPackageJson(
  options: NormalizedSchema,
  template: MfeTemplate,
  angularRspackVersion: string,
): ProjectPackageJson {
  const { dependencies, devDependencies } = projectDependencies()
  devDependencies['@nx/angular-rspack'] = angularRspackVersion

  return {
    name: options.packageName,
    version: '0.1.0',
    private: true,
    type: 'module',
    mfe: { port: options.port, definitions: [options.id] },
    ...(template === 'widget'
      ? { exports: { './contracts': `./.mfe/widgets/${options.id}.contract.ts` } }
      : {}),
    scripts: SCRIPTS,
    dependencies,
    devDependencies: sorted(devDependencies),
  }
}

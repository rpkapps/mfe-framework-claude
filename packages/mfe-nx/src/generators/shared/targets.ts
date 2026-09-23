/**
 * The container builds with Nx's Angular webpack builder and `withMfe()` as its
 * `customWebpackConfig`, and is served by the matching dev server. Every other target depends on
 * `generate`: the build's `.mfe/*` modules have to exist before webpack, Vitest or `tsc` can
 * resolve them, exactly as an authored container's own scripts do (see `packages/create-mfe`).
 */

import { joinPathFragments, type TargetConfiguration } from '@nx/devkit'

import type { NormalizedSchema } from './normalize.ts'

/** The dev server a shell fetches the container from lives on another origin, always. */
const CROSS_ORIGIN_HEADERS = { 'Access-Control-Allow-Origin': '*' }

export function buildTargets(options: NormalizedSchema): Record<string, TargetConfiguration> {
  const root = options.projectRoot
  const inRoot = (path: string): string => joinPathFragments(root, path)

  return {
    generate: {
      executor: '@company/mfe-nx:generate',
      // Cheap, and it seeds `public/runtime-config.json` beside what it generates, so a cached
      // replay would restore half of what it does.
      cache: false,
    },
    build: {
      executor: '@nx/angular:webpack-browser',
      dependsOn: ['generate', '^build'],
      outputs: ['{options.outputPath}'],
      cache: true,
      options: {
        outputPath: joinPathFragments('dist', root),
        index: inRoot('src/index.html'),
        // withMfe() makes the generated stub the only entry; naming it here keeps the builder's
        // own view of the project truthful.
        main: inRoot('.mfe/entries/container.ts'),
        tsConfig: inRoot('tsconfig.app.json'),
        // Zoneless: nothing patches timers or DOM events, so there is nothing to polyfill.
        polyfills: [],
        assets: [{ glob: '**/*', input: inRoot('public') }],
        // src/styles.css reaches the page through the generated container stylesheet, which
        // ships with every exposed entry; a global `styles` bundle is never loaded by a shell.
        styles: [],
        scripts: [],
        customWebpackConfig: { path: inRoot('webpack.config.ts') },
      },
      configurations: {
        production: {
          optimization: true,
          outputHashing: 'all',
          sourceMap: false,
          namedChunks: false,
          extractLicenses: true,
        },
        development: {
          optimization: false,
          outputHashing: 'none',
          sourceMap: true,
          namedChunks: true,
          extractLicenses: false,
          buildOptimizer: false,
          vendorChunk: false,
        },
      },
      defaultConfiguration: 'production',
    },
    serve: {
      executor: '@nx/angular:dev-server',
      dependsOn: ['generate'],
      options: { port: options.port, headers: CROSS_ORIGIN_HEADERS },
      configurations: {
        production: { buildTarget: `${options.projectName}:build:production` },
        development: { buildTarget: `${options.projectName}:build:development` },
      },
      defaultConfiguration: 'development',
    },
    test: {
      executor: 'nx:run-commands',
      dependsOn: ['generate'],
      options: { command: 'vitest run', cwd: '{projectRoot}' },
    },
    typecheck: {
      executor: 'nx:run-commands',
      dependsOn: ['generate'],
      options: {
        command: 'tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.spec.json',
        cwd: '{projectRoot}',
      },
    },
  }
}

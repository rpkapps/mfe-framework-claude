/** Every target runs `mfe-generate` first: the build's `.mfe/*` modules and route metadata have
 * to exist before `rspack`, `vitest` or `tsc` can resolve them, exactly as an authored container's
 * own scripts do (see `packages/create-mfe`). Plain `nx:run-commands` over the Rspack CLI, rather
 * than an `@nx/rspack` executor, so this generator carries no version coupling to that package;
 * the README documents the executor-based alternative. */

import type { TargetConfiguration } from '@nx/devkit'

export function buildTargets(): Record<string, TargetConfiguration> {
  return {
    generate: {
      executor: 'nx:run-commands',
      options: { command: 'mfe-generate', cwd: '{projectRoot}' },
    },
    build: {
      executor: 'nx:run-commands',
      options: { command: 'mfe-generate && rspack build --mode production', cwd: '{projectRoot}' },
      outputs: ['{projectRoot}/dist'],
      cache: true,
      dependsOn: ['^build'],
    },
    serve: {
      executor: 'nx:run-commands',
      options: { command: 'mfe-generate && rspack serve', cwd: '{projectRoot}' },
    },
    test: {
      executor: 'nx:run-commands',
      options: { command: 'mfe-generate && vitest run', cwd: '{projectRoot}' },
    },
    typecheck: {
      executor: 'nx:run-commands',
      options: { command: 'mfe-generate && tsc --noEmit', cwd: '{projectRoot}' },
    },
  }
}

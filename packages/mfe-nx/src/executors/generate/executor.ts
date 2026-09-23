/**
 * `@company/mfe-nx:generate`: the same generation the build runs, so a fresh clone's typecheck,
 * tests and editor resolve `#mfe/*` without a build. Every other target of a generated container
 * depends on it.
 */

import { join } from 'node:path'

import { logger, type ExecutorContext } from '@nx/devkit'

import {
  createBuildError,
  seedLocalRuntimeConfig,
  summarizeGeneration,
  type GenerationSummary,
} from '@company/mfe-build'

import { generateContainer } from '../../generate/container.ts'

/** The executor takes no options: the container is the project it runs for. */
export type GenerateExecutorOptions = Readonly<Record<string, never>>

/**
 * Writes the generated modules, then adds any declared default missing from the developer's
 * `.mfe/runtime-config.json`, which the dev server serves; a value already there is never changed.
 */
export function generate(containerRoot: string): GenerationSummary {
  const { plan, written } = generateContainer({ containerRoot })
  return summarizeGeneration(
    plan,
    written.map(file => file.path),
    seedLocalRuntimeConfig(plan),
  )
}

export default function generateExecutor(
  _options: GenerateExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  let result: GenerationSummary
  try {
    result = generate(containerRootOf(context))
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error))
    return Promise.resolve({ success: false })
  }

  if (result.paths.length === 0) {
    logger.info(`${result.packageName}: generated output is already current.`)
  } else {
    logger.info([result.packageName, ...result.paths.map(path => `  ${path}`)].join('\n'))
  }
  for (const note of result.notes) logger.warn(note)

  // Nothing else reports these when only the tests or the typecheck run, so they fail here too.
  for (const diagnostic of result.diagnostics) logger.error(diagnostic.message)
  return Promise.resolve({ success: result.diagnostics.length === 0 })
}

function containerRootOf(context: ExecutorContext): string {
  const project =
    context.projectName === undefined
      ? undefined
      : context.projectsConfigurations.projects[context.projectName]

  if (project === undefined) {
    throw createBuildError({
      file: join(context.root, 'nx.json'),
      operation: 'find the container to generate for',
      expected: 'the executor to run as a target of a project',
      observed:
        context.projectName === undefined
          ? 'no project'
          : `a project '${context.projectName}' the workspace does not configure`,
      declaredBy: 'The generate executor',
      repair: 'Run it through the project target: nx run <project>:generate.',
    })
  }

  return join(context.root, project.root)
}

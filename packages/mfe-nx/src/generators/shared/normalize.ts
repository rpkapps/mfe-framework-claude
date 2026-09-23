/** Turns a generator's raw schema into the values every template and target needs. Nx's own
 * `determineProjectNameAndRootOptions` is internal, so `projectRoot` is computed the same simple
 * way it is: the given `directory`, or `apps/<name>`. */

import { joinPathFragments, names, offsetFromRoot } from '@nx/devkit'

import { assertUsableId } from './id.ts'
import type { MfeGeneratorSchema, MfeTemplate } from './schema.ts'

export interface NormalizedSchema {
  readonly projectName: string
  readonly id: string
  readonly projectRoot: string
  readonly offsetFromRoot: string
  readonly port: number
  readonly packageName: string
  readonly skipFormat: boolean
  readonly skipPackageJson: boolean
  readonly tags: readonly string[]
}

const DEFAULT_PORT: Readonly<Record<MfeTemplate, number>> = { app: 3101, widget: 3103 }

export function normalizeOptions(
  schema: MfeGeneratorSchema,
  template: MfeTemplate,
): NormalizedSchema {
  const projectName = names(schema.name).fileName
  const id = schema.id ?? projectName
  assertUsableId(id)

  const projectRoot = schema.directory ?? joinPathFragments('apps', projectName)
  const tags =
    schema.tags === undefined
      ? []
      : schema.tags
          .split(',')
          .map(tag => tag.trim())
          .filter(tag => tag.length > 0)

  return {
    projectName,
    id,
    projectRoot,
    offsetFromRoot: offsetFromRoot(projectRoot),
    port: schema.port ?? DEFAULT_PORT[template],
    packageName: schema.packageName ?? `@example/${id}`,
    skipFormat: schema.skipFormat === true,
    skipPackageJson: schema.skipPackageJson === true,
    tags,
  }
}

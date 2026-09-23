import type { GeneratorCallback, Tree } from '@nx/devkit'

import { generateProject } from '../shared/generate-project.ts'
import type { MfeGeneratorSchema } from '../shared/schema.ts'

/** `nx g @company/mfe-nx:widget <name>`. Registered as the `widget` generator's factory. */
export default async function widgetGenerator(
  tree: Tree,
  schema: MfeGeneratorSchema,
): Promise<GeneratorCallback> {
  return await generateProject(tree, schema, 'widget')
}

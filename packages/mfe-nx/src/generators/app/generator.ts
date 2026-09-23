import type { GeneratorCallback, Tree } from '@nx/devkit'

import { generateProject } from '../shared/generate-project.ts'
import type { MfeGeneratorSchema } from '../shared/schema.ts'

/** `nx g @company/mfe-nx:app <name>`. Registered as the `app` generator's factory. */
export default async function appGenerator(
  tree: Tree,
  schema: MfeGeneratorSchema,
): Promise<GeneratorCallback> {
  return await generateProject(tree, schema, 'app')
}

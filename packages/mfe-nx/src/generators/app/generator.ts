import { join } from 'node:path'

import type { GeneratorCallback, Tree } from '@nx/devkit'

import { generateProject } from '../shared/generate-project.ts'
import type { MfeGeneratorSchema } from '../shared/schema.ts'

/** `nx g @company/mfe-nx:app <name>`. Registered as the `app` generator's factory. */
export default async function appGenerator(
  tree: Tree,
  schema: MfeGeneratorSchema,
): Promise<GeneratorCallback> {
  return await generateProject({
    tree,
    schema,
    template: 'app',
    filesRoot: join(__dirname, 'files'),
    commonFilesRoot: join(__dirname, '../shared/files-common'),
  })
}

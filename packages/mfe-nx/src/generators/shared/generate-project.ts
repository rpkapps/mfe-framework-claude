/**
 * The body both `app` and `widget` generators share: normalize options, register the project,
 * write its files from the two template folders (the files every container needs, then the ones
 * specific to this template), give it its own manifest and, unless skipped, add the workspace's
 * dependencies and format what was written.
 */

import { join } from 'node:path'

import {
  addDependenciesToPackageJson,
  addProjectConfiguration,
  formatFiles,
  generateFiles,
  installPackagesTask,
  runTasksInSerial,
  writeJson,
  type GeneratorCallback,
  type Tree,
} from '@nx/devkit'

import { toCamel, toPascal } from './names.ts'
import { normalizeOptions, type NormalizedSchema } from './normalize.ts'
import { pinWorkspaceTypeScript, readNxVersion } from './nx-workspace.ts'
import { buildProjectPackageJson, projectDependencies } from './project-package-json.ts'
import type { MfeGeneratorSchema, MfeTemplate } from './schema.ts'
import { buildTargets } from './targets.ts'
import { nxAngularVersionFor } from './versions.ts'

export interface GenerateProjectOptions {
  readonly tree: Tree
  readonly schema: MfeGeneratorSchema
  readonly template: MfeTemplate
  /** Absolute path to this generator's own `files` folder (`path.join(__dirname, 'files')`). */
  readonly filesRoot: string
  /** Absolute path to the files every container needs, regardless of template. */
  readonly commonFilesRoot: string
}

function templateSubstitutions(options: NormalizedSchema, template: MfeTemplate) {
  return {
    ...options,
    template,
    isApp: template === 'app',
    isWidget: template === 'widget',
    // The Widget component's class name and the contract's variable name; harmless when a
    // template does not reference them.
    camel: toCamel(options.id),
    pascal: toPascal(options.id),
  }
}

export async function generateProject({
  tree,
  schema,
  template,
  filesRoot,
  commonFilesRoot,
}: GenerateProjectOptions): Promise<GeneratorCallback> {
  const options = normalizeOptions(schema, template)
  // Checked before anything is written, so an unsupported workspace is left as it was.
  const dependencies = projectDependencies(nxAngularVersionFor(readNxVersion(tree)))

  addProjectConfiguration(tree, options.projectName, {
    root: options.projectRoot,
    projectType: template === 'app' ? 'application' : 'library',
    sourceRoot: join(options.projectRoot, 'src'),
    targets: buildTargets(options),
    tags: [...options.tags],
  })

  const substitutions = templateSubstitutions(options, template)
  generateFiles(tree, commonFilesRoot, options.projectRoot, substitutions)
  generateFiles(tree, filesRoot, options.projectRoot, substitutions)

  writeJson(
    tree,
    join(options.projectRoot, 'package.json'),
    buildProjectPackageJson(options, template, dependencies),
  )

  if (template === 'app') {
    writeJson(tree, join(options.projectRoot, 'public/runtime-config.json'), {
      apiBaseUrl: 'https://api.example.test/v1/',
    })
  }

  let installDependenciesTask: GeneratorCallback = () => {}
  if (!options.skipPackageJson) {
    installDependenciesTask = addDependenciesToPackageJson(
      tree,
      dependencies.dependencies,
      dependencies.devDependencies,
    )
    pinWorkspaceTypeScript(tree)
  }

  if (!options.skipFormat) {
    await formatFiles(tree)
  }

  return runTasksInSerial(installDependenciesTask, () => {
    installPackagesTask(tree)
  })
}

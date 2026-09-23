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
  names,
  runTasksInSerial,
  writeJson,
  type GeneratorCallback,
  type Tree,
} from '@nx/devkit'

import { normalizeOptions, type NormalizedSchema } from './normalize.ts'
import { pinWorkspaceTypeScript, readNxVersion } from './nx-workspace.ts'
import { buildProjectPackageJson, projectDependencies } from './project-package-json.ts'
import type { MfeGeneratorSchema, MfeTemplate } from './schema.ts'
import { buildTargets } from './targets.ts'
import { nxAngularVersionFor } from './versions.ts'

/** The files every container needs, beside each template's own `files` folder. */
const COMMON_FILES = join(__dirname, 'files-common')

function templateSubstitutions(options: NormalizedSchema, template: MfeTemplate) {
  const { propertyName, className } = names(options.id)
  return {
    ...options,
    isWidget: template === 'widget',
    // The Widget component's class name and the contract's variable name, as `packages/create-mfe`
    // spells them; harmless when a template does not reference them.
    camel: propertyName,
    pascal: className,
  }
}

export async function generateProject(
  tree: Tree,
  schema: MfeGeneratorSchema,
  template: MfeTemplate,
): Promise<GeneratorCallback> {
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
  generateFiles(tree, COMMON_FILES, options.projectRoot, substitutions)
  generateFiles(tree, join(__dirname, '..', template, 'files'), options.projectRoot, substitutions)

  writeJson(
    tree,
    join(options.projectRoot, 'package.json'),
    buildProjectPackageJson(options, template, dependencies),
  )

  if (template === 'app') {
    // The developer's own values, which the dev server serves and no build copies: the `generate`
    // target adds the declared defaults, and this is the one value `src/mfe.config.ts` requires.
    writeJson(tree, join(options.projectRoot, '.mfe/runtime-config.json'), {
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

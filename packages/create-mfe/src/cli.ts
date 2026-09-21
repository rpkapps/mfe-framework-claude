#!/usr/bin/env node
/**
 * `pnpm create @company/mfe`: a deliverable, not a convenience, so every project made from it
 * copies this shape exactly and what it produces must pass its own format, lint and typecheck
 * from a clean checkout.
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import pc from 'picocolors'

import { appTemplate } from './templates/app.ts'
import { widgetTemplate } from './templates/widget.ts'
import type { TemplateFile, TemplateOptions } from './templates/types.ts'

const USAGE = `
${pc.bold('pnpm create @company/mfe')} <directory> [options]

Options:
  --id <id>         definition id (lower-case letters, digits, single hyphens)
  --template <kind> app | widget            (default: app)
  --force           write into a non-empty directory
  --help            show this message

Examples:
  pnpm create @company/mfe operations --id operations
  pnpm create @company/mfe alert-panel --id alert-panel --template widget
`

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface ScaffoldOptions {
  readonly directory: string
  readonly id: string
  readonly template: 'app' | 'widget'
  readonly force?: boolean
}

/** Renders a template to disk. Exported so tests can scaffold without a shell. */
export async function scaffold(options: ScaffoldOptions): Promise<readonly string[]> {
  if (!ID_PATTERN.test(options.id)) {
    throw new Error(
      `"${options.id}" is not a usable definition id. Ids are lower-case letters, digits and ` +
        'single hyphens, for example "alert-panel". The id is also the storage prefix and the ' +
        'CSS scope value, so it has to be unambiguous in both.',
    )
  }

  const target = resolve(options.directory)
  await mkdir(target, { recursive: true })

  if (options.force !== true) {
    const existing = await readdir(target)
    if (existing.length > 0) {
      throw new Error(
        `${target} is not empty. Pass --force to write into it anyway, or choose an empty directory.`,
      )
    }
  }

  const templateOptions: TemplateOptions = {
    id: options.id,
    // The package name is derived rather than asked for: one fewer decision in
    // the quickstart, and it keeps the id and the package aligned by default.
    packageName: `@example/${options.id}`,
  }

  const files: readonly TemplateFile[] =
    options.template === 'widget' ? widgetTemplate(templateOptions) : appTemplate(templateOptions)

  const written: string[] = []
  for (const file of files) {
    const path = join(target, file.path)
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, file.contents, 'utf8')
    written.push(file.path)
  }

  return written
}

function printNextSteps(options: ScaffoldOptions, fileCount: number): void {
  const port = options.template === 'widget' ? 3103 : 3101

  console.log(`
${pc.green('Created')} ${fileCount} files in ${options.directory}

${pc.bold('Next steps')}
  cd ${options.directory}
  pnpm install
  pnpm run dev

${pc.dim('dev validates local configuration, starts the remote and prints its manifest URL.')}

${pc.bold('Connecting to the shell')}
${pc.dim('Run this in the shell’s browser console, then reload:')}

  const key = 'company:mfe:overrides'
  const overrides = JSON.parse(localStorage.getItem(key) || '{}')
  overrides['${options.id}'] = 'http://localhost:${port}/mf-manifest.json'
  localStorage.setItem(key, JSON.stringify(overrides))
  location.reload()

${pc.dim('Changing an override needs a reload, not a remount: the container’s modules are already')}
${pc.dim('registered and its chunks are document-level. The override is a URL only — never a token.')}
`)
}

export async function main(argv: readonly string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        id: { type: 'string' },
        template: { type: 'string', default: 'app' },
        force: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    })
  } catch (error) {
    console.error(pc.red(error instanceof Error ? error.message : String(error)))
    console.log(USAGE)
    return 1
  }

  if (parsed.values.help === true) {
    console.log(USAGE)
    return 0
  }

  const directory = parsed.positionals[0]
  if (directory === undefined) {
    console.error(pc.red('A target directory is required.'))
    console.log(USAGE)
    return 1
  }

  const template = parsed.values.template
  if (template !== 'app' && template !== 'widget') {
    console.error(pc.red(`Unknown template "${template}". Use "app" or "widget".`))
    return 1
  }

  // Defaulting the id to the directory name keeps the quickstart to one
  // argument while leaving the id explicit for anyone who wants it different.
  const id = parsed.values.id ?? directory.split('/').filter(Boolean).pop() ?? ''

  try {
    const written = await scaffold({
      directory,
      id,
      template,
      force: parsed.values.force === true,
    })
    printNextSteps({ directory, id, template }, written.length)
    return 0
  } catch (error) {
    console.error(pc.red(error instanceof Error ? error.message : String(error)))
    return 1
  }
}

// Only run when invoked directly, so the module stays importable by tests.
if (process.argv[1]?.endsWith('cli.ts') === true || process.argv[1]?.endsWith('cli.js') === true) {
  process.exitCode = await main(process.argv.slice(2))
}

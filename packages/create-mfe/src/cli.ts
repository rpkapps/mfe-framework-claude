#!/usr/bin/env node
/**
 * `pnpm create @company/mfe`
 *
 * The scaffold is a deliverable rather than a convenience: it sets the shape
 * every team copies, and it is the cheapest available guarantee that the
 * documented shape and the real shape stay the same. If a step is missing here,
 * every project created from it is missing that step too.
 *
 * What it produces passes its own format, lint and typecheck commands from a
 * clean checkout, and a second generation over the same directory produces no
 * unexplained changes.
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

  console.log(`\n${pc.green('Created')} ${fileCount} files in ${options.directory}\n`)
  console.log(pc.bold('Next steps'))
  console.log(`  cd ${options.directory}`)
  console.log('  pnpm install')
  console.log('  pnpm run dev\n')

  console.log(
    pc.dim(
      'The dev command validates local configuration, starts the remote and prints the exact\n' +
        'manifest URL, the definition id, and the override snippet for connecting to the shell.\n',
    ),
  )

  console.log(pc.bold('Connecting to the shell'))
  console.log(pc.dim('Run this in the shell’s browser console, then reload:\n'))
  console.log(`  const key = 'company:mfe:overrides'`)
  console.log(`  const overrides = JSON.parse(localStorage.getItem(key) || '{}')`)
  console.log(`  overrides['${options.id}'] = 'http://localhost:${port}/mf-manifest.json'`)
  console.log(`  localStorage.setItem(key, JSON.stringify(overrides))`)
  console.log(`  location.reload()\n`)

  console.log(
    pc.dim(
      'Changing an override requires a reload: the container’s modules are already registered\n' +
        'in the federation runtime and its chunks are document-level, so remounting is not enough.\n' +
        'The override is a URL only. It never carries tokens or configuration.\n',
    ),
  )
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

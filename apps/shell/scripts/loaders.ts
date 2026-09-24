/**
 * The loading screens the shell can draw while sign-in and boot run. Each one is a script in
 * `src/loaders/`, `<name>.js`, that defines the custom element `<name>-loader`; the deployment
 * chooses one with `SHELL_LOADER`, declared as `loader` in `src/mfe.config.ts`, whose `z.enum`
 * lists every name and whose default is the one drawn when nothing says otherwise. How long each
 * stays on screen at least is `loaderMinDuration` there, a `z.object` with a key per loader.
 *
 * The build minifies every loader and inlines them all into index.html, each wrapped in a function
 * that only the chosen one's is called: the page draws without fetching a script, and a loader the
 * deployment did not choose costs its bytes but never runs.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { rspack, type RsbuildPlugin } from '@rsbuild/core'
import { z } from 'zod'

import type { EnvVarDescriptor } from '@company/mfe-rspack/env'

export interface ShellLoader {
  readonly name: string
  readonly file: string
  readonly source: string
}

export interface ShellLoaders {
  /** The one drawn when the runtime configuration names none, or cannot be read. */
  readonly fallback: string
  /** The declared minimum durations, used when the runtime configuration carries none. */
  readonly minDuration: Readonly<Record<string, number>>
  readonly loaders: readonly ShellLoader[]
}

export interface ShellLoaderDeclarations {
  /** `loader`: which loader draws. */
  readonly loader: EnvVarDescriptor
  /** `loaderMinDuration`: how long each stays on screen at least, in milliseconds. */
  readonly minDuration: EnvVarDescriptor
}

/** A loader's name is also the start of its element's, so it is what a custom element allows. */
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * Reads the names and the default from the `loader` declaration, the minimum durations from
 * `loaderMinDuration`, and every loader's source. The lists have to agree: a name with no file
 * would leave the page with nothing to draw, a file no name reaches could never be chosen, and a
 * loader missing from the durations could never be given one.
 */
export function readShellLoaders(
  root: string,
  declarations: ShellLoaderDeclarations,
): ShellLoaders {
  const where = 'src/mfe.config.ts'
  const declaration = declarations.loader
  const schema = z.toJSONSchema(declaration.schema) as { enum?: unknown; default?: unknown }
  const names = schema.enum
  if (!Array.isArray(names) || names.length === 0 || !names.every(isName)) {
    throw new Error(
      `${where}: declare ${declaration.name} with z.enum([...]) of loader names (lower-case words joined by hyphens), for example z.enum(['drill-bit', 'well-log']).`,
    )
  }
  if (typeof schema.default !== 'string' || !names.includes(schema.default)) {
    throw new Error(
      `${where}: give ${declaration.name} a .default() naming one of its loaders, which is drawn when the runtime configuration cannot be read.`,
    )
  }

  const minDuration = readMinDuration(declarations.minDuration, names, where)

  const directory = join(root, 'src/loaders')
  const files = readdirSync(directory).filter(file => file.endsWith('.js'))
  const unreachable = files.map(file => file.slice(0, -3)).filter(name => !names.includes(name))
  if (unreachable.length > 0) {
    throw new Error(
      `${relative(root, directory)}: ${unreachable.map(name => `${name}.js`).join(', ')} cannot be chosen. Add ${unreachable.map(name => `'${name}'`).join(', ')} to the z.enum of ${declaration.name} in ${where}, or delete the file.`,
    )
  }

  const loaders = names.map(name => {
    const file = join(directory, `${name}.js`)
    if (!files.includes(`${name}.js`)) {
      throw new Error(
        `${where}: ${declaration.name} can name '${name}', but ${relative(root, file)} does not exist. Add the loader, or remove the name.`,
      )
    }
    return { name, file: relative(root, file), source: readFileSync(file, 'utf8') }
  })

  return { fallback: schema.default, minDuration, loaders }
}

function readMinDuration(
  declaration: EnvVarDescriptor,
  names: readonly string[],
  where: string,
): Record<string, number> {
  const schema = z.toJSONSchema(declaration.schema) as { properties?: unknown; default?: unknown }
  const keys =
    schema.properties !== null && typeof schema.properties === 'object'
      ? Object.keys(schema.properties)
      : null
  const missing = keys === null ? names : names.filter(name => !keys.includes(name))
  const extra = keys === null ? [] : keys.filter(key => !names.includes(key))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${where}: declare ${declaration.name} as z.object({...}) with one optional number of milliseconds per loader, and no other key.${missing.length > 0 ? ` It has no key for ${missing.map(name => `'${name}'`).join(', ')}.` : ''}${extra.length > 0 ? ` ${extra.map(key => `'${key}'`).join(', ')} is not a loader.` : ''}`,
    )
  }
  const value: unknown = schema.default ?? {}
  if (
    value === null ||
    typeof value !== 'object' ||
    !Object.values(value).every(ms => typeof ms === 'number' && ms >= 0)
  ) {
    throw new Error(
      `${where}: give ${declaration.name} a .default() of milliseconds per loader, for example .default({ 'drill-bit': 1000 }).`,
    )
  }
  return value as Record<string, number>
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && NAME.test(value)
}

/**
 * The object index.html is given, as JavaScript: the fallback's name, the declared minimum
 * durations, and each loader minified into a function that defines its element when called.
 */
export async function inlineShellLoaders({
  fallback,
  minDuration,
  loaders,
}: ShellLoaders): Promise<string> {
  const entries = await Promise.all(
    loaders.map(async loader => {
      const { code } = await rspack.experiments.swc.minify(loader.source, {
        compress: true,
        mangle: true,
        format: { comments: false },
      })
      // Inside a <script>, this ends the element wherever it stands. SWC escapes it in strings, so
      // this only stops a way of writing it that the minifier leaves as it is.
      if (/<\/script/i.test(code)) {
        throw new Error(`${loader.file}: '</script' cannot appear in a loader that is inlined.`)
      }
      return `${JSON.stringify(loader.name)}:function(){${code}}`
    }),
  )
  return `{fallback:${JSON.stringify(fallback)},minDuration:${JSON.stringify(minDuration)},draw:{${entries.join(',')}}}`
}

/** Gives the template `shellLoaders`, the object `inlineShellLoaders` writes. */
export function pluginShellLoaders(
  options: ShellLoaderDeclarations & { readonly root: string },
): RsbuildPlugin {
  return {
    name: 'shell-loaders',

    setup(api) {
      api.modifyRsbuildConfig(async (config, { mergeRsbuildConfig }) =>
        mergeRsbuildConfig(config, {
          html: {
            templateParameters: {
              shellLoaders: await inlineShellLoaders(readShellLoaders(options.root, options)),
            },
          },
          // Read once, with the configuration, so a change to a loader restarts the server.
          dev: {
            watchFiles: {
              paths: [join(options.root, 'src/loaders'), join(options.root, 'src/mfe.config.ts')],
              type: 'reload-server',
            },
          },
        }),
      )
    },
  }
}

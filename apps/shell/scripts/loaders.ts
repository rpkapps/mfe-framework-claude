/**
 * The loading screens the shell can draw while sign-in and boot run. Each one is a script in
 * `src/loaders/`, `<name>.js`, that defines the custom element `<name>-loader`; the deployment
 * chooses one with `SHELL_LOADER`, declared as `loader` in `src/mfe.config.ts`, whose `z.enum`
 * lists every name and whose default is the one drawn when nothing says otherwise. How long each
 * stays on screen at least is `loaderMinDuration` there, a `z.object` with a key per loader.
 *
 * A directory of loaders is a family that shares a kit: `src/loaders/<family>/kit.js` declares
 * `const kit`, and every other script there, `<name>.js`, is a loader that uses it, as `kit`.
 *
 * The build minifies every loader and inlines them all into index.html, each wrapped in a function
 * that only the chosen one's is called, after its family's kit: the page draws without fetching a
 * script, and a loader the deployment did not choose costs its bytes but never runs.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { rspack, type RsbuildPlugin } from '@rsbuild/core'
import { z } from 'zod'

import type { EnvVarDescriptor } from '@company/mfe-rspack/env'

export interface ShellLoader {
  readonly name: string
  readonly file: string
  readonly source: string
  /** The family whose kit it uses, for a loader in a directory of its own. */
  readonly kit?: string
}

export interface ShellLoaderKit {
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
  readonly kits: readonly ShellLoaderKit[]
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
  const { found, kits } = findLoaders(root, directory)
  const unreachable = [...found.keys()].filter(name => !names.includes(name))
  if (unreachable.length > 0) {
    throw new Error(
      `${relative(root, directory)}: ${unreachable.map(name => relative(root, found.get(name)?.file ?? name)).join(', ')} cannot be chosen. Add ${unreachable.map(name => `'${name}'`).join(', ')} to the z.enum of ${declaration.name} in ${where}, or delete the file.`,
    )
  }

  const loaders = names.map(name => {
    const place = found.get(name)
    if (place === undefined) {
      throw new Error(
        `${where}: ${declaration.name} can name '${name}', but there is no ${relative(root, join(directory, `${name}.js`))}, nor a ${name}.js in a directory of loaders. Add the loader, or remove the name.`,
      )
    }
    return {
      name,
      file: relative(root, place.file),
      source: readFileSync(place.file, 'utf8'),
      ...(place.kit === undefined ? {} : { kit: place.kit }),
    }
  })

  return { fallback: schema.default, minDuration, loaders, kits }
}

/** Every loader's file by its name, and every family's kit. */
function findLoaders(
  root: string,
  directory: string,
): { found: Map<string, { file: string; kit?: string }>; kits: ShellLoaderKit[] } {
  const found = new Map<string, { file: string; kit?: string }>()
  const kits: ShellLoaderKit[] = []
  const add = (name: string, file: string, kit?: string): void => {
    const other = found.get(name)
    if (other !== undefined) {
      throw new Error(
        `${relative(root, file)}: '${name}' is also ${relative(root, other.file)}. Loader names are one namespace across every family; rename one of them.`,
      )
    }
    found.set(name, kit === undefined ? { file } : { file, kit })
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isFile() && entry.name.endsWith('.js')) add(entry.name.slice(0, -3), path)
    if (!entry.isDirectory()) continue
    const kitFile = join(path, 'kit.js')
    if (!existsSync(kitFile)) {
      throw new Error(
        `${relative(root, path)}: a directory of loaders is a family, and needs the kit.js its loaders share.`,
      )
    }
    kits.push({
      name: entry.name,
      file: relative(root, kitFile),
      source: readFileSync(kitFile, 'utf8'),
    })
    for (const file of readdirSync(path)) {
      if (file.endsWith('.js') && file !== 'kit.js')
        add(file.slice(0, -3), join(path, file), entry.name)
    }
  }
  return { found, kits }
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
 * durations, each family's kit minified into a function that returns it, and each loader
 * minified into `run`, which defines its element when called with its family's kit.
 */
export async function inlineShellLoaders({
  fallback,
  minDuration,
  loaders,
  kits,
}: ShellLoaders): Promise<string> {
  const kitEntries = await Promise.all(
    kits.map(async kit => {
      const code = await minify(kit)
      // The minifier keeps a script's top-level names, so the kit is still called `kit`.
      if (!/\bkit=/.test(code)) {
        throw new Error(`${kit.file}: declare the family's kit as \`const kit = …\`.`)
      }
      return `${JSON.stringify(kit.name)}:function(){${code}\nreturn kit}`
    }),
  )
  const entries = await Promise.all(
    loaders.map(async loader => {
      const code = await minify(loader)
      const kit = loader.kit === undefined ? '' : `kit:${JSON.stringify(loader.kit)},`
      return `${JSON.stringify(loader.name)}:{${kit}run:function(kit){${code}}}`
    }),
  )
  return `{fallback:${JSON.stringify(fallback)},minDuration:${JSON.stringify(minDuration)},kits:{${kitEntries.join(',')}},draw:{${entries.join(',')}}}`
}

async function minify(script: { readonly file: string; readonly source: string }): Promise<string> {
  const { code } = await rspack.experiments.swc.minify(script.source, {
    compress: true,
    mangle: true,
    format: { comments: false },
  })
  // Inside a <script>, this ends the element wherever it stands. SWC escapes it in strings, so
  // this only stops a way of writing it that the minifier leaves as it is.
  if (/<\/script/i.test(code)) {
    throw new Error(`${script.file}: '</script' cannot appear in a loader that is inlined.`)
  }
  return code
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

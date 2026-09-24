/**
 * The loading screens the shell can draw while sign-in and boot run. Each one is a script in
 * `src/loaders/`, `<name>.js`, that defines the custom element `<name>-loader`. `src/mfe.config.ts`
 * chooses one with its `loader` export, which a deployment can replace with `SHELL_LOADER`, whose
 * `z.enum` lists every name. `cycle` is not a loader but a choice: the next one on each page
 * load. How long the loading screen stays up at least is `loaderMinDuration` there.
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

/** The choice that shows the next loader on each page load, rather than a loader. */
export const CYCLE = 'cycle'

export interface ShellLoaders {
  /** What is drawn when the runtime configuration names nothing, or cannot be read. */
  readonly fallback: string
  /** How long the loading screen stays up at least once drawn, in milliseconds. */
  readonly minDuration: number
  readonly loaders: readonly ShellLoader[]
  readonly kits: readonly ShellLoaderKit[]
}

export interface ShellLoaderDeclarations {
  /** `SHELL_LOADER`: the names a deployment can choose from. */
  readonly loader: EnvVarDescriptor
  /** The `loader` export: what is drawn unless a deployment chooses otherwise. */
  readonly fallback: string
  /** `loaderMinDuration`: how long the loading screen stays up at least, in milliseconds. */
  readonly minDuration: number
}

/** A loader's name is also the start of its element's, so it is what a custom element allows. */
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * Reads the names and the default from the `loader` declaration, and every loader's source. The
 * two lists have to agree: a name with no file would leave the page with nothing to draw, and a
 * file no name reaches could never be chosen.
 */
export function readShellLoaders(
  root: string,
  declarations: ShellLoaderDeclarations,
): ShellLoaders {
  const where = 'src/mfe.config.ts'
  const declaration = declarations.loader
  const schema = z.toJSONSchema(declaration.schema) as { enum?: unknown }
  const choices = schema.enum
  if (!Array.isArray(choices) || choices.length === 0 || !choices.every(isName)) {
    throw new Error(
      `${where}: declare ${declaration.name} with z.enum([...]) of loader names (lower-case words joined by hyphens), for example z.enum(['drill-bit', 'well-log', 'cycle']).`,
    )
  }
  if (!choices.includes(declarations.fallback)) {
    throw new Error(
      `${where}: loader is '${declarations.fallback}', which ${declaration.name} does not list. Name one of its loaders, or 'cycle'.`,
    )
  }
  const names = choices.filter(name => name !== CYCLE)

  const minDuration = declarations.minDuration
  if (!Number.isFinite(minDuration) || minDuration < 0) {
    throw new Error(
      `${where}: loaderMinDuration is a number of milliseconds, 0 or more, for example 1000.`,
    )
  }

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

  return { fallback: declarations.fallback, minDuration, loaders, kits }
}

/**
 * Every loader there is, whatever `src/mfe.config.ts` lists: the ones of their own first, then each
 * family's, by name. examples/loaders shows them all.
 */
export function readAllLoaders(root: string): { loaders: ShellLoader[]; kits: ShellLoaderKit[] } {
  const { found, kits } = findLoaders(root, join(root, 'src/loaders'))
  const loaders = [...found.entries()].map(([name, place]) => ({
    name,
    file: relative(root, place.file),
    source: readFileSync(place.file, 'utf8'),
    ...(place.kit === undefined ? {} : { kit: place.kit }),
  }))
  const rank = (loader: ShellLoader): string => `${loader.kit ?? ''}/${loader.name}`
  return { loaders: loaders.sort((a, b) => (rank(a) < rank(b) ? -1 : 1)), kits }
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
    if (entry.isFile() && entry.name === `${CYCLE}.js`) {
      throw new Error(
        `${relative(root, path)}: '${CYCLE}' is the choice of every loader in turn, so no loader can be called that.`,
      )
    }
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

function isName(value: unknown): value is string {
  return typeof value === 'string' && NAME.test(value)
}

/**
 * Every loader's colours, from Tecton's tokens: `src/loaders/theme.css`, which index.html writes
 * into a `<style>` of its own, and examples/loaders shows every loader in.
 */
export function readLoaderTheme(root: string): string {
  const file = join(root, 'src/loaders/theme.css')
  const css = readFileSync(file, 'utf8')
  if (/<\/style/i.test(css)) {
    throw new Error(
      `${relative(root, file)}: '</style' cannot appear in a stylesheet that is inlined.`,
    )
  }
  return css
}

/**
 * The object index.html is given, as JavaScript: the fallback's name, the minimum duration, each
 * family's kit minified into a function that returns it, and each loader
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

/**
 * Gives the template `shellLoaders`, the object `inlineShellLoaders` writes, and
 * `shellLoaderTheme`, the loaders' colours.
 */
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
              shellLoaderTheme: readLoaderTheme(options.root),
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

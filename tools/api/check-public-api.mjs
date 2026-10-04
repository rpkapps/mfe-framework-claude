#!/usr/bin/env node
/**
 * Public API check. Every runtime export of a framework package must have a real caller, or be
 * listed in `api-surface.json` as authoring API. A real caller is the shell, the docs site's own
 * code, a root configuration file or another package's source. Examples, tests, tools, docs pages
 * and lint messages do not count: an export that only they reach is unused by anything that ships.
 *
 * Authoring API is what containers call and the shell never does, such as `useBasePath`. An entry
 * must name the docs page that documents it, and an example must call it, so nothing is exported
 * only to be described.
 *
 * Generated code ships too, but it exists only after `pnpm generate`, so the check reads only
 * committed files and gives the same answer either way. An export only generated code calls is listed under
 * "generatedCallers" with the generator that writes the call.
 *
 * It also fails when the docs fall behind the code: an authoring entry whose page no longer
 * mentions it, and a reference heading that names an API which no longer exists.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const surfacePath = join(repoRoot, 'api-surface.json')
const referenceDirectory = join(repoRoot, 'apps/docs/content/docs/reference')

/** Where a real caller can live, relative to the repository root. */
const CALLER_ROOTS = ['apps/shell', 'apps/docs/src', 'packages']
const ROOT_CONFIG_FILES = ['eslint.config.ts', 'vitest.config.ts']
const EXAMPLE_ROOTS = ['examples']
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|mjs|jsx)$/
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

/**
 * The committed source files under the roots. Tests count only where `withTests` says so, as in
 * examples. Reading what git tracks leaves out generated output wherever it is written.
 */
function sourceFilesUnder(roots, withTests) {
  const listed = execFileSync('git', ['ls-files', '-z', '--', ...roots], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return listed
    .split('\0')
    .filter(path => SOURCE_EXTENSIONS.test(path))
    .filter(path => withTests || (!TEST_FILE.test(path) && !path.includes('/__tests__/')))
    .map(path => join(repoRoot, path))
}

/** Each package's public entry points that resolve to source, as `{ specifier, packageRoot, file }`. */
async function publicEntries() {
  const entries = []
  for (const directory of await readdir(join(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue
    const packageRoot = join(repoRoot, 'packages', directory.name)
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const source = typeof target === 'object' ? target['mfe-source'] : undefined
      if (source === undefined) continue
      const specifier = subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`
      entries.push({ specifier, packageRoot, file: join(packageRoot, source) })
    }
  }
  return entries
}

/**
 * What each entry exports, read with the type checker: every name, and for runtime values the
 * symbol it resolves to. An adapter's `/host` re-exports the runtime, so one symbol is often
 * reachable under several specifiers, and a caller of any of them uses it.
 */
function readExports(entries) {
  const program = ts.createProgram(
    entries.map(entry => entry.file),
    {
      allowJs: true,
      allowImportingTsExtensions: true,
      customConditions: ['mfe-source'],
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2023,
    },
  )
  const checker = program.getTypeChecker()
  const bySpecifier = new Map()
  const homes = new Map()
  for (const entry of entries) {
    const sourceFile = program.getSourceFile(entry.file)
    const moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile)
    const values = new Map()
    const all = new Set()
    for (const symbol of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
      all.add(symbol.name)
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
      if (!(target.flags & ts.SymbolFlags.Value)) continue
      values.set(symbol.name, target)
      const declaredHere = target.declarations?.some(declaration =>
        declaration.getSourceFile().fileName.startsWith(`${entry.packageRoot}/`),
      )
      const key = `${entry.specifier}#${symbol.name}`
      const home = homes.get(target)
      if (home === undefined || (declaredHere && !home.declaredHere)) {
        homes.set(target, { key, declaredHere })
      }
    }
    bySpecifier.set(entry.specifier, { values, all })
  }
  return { bySpecifier, homes }
}

function packageOf(specifier) {
  const [scope, name] = specifier.split('/')
  return `${scope}/${name}`
}

function ownPackageOf(file) {
  const match = /^packages\/([^/]+)\//.exec(relative(repoRoot, file).replaceAll('\\', '/'))
  return match ? `@company/${match[1]}` : undefined
}

/**
 * The framework symbols the files import: named imports, and the properties read off a namespace
 * import. Re-exports do not count, since forwarding a name is not calling it, and a package's
 * own files are not callers of that package.
 */
async function symbolsImportedBy(files, bySpecifier) {
  const used = new Set()
  for (const file of files) {
    const ownPackage = ownPackageOf(file)
    const sourceFile = ts.createSourceFile(
      file,
      await readFile(file, 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
    )
    const namespaces = new Map()
    const use = (specifier, name) => {
      const symbol = bySpecifier.get(specifier)?.values.get(name)
      if (symbol !== undefined) used.add(symbol)
    }

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
        continue
      const specifier = statement.moduleSpecifier.text
      if (!bySpecifier.has(specifier) || packageOf(specifier) === ownPackage) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.set(bindings.name.text, specifier)
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements)
          use(specifier, (element.propertyName ?? element.name).text)
      }
    }

    if (namespaces.size === 0) continue
    const visit = node => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaces.has(node.expression.text)
      ) {
        use(namespaces.get(node.expression.text), node.name.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return used
}

/** Identifiers named by `###` headings on the reference pages, such as `useApps` or `DynamicWidget`. */
async function referenceHeadingNames() {
  const identifier = /^(?:[a-z]+[A-Z][\w$]*|[A-Z][a-z]+[A-Z][\w$]*)$/
  const found = []
  for (const page of await readdir(referenceDirectory)) {
    if (!page.endsWith('.mdx')) continue
    const source = await readFile(join(referenceDirectory, page), 'utf8')
    for (const [, heading] of source.matchAll(/^### (.+)$/gm)) {
      for (const token of heading.split(/,\s*|\s+and\s+/).map(part => part.trim())) {
        if (identifier.test(token)) found.push({ name: token, page })
      }
    }
  }
  return found
}

const entries = await publicEntries()
const { bySpecifier, homes } = readExports(entries)
const callers = [
  ...sourceFilesUnder(CALLER_ROOTS, false),
  ...ROOT_CONFIG_FILES.map(file => join(repoRoot, file)).filter(existsSync),
]
const used = await symbolsImportedBy(callers, bySpecifier)
const usedByExamples = await symbolsImportedBy(sourceFilesUnder(EXAMPLE_ROOTS, true), bySpecifier)

const surface = JSON.parse(await readFile(surfacePath, 'utf8'))
const authoring = surface.authoring ?? {}
const pending = new Set(surface.pendingDecision ?? [])
const generatedCallers = surface.generatedCallers ?? {}
const symbolFor = key => {
  const [specifier, name] = key.split('#')
  const symbol = bySpecifier.get(specifier)?.values.get(name)
  return symbol !== undefined && homes.get(symbol).key === key ? symbol : undefined
}
const problems = []

for (const [symbol, { key }] of homes) {
  if (used.has(symbol) || key in authoring || key in generatedCallers || pending.has(key)) continue
  problems.push(
    `${key} is exported, but nothing that ships calls it: no caller in apps/shell, apps/docs/src or another package. Remove the export. If containers are meant to call it, add it to "authoring" in api-surface.json with the page that documents it.`,
  )
}

for (const [key, page] of Object.entries(authoring)) {
  const symbol = symbolFor(key)
  const name = key.split('#')[1]
  if (symbol === undefined) {
    problems.push(
      `${key} is in "authoring" in api-surface.json, but it is not a runtime export under that name. Remove the entry, or use the name the check reports for it.`,
    )
    continue
  }
  if (used.has(symbol)) {
    problems.push(
      `${key} now has a caller that ships, so it no longer needs an "authoring" entry in api-surface.json. Remove the entry.`,
    )
  }
  if (!usedByExamples.has(symbol)) {
    problems.push(
      `${key} is authoring API, but no example calls it. Use it in the example that demonstrates it, or remove the export.`,
    )
  }
  const pagePath = join(repoRoot, page)
  if (!existsSync(pagePath)) {
    problems.push(
      `${key} names ${page} as its docs page in api-surface.json, but that file does not exist.`,
    )
  } else if (!new RegExp(`\\b${name}\\b`).test(await readFile(pagePath, 'utf8'))) {
    problems.push(
      `${key} is authoring API, but ${page} never mentions ${name}. Document it there, or point the entry at the page that does.`,
    )
  }
}

for (const [key, generator] of Object.entries(generatedCallers)) {
  const symbol = symbolFor(key)
  const name = key.split('#')[1]
  if (symbol === undefined || used.has(symbol)) {
    problems.push(
      `${key} is in "generatedCallers" in api-surface.json, but it is not an export only generated code calls. Remove the entry.`,
    )
  } else if (!existsSync(join(repoRoot, generator))) {
    problems.push(`${key} names ${generator} as its generator, but that file does not exist.`)
  } else if (!new RegExp(`\\b${name}\\b`).test(await readFile(join(repoRoot, generator), 'utf8'))) {
    problems.push(
      `${key} names ${generator} as its generator, but that file never writes ${name}. Point the entry at the generator that does.`,
    )
  }
}

for (const key of pending) {
  const symbol = symbolFor(key)
  if (symbol === undefined || used.has(symbol)) {
    problems.push(
      `${key} is in "pendingDecision" in api-surface.json, but it is no longer an unused export. Remove the entry.`,
    )
  }
}

const allNames = new Set([...bySpecifier.values()].flatMap(({ all }) => [...all]))
for (const { name, page } of await referenceHeadingNames()) {
  if (!allNames.has(name)) {
    problems.push(
      `reference/${page} has a heading for ${name}, which no framework package exports. Update the page to match the code.`,
    )
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Public API check passed for ${entries.length} entry points.\n`)
}

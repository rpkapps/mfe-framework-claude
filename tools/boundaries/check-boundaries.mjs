#!/usr/bin/env node
/**
 * Package boundary check for the framework import DAG: ESLint's restricted-import rules cover
 * only the files ESLint is pointed at, where this also reads each package manifest, so a
 * forbidden dependency cannot be introduced by editing package.json alone.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/**
 * The AI and agent libraries and the model providers' SDKs, as the lint presets list them (§45):
 * no framework package imports one, and `@company/mfe-agent` only AG-UI.
 */
const AGENT_LIBRARIES = [
  '@company/mfe-agent',
  '@ag-ui/',
  'ai',
  'openai',
  'langchain',
  '@tanstack/ai',
  '@tanstack/ai-*',
  '@ai-sdk/',
  '@copilotkit/',
  '@anthropic-ai/',
  '@google/genai',
  '@langchain/',
  '@mastra/',
]

const AGENT_PACKAGE_OWN = new Set(['@company/mfe-agent', '@ag-ui/'])

/**
 * Each rule names the package it guards and the specifiers it may not depend on, directly or
 * through its manifest: a name matches itself and its subpaths, one ending in `/` a scope, and
 * one ending in `*` every name it starts.
 */
const RULES = [
  {
    package: '@company/mfe-core',
    forbidden: [
      ...AGENT_LIBRARIES,
      'react',
      'react-dom',
      '@tanstack/react-router',
      '@tanstack/react-query',
      'single-spa',
      '@module-federation/enhanced',
      '@module-federation/runtime',
      '@company/mfe-runtime',
      '@company/mfe-react',
      '@company/mfe-angular',
      '@company/mfe-devtools',
      '@company/mfe-build',
      '@opentelemetry/',
      '@grafana/faro',
      'zustand',
      'redux',
      'mobx',
      'jotai',
      '@tanstack/store',
    ],
    reason:
      'The neutral core cannot import a framework, an adapter or a router, carries no OTel or Faro dependency, uses no general state-management library, and imports no agent library.',
  },
  {
    package: '@company/mfe-runtime',
    forbidden: [
      ...AGENT_LIBRARIES,
      'react',
      'react-dom',
      '@tanstack/react-router',
      '@tanstack/react-query',
      'single-spa',
      '@module-federation/enhanced',
      '@module-federation/runtime',
      '@company/mfe-react',
      '@company/mfe-angular',
      '@company/mfe-devtools',
      '@company/mfe-build',
      '@opentelemetry/',
      '@grafana/faro',
      'zustand',
      'redux',
      'mobx',
      'jotai',
      '@tanstack/store',
    ],
    reason:
      'The neutral runtime cannot import React, Angular, a router, single-spa or Module Federation, carries no OTel or Faro dependency, uses no general state-management library, and imports no agent library.',
  },
  {
    package: '@company/mfe-angular',
    forbidden: [
      ...AGENT_LIBRARIES,
      'react',
      'react-dom',
      '@tanstack/',
      '@company/mfe-react',
      '@company/mfe-devtools',
      '@company/mfe-rspack',
      'single-spa',
      '@opentelemetry/',
      '@grafana/faro',
      'zone.js',
      '@module-federation/',
      'primeng',
      '@primeng/',
      '@primeuix/',
    ],
    reason:
      'The Angular adapter stays UI-library agnostic and framework-pluggable: no React, no TanStack, no sibling adapter or its build integration, no zone.js, no Module Federation, no vendor telemetry, no agent library, and no UI component library of its own — PrimeNG included.',
  },
  {
    package: '@company/mfe-build',
    forbidden: [
      ...AGENT_LIBRARIES,
      'react',
      'react-dom',
      '@tanstack/',
      '@rsbuild/',
      '@rspack/',
      'webpack',
      '@company/mfe-react',
      '@company/mfe-angular',
      '@angular/',
      '@company/mfe-rspack',
      '@company/mfe-nx',
      '@company/mfe-devtools',
      '@company/mfe-runtime',
      '@tecton/react',
    ],
    reason:
      'The neutral build layer is shared by every build integration, so it imports no UI framework, router, bundler, design system, integration or agent library: what differs between them reaches it through the profile each integration passes in.',
  },
  {
    package: '@company/mfe-rspack',
    forbidden: [...AGENT_LIBRARIES],
    reason:
      'A build integration builds containers; the agent is reached at run time, through actions.',
  },
  {
    package: '@company/mfe-nx',
    forbidden: [...AGENT_LIBRARIES],
    reason:
      'A build integration builds containers; the agent is reached at run time, through actions.',
  },
  {
    package: '@company/mfe-react',
    forbidden: [
      ...AGENT_LIBRARIES,
      'single-spa',
      '@opentelemetry/',
      '@grafana/faro',
      '@company/mfe-devtools',
    ],
    reason:
      'The legacy adapter is the only package that knows the legacy single-spa contract, vendor telemetry stays shell-owned, and the agent is reached through actions, never an agent library.',
  },
  {
    package: '@company/mfe-legacy-angular',
    forbidden: [
      ...AGENT_LIBRARIES,
      'react',
      'react-dom',
      '@tanstack/react-router',
      '@company/mfe-react',
      '@company/mfe-devtools',
    ],
    reason:
      'The legacy adapter is a sibling of the React adapter, not a consumer of it, and imports no agent library.',
  },
  {
    package: '@company/mfe-agent',
    forbidden: [
      'single-spa',
      '@module-federation/',
      '@opentelemetry/',
      '@grafana/faro',
      '@company/mfe-react',
      '@company/mfe-angular',
      '@company/mfe-legacy-angular',
      '@company/mfe-devtools',
      '@company/mfe-build',
      '@company/mfe-rspack',
      '@company/mfe-nx',
      '@company/create-mfe',
      ...AGENT_LIBRARIES.filter(library => !AGENT_PACKAGE_OWN.has(library)),
      'zustand',
      'redux',
      'mobx',
      'jotai',
      '@tanstack/store',
    ],
    reason:
      'The agent package speaks AG-UI and nothing else, so any backend that speaks it will do (docs/decisions.md §49); it imports no adapter, developer tool or build package, and the shell hands it the runtime.',
  },
  {
    package: '@company/mfe-devtools',
    forbidden: [
      ...AGENT_LIBRARIES,
      'single-spa',
      '@opentelemetry/',
      '@grafana/faro',
      '@company/mfe-rspack',
      'zustand',
      'redux',
      'mobx',
      'jotai',
      '@tanstack/store',
    ],
    reason:
      'A developer tool reads the runtime and the design system, never the build integration, a vendor SDK or an agent library, and it keeps its state in the framework subscription primitives like everything else.',
  },
]

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

async function collectSourceFiles(dir, out = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      await collectSourceFiles(full, out)
      continue
    }
    const dot = entry.name.lastIndexOf('.')
    if (dot > 0 && SOURCE_EXTENSIONS.has(entry.name.slice(dot))) out.push(full)
  }
  return out
}

function matchesForbidden(specifier, forbidden) {
  return forbidden.find(
    candidate =>
      specifier === candidate ||
      specifier.startsWith(`${candidate}/`) ||
      (candidate.endsWith('/') && specifier.startsWith(candidate)) ||
      (candidate.endsWith('*') && specifier.startsWith(candidate.slice(0, -1))),
  )
}

async function packageDirectoryFor(packageName) {
  const dirs = await readdir(join(repoRoot, 'packages'), { withFileTypes: true })
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const manifestPath = join(repoRoot, 'packages', dir.name, 'package.json')
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (manifest.name === packageName) return join(repoRoot, 'packages', dir.name)
    } catch {
      // A directory without a readable manifest is not a workspace package.
    }
  }
  return null
}

/**
 * The packages that reach `@company/mfe-core` through the share scope at run time. None of them may
 * guard code with core's `DEV`: an import across the share boundary is not a constant any minifier
 * can fold, so everything behind it would ship to production. Each keeps its own `src/dev.ts`.
 */
const SHARED_CORE_CONSUMERS = [
  '@company/mfe-runtime',
  '@company/mfe-react',
  '@company/mfe-angular',
  '@company/mfe-legacy-angular',
  '@company/mfe-devtools',
  '@company/mfe-agent',
]

const CORE = '@company/mfe-core'

/**
 * Where a file reaches core's `DEV` as a value: a named import or re-export under any alias, or a
 * `DEV` read off a namespace import. A type-only import is left alone, since it never reaches the
 * bundle.
 */
function coreDevReferences(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true)
  const references = []
  const namespaces = new Set()
  const fromCore = node =>
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text === CORE
  const isDev = element => (element.propertyName ?? element.name).text === 'DEV'

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && fromCore(statement)) {
      const clause = statement.importClause
      if (clause === undefined || clause.isTypeOnly) continue
      const bindings = clause.namedBindings
      if (bindings === undefined) continue
      if (ts.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text)
        continue
      }
      for (const element of bindings.elements) {
        if (!element.isTypeOnly && isDev(element)) references.push(element)
      }
    }
    if (ts.isExportDeclaration(statement) && fromCore(statement) && !statement.isTypeOnly) {
      const clause = statement.exportClause
      if (clause === undefined || !ts.isNamedExports(clause)) continue
      for (const element of clause.elements) {
        if (!element.isTypeOnly && isDev(element)) references.push(element)
      }
    }
  }

  if (namespaces.size > 0) {
    const visit = node => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        namespaces.has(node.expression.text) &&
        node.name.text === 'DEV'
      ) {
        references.push(node)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return references.map(
    node => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  )
}

const violations = []

for (const rule of RULES) {
  const packageDir = await packageDirectoryFor(rule.package)
  if (!packageDir) {
    violations.push(`Unknown package in boundary rules: ${rule.package}`)
    continue
  }

  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest[field] ?? {})) {
      const hit = matchesForbidden(dependency, rule.forbidden)
      if (hit) {
        violations.push(
          `${rule.package} declares forbidden ${field.slice(0, -1)} "${dependency}".\n  ${rule.reason}`,
        )
      }
    }
  }

  for (const file of await collectSourceFiles(join(packageDir, 'src'))) {
    const source = await readFile(file, 'utf8')
    // TypeScript's own scan: every import, `export … from`, `import(…)` and `require(…)`, a
    // side-effect or type-only one included, and nothing inside a comment or a string.
    for (const { fileName: specifier, pos } of ts.preProcessFile(source, true, true)
      .importedFiles) {
      const hit = matchesForbidden(specifier, rule.forbidden)
      if (!hit) continue
      const line = source.slice(0, pos).split('\n').length
      violations.push(
        `${relative(repoRoot, file)}:${line} imports forbidden "${specifier}" from ${rule.package}.\n  ${rule.reason}`,
      )
    }
  }
}

for (const packageName of SHARED_CORE_CONSUMERS) {
  const packageDir = await packageDirectoryFor(packageName)
  if (!packageDir) {
    violations.push(`Unknown package in the development-flag rule: ${packageName}`)
    continue
  }
  for (const file of await collectSourceFiles(join(packageDir, 'src'))) {
    const source = await readFile(file, 'utf8')
    for (const line of coreDevReferences(file, source)) {
      violations.push(
        `${relative(repoRoot, file)}:${line} imports DEV from ${CORE}.\n  Core is shared, so the flag cannot fold across the share boundary and the code it guards ships to production. Import DEV from this package's own src/dev.ts instead.`,
      )
    }
  }
}

if (violations.length > 0) {
  console.error(`Package boundary check failed (${violations.length} violation(s)):\n`)
  for (const violation of violations) console.error(`  - ${violation}\n`)
  process.exit(1)
}

console.log(
  `Package boundary check passed: ${RULES.length} package rules, import DAG intact, no shared development flag.`,
)

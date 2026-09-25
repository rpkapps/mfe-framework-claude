#!/usr/bin/env node
/**
 * Package boundary check for the framework import DAG: ESLint's restricted-import rules cover
 * only the files ESLint is pointed at, where this also reads each package manifest, so a
 * forbidden dependency cannot be introduced by editing package.json alone.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Each rule names the package it guards and the specifiers it may not depend on, directly or
 * through its manifest.
 */
const RULES = [
  {
    package: '@company/mfe-core',
    forbidden: [
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
      'The neutral core cannot import a framework, an adapter or a router, carries no OTel or Faro dependency, and uses no general state-management library.',
  },
  {
    package: '@company/mfe-runtime',
    forbidden: [
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
      'The neutral runtime cannot import React, Angular, a router, single-spa or Module Federation, carries no OTel or Faro dependency, and uses no general state-management library.',
  },
  {
    package: '@company/mfe-angular',
    forbidden: [
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
      'The Angular adapter stays UI-library agnostic and framework-pluggable: no React, no TanStack, no sibling adapter or its build integration, no zone.js, no Module Federation, no vendor telemetry, and no UI component library of its own — PrimeNG included.',
  },
  {
    package: '@company/mfe-build',
    forbidden: [
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
      'The neutral build layer is shared by every build integration, so it imports no UI framework, router, bundler, design system or integration: what differs between them reaches it through the profile each integration passes in.',
  },
  {
    package: '@company/mfe-react',
    forbidden: ['single-spa', '@opentelemetry/', '@grafana/faro', '@company/mfe-devtools'],
    reason:
      'The legacy adapter is the only package that knows the legacy single-spa contract, and vendor telemetry stays shell-owned.',
  },
  {
    package: '@company/mfe-legacy-angular',
    forbidden: [
      'react',
      'react-dom',
      '@tanstack/react-router',
      '@company/mfe-react',
      '@company/mfe-devtools',
    ],
    reason: 'The legacy adapter is a sibling of the React adapter, not a consumer of it.',
  },
  {
    package: '@company/mfe-devtools',
    forbidden: [
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
      'A developer tool reads the runtime and the design system, never the build integration or a vendor SDK, and it keeps its state in the framework subscription primitives like everything else.',
  },
]

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

/** Matches static imports, `export ... from`, and dynamic `import(...)`. */
const SPECIFIER_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

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
      (candidate.endsWith('/') && specifier.startsWith(candidate)),
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
]

/** A value import or re-export of `DEV` from core; `type DEV` would not reach the bundle. */
const CORE_DEV_IMPORT = /(?:import|export)\s*\{([^}]*)\}\s*from\s*['"]@company\/mfe-core['"]/g

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
    for (const match of source.matchAll(SPECIFIER_PATTERN)) {
      const specifier = match[1] ?? match[2] ?? match[3]
      if (!specifier) continue
      const hit = matchesForbidden(specifier, rule.forbidden)
      if (!hit) continue
      const line = source.slice(0, match.index ?? 0).split('\n').length
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
    for (const match of source.matchAll(CORE_DEV_IMPORT)) {
      const names = match[1].split(',').map(name => name.trim())
      if (!names.some(name => name === 'DEV' || name.startsWith('DEV '))) continue
      const line = source.slice(0, match.index).split('\n').length
      violations.push(
        `${relative(repoRoot, file)}:${line} imports DEV from @company/mfe-core.\n  Core is shared, so the flag cannot fold across the share boundary and the code it guards ships to production. Import DEV from this package's own src/dev.ts instead.`,
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

/**
 * A container's own modules, reached one import at a time and read from syntax only. The neutral
 * build follows a Widget contract's import the same way; its helpers are private to it, so the
 * route reader keeps this small copy rather than reaching into another package.
 */

import { statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  collectImportedBindings,
  collectTopLevelBindings,
  ts,
  unwrapExpression,
} from '@company/mfe-build'

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.jsx'] as const

/** Resolves a relative specifier to a file on disk, or `null` for a bare one. */
export function resolveRelativeModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null

  const base = resolve(dirname(fromFile), specifier)
  const candidates: string[] = [base]
  // `./app.routes.js` is how a TypeScript ESM import may spell `./app.routes.ts`.
  if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`)
  for (const extension of MODULE_EXTENSIONS) candidates.push(`${base}${extension}`)
  for (const extension of MODULE_EXTENSIONS) candidates.push(resolve(base, `index${extension}`))

  return candidates.find(isFile) ?? null
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

/** The initialiser of an exported top-level binding, or `null` when it is not a local `const`. */
export function findExportedExpression(
  sourceFile: ts.SourceFile,
  name: string,
): ts.Expression | null {
  const topLevel = collectTopLevelBindings(sourceFile)
  const localImports = collectImportedBindings(sourceFile)

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const exported = (ts.getModifiers(statement) ?? []).some(
        modifier => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
      if (!exported) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
        if (declaration.initializer === undefined) continue
        return unwrapExpression(declaration.initializer)
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (!ts.isNamedExports(statement.exportClause)) continue
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== name) continue
        const local = (element.propertyName ?? element.name).text
        const expression = topLevel.get(local)
        if (expression !== undefined) return unwrapExpression(expression)
        if (localImports.has(local)) return null
      }
    }
  }

  return null
}

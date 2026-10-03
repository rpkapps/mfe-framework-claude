import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveRelativeModule } from '../discovery/local-modules.ts'
import { standaloneSources } from '../discovery/sources.ts'
import { collectImportedBindings, ts } from '../discovery/ts-ast.ts'
import { compileUserContext, compileUserContextReads, requirementsFor } from './compiler.ts'
import {
  HOST_RUNTIME_MODULES,
  isImportedRuntimeCall,
  userContextExpression,
  type HostUserContextTransform,
} from './transform.ts'
import { stateType } from './generate.ts'
import { banner, generatedPath, type GeneratedFile } from '../generate/emit.ts'

export interface HostUserContextPlan {
  readonly source: string
  readonly dependencies: readonly string[]
  readonly registration: HostUserContextTransform
  readonly values: string
  readonly reads: string
}
/** Follow the host's entry graph; never evaluate application modules or inspect unrelated tests. */
export function discoverHostUserContext(
  root: string,
  id: string,
  entries?: readonly string[],
): HostUserContextPlan | undefined {
  const sources = standaloneSources()
  const visited = new Set<string>()
  let result: HostUserContextPlan | undefined
  const visitFile = (filename: string): void => {
    if (visited.has(filename)) return
    visited.add(filename)
    const file = sources.parse(filename)
    const factories = new Map(
      [...collectImportedBindings(file)].filter(
        ([, binding]) =>
          binding.imported === 'createMfeRuntime' &&
          HOST_RUNTIME_MODULES.includes(binding.moduleSpecifier),
      ),
    )
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        factories.has(node.expression.text) &&
        isImportedRuntimeCall(node.expression)
      ) {
        const options = node.arguments[0]
        if (options && ts.isObjectLiteralExpression(options)) {
          const schema = userContextExpression(options, 'schema', true)
          const reads = userContextExpression(options, 'reads', true)
          if (schema || reads) {
            if (result)
              throw new Error(
                'Declare userContext schema/reads on exactly one createMfeRuntime call per host',
              )
            const own = schema
              ? compileUserContext(id, schema, file, sources).contracts[0]
              : undefined
            const foreign = reads ? compileUserContextReads(id, reads, file, sources) : []
            if (factories.get(node.expression.text)?.moduleSpecifier.includes('angular'))
              throw new Error(
                'Angular host user-context bindings are not supported by the React host build integration',
              )
            result = {
              dependencies: [],
              source: filename,
              registration: {
                ...(own ? { contract: own } : {}),
                requirements: requirementsFor(
                  { formatVersion: 1, contracts: [...(own ? [own] : []), ...foreign] },
                  id,
                ),
              },
              values: own ? stateType(own.node) : 'Record<string, never>',
              reads: `{ ${foreign.map(contract => `${JSON.stringify(contract.id)}: ${stateType(contract.node)}`).join('; ')} }`,
            }
          }
        }
      }
      if (
        ts.isImportDeclaration(node) &&
        (node.importClause?.isTypeOnly ||
          (node.importClause?.namedBindings &&
            ts.isNamedImports(node.importClause.namedBindings) &&
            !node.importClause.name &&
            node.importClause.namedBindings.elements.every(item => item.isTypeOnly)))
      )
        return
      if (ts.isExportDeclaration(node) && node.isTypeOnly) return
      const specifier =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? node.arguments[0]
            : undefined
      if (specifier && ts.isStringLiteral(specifier)) {
        const target = resolveRelativeModule(filename, specifier.text)
        if (target && /\.[cm]?[jt]sx?$/.test(target)) visitFile(target)
      }
      node.forEachChild(visit)
    }
    visit(file)
  }
  const roots = entries ?? ['src/index.tsx', 'src/index.ts', 'src/main.tsx', 'src/main.ts']
  for (const entry of roots) {
    const path = resolve(root, entry)
    const file = existsSync(path)
      ? path
      : resolveRelativeModule(resolve(root, 'package.json'), `./${entry}`)
    if (file) visitFile(file)
    else if (entries) throw new Error(`Host entry does not exist: ${path}`)
  }
  return result ? { ...result, dependencies: [...visited] } : undefined
}
export function hostUserContextFile(
  plan: HostUserContextPlan,
  generatedDir: string,
  generator: string,
): GeneratedFile {
  return {
    path: generatedPath(generatedDir, 'user-context.ts'),
    contents: [
      banner(generator, '#mfe/user-context'),
      "import { createHostUserContextBindings } from '@company/mfe-react/user-context'",
      `export type UserContextValues = ${plan.values}`,
      `export type UserContextReads = ${plan.reads}`,
      `export const { useUserContext } = createHostUserContextBindings<UserContextValues, UserContextReads>(${JSON.stringify(plan.registration.requirements)})`,
      '',
    ].join('\n'),
  }
}

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveRelativeModule } from '../discovery/local-modules.ts'
import { standaloneSources } from '../discovery/sources.ts'
import { collectImportedBindings, ts } from '../discovery/ts-ast.ts'
import { banner, generatedPath, type GeneratedFile } from '../generate/emit.ts'
import {
  readUserContextSource,
  userContextDeclarationModule,
  userContextExpression,
  type UserContextSource,
} from './declaration.ts'
import { bindingTypes } from './generate.ts'

export interface HostUserContextPlan {
  readonly source: string
  readonly dependencies: readonly string[]
  readonly declaration: UserContextSource
}
export const HOST_RUNTIME_MODULES = [
  '@company/mfe-react/host',
  '@company/mfe-angular/host',
  '@company/mfe-runtime',
]
/** A matching imported name can still be shadowed by an ordinary local function or variable. */
export function isImportedRuntimeCall(identifier: ts.Identifier): boolean {
  const binds = (name: ts.BindingName): boolean =>
    ts.isIdentifier(name)
      ? name.text === identifier.text
      : name.elements.some(element => ts.isBindingElement(element) && binds(element.name))
  for (let scope = identifier.parent; scope && !ts.isSourceFile(scope); scope = scope.parent) {
    if (ts.isFunctionLike(scope) && scope.parameters.some(parameter => binds(parameter.name)))
      return false
    if (
      (ts.isFunctionExpression(scope) || ts.isClassExpression(scope)) &&
      scope.name?.text === identifier.text
    )
      return false
    if (
      (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) &&
      scope.initializer &&
      ts.isVariableDeclarationList(scope.initializer) &&
      scope.initializer.declarations.some(declaration => binds(declaration.name))
    )
      return false
    if (
      ts.isCatchClause(scope) &&
      scope.variableDeclaration &&
      binds(scope.variableDeclaration.name)
    )
      return false
    if (
      ts.isBlock(scope) &&
      scope.statements.some(statement =>
        ts.isVariableStatement(statement)
          ? statement.declarationList.declarations.some(declaration => binds(declaration.name))
          : (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
            statement.name?.text === identifier.text,
      )
    )
      return false
  }
  return true
}
/** Follow the host's entry graph; never evaluate application modules or inspect unrelated tests. */
export function discoverHostUserContext(
  root: string,
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
            if (factories.get(node.expression.text)?.moduleSpecifier.includes('angular'))
              throw new Error(
                'Angular host user-context bindings are not supported by the React host build integration',
              )
            result = {
              dependencies: [],
              source: filename,
              declaration: readUserContextSource(file, schema, reads),
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
export function hostUserContextFiles(
  plan: HostUserContextPlan,
  generatedDir: string,
  generator: string,
): readonly GeneratedFile[] {
  const declaration = generatedPath(generatedDir, 'user-context.declaration.ts')
  return [
    {
      path: declaration,
      contents: userContextDeclarationModule(plan.declaration, declaration, generator),
    },
    {
      path: generatedPath(generatedDir, 'user-context.ts'),
      contents: [
        banner(generator, '#mfe/user-context'),
        "import { createHostUserContextBindings } from '@company/mfe-react/user-context'",
        ...bindingTypes('react', './user-context.declaration.ts'),
        'export const { useUserContext } = createHostUserContextBindings<UserContextValues, UserContextReads>()',
        '',
      ].join('\n'),
    },
  ]
}

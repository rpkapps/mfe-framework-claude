import { readFileSync } from 'node:fs'
import type { UserContextManifest } from '@company/mfe-core/user-context'
import {
  collectImportedBindings,
  objectProperty,
  stringLiteralValue,
  ts,
} from '../discovery/ts-ast.ts'
import {
  compileUserContext,
  compileUserContextReads,
  checkUserContextRelease,
  type UserContextReleasePolicy,
} from './compiler.ts'
import { userContextExpression } from './transform.ts'

interface Context {
  readonly sourceCode: { readonly text: string }
  readonly filename: string
  report(descriptor: { loc: { line: number; column: number }; message: string }): void
}

/** Register in an ESLint flat config. Build enforcement remains independent of suppressions. */
export function userContextRule(policyFile?: string) {
  return {
    meta: { type: 'problem' as const, schema: [] },
    create(context: Context) {
      return {
        Program() {
          const file = ts.createSourceFile(
            context.filename,
            context.sourceCode.text,
            ts.ScriptTarget.Latest,
            true,
            context.filename.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
          )
          const factories = new Set(
            [...collectImportedBindings(file)]
              .filter(
                ([, binding]) =>
                  ['createApp', 'createWidget'].includes(binding.imported) &&
                  ['@company/mfe-react', '@company/mfe-angular'].includes(binding.moduleSpecifier),
              )
              .map(([local]) => local),
          )
          const visit = (node: ts.Node): void => {
            if (
              ts.isCallExpression(node) &&
              ts.isIdentifier(node.expression) &&
              factories.has(node.expression.text) &&
              node.arguments[0] &&
              ts.isObjectLiteralExpression(node.arguments[0])
            ) {
              try {
                const schema = userContextExpression(node.arguments[0])
                const reads = userContextExpression(node.arguments[0], 'userContextReads')
                const id = objectProperty(node.arguments[0], 'id')
                const ownerId =
                  (id ? stringLiteralValue(id.initializer) : undefined) ?? '<definition>'
                const contracts = schema
                  ? [...compileUserContext(ownerId, schema, file).contracts]
                  : []
                if (reads) contracts.push(...compileUserContextReads(ownerId, reads, file))
                if (contracts.length && policyFile) {
                  const manifest: UserContextManifest = { formatVersion: 1, contracts }
                  checkUserContextRelease(
                    [manifest],
                    JSON.parse(readFileSync(policyFile, 'utf8')) as UserContextReleasePolicy,
                  )
                }
              } catch (error) {
                const position = file.getLineAndCharacterOfPosition(node.getStart(file))
                context.report({
                  loc: { line: position.line + 1, column: position.character },
                  message: error instanceof Error ? error.message : String(error),
                })
              }
            }
            node.forEachChild(visit)
          }
          visit(file)
        },
      }
    },
  }
}

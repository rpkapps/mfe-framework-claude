/**
 * The webpack loader the integration tests compile TypeScript with, in place of the Angular
 * builder's own emit: syntax only, and with the `.ts` → `.js` specifier rewrite a generated
 * container's tsconfig asks that emit for, so the build has to map those specifiers back itself.
 */

const ts = require('typescript')

module.exports = function typescriptLoader(source) {
  return ts.transpileModule(source, {
    fileName: this.resourcePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      rewriteRelativeImportExtensions: true,
      experimentalDecorators: true,
    },
  }).outputText
}

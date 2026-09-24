/** Types for the plain-JavaScript helper beside this file. */

export declare const SINGLE_COPY: string[]
export declare const INLINE_DEPS: RegExp[]
export declare const singleCopyAliases: { find: RegExp; replacement: string }[]
export declare const tectonResolveForTests: {
  conditions: string[]
  dedupe: string[]
  alias: { find: RegExp; replacement: string }[]
}
export declare const tectonServerForTests: { deps: { inline: RegExp[] } }

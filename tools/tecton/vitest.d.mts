/** Types for the plain-JavaScript helper beside this file. */

import type { Plugin } from 'vitest/config'

export declare const SINGLE_COPY: string[]
export declare const INLINE_DEPS: RegExp[]
export declare const singleCopyForTests: Plugin
export declare const tectonResolveForTests: {
  conditions: string[]
  dedupe: string[]
}
export declare const tectonServerForTests: { deps: { inline: RegExp[] } }

/**
 * `@company/mfe-react/host` — what a shell written in React boots with: the runtime's whole host
 * surface, and the provider that hands the runtime to the React tree. Every adapter's `/host` is
 * the same re-export plus its own provider, so the surfaces cannot drift apart.
 *
 * The re-export names the runtime's bare specifier and never a subpath: under federation only
 * the bare specifier is a share key, so a subpath would bundle a second copy of the runtime.
 */

// A container built with the React Compiler imports this and shares it in the React scope. Only a
// module the host itself imports is provided, and a host is rarely compiled, so without this line
// the first container to need it provides its own and downloads its React client chunk with it.
import 'react/compiler-runtime'

export * from '@company/mfe-runtime'

export { MfeProvider, type MfeProviderProps } from '../runtime-context.tsx'

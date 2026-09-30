/** All shell-owned load paths, including speculative preloads, enforce registry requirements. */
import { assertRuntimeCompatibility } from '@company/mfe-core/runtime-compatibility'

import type { ContainerLoader } from './container-loader.ts'

export function withRuntimeApiCompatibility<T>(
  loader: ContainerLoader<T>,
  apiVersion: string,
): ContainerLoader<T> {
  const load: ContainerLoader<T>['load'] = async (entry, options) => {
    assertRuntimeCompatibility({ apiVersion }, entry)
    return await loader.load(entry, options)
  }
  if (loader.preload === undefined) return { load }
  const preload = loader.preload.bind(loader)
  return {
    load,
    preload: async (entry, options) => {
      assertRuntimeCompatibility({ apiVersion }, entry)
      return await preload(entry, options)
    },
  }
}

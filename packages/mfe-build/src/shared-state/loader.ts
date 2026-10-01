import { readFileSync } from 'node:fs'
import type { SharedStateRequirements } from '@company/mfe-core/shared-state'
import { transformSharedStateSource } from './transform.ts'
interface LoaderContext {
  readonly resourcePath: string
  getOptions(): { readonly references: string }
  addDependency(file: string): void
}
export default function sharedStateLoader(this: LoaderContext, source: string): string {
  const { references } = this.getOptions()
  this.addDependency(references)
  const definitions = JSON.parse(readFileSync(references, 'utf8')) as Record<
    string,
    SharedStateRequirements
  >
  return transformSharedStateSource(source, this.resourcePath, definitions)
}

import { readFileSync } from 'node:fs'
import type { UserContextRequirements } from '@company/mfe-core/user-context'
import { transformUserContextSource } from './transform.ts'
interface LoaderContext {
  readonly resourcePath: string
  getOptions(): { readonly references: string }
  addDependency(file: string): void
}
export default function userContextLoader(this: LoaderContext, source: string): string {
  const { references } = this.getOptions()
  this.addDependency(references)
  const definitions = JSON.parse(readFileSync(references, 'utf8')) as Record<
    string,
    UserContextRequirements
  >
  return transformUserContextSource(source, this.resourcePath, definitions)
}

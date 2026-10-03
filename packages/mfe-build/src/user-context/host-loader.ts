import { discoverHostUserContext, hostUserContextFiles } from './host.ts'
import { writeGeneratedFiles } from '../generate/emit.ts'
interface LoaderContext {
  getOptions(): {
    readonly root: string
    readonly entries?: readonly string[]
    readonly generatedDir: string
    readonly generator: string
  }
  addDependency(file: string): void
}
/** Retypes the shell's binding while its build watches; the source itself passes through unchanged. */
export default function hostUserContextLoader(this: LoaderContext, source: string): string {
  const options = this.getOptions()
  const discovered = discoverHostUserContext(options.root, options.entries)
  if (!discovered) return source
  for (const dependency of discovered.dependencies) this.addDependency(dependency)
  writeGeneratedFiles(hostUserContextFiles(discovered, options.generatedDir, options.generator))
  return source
}

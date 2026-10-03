import { discoverHostUserContext, hostUserContextFile } from './host.ts'
import { writeGeneratedFiles } from '../generate/emit.ts'
import { transformUserContextSource } from './transform.ts'
interface LoaderContext {
  readonly resourcePath: string
  getOptions(): {
    readonly root: string
    readonly id: string
    readonly entries?: readonly string[]
    readonly generatedDir: string
    readonly generator: string
  }
  addDependency(file: string): void
}
/** Hosts discover their current declaration; container loaders only consume generated references. */
export default function hostUserContextLoader(this: LoaderContext, source: string): string {
  const options = this.getOptions()
  const discovered = discoverHostUserContext(options.root, options.id, options.entries)
  if (!discovered || discovered.source !== this.resourcePath)
    throw new Error(
      'Host userContext declaration moved or disappeared; regenerate the host and restart its build',
    )
  for (const dependency of discovered.dependencies) this.addDependency(dependency)
  writeGeneratedFiles([hostUserContextFile(discovered, options.generatedDir, options.generator)])
  return transformUserContextSource(source, this.resourcePath, {}, discovered.registration)
}

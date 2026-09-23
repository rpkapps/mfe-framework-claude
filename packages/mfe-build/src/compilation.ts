/**
 * What a container build does to each compilation, whichever bundler runs it: regenerate before
 * every compile, report the plan's findings, ship the generated artifacts and stamp the federation
 * manifest. It is written against the part of the plugin API webpack and Rspack share, so both
 * integrations do it the same way and neither has to guess which generated files are assets.
 */

import { withFrameworkMetadata } from './federation/federation-options.ts'
import { createGeneratedFileWriter } from './generate/emit.ts'
import type { ContainerPlan } from './plan.ts'

/** A compilation as the build uses it; `Source` and `Failure` are the bundler's own types. */
export interface BundlerCompilation<Source, Failure> {
  readonly errors: Failure[]
  readonly hooks: {
    readonly processAssets: {
      tap(options: { readonly name: string; readonly stage: number }, callback: () => void): void
    }
  }
  getAsset(name: string): { readonly source: { source(): string | Buffer } } | undefined | void
  emitAsset(name: string, source: Source): void
  updateAsset(name: string, source: Source): void
}

/** A webpack or Rspack compiler, as the build uses it; Rspack also answers to `webpack`. */
export interface BundlerCompiler<Source, Failure> {
  readonly options: { readonly mode?: string | undefined }
  readonly hooks: {
    readonly beforeCompile: { tap(name: string, callback: () => void): void }
    readonly thisCompilation: {
      tap(name: string, callback: (compilation: BundlerCompilation<Source, Failure>) => void): void
    }
  }
  readonly webpack: {
    readonly Compilation: {
      readonly PROCESS_ASSETS_STAGE_DERIVED: number
      readonly PROCESS_ASSETS_STAGE_REPORT: number
    }
    readonly sources: { readonly RawSource: new (source: string) => Source }
  }
}

export interface ContainerCompilationOptions<Plan extends ContainerPlan, Failure> {
  /** Names the plugin's taps, and starts the errors it reports itself. */
  readonly name: string
  /** The plan the compiler was configured from, which is written before the first compile. */
  readonly plan: Plan
  /** Plans the sources again, before every compile after the first. */
  readonly replan: () => Plan
  /**
   * Ship the declared defaults as the container's runtime configuration. Off for a dev server,
   * which serves the developer's own copy from `.mfe/` instead; defaults to a production-mode
   * compile.
   */
  readonly emitRuntimeConfig?: boolean | undefined
  /** The finding as the error type the bundler reports. */
  readonly toError: (error: Error) => Failure
  /** Completes the error for a missing federation manifest: what should have added it. */
  readonly federationRepair: string
}

/** Returns the plan the latest compile was built from. */
export function applyContainerCompilation<Plan extends ContainerPlan, Source, Failure>(
  compiler: BundlerCompiler<Source, Failure>,
  options: ContainerCompilationOptions<Plan, Failure>,
): () => Plan {
  const { name } = options
  const write = createGeneratedFileWriter()
  let plan = options.plan
  write(plan.generated.files)

  // The configured plan is current for the first compile: nothing could have changed since.
  let fresh = true
  compiler.hooks.beforeCompile.tap(name, () => {
    if (fresh) {
      fresh = false
      return
    }
    plan = options.replan()
    write(plan.generated.files)
  })

  const emitRuntimeConfig = options.emitRuntimeConfig ?? compiler.options.mode === 'production'
  const { Compilation, sources } = compiler.webpack

  compiler.hooks.thisCompilation.tap(name, compilation => {
    const current = plan
    for (const diagnostic of current.diagnostics) {
      compilation.errors.push(options.toError(diagnostic))
    }

    compilation.hooks.processAssets.tap(
      { name, stage: Compilation.PROCESS_ASSETS_STAGE_DERIVED },
      () => {
        for (const file of current.generated.files) {
          if (file.asset === undefined) continue
          if (file.asset === current.options.runtimeConfigFileName && !emitRuntimeConfig) continue
          if (compilation.getAsset(file.asset) === undefined) {
            compilation.emitAsset(file.asset, new sources.RawSource(file.contents))
          }
        }
      },
    )

    // The federation manifest is written during processAssets, so the metadata goes in last.
    compilation.hooks.processAssets.tap(
      { name, stage: Compilation.PROCESS_ASSETS_STAGE_REPORT },
      () => {
        const manifest = current.options.manifestFileName
        const asset = compilation.getAsset(manifest)

        if (asset === undefined) {
          compilation.errors.push(
            options.toError(
              new Error(
                `${name}: no ${manifest} was emitted, so this container declares no framework ` +
                  'contract and a shell cannot tell which major it was built against. ' +
                  options.federationRepair,
              ),
            ),
          )
          return
        }

        const stats = JSON.parse(asset.source.source().toString()) as Record<string, unknown>
        const stamped = withFrameworkMetadata(stats, current.generated.frameworkMetadata)
        compilation.updateAsset(
          manifest,
          new sources.RawSource(`${JSON.stringify(stamped, null, 2)}\n`),
        )
      },
    )
  })

  return () => plan
}

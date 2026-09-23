/**
 * What every mount's application shares: zoneless change detection, the mount and its runtime as
 * injection tokens, an `ErrorHandler` that reports to the shell's diagnostics instead of the
 * console, and one lifecycle from creation to teardown. One application per mount, so none of it
 * is ever shared between two mounts.
 */

import {
  ErrorHandler,
  provideExperimentalZonelessChangeDetection,
  type ApplicationRef,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core'
import { createApplication } from '@angular/platform-browser'
import {
  createMfeError,
  isMfeError,
  toMfeError,
  withoutUndefined,
  type ContractValidation,
  type MfeError,
} from '@company/mfe-core'
import type { AppMountTarget, MountContext, MountedApp } from '@company/mfe-runtime'

import type { MfeDefinition } from '../definition.ts'
import { MFE_MOUNT, MFE_RUNTIME } from '../inject/tokens.ts'

type MountProviders = readonly (Provider | EnvironmentProviders)[]

/**
 * Collects instead of reporting while the mount is being created, so a component that fails its
 * first render rejects the mount — the host then shows its retry path — rather than leaving an
 * empty element behind a diagnostic.
 */
export class MountErrorHandler implements ErrorHandler {
  readonly #context: MountContext
  #captured: unknown[] | null = null

  constructor(context: MountContext) {
    this.#context = context
  }

  handleError(error: unknown): void {
    if (this.#captured !== null) {
      this.#captured.push(error)
      return
    }

    this.#context.runtime.diagnostics.report(
      this.toMountError(error, 'run the mounted application'),
      {
        context: { mount: this.#context.definitionId },
      },
    )
  }

  /**
   * Runs `work`; a throw, or a failure Angular handed to this handler meanwhile, fails it. Whatever
   * `work` created belongs to the mount's application, which the caller destroys on failure.
   */
  capture<T>(work: () => T): ContractValidation<T> {
    const captured: unknown[] = []
    this.#captured = captured
    try {
      const value = work()
      if (captured.length === 0) return { ok: true, value }
    } catch (error) {
      captured.push(error)
    } finally {
      this.#captured = null
    }
    return { ok: false, error: this.toMountError(captured[0], 'render the definition') }
  }

  toMountError(error: unknown, operation: string): MfeError {
    if (isMfeError(error)) return error
    const { definitionId, definitionVersion } = this.#context
    return toMfeError(error, {
      code: 'mount/failure',
      id: definitionId,
      ...withoutUndefined({ definitionVersion }),
      operation,
      repair:
        'Handle the failure inside the component, or follow the cause attached to this error to the line that threw.',
    })
  }
}

function provideMfeMount(
  context: MountContext,
  errors: MountErrorHandler,
): (Provider | EnvironmentProviders)[] {
  return [
    provideExperimentalZonelessChangeDetection(),
    { provide: ErrorHandler, useValue: errors },
    { provide: MFE_MOUNT, useValue: context },
    { provide: MFE_RUNTIME, useValue: context.runtime },
  ]
}

/**
 * One application per mount, on the page's shared browser platform, which no mount ever destroys.
 * A provider that fails here is the definition's, so the failure is named after it.
 */
async function createMountApplication(
  providers: MountProviders,
  errors: MountErrorHandler,
): Promise<ApplicationRef> {
  try {
    return await createApplication({ providers: [...providers] })
  } catch (error) {
    throw errors.toMountError(error, 'create its application')
  }
}

/**
 * Angular removes the element a component was created on when it is destroyed, and the element a
 * host hands over is the host's, so every mount renders into a child it owns.
 */
function createHostElement(parent: HTMLElement): HTMLElement {
  const element = parent.ownerDocument.createElement('div')
  element.style.display = 'contents'
  parent.appendChild(element)
  return element
}

/** A host disposing a mount it no longer wants is not a failure worth a retry, only a stop. */
export function disposedWhileMounting(context: MountContext): MfeError {
  const { definitionId, definitionVersion } = context
  return toMfeError(context.signal.reason, {
    code: 'mount/failure',
    id: definitionId,
    ...withoutUndefined({ definitionVersion }),
    operation: 'mount',
    observed: 'the mount was disposed before it finished mounting',
    repair: 'No action required when this follows a disposal or a retry.',
  })
}

/**
 * An application destroyed by anything but the mount's own `dispose` — code inside it destroying
 * its `ApplicationRef`, or the platform going down under it — leaves the host an empty element, so
 * it is the mount's fatal failure, and the host can offer a retry instead. The returned function
 * stops watching; `dispose` calls it before destroying the application itself.
 */
function reportForeignDestroy(
  appRef: ApplicationRef,
  context: MountContext,
  onFailure: (error: unknown) => void,
): () => void {
  const { definitionId, definitionVersion, kind } = context

  return appRef.onDestroy(() => {
    onFailure(
      createMfeError({
        code: 'mount/failure',
        id: definitionId,
        ...withoutUndefined({ definitionVersion }),
        operation: `keep the ${kind === 'app' ? 'App' : 'Widget'}'s application running`,
        expected: 'the application to live until the host disposes the mount',
        observed: 'the application was destroyed while the mount was live',
        repair:
          'Find the code that destroys the ApplicationRef or the platform; only the host ends a mount.',
      }),
    )
  })
}

export interface MountApplicationOptions<T> {
  readonly definition: Pick<MfeDefinition, 'id' | 'version' | 'kind' | 'providers'>
  readonly target: Pick<AppMountTarget, 'element' | 'context' | 'onFailure'>
  readonly errors: MountErrorHandler
  /** What this kind of mount provides besides the author's providers and the mount's own. */
  readonly providers: MountProviders
  /** Creates the root component; a throw, or a failure Angular reports meanwhile, rejects. */
  readonly render: (application: ApplicationRef, hostElement: HTMLElement) => T
  /**
   * Wires what runs once the root component exists, and returns what stops it. That runs first on
   * disposal, so nothing can reach the definition while its application is torn down.
   */
  readonly start: (rendered: T, application: ApplicationRef) => () => void
  /** Releases what was made before the application, on every way out: failure or disposal. */
  readonly release?: () => void
}

export interface MountApplication<T> extends Required<MountedApp> {
  readonly rendered: T
  /** True from the first call of `dispose`, so a late update is ignored. */
  isDisposed(): boolean
}

/**
 * One mount's application from creation to teardown, which an App and a Widget share: the author's
 * providers first, so none of them can replace what the mount owns; a failed render or a disposal
 * while creating leaves nothing behind; an application destroyed from inside is the mount's fatal
 * failure; and teardown runs once, whether the host disposes the handle or only the context.
 */
export async function runMountApplication<T>(
  options: MountApplicationOptions<T>,
): Promise<MountApplication<T>> {
  const { definition, errors, render, start, release = () => undefined } = options
  const { context, element, onFailure } = options.target

  const application = await createMountApplication(
    [...definition.providers, ...provideMfeMount(context, errors), ...options.providers],
    errors,
  )

  if (context.signal.aborted) {
    application.destroy()
    release()
    throw disposedWhileMounting(context)
  }

  const hostElement = createHostElement(element)
  const rendered = errors.capture(() => render(application, hostElement))
  if (!rendered.ok) {
    application.destroy()
    release()
    hostElement.remove()
    throw rendered.error
  }

  const stop = start(rendered.value, application)
  const stopWatchingDestroy = reportForeignDestroy(application, context, onFailure)
  const label = definition.kind === 'app' ? 'App' : 'Widget'

  let disposal: Promise<void> | null = null
  const dispose = (): Promise<void> => {
    disposal ??= (async () => {
      stopWatchingDestroy()
      stop()
      try {
        // Already destroyed when this follows a failure reported through `onFailure`.
        if (!application.destroyed) application.destroy()
      } catch (error) {
        context.runtime.diagnostics.report(
          toMfeError(error, {
            code: 'dispose/failure',
            id: definition.id,
            ...withoutUndefined({ definitionVersion: definition.version }),
            operation: `dispose ${label}`,
            repair: `Check the ngOnDestroy hooks and DestroyRef callbacks inside the ${label}.`,
          }),
        )
      }
      release()
      hostElement.remove()
      await Promise.resolve()
    })()
    return disposal
  }

  // The host disposes the handle before the context; a host that only disposes the context
  // still gets the application torn down.
  context.signal.addEventListener('abort', () => void dispose(), { once: true })

  return {
    rendered: rendered.value,
    dispose,
    // Once zoneless change detection, and an App's pending navigations, have nothing left to do.
    whenStable: () => application.whenStable(),
    isDisposed: () => disposal !== null,
  }
}

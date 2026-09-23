/**
 * What every mount's application shares: zoneless change detection, the mount and its runtime as
 * injection tokens, and an `ErrorHandler` that reports to the shell's diagnostics instead of the
 * console. One application per mount, so none of it is ever shared between two mounts.
 */

import {
  ErrorHandler,
  provideExperimentalZonelessChangeDetection,
  type ApplicationRef,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core'
import { createApplication } from '@angular/platform-browser'
import { isMfeError, toMfeError, type ContractValidation, type MfeError } from '@company/mfe-core'
import type { MountContext } from '@company/mfe-host'

import { MFE_MOUNT, MFE_RUNTIME } from '../inject/tokens.ts'

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
      ...(definitionVersion === undefined ? {} : { definitionVersion }),
      operation,
      repair:
        'Handle the failure inside the component, or follow the cause attached to this error to the line that threw.',
    })
  }
}

export function provideMfeMount(
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
export async function createMountApplication(
  providers: readonly (Provider | EnvironmentProviders)[],
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
export function createHostElement(parent: HTMLElement): HTMLElement {
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
    ...(definitionVersion === undefined ? {} : { definitionVersion }),
    operation: 'mount',
    observed: 'the mount was disposed before it finished mounting',
    repair: 'No action required when this follows a disposal or a retry.',
  })
}

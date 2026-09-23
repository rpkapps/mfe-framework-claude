/**
 * The Angular application behind each live mount, by its context. A host holds only the runtime's
 * neutral handle, which never exposes what a definition's `mount` resolved to; the testing entry
 * point mounts through that same handle and reads the mount's injector back from here.
 */

import type { EnvironmentInjector } from '@angular/core'
import type { MountContext } from '@company/mfe-runtime'

export interface MountedApplication {
  /** The mount's own application injector, where an App's `Router` lives. */
  readonly injector: EnvironmentInjector
  /** Resolves once zoneless change detection and pending navigations have nothing left to do. */
  whenStable(): Promise<void>
}

/** Weak, so a disposed mount's context takes its entry with it. */
const applications = new WeakMap<MountContext, MountedApplication>()

export function recordMountedApplication(
  context: MountContext,
  application: MountedApplication,
): void {
  applications.set(context, application)
}

export function mountedApplicationOf(context: MountContext): MountedApplication | undefined {
  return applications.get(context)
}

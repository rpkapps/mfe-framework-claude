/**
 * PrimeNG for this container, kept to its own mounts. Each mount is its own Angular application,
 * so these providers go in the definition's `providers` and every mount gets its own PrimeNG
 * configuration. Verified with PrimeNG 19.1.4 and Angular 19.2, zoneless.
 *
 * PrimeNG is given no preset, so it declares none of its `--p-*` design tokens: its components only
 * read them. The host declares them for the whole page, once, before the first Angular container
 * mounts, and switches them with the theme class it puts on <html>, so dark mode needs nothing here.
 * PrimeNG still writes each component's rules into page-wide style tags keyed by name, so every
 * Angular container on a page uses the same PrimeNG version; the build never shares PrimeNG.
 */

import {
  inject,
  makeEnvironmentProviders,
  provideAppInitializer,
  type EnvironmentProviders,
} from '@angular/core'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { injectMfeMount } from '@company/mfe-angular'
import { PrimeNG, providePrimeNG } from 'primeng/config'

/** The environment providers for `createApp` / `createWidget`'s `providers`. */
export function providePrimeNgForMfe(): EnvironmentProviders {
  return makeEnvironmentProviders([
    // PrimeNG's overlays declare Angular animations, and opening one without any animations
    // provider throws NG05105. Swap to `provideAnimationsAsync()` for real transitions; both work
    // zoneless.
    provideNoopAnimations(),
    // No theme: the tokens are the host's, so PrimeNG writes only its components' rules.
    providePrimeNG({}),
    // Select, MultiSelect, AutoComplete and the other overlay components fall back to
    // `overlayOptions.appendTo`, so this routes all of them into this mount's overlay root.
    // Dialog, ConfirmDialog and Drawer do not read it: give each an explicit
    // [appendTo]="mount.overlayRoot" (with `mount = injectMfeMount()` in the component).
    provideAppInitializer(() => {
      const mount = injectMfeMount()
      const config = inject(PrimeNG)
      config.overlayOptions = { ...config.overlayOptions, appendTo: mount.overlayRoot }
    }),
  ])
}

/**
 * Everything the shell does for Angular containers, in one place: the adapter that reads their
 * registry entries, and the page-wide assets every one of them relies on and none of them ships —
 * PrimeNG's design tokens, Open Props and the Material Symbols font (see angular.css).
 *
 * They load with the first Angular container the page loads, beside its own download, and no
 * Angular definition mounts before they have: the mount shows its loading state meanwhile, so
 * nothing paints unstyled. A page that never loads an Angular container never fetches them.
 */

import { createAngularAdapter } from '@company/mfe-angular/registry'

/**
 * The fonts to wait for, as CSS font shorthands. A stylesheet that declares a font does not
 * download it until text uses it, and until then an icon renders as its name, so each is loaded
 * here. Keep this in step with the faces material-symbols.css declares.
 */
const PAGE_FONTS = ['400 24px "Material Symbols Rounded"']

async function loadPageAssets(): Promise<void> {
  // Its own stylesheet chunk, fetched only here; the import settles once the sheet has applied.
  await import('./angular.css')
  await Promise.all(PAGE_FONTS.map(font => document.fonts.load(font)))
}

export const angularAdapter = createAngularAdapter({ pageAssets: loadPageAssets })

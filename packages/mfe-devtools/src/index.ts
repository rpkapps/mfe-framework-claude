/**
 * The package's public surface.
 *
 * Note what is *not* here: the panel. It is reachable only through the dynamic
 * specifier in `load-panel.ts`, because a static re-export would put every
 * component it imports back into the host's initial chunk and make the code
 * splitting decorative. `devtools-mount.test.tsx` asserts it stays that way.
 */

export { MfeDevtools } from './devtools-mount.tsx'
export { devtools, initDevtools } from './devtools-store.ts'
export {
  DEVTOOLS_QUERY_PARAM,
  DEVTOOLS_STORAGE_KEY,
  readDevtoolsSettings,
  writeDevtoolsSettings,
  type DevtoolsSettings,
  type DevtoolsSide,
  type DevtoolsTab,
} from './devtools-settings.ts'

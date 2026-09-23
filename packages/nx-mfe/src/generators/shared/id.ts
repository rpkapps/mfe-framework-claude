/**
 * The definition id rule mirrors `packages/create-mfe`'s scaffold: an id becomes the federation
 * container name, the storage prefix and the CSS scope value, so it has to stay unambiguous in
 * every one of those roles, not merely be a valid identifier.
 */

export const DEFINITION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function assertUsableId(id: string): void {
  if (DEFINITION_ID_PATTERN.test(id)) return

  throw new Error(
    `"${id}" is not a usable definition id: it must match ${DEFINITION_ID_PATTERN.toString()} ` +
      '(lower-case letters, digits and single hyphens, for example "alert-panel"). The id also ' +
      'becomes the federation container name, the storage prefix and the CSS scope value, so it ' +
      'has to be unambiguous in all three. Pass --id with a value in that shape, or rename the ' +
      'project.',
  )
}

/** `alert-panel` becomes `alertPanel` / `AlertPanel`, matching `packages/create-mfe`'s scaffold
 * so a component named after its id reads the same way in both starters. */

export function toCamel(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_match, character: string) => character.toUpperCase())
}

export function toPascal(id: string): string {
  const camel = toCamel(id)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

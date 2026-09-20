/**
 * The reserved scope the host page registers and stores under.
 *
 * A module of its own, importing nothing, because both halves of the framework
 * key host records, commands and breadcrumbs by it.
 */

/**
 * Everything the host page owns rather than any definition mounted on it. The
 * `@` is what makes it reserved rather than conventional: a definition id is
 * lower-case letters, digits and single hyphens, so nothing a host registers
 * can collide with a definition's. The paths that take a definition id refuse
 * it, and `bindHost`, `hostStorage` and `registerHost` are the only ways in.
 */
export const HOST_SCOPE = '@host'

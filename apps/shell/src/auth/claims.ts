/**
 * The ID token's claims become shell state. Groups are data for rendering and UX decisions, not
 * an authorization API: the resource servers still decide what the token may do.
 */

import type { ShellUser } from '@company/mfe-react'

export interface ShellIdentity {
  readonly user: ShellUser
  readonly groups: readonly string[]
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** A provider sends one group as a bare string and several as an array, depending on how it is configured. */
function groupsFrom(value: unknown): readonly string[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value]
  if (!Array.isArray(value)) return []
  return value.filter((group): group is string => typeof group === 'string' && group !== '')
}

export function identityFromClaims(
  claims: Readonly<Record<string, unknown>>,
  groupsClaim: string,
): ShellIdentity {
  const id = text(claims['sub'])
  if (id === undefined) throw new Error('The ID token has no subject (sub) claim.')

  const email = text(claims['email'])
  const givenAndFamily = [text(claims['given_name']), text(claims['family_name'])]
    .filter(part => part !== undefined)
    .join(' ')
  const name =
    text(claims['name']) ??
    text(givenAndFamily) ??
    text(claims['preferred_username']) ??
    email ??
    id

  return {
    user: { id, name, ...(email === undefined ? {} : { email }) },
    groups: groupsFrom(claims[groupsClaim]),
  }
}

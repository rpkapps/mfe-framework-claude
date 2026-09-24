import { describe, expect, it } from 'vitest'

import { identityFromClaims } from './claims.ts'

describe('identityFromClaims', () => {
  it('maps the standard claims and the groups claim', () => {
    expect(
      identityFromClaims(
        {
          sub: 'a1b2',
          name: 'Robin Kolesnik',
          email: 'robin@example.com',
          groups: ['geoscience', 'well-planning.read'],
        },
        'groups',
      ),
    ).toEqual({
      user: { id: 'a1b2', name: 'Robin Kolesnik', email: 'robin@example.com' },
      groups: ['geoscience', 'well-planning.read'],
    })
  })

  it('builds a name from the given and family names, then the username, then the email', () => {
    expect(
      identityFromClaims({ sub: 's', given_name: 'Robin', family_name: 'K' }, 'groups').user.name,
    ).toBe('Robin K')
    expect(identityFromClaims({ sub: 's', preferred_username: 'rkol' }, 'groups').user.name).toBe(
      'rkol',
    )
    expect(identityFromClaims({ sub: 's', email: 'r@example.com' }, 'groups').user.name).toBe(
      'r@example.com',
    )
    expect(identityFromClaims({ sub: 's' }, 'groups').user).toEqual({ id: 's', name: 's' })
  })

  it('reads the configured claim, a single group, and drops anything that is not a group name', () => {
    expect(identityFromClaims({ sub: 's', roles: 'reader' }, 'roles').groups).toEqual(['reader'])
    expect(
      identityFromClaims({ sub: 's', groups: ['a', 3, '', null, 'b'] }, 'groups').groups,
    ).toEqual(['a', 'b'])
    expect(identityFromClaims({ sub: 's' }, 'groups').groups).toEqual([])
  })

  it('refuses claims without a subject', () => {
    expect(() => identityFromClaims({ name: 'Nobody' }, 'groups')).toThrow(/sub/)
  })
})

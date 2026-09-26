/**
 * TanStack reports a match's pathname without the router's basepath, and the shell renders a
 * crumb's href as it is, so a crumb that left out the App's boundary would link out of the App.
 */

import { describe, expect, it } from 'vitest'

import { breadcrumbsFromMatches, type BreadcrumbMatch } from './breadcrumbs-from-matches.ts'

const ROOT: BreadcrumbMatch = { id: '__root__', pathname: '/' }

function hrefs(matches: readonly BreadcrumbMatch[], basePath: string): readonly unknown[] {
  return breadcrumbsFromMatches(matches, basePath).map(item => item.href)
}

describe('breadcrumbsFromMatches', () => {
  it('links each crumb under the App boundary', () => {
    const matches: BreadcrumbMatch[] = [
      ROOT,
      { id: '/wells', pathname: '/wells', routePath: '/wells' },
      {
        id: '/wells/$wellId',
        pathname: '/wells/w-7',
        routePath: '$wellId',
        params: { wellId: 'w-7' },
      },
    ]

    expect(hrefs(matches, '/p')).toEqual(['/p/wells', '/p/wells/w-7'])
  })

  it('adds no second slash when the boundary or the match ends in one', () => {
    const matches: BreadcrumbMatch[] = [
      ROOT,
      { id: '/wells', pathname: '/wells/', routePath: '/wells' },
    ]

    expect(hrefs(matches, '/p/')).toEqual(['/p/wells'])
  })

  it('leaves the path as it is for an App mounted at the root', () => {
    const matches: BreadcrumbMatch[] = [
      ROOT,
      { id: '/wells', pathname: '/wells', routePath: '/wells' },
    ]

    expect(hrefs(matches, '/')).toEqual(['/wells'])
  })

  it('links a labelled crumb at the boundary itself to the boundary', () => {
    const matches: BreadcrumbMatch[] = [
      { id: '/_home', pathname: '/', routePath: 'home', staticData: { breadcrumb: 'Home' } },
    ]

    expect(hrefs(matches, '/p')).toEqual(['/p'])
    expect(hrefs(matches, '/')).toEqual(['/'])
  })
})

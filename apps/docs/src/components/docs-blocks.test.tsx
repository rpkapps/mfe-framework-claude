import * as React from 'react'
import { act } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  DocsSharedCode as DocsSharedCodeComponent,
  DocsTab as DocsTabComponent,
  DocsTabs as DocsTabsComponent,
} from './docs-blocks.tsx'

let DocsTab: typeof DocsTabComponent
let DocsTabs: typeof DocsTabsComponent
let DocsSharedCode: typeof DocsSharedCodeComponent

function Examples() {
  return (
    <DocsTabs items={['Angular', 'React']}>
      <DocsTab value="React">React example</DocsTab>
      <DocsTab value="Angular">Angular example</DocsTab>
    </DocsTabs>
  )
}

let root: Root | undefined
let container: HTMLDivElement

beforeEach(async () => {
  vi.resetModules()
  ;({ DocsTab, DocsTabs, DocsSharedCode } = await import('./docs-blocks.tsx'))
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container.remove()
  vi.restoreAllMocks()
})

async function mount(children: React.ReactNode) {
  root = createRoot(container)
  await act(async () => root?.render(children))
}

async function choose(label: string) {
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    item => item.textContent === label,
  )
  expect(tab).toBeDefined()
  await act(async () => tab?.click())
}

function selectedLabels() {
  return [...container.querySelectorAll('[role="tab"][aria-selected="true"]')].map(
    tab => tab.textContent,
  )
}

describe('framework examples', () => {
  it('shows the same shared snippet in either framework tab', async () => {
    await mount(
      <DocsSharedCode>
        <pre>
          <code>pnpm run build</code>
        </pre>
      </DocsSharedCode>,
    )
    expect(selectedLabels()).toEqual(['React'])
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toBe('pnpm run build')
    await choose('Angular')
    expect(selectedLabels()).toEqual(['Angular'])
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toBe('pnpm run build')
  })
  it('puts React first and defaults to React', async () => {
    await mount(<Examples />)
    expect(container.querySelector('[role="tab"]')?.textContent).toBe('React')
    expect(selectedLabels()).toEqual(['React'])
  })

  it('lets each example switch independently and starts the next page on React', async () => {
    await mount(
      <>
        <Examples />
        <Examples />
      </>,
    )
    await choose('Angular')
    expect(selectedLabels()).toEqual(['Angular', 'React'])
    expect(window.localStorage.getItem('mfe-docs:framework')).toBeNull()
    await act(async () => root?.render(<Examples key="next-page" />))
    expect(selectedLabels()).toEqual(['React'])
  })

  it('hydrates with React even when a previous Angular preference exists', async () => {
    window.localStorage.setItem('mfe-docs:framework', 'Angular')
    container.innerHTML = renderToString(<Examples />)
    expect(selectedLabels()).toEqual(['React'])
    const onRecoverableError = vi.fn()
    await act(async () => {
      root = hydrateRoot(container, <Examples />, { onRecoverableError })
    })
    expect(selectedLabels()).toEqual(['React'])
    expect(onRecoverableError).not.toHaveBeenCalled()
  })

  it('keeps working when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Denied')
    })
    await mount(
      <>
        <Examples />
        <Examples />
      </>,
    )
    await choose('Angular')
    expect(selectedLabels()).toEqual(['Angular', 'React'])
    await act(async () => root?.render(<Examples key="next-page" />))
    expect(selectedLabels()).toEqual(['React'])
  })

  it('leaves unrelated tabs independent with their existing default', async () => {
    await mount(
      <>
        <Examples />
        <DocsTabs items={['npm', 'pnpm']} defaultValue="pnpm">
          <DocsTab value="npm">npm install</DocsTab>
          <DocsTab value="pnpm">pnpm install</DocsTab>
        </DocsTabs>
      </>,
    )
    await choose('Angular')
    expect(selectedLabels()).toEqual(['Angular', 'pnpm'])
    await choose('npm')
    expect(selectedLabels()).toEqual(['Angular', 'npm'])
  })
})

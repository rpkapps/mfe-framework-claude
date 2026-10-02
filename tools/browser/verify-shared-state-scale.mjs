/** Real layout checks against a 30-contract runtime, built separately from the production shell. */
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { createRsbuild } from '@rsbuild/core'
import { expect } from '@playwright/test'
import { tectonResolve, useWorkspaceModules } from '../tecton/tecton-build.mjs'

export async function verifySharedStateScale(browser) {
  const shell = fileURLToPath(new URL('../../apps/shell/', import.meta.url))
  const requireFromShell = createRequire(`${shell}package.json`)
  const { pluginReact } = await import(
    pathToFileURL(requireFromShell.resolve('@rsbuild/plugin-react')).href
  )
  useWorkspaceModules(shell)
  const rsbuild = await createRsbuild({
    cwd: shell,
    rsbuildConfig: {
      plugins: [pluginReact()],
      source: { entry: { index: './src/testing/shared-state-devtools.fixture.tsx' } },
      dev: { lazyCompilation: false },
      server: { port: 3019, strictPort: true, publicDir: false },
      tools: { rspack: { resolve: tectonResolve(shell) } },
    },
  })
  const server = await rsbuild.startDevServer()
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const shots = fileURLToPath(new URL('../../screenshots/', import.meta.url))
  await mkdir(shots, { recursive: true })
  const panel = page.locator('[data-mfe-devtools-panel]')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('http://localhost:3019/', { waitUntil: 'load' })
    await expect(panel.getByText('30 keys · Read only')).toBeVisible()
    const list = panel.getByRole('navigation', { name: 'Shared-state contracts' })
    await expect(list.getByRole('button')).toHaveCount(30)
    const first = list.getByRole('button').first()
    expect((await first.boundingBox()).height).toBeLessThanOrEqual(32)
    const well = list.getByRole('button', { name: 'Inspect well:selection' })
    // Click the whitespace at the edge and the trailing badge, not just the label.
    await well.click({ position: { x: 3, y: 14 } })
    await expect(well).toHaveAttribute('aria-pressed', 'true')
    const second = list.getByRole('button', { name: 'Inspect assets:filters' })
    await second.locator('[data-slot="badge"]').click()
    await expect(second).toHaveAttribute('aria-pressed', 'true')
    await first.focus()
    await page.keyboard.press('End')
    await expect(list.getByRole('button').last()).toBeFocused()
    expect(await list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await page.keyboard.press('Home')
    await expect(first).toBeFocused()
    expect(await list.evaluate(element => element.scrollTop)).toBeLessThanOrEqual(4)
    await panel.screenshot({ path: `${shots}shared-state-30-keys.png` })

    await page.getByRole('button', { name: 'Dock to the right', exact: true }).click()
    await expect(list).toBeHidden()
    const picker = page.getByLabel('Choose shared-state key', { exact: true })
    await picker.click()
    await expect(page.getByRole('option')).toHaveCount(30)
    await panel.screenshot({ path: `${shots}shared-state-30-keys-narrow-picker.png` })
    const input = page.getByLabel('Find a shared-state key', { exact: true })
    await input.fill('well:selection')
    await page.getByRole('option', { name: 'well:selection', exact: true }).click()
    await expect(page.getByLabel('current value of well:selection', { exact: true })).toContainText(
      'well-42',
    )
    await expect(picker).toBeFocused()
    await panel.screenshot({ path: `${shots}shared-state-30-keys-narrow.png` })
    await picker.click()
    await input.fill('no-such-key')
    await expect(page.getByText('No keys match your search.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker).toBeFocused()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByLabel('current value of well:selection', { exact: true })).toBeVisible()
    await panel.screenshot({ path: `${shots}shared-state-30-keys-mobile.png` })
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    // A very short narrow dock still lets the detail body scroll independently.
    await page.setViewportSize({ width: 800, height: 360 })
    await page.getByRole('tab', { name: 'Contract', exact: true }).click()
    const body = panel.locator('[data-slot="panel-content"]').last()
    expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
    expect(errors).toEqual([])
    console.log(
      'Shared State scale: 30 compact full-row targets, keyboard scrolling, narrow picker, mobile and short docks verified.',
    )
  } finally {
    await page.close()
    await server.close()
  }
}

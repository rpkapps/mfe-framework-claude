import { afterEach, describe, expect, it } from 'vitest'

import { cleanupContainers, createContainer, entryOf } from '../testing/fixtures.ts'
import { findNonContainerAwareAssetReferences } from './relative-references.ts'

afterEach(cleanupContainers)

function scan(source: string): readonly Error[] {
  const root = createContainer({ 'src/logo.ts': source })
  return findNonContainerAwareAssetReferences(entryOf(root, 'src/logo.ts'))
}

describe('findNonContainerAwareAssetReferences', () => {
  it('reports a bare relative path in a template string', () => {
    const errors = scan('export const logo = `./assets/logo.svg`\n')

    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('import.meta.url')
    expect(errors[0]?.message).toContain('dev server')
  })

  it('reports a bare relative path in an ordinary string', () => {
    expect(scan("export const logo = './assets/logo.svg'\n")).toHaveLength(1)
  })

  it('accepts an ordinary import', () => {
    expect(scan("import logo from './assets/logo.svg'\nexport { logo }\n")).toHaveLength(0)
  })

  it('accepts new URL against import.meta.url', () => {
    expect(
      scan("export const logo = new URL('./assets/logo.svg', import.meta.url).href\n"),
    ).toHaveLength(0)
  })

  it('accepts Angular component resource URLs resolved by the compiler', () => {
    expect(
      scan(`
import { Component as AngularComponent } from '@angular/core'
@AngularComponent({
  templateUrl: './widget.component.html',
  styleUrl: './widget.component.css',
  styleUrls: ['./widget-base.css', './widget-theme.css'],
})
export class WidgetComponent {}
`),
    ).toHaveLength(0)
  })

  it('does not exempt unrelated resource strings or decorators', () => {
    expect(
      scan(`
import { Component } from '@angular/core'
const fallback = './fallback.css'
const metadata = { styleUrl: './unsafe.css' }
@Other({ styleUrl: './other.css' })
class OtherComponent {}
@Component({ styleUrl: './safe.css' })
class WidgetComponent {}
`),
    ).toHaveLength(3)
  })

  it('leaves absolute external URLs alone', () => {
    expect(scan("export const logo = 'https://cdn.example.com/logo.svg'\n")).toHaveLength(0)
    expect(scan("export const logo = '/static/logo.svg'\n")).toHaveLength(0)
  })

  it('leaves route paths and module specifiers alone', () => {
    expect(scan("export const route = './orders/detail'\n")).toHaveLength(0)
  })
})

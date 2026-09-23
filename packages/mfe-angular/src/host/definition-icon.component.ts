/**
 * `<mfe-definition-icon>` — draws a registry entry's icon. The framework owns this rather than any
 * one host, because the catalogue, the developer tools and a shell's own chrome all render the
 * same entries.
 *
 * `IconData` arrives over the network from another origin, so the tag of every shape is checked
 * here as well as at the registry boundary: the boundary decides the record is well formed, this
 * decides what is allowed to reach the document. Attribute names reach the DOM as written.
 *
 * Decorated rather than built from signals, like every component this package ships: the JIT
 * pipeline the package's own tests run under has no transform for signal inputs, and a container
 * compiles this source ahead of time with the rest of its application.
 */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Input,
  Renderer2,
  type OnChanges,
} from '@angular/core'
import type { IconData, IconNode } from '@company/mfe-core'

/** What an icon may draw with. Anything else is dropped rather than rendered. */
const TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g'])

/**
 * Attributes that run or fetch something. React ignores a string event handler by itself; the DOM
 * runs one, so they are dropped here, with links, which none of the allowed shapes needs.
 */
const UNSAFE_ATTRIBUTE = /^(?:on|href$|xlink:href$)/i

/** A name the DOM would refuse with an exception, dropped like React drops one. */
const ATTRIBUTE_NAME = /^[a-zA-Z_:][\w:.-]*$/

/** Renderer2's name for the SVG namespace. */
const SVG = 'svg'

@Component({
  selector: 'mfe-definition-icon',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfeDefinitionIconComponent implements OnChanges {
  @Input({ required: true }) icon!: IconData
  /** Edge length in pixels; the icon's own `viewBox` decides what is drawn inside it. */
  @Input() size = 24
  /** Naming the icon makes it content; without a label it is decoration and stays hidden. */
  @Input() label: string | undefined

  readonly #renderer = inject(Renderer2)
  readonly #host: HTMLElement = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement

  /** Redrawn whole: an icon is a handful of shapes, and a partial patch could keep a stale one. */
  ngOnChanges(): void {
    for (const child of [...this.#host.childNodes]) this.#renderer.removeChild(this.#host, child)

    const svg = this.#element('svg', this.icon.attributes ?? {})
    this.#renderer.setAttribute(svg, 'viewBox', this.icon.viewBox)
    this.#renderer.setAttribute(svg, 'width', String(this.size))
    this.#renderer.setAttribute(svg, 'height', String(this.size))
    if (this.label === undefined) {
      this.#renderer.setAttribute(svg, 'aria-hidden', 'true')
    } else {
      this.#renderer.setAttribute(svg, 'role', 'img')
      this.#renderer.setAttribute(svg, 'aria-label', this.label)
    }

    this.#draw(svg, this.icon.node)
    this.#renderer.appendChild(this.#host, svg)
  }

  #draw(parent: Element, nodes: readonly IconNode[]): void {
    for (const [tag, attributes, children] of nodes) {
      if (!TAGS.has(tag)) continue
      const element = this.#element(tag, attributes)
      if (children !== undefined) this.#draw(element, children)
      this.#renderer.appendChild(parent, element)
    }
  }

  #element(tag: string, attributes: Readonly<Record<string, string>>): Element {
    const element = this.#renderer.createElement(tag, SVG) as Element
    for (const [name, value] of Object.entries(attributes)) {
      if (!ATTRIBUTE_NAME.test(name) || UNSAFE_ATTRIBUTE.test(name)) continue
      this.#renderer.setAttribute(element, name, value)
    }
    return element
  }
}

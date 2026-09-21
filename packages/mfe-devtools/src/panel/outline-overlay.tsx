/**
 * A box round every mounted App and Widget, so a page composed from several containers can be
 * read as the several containers it is. It paints below the panel and above the page, takes no
 * pointer events, and is `aria-hidden`: it is a picture of the page, not part of it.
 */

import type { ReactNode } from 'react'
import { AppWindowIcon, ComponentIcon } from 'lucide-react'

import { useMountOutlines, type MountOutline } from './outlines.ts'

/** One below the panel, which is `2147483000`: the tools stay legible over what they are outlining. */
const OVERLAY_Z_INDEX = 2147482999

/** The label's own height, which is what decides whether it fits above its box. */
const LABEL_HEIGHT = 20

/**
 * Colour carries the kind, because that is the one thing a box cannot show by its shape. Both are
 * deliberately loud: this paints over whatever an MFE renders, and a box that blends into it is a
 * box nobody sees. An App takes the focus colour, and a Widget an azure step — a dark teal on a
 * light page and a bright cyan on a dark one, so `text-background` on that label inverts with it
 * and stays legible in both.
 *
 * The boxes carry no tint: an App's is usually the whole viewport, and a wash over the page dims
 * the content the outlines were turned on to look at.
 */
const KIND_STYLE: Readonly<
  Record<MountOutline['kind'], { readonly box: string; readonly label: string }>
> = {
  // `text-black` rather than `text-background`, alone among the three: the focus colour is a bright
  // pink in both themes rather than one that inverts, and dark is what reads on it either way.
  app: { box: 'border-ring', label: 'bg-ring text-black' },
  widget: { box: 'border-azure-830', label: 'bg-azure-830 text-background' },
  unknown: { box: 'border-neutral', label: 'bg-neutral text-neutral-foreground' },
}

const KIND_ICON: Readonly<Record<MountOutline['kind'], typeof AppWindowIcon>> = {
  app: AppWindowIcon,
  widget: ComponentIcon,
  unknown: ComponentIcon,
}

export function MountOutlineOverlay(): ReactNode {
  const outlines = useMountOutlines()

  return (
    <div
      aria-hidden
      data-mfe-devtools-outlines
      style={{ zIndex: OVERLAY_Z_INDEX }}
      className="pointer-events-none fixed inset-0 overflow-hidden"
    >
      {outlines.map(outline => (
        <MountBox key={outline.key} outline={outline} />
      ))}
    </div>
  )
}

function MountBox({ outline }: { readonly outline: MountOutline }): ReactNode {
  const { rect, kind, id } = outline
  const style = KIND_STYLE[kind]
  const Icon = KIND_ICON[kind]
  // A mount at the top of the viewport has no room above it, so the label drops inside the box.
  const above = rect.y >= LABEL_HEIGHT

  return (
    <div
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      className={`absolute rounded-xs border-2 ${style.box}`}
    >
      <span
        className={`absolute left-0 flex max-w-full items-center gap-1 rounded-xs px-1 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap ${style.label} ${above ? 'bottom-full rounded-b-none' : 'top-0 rounded-t-none'}`}
      >
        <Icon className="size-3 shrink-0 opacity-80" />
        <span className="truncate">{id}</span>
        <span className="shrink-0 opacity-70">
          {rect.width}×{rect.height}
        </span>
      </span>
    </div>
  )
}

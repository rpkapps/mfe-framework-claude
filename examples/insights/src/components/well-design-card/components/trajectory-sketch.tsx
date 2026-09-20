import * as React from 'react'
import { cn } from 'cn'

import type { WellDesign } from '../data'

type TrajectorySketchProps = React.ComponentProps<'svg'> & {
  design: Pick<WellDesign, 'path' | 'casings' | 'td' | 'kickOff' | 'md'>
  /** Depth labels along the left edge. */
  showLabels?: boolean
}

const W = 240
const H = 200
const PAD = { top: 16, right: 44, bottom: 12, left: 48 }

/**
 * Minimal SVG well-trajectory sketch: a polyline from surface to TD with
 * casing shoes drawn as ticks and depth / hole-size labels.
 */
function TrajectorySketch({
  className,
  design,
  showLabels = true,
  ...props
}: TrajectorySketchProps) {
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const toX = (x: number) => PAD.left + x * innerW
  const toY = (y: number) => PAD.top + y * innerH
  const path = design.path
  const points = path.map(([x, y]) => `${toX(x)},${toY(y)}`).join(' ')
  /** Total-depth point: the trajectory always ends at TD. */
  const tdPoint: [number, number] = path[path.length - 1] ?? [0, 0]

  /** Approximate x on the path at a given normalised depth. */
  const xAtDepth = (depth: number) => {
    for (let i = 1; i < path.length; i++) {
      const from = path[i - 1]
      const to = path[i]
      if (from === undefined || to === undefined) continue
      const [x0, y0] = from
      const [x1, y1] = to
      if (depth <= y1) {
        const t = y1 === y0 ? 0 : (depth - y0) / (y1 - y0)
        return x0 + (x1 - x0) * t
      }
    }
    return tdPoint[0]
  }

  const depthFt = (fraction: number) => Math.round(design.td * fraction)

  return (
    <svg
      data-slot="trajectory-sketch"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Well trajectory sketch"
      className={cn('h-auto w-full max-w-full text-muted-foreground', className)}
      {...props}
    >
      {/* surface line */}
      <line
        x1={PAD.left - 8}
        x2={W - PAD.right + 8}
        y1={PAD.top}
        y2={PAD.top}
        className="stroke-border-strong"
        strokeWidth={2}
      />
      {/* depth grid */}
      {[0.25, 0.5, 0.75].map(fraction => (
        <line
          key={fraction}
          x1={PAD.left}
          x2={W - PAD.right}
          y1={toY(fraction)}
          y2={toY(fraction)}
          className="stroke-border-subtle"
          strokeDasharray="2 4"
        />
      ))}
      {/* trajectory */}
      <polyline
        points={points}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* casing shoes */}
      {design.casings.map(casing => {
        const x = toX(xAtDepth(casing.depth))
        const y = toY(casing.depth)
        return (
          <g key={`${casing.depth}-${casing.size}`}>
            <line
              x1={x - 7}
              x2={x + 7}
              y1={y}
              y2={y}
              stroke="var(--chart-2)"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            {showLabels && (
              <>
                <text
                  x={PAD.left - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-current font-mono"
                  fontSize={8}
                >
                  {depthFt(casing.depth).toLocaleString()} ft
                </text>
                <text
                  x={W - PAD.right + 6}
                  y={y + 3}
                  textAnchor="start"
                  fill="var(--chart-1)"
                  className="font-mono"
                  fontSize={8}
                >
                  {casing.size}
                </text>
              </>
            )}
          </g>
        )
      })}
      {/* TD marker */}
      <circle cx={toX(tdPoint[0])} cy={toY(tdPoint[1])} r={3.5} fill="var(--chart-5)" />
    </svg>
  )
}

export { TrajectorySketch }
export type { TrajectorySketchProps }

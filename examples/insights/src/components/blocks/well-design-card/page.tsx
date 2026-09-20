// @ts-nocheck
'use client'

import * as React from 'react'

import { TrajectorySketch } from './components/trajectory-sketch'
import { WellDesignCard } from './components/well-design-card'
import { wellDesigns } from './data'

/** Route-ready page: a responsive grid of well design cards. */
export default function WellDesignCardPage() {
  const [selected, setSelected] = React.useState<string[]>([])

  return (
    <div
      data-slot="well-design-card-page"
      className="min-h-svh w-full bg-background px-4 py-8 text-foreground md:px-8"
    >
      <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {wellDesigns.map(design => (
          <WellDesignCard
            key={design.id}
            design={design}
            isSelected={selected.includes(design.id)}
            onSelectedChange={next =>
              setSelected(current =>
                next ? [...current, design.id] : current.filter(id => id !== design.id),
              )
            }
          />
        ))}
      </div>
    </div>
  )
}

export { WellDesignCard, TrajectorySketch }
export { wellDesigns, trajectoryMeta, phaseMeta, riskLabel } from './data'
export type { WellDesign, TrajectoryType, DesignPhase } from './data'
export type { WellDesignCardProps } from './components/well-design-card'

// @ts-nocheck
'use client'

import * as React from 'react'

import { FdaCard, LevelMeter } from './components/fda-card'
import { fdaSummaries } from './data'

/** Route-ready page: a responsive grid of FDA cards with selection. */
export default function FdaCardPage() {
  const [selected, setSelected] = React.useState<string[]>([])

  return (
    <div
      data-slot="fda-card-page"
      className="min-h-svh w-full bg-background px-4 py-8 text-foreground md:px-8"
    >
      <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-2 xl:grid-cols-3">
        {fdaSummaries.map(fda => (
          <FdaCard
            key={fda.id}
            fda={fda}
            isSelected={selected.includes(fda.id)}
            onSelectedChange={next =>
              setSelected(current =>
                next ? [...current, fda.id] : current.filter(id => id !== fda.id),
              )
            }
          />
        ))}
      </div>
    </div>
  )
}

export { FdaCard, LevelMeter }
export { fdaSummaries, statusMeta, ratingMeta, levelLabel } from './data'
export type { FdaSummary, FdaCardStatus, FdaRating } from './data'
export type { FdaCardProps } from './components/fda-card'

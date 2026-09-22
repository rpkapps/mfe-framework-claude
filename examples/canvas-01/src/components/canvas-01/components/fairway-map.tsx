import * as React from 'react'
import { cn } from 'cn'

import { features as defaultFeatures, surveys as defaultSurveys } from '../data'
import type { MapFeature } from '../data'

type FairwayMapProps = Omit<React.ComponentProps<'svg'>, 'onSelect'> & {
  features?: MapFeature[]
  surveys?: MapFeature[]
  selected?: string | null
  onSelect?: (id: string | null) => void
  /** Magnification of the view; 1 fits the whole extent, 2 halves it. */
  zoom?: number
}

/** Extent of the map in map units; the view box is a window onto it. */
const extent = { width: 1000, height: 600 }

/**
 * Stand-in for the map engine: an SVG fairway map with sub-basin and
 * terrace fills, survey outlines, field polygons and hatched prospect
 * areas. Colours come from the chart tokens so it follows the theme.
 */
function FairwayMap({
  className,
  features = defaultFeatures,
  surveys = defaultSurveys,
  selected,
  onSelect,
  zoom = 1,
  ...props
}: FairwayMapProps) {
  const id = React.useId()
  const scale = Math.max(zoom, 0.1)
  const width = extent.width / scale
  const height = extent.height / scale
  return (
    <svg
      data-slot="fairway-map"
      viewBox={`${(extent.width - width) / 2} ${(extent.height - height) / 2} ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      className={cn('size-full select-none', className)}
      role="img"
      aria-label="Fairway map"
      {...props}
    >
      <defs>
        <pattern
          id={`${id}-hatch`}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke="var(--color-foreground)"
            strokeWidth="1"
            strokeOpacity="0.5"
          />
        </pattern>
        <pattern id={`${id}-grid`} width="100" height="100" patternUnits="userSpaceOnUse">
          <path
            d="M100 0H0V100"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="0.5"
            strokeOpacity="0.6"
            vectorEffect="non-scaling-stroke"
          />
        </pattern>
      </defs>

      {/* Regional geology */}
      <rect width="1000" height="600" fill="var(--chart-2)" fillOpacity="0.18" />
      <path
        d="M0 0H700C640 120 660 260 560 340C480 410 420 520 360 600H0Z"
        fill="var(--chart-3)"
        fillOpacity="0.16"
      />
      <path
        d="M1000 0H820C780 120 860 260 900 340C940 410 960 520 1000 600Z"
        fill="var(--chart-5)"
        fillOpacity="0.2"
      />
      <path
        d="M0 600V420C80 380 160 360 260 300C340 250 380 210 460 190C500 260 420 340 360 420C300 500 200 540 120 600Z"
        fill="var(--chart-4)"
        fillOpacity="0.35"
      />
      <path
        d="M140 440C170 400 240 400 250 440C260 480 200 520 160 500C130 485 125 460 140 440Z"
        fill="var(--chart-5)"
        fillOpacity="0.55"
      />
      <rect width="1000" height="600" fill={`url(#${id}-grid)`} />

      {/* Survey outlines */}
      {surveys.map(survey => (
        <g key={survey.id} className="text-muted-foreground">
          <polygon
            points={survey.points}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="2 4"
            strokeOpacity="0.8"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={survey.label[0]}
            y={survey.label[1]}
            className="fill-current font-mono"
            style={{ fontSize: 11 / scale }}
            opacity="0.8"
          >
            {survey.name}
          </text>
        </g>
      ))}

      {/* Fields and prospects */}
      {features.map(feature => {
        const isSelected = selected === feature.id
        const isProspect = feature.kind === 'prospect'
        return (
          <g
            key={feature.id}
            data-kind={feature.kind}
            data-selected={isSelected || undefined}
            className={cn('cursor-pointer', onSelect && 'hover:opacity-90')}
            onClick={() => onSelect?.(isSelected ? null : feature.id)}
          >
            <polygon
              points={feature.points}
              fill={isProspect ? `url(#${id}-hatch)` : 'var(--chart-1)'}
              fillOpacity={isProspect ? 1 : 0.45}
              stroke={isSelected ? 'var(--color-ring)' : 'var(--color-foreground)'}
              strokeWidth={isSelected ? 2 : 1}
              strokeOpacity={isSelected ? 1 : 0.7}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={feature.label[0]}
              y={feature.label[1]}
              textAnchor="middle"
              className="fill-foreground font-mono"
              style={{ fontSize: 12 / scale }}
            >
              {feature.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export { FairwayMap }
export type { FairwayMapProps }

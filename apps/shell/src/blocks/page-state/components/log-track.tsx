import * as React from "react"
import { cn } from "cn"

/**
 * LogTrack — a decorative well-log panel: depth scale on the left, a few
 * named tracks (GR, RES, DT…) with deterministic pseudo-random curves, and
 * a drawing context for overlays (`LogTrackMarker`, `LogTrackBand`) so a
 * page state can annotate the log at a depth: where the data stops (404),
 * a restricted interval (403), an anomaly (500), a workover band (503)…
 *
 * The curves come from a seeded random walk, so a given `seed` always draws
 * the same log and the illustration is stable across renders and builds.
 */
const W = 360
const H = 440
const PAD = { top: 30, right: 14, bottom: 14, left: 46 }
const GAP = 8
const SAMPLES = 96

type Geometry = {
  x0: number
  x1: number
  y0: number
  y1: number
  /** Y coordinate of a depth fraction (0 = top of the log, 1 = bottom). */
  toY: (fraction: number) => number
}

const LogTrackContext = React.createContext<Geometry | null>(null)

function useLogTrack() {
  const geometry = React.useContext(LogTrackContext)
  if (!geometry) throw new Error("useLogTrack must be used within a LogTrack.")
  return geometry
}

/** mulberry32 — small, fast, deterministic. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mean-reverting random walk with a few "formation" steps: 0..1 per sample. */
function curve(seed: number, samples: number) {
  const next = random(seed)
  const values: number[] = []
  let value = 0.35 + next() * 0.3
  let target = value
  for (let i = 0; i < samples; i++) {
    if (next() < 0.06) target = 0.2 + next() * 0.6
    value += (next() - 0.5) * 0.16 + (target - value) * 0.18
    value = Math.min(0.94, Math.max(0.06, value))
    values.push(value)
  }
  return values
}

type Track = {
  label: string
  /** Tailwind stroke class; defaults cycle through the chart colours. */
  className?: string
}

const defaultTracks: Track[] = [
  { label: "GR", className: "stroke-chart-1" },
  { label: "RES", className: "stroke-chart-2" },
  { label: "DT", className: "stroke-chart-3" },
]

type LogTrackProps = Omit<React.ComponentProps<"svg">, "children"> & {
  seed?: number
  tracks?: Track[]
  depthFrom?: number
  depthTo?: number
  unit?: string
  /** Depth fraction below which no data is drawn. */
  stopAt?: number
  /** Depth fraction below which the curves are drawn dashed and muted. */
  fadeFrom?: number
  /** Depth fraction below which the curves flat-line (dashed). */
  flatFrom?: number
  /** Send one track off-scale at a depth fraction, in the accent colour. */
  spike?: { track: number; at: number }
  /** Overlays drawn in the log's coordinate space (markers, bands). */
  children?: React.ReactNode
}

function LogTrack({
  className,
  seed = 7,
  tracks = defaultTracks,
  depthFrom = 1200,
  depthTo = 3200,
  unit = "m",
  stopAt,
  fadeFrom,
  flatFrom,
  spike,
  children,
  ...props
}: LogTrackProps) {
  const clipId = React.useId()
  const geometry = React.useMemo<Geometry>(() => {
    const y0 = PAD.top
    const y1 = H - PAD.bottom
    return {
      x0: PAD.left,
      x1: W - PAD.right,
      y0,
      y1,
      toY: (fraction) => y0 + Math.min(1, Math.max(0, fraction)) * (y1 - y0),
    }
  }, [])

  const innerW = geometry.x1 - geometry.x0
  const trackW = (innerW - GAP * (tracks.length - 1)) / tracks.length
  const trackX = (index: number) => geometry.x0 + index * (trackW + GAP)

  const curves = React.useMemo(
    () => tracks.map((_, index) => curve(seed * 31 + index * 7919, SAMPLES)),
    [seed, tracks]
  )

  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const depthAt = (fraction: number) =>
    Math.round(depthFrom + (depthTo - depthFrom) * fraction)

  return (
    <svg
      data-slot="log-track"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Well log illustration"
      className={cn(
        // Small screens: a 400px-tall log inside the 256px figure band, so the
        // middle of the log (where the annotations sit) shows at readable size.
        "w-auto max-w-full shrink-0 font-mono text-muted-foreground max-lg:h-[400px] lg:h-full lg:max-h-full",
        className
      )}
      {...props}
    >
      <defs>
        {tracks.map((_, index) => (
          <clipPath key={index} id={`${clipId}-track-${index}`}>
            <rect
              x={trackX(index)}
              y={geometry.y0}
              width={trackW}
              height={geometry.y1 - geometry.y0}
            />
          </clipPath>
        ))}
      </defs>

      {/* track headers + frames */}
      {tracks.map((track, index) => (
        <g key={track.label}>
          <text
            x={trackX(index) + trackW / 2}
            y={PAD.top - 12}
            textAnchor="middle"
            fontSize={9}
            letterSpacing={1}
            className="fill-current"
          >
            {track.label}
          </text>
          <rect
            x={trackX(index)}
            y={geometry.y0}
            width={trackW}
            height={geometry.y1 - geometry.y0}
            className="fill-background/40 stroke-border"
            strokeWidth={1}
          />
        </g>
      ))}

      {/* depth scale */}
      {ticks.map((fraction) => (
        <g key={fraction}>
          <line
            x1={geometry.x0}
            x2={geometry.x1}
            y1={geometry.toY(fraction)}
            y2={geometry.toY(fraction)}
            className="stroke-border-subtle"
            strokeDasharray="2 4"
          />
          <text
            x={geometry.x0 - 6}
            y={geometry.toY(fraction) + 3}
            textAnchor="end"
            fontSize={9}
            className="fill-current"
          >
            {depthAt(fraction)}
          </text>
        </g>
      ))}
      <text
        x={geometry.x0 - 6}
        y={PAD.top - 12}
        textAnchor="end"
        fontSize={9}
        letterSpacing={1}
        className="fill-current"
      >
        {unit.toUpperCase()}
      </text>

      {/* curves */}
      {tracks.map((track, index) => {
        const values = curves[index] ?? []
        const points = values.map((value, i) => {
          const fraction = i / (SAMPLES - 1)
          return {
            fraction,
            x: trackX(index) + 4 + value * (trackW - 8),
            y: geometry.toY(fraction),
          }
        })
        const solid = points.filter(
          (p) =>
            (stopAt === undefined || p.fraction <= stopAt) &&
            (fadeFrom === undefined || p.fraction <= fadeFrom) &&
            (flatFrom === undefined || p.fraction <= flatFrom)
        )
        const faded =
          fadeFrom === undefined
            ? []
            : points.filter(
                (p) =>
                  p.fraction >= fadeFrom &&
                  (stopAt === undefined || p.fraction <= stopAt)
              )
        const solidEnd = solid[solid.length - 1]
        const flat =
          flatFrom === undefined || solidEnd === undefined
            ? null
            : {
                x: solidEnd.x,
                y0: solidEnd.y,
                y1: geometry.toY(stopAt ?? 1),
              }
        const spikeHere = spike && spike.track === index
        const spikePoints = spikeHere
          ? (() => {
              const i = Math.round(spike.at * (SAMPLES - 1))
              const before = points[Math.max(0, i - 2)]
              const after = points[Math.min(SAMPLES - 1, i + 2)]
              if (before === undefined || after === undefined) return null
              return `${before.x},${before.y} ${trackX(index) + trackW + 20},${geometry.toY(spike.at)} ${after.x},${after.y}`
            })()
          : null
        const stroke = cn(track.className ?? "stroke-chart-1")
        return (
          <g
            key={track.label}
            clipPath={`url(#${clipId}-track-${index})`}
            fill="none"
          >
            <polyline
              points={solid.map((p) => `${p.x},${p.y}`).join(" ")}
              className={stroke}
              strokeWidth={1.25}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {faded.length > 1 && (
              <polyline
                points={faded.map((p) => `${p.x},${p.y}`).join(" ")}
                className={cn(stroke, "opacity-35")}
                strokeWidth={1.25}
                strokeDasharray="3 5"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {flat && (
              <line
                x1={flat.x}
                x2={flat.x}
                y1={flat.y0}
                y2={flat.y1}
                className={cn(stroke, "opacity-50")}
                strokeWidth={1.25}
                strokeDasharray="3 5"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {spikePoints && (
              <polyline
                points={spikePoints}
                className="stroke-(--page-state-accent)"
                strokeWidth={1.75}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        )
      })}

      <LogTrackContext value={geometry}>{children}</LogTrackContext>
    </svg>
  )
}

type OverlayTone = "accent" | "muted"

const overlayToneClass: Record<OverlayTone, string> = {
  accent: "text-(--page-state-accent)",
  muted: "text-muted-foreground",
}

/** A horizontal depth line across the tracks with a small label tag. */
function LogTrackMarker({
  at,
  label,
  tone = "accent",
  className,
  ...props
}: Omit<React.ComponentProps<"g">, "children"> & {
  at: number
  label?: React.ReactNode
  tone?: OverlayTone
}) {
  const { x0, x1, toY } = useLogTrack()
  const y = toY(at)
  const text = typeof label === "string" ? label : ""
  const tagW = Math.max(40, text.length * 6 + 14)
  return (
    <g
      data-slot="log-track-marker"
      className={cn(overlayToneClass[tone], className)}
      {...props}
    >
      <line
        x1={x0 - 4}
        x2={x1}
        y1={y}
        y2={y}
        className="stroke-current"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={`${x0 - 4},${y} ${x0 - 10},${y - 4} ${x0 - 10},${y + 4}`}
        className="fill-current"
      />
      {label && (
        <g transform={`translate(${x1 - tagW}, ${y - 18})`}>
          <rect width={tagW} height={14} rx={3} className="fill-current" />
          <text
            x={tagW / 2}
            y={10}
            textAnchor="middle"
            fontSize={8}
            letterSpacing={0.8}
            className="fill-background font-medium"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  )
}

/** A depth interval across the tracks: hatched or solid, with a label and optional icon. */
function LogTrackBand({
  from,
  to,
  label,
  pattern = "hatch",
  tone = "accent",
  className,
  children,
  ...props
}: React.ComponentProps<"g"> & {
  from: number
  to: number
  label?: React.ReactNode
  pattern?: "hatch" | "solid"
  tone?: OverlayTone
}) {
  const { x0, x1, toY } = useLogTrack()
  const patternId = React.useId()
  const y0 = toY(from)
  const y1 = toY(to)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return (
    <g
      data-slot="log-track-band"
      className={cn(overlayToneClass[tone], className)}
      {...props}
    >
      {pattern === "hatch" && (
        <defs>
          <pattern
            id={patternId}
            width={8}
            height={8}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={8}
              className="stroke-current"
              strokeWidth={1.5}
            />
          </pattern>
        </defs>
      )}
      <rect
        x={x0}
        y={y0}
        width={x1 - x0}
        height={y1 - y0}
        className="fill-card"
        opacity={pattern === "solid" ? 0.92 : 0.7}
      />
      <rect
        x={x0}
        y={y0}
        width={x1 - x0}
        height={y1 - y0}
        fill={pattern === "hatch" ? `url(#${patternId})` : "currentColor"}
        opacity={pattern === "hatch" ? 0.25 : 0.1}
      />
      <line
        x1={x0}
        x2={x1}
        y1={y0}
        y2={y0}
        className="stroke-current"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={x0}
        x2={x1}
        y1={y1}
        y2={y1}
        className="stroke-current"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      {children && (
        <g transform={`translate(${cx - 14}, ${cy - (label ? 26 : 14)})`}>
          {children}
        </g>
      )}
      {label && (
        <text
          x={cx}
          y={cy + (children ? 14 : 4)}
          textAnchor="middle"
          fontSize={9}
          letterSpacing={1.2}
          className="fill-current font-medium"
        >
          {label}
        </text>
      )}
    </g>
  )
}

export { LogTrack, LogTrackMarker, LogTrackBand, useLogTrack }
export type { LogTrackProps }

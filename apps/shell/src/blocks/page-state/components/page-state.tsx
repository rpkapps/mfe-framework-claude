"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

import { Badge } from "@tecton/react/components/badge"
import { CopyButton } from "@tecton/react/tecton/copy-button"

/**
 * PageState — the full-page scaffold every page state (404, 403, 500,
 * maintenance, offline…) shares: a status row, the big code, title,
 * description, actions and a diagnostics footer on the left; a figure
 * panel on the right (stacked above on small screens). `tone` colours the
 * status badge, the figure glow and `--page-state-accent`, which the
 * `LogTrack` overlays pick up.
 */
const pageStateVariants = cva(
  "grid min-h-svh w-full grid-rows-[auto_1fr] bg-background text-foreground lg:grid-cols-2 lg:grid-rows-1",
  {
    variants: {
      tone: {
        neutral: "[--page-state-accent:var(--neutral)]",
        info: "[--page-state-accent:var(--info)]",
        success: "[--page-state-accent:var(--success)]",
        warning: "[--page-state-accent:var(--warning)]",
        destructive: "[--page-state-accent:var(--destructive)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

type Tone = NonNullable<VariantProps<typeof pageStateVariants>["tone"]>

const ToneContext = React.createContext<Tone>("neutral")

const badgeVariantByTone: Record<
  Tone,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  neutral: "secondary",
  info: "info",
  success: "success",
  warning: "warning",
  destructive: "destructive",
}

function PageState({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"main"> & VariantProps<typeof pageStateVariants>) {
  return (
    <ToneContext value={tone ?? "neutral"}>
      <main
        data-slot="page-state"
        data-tone={tone}
        className={cn(pageStateVariants({ tone }), className)}
        {...props}
      />
    </ToneContext>
  )
}

function PageStateContent({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-state-content"
      className={cn(
        "order-last flex min-w-0 flex-col justify-center px-6 py-10 md:px-12 md:py-14 lg:order-none lg:px-16",
        className
      )}
      {...props}
    >
      <div className="flex w-full max-w-xl flex-col gap-6">{children}</div>
    </div>
  )
}

/** Status row: tone badge + monospace protocol line (`HTTP 404 · Not Found`). */
function PageStateStatus({
  className,
  label,
  children,
  ...props
}: React.ComponentProps<"div"> & { label: React.ReactNode }) {
  const tone = React.useContext(ToneContext)
  return (
    <div
      data-slot="page-state-status"
      className={cn("flex flex-wrap items-center gap-3", className)}
      {...props}
    >
      <Badge variant={badgeVariantByTone[tone]} size="md">
        {label}
      </Badge>
      {children && (
        <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          {children}
        </span>
      )}
    </div>
  )
}

/** The big code (`404`) with an accent rule under it. */
function PageStateCode({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-state-code"
      className={cn("flex flex-col gap-4", className)}
    >
      <span
        className="font-mono text-7xl leading-none font-medium tracking-tighter tabular-nums md:text-8xl"
        {...props}
      />
      <span
        aria-hidden
        className="h-1 w-12 rounded-full bg-(--page-state-accent)"
      />
    </div>
  )
}

function PageStateHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-state-header"
      className={cn("flex flex-col gap-3", className)}
      {...props}
    />
  )
}

function PageStateTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      data-slot="page-state-title"
      className={cn(
        "font-heading text-2xl font-medium tracking-tight text-balance md:text-3xl",
        className
      )}
      {...props}
    />
  )
}

function PageStateDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="page-state-description"
      className={cn(
        "max-w-prose text-base/relaxed text-pretty text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function PageStateActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-state-actions"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  )
}

/** Diagnostics footer: a row of small label / value pairs. */
function PageStateMeta({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl
      data-slot="page-state-meta"
      className={cn(
        "flex flex-wrap gap-x-8 gap-y-3 border-t border-border-subtle pt-5 text-xs",
        className
      )}
      {...props}
    />
  )
}

function PageStateMetaItem({
  className,
  label,
  value,
  copyable,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode
  value: string
  /** Show a copy button after the value. */
  copyable?: boolean
}) {
  return (
    <div
      data-slot="page-state-meta-item"
      className={cn("flex min-w-0 flex-col gap-0.5", className)}
      {...props}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 font-mono text-foreground">
        <span className="truncate">{value}</span>
        {copyable && (
          <CopyButton
            value={value}
            size="icon-xs"
            className="-my-1 text-muted-foreground"
            aria-label={`Copy ${typeof label === "string" ? label.toLowerCase() : "value"}`}
          />
        )}
      </dd>
    </div>
  )
}

/**
 * Figure panel: paper background with a fine dot grid and a tone-coloured
 * glow. Holds the `LogTrack` illustration or any other visual.
 */
function PageStateFigure({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="page-state-figure"
      className={cn(
        "relative flex items-center justify-center overflow-hidden border-b border-border-subtle bg-card max-lg:h-64 lg:border-s lg:border-b-0",
        "bg-[radial-gradient(var(--border-subtle)_1px,transparent_1px)] bg-[size:20px_20px]",
        className
      )}
      {...props}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_45%,color-mix(in_oklch,var(--page-state-accent)_14%,transparent),transparent_70%)]"
      />
      <div className="relative flex h-full w-full items-center justify-center px-6 max-lg:overflow-hidden lg:absolute lg:inset-0 lg:h-auto lg:p-16">
        {children}
      </div>
    </div>
  )
}

export {
  PageState,
  PageStateContent,
  PageStateStatus,
  PageStateCode,
  PageStateHeader,
  PageStateTitle,
  PageStateDescription,
  PageStateActions,
  PageStateMeta,
  PageStateMetaItem,
  PageStateFigure,
  pageStateVariants,
}
export type { Tone as PageStateTone }

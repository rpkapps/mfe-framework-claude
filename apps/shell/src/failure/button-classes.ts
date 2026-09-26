/**
 * Tecton's button classes, for the failure page's native buttons. They are copied rather than
 * imported because `@tecton/react/components/button` imports React Aria, which is shared across
 * the federation and so never tree-shaken: `buttonVariants` alone would load all of it.
 * `failure-page.test.ts` checks them against `buttonVariants`, so a Tecton update that changes the
 * button fails there rather than drifting here.
 */

/** `buttonVariants()`: the default button. */
export const ACTION_BUTTON =
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 hover:bg-primary-hover hover:text-primary-hover-foreground focus-visible:bg-primary-hover focus-visible:text-primary-hover-foreground data-pressed:bg-primary-pressed data-pressed:text-primary-pressed-foreground aria-expanded:bg-primary-active aria-expanded:text-primary-active-foreground bg-primary text-primary-foreground h-8 gap-1 px-2 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5"

/** `buttonVariants({ variant: 'ghost', size: 'icon-xs' })`: what `CopyButton` draws at that size. */
export const COPY_BUTTON =
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 text-ghost-foreground hover:bg-ghost-hover hover:text-ghost-hover-foreground focus-visible:bg-ghost-hover focus-visible:text-ghost-hover-foreground data-pressed:bg-ghost-pressed data-pressed:text-ghost-pressed-foreground aria-expanded:bg-ghost-active aria-expanded:text-ghost-active-foreground size-6 rounded-[min(var(--radius-md),8px)] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3"

/**
 * Tecton's rem in pixels, for sizes that take no CSS variables (the chat split's panel sizes). A
 * plain `rem` follows the root font size, which a shell may shrink for PrimeNG; Tecton's own sizes
 * follow `--tecton-rem`, so this measures that.
 */
export function tectonRemInPixels(): number {
  const probe = document.createElement('div')
  probe.style.cssText = 'position: absolute; visibility: hidden; width: var(--tecton-rem, 1rem)'
  document.body.append(probe)
  const pixels = probe.getBoundingClientRect().width
  probe.remove()
  return pixels || 16
}

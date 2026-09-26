/**
 * The hooks the header and the panel's frame use, on the boot path; the chat's own are in
 * `hooks.ts`, which loads with it. Apart from the components so React Refresh can replace those in
 * place (§18).
 */

import { useSyncExternalStore } from 'react'

import { shellChat, type LazyShellChat } from './instance.ts'
import { CLOSED_PANEL, type ChatPanel, type ChatPanelState } from './panel.ts'

const noop = (): (() => void) => () => {}

/** Set at boot, before the first render, and replaced only by a boot that renders again. */
export function useShellChat(): LazyShellChat | null {
  return shellChat()
}

export function useChatPanel(chat: { readonly panel: ChatPanel } | null): ChatPanelState {
  return useSyncExternalStore(
    chat?.panel.subscribe ?? noop,
    chat?.panel.getSnapshot ?? (() => CLOSED_PANEL),
  )
}

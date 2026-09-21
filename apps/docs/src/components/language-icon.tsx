import { BracesIcon, FileCodeIcon, FileTextIcon, PaletteIcon, TerminalIcon } from 'lucide-react'

import type { ReactElement } from 'react'

/** Small icon for a code block title, keyed by file extension / language. */
export function getIconForLanguageExtension(language: string): ReactElement {
  switch (language) {
    case 'tsx':
    case 'ts':
    case 'jsx':
    case 'js':
    case 'mjs':
    case 'mts':
      return <FileCodeIcon />
    case 'css':
      return <PaletteIcon />
    case 'json':
      return <BracesIcon />
    case 'bash':
    case 'sh':
    case 'shell':
      return <TerminalIcon />
    default:
      return <FileTextIcon />
  }
}

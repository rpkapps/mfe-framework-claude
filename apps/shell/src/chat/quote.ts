/**
 * The text the user selected, quoted into their message as Markdown (`> `), so the transcript
 * and the model both read it as quoted, and it stays in the conversation.
 */

/** The longest selection that goes into a message; the rest is left out, and the quote says so. */
export const MAX_SELECTION_LENGTH = 2000

export function quote(text: string): string {
  const trimmed = text.trim()
  const clipped =
    trimmed.length > MAX_SELECTION_LENGTH ? `${trimmed.slice(0, MAX_SELECTION_LENGTH)}…` : trimmed
  return clipped
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
}

/** A message's leading `> ` lines, the text the user selected, apart from what they wrote. */
export function splitQuote(text: string): { readonly quoted: string; readonly rest: string } {
  const lines = text.split('\n')
  let end = 0
  while (end < lines.length && lines[end]?.startsWith('>') === true) end += 1
  if (end === 0) return { quoted: '', rest: text }
  return {
    quoted: lines
      .slice(0, end)
      .map(line => line.replace(/^> ?/, ''))
      .join('\n'),
    rest: lines.slice(end).join('\n').trim(),
  }
}

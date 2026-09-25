/** The shell's own tools, by name: what the transcript renders its own way, and what is always declared. */
export const SHELL_TOOLS = {
  navigate: 'navigate',
  renderWidget: 'render_widget',
  table: 'show_table',
  chart: 'show_chart',
  summary: 'show_summary',
  askUser: 'ask_user',
  a2ui: 'render_a2ui',
} as const

type ShellToolName = (typeof SHELL_TOOLS)[keyof typeof SHELL_TOOLS]

const NAMES: ReadonlySet<string> = new Set(Object.values(SHELL_TOOLS))

export function isShellTool(name: string): name is ShellToolName {
  return NAMES.has(name)
}

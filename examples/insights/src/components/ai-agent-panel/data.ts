export type AgentAction = {
  id: string
  label: string
  /** Chip colour; `primary` is the default call-to-action. */
  color?: 'primary' | 'default' | 'success'
}

export type AgentToolStep = {
  id: string
  label: string
  detail?: string
  duration: string
}

export type AgentMessage =
  | {
      id: string
      role: 'assistant'
      content: string[]
      actions?: AgentAction[]
    }
  | {
      id: string
      role: 'user'
      content: string
    }
  | {
      id: string
      role: 'tool'
      summary: string
      duration: string
      steps: AgentToolStep[]
    }

export const agentConversation: AgentMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content:
      'The 7" production casing is showing collapse risk below 12,800 ft. What are our options?',
  },
  {
    id: 't1',
    role: 'tool',
    summary: '3 actions',
    duration: '37s',
    steps: [
      {
        id: 's1',
        label: 'Checked casing inventory for 5" liner',
        detail: '3 joints available at Mongstad base',
        duration: '4s',
      },
      {
        id: 's2',
        label: 'Calculated impact on drilling time and rig schedule',
        detail: '+0.5 days',
        duration: '21s',
      },
      {
        id: 's3',
        label: 'Calculated impact on cost',
        detail: '$2.0M – $2.3M',
        duration: '12s',
      },
    ],
  },
  {
    id: 'm2',
    role: 'assistant',
    content: [
      'We have a 5" production liner in available inventory which should work for this situation. The estimated impact is +0.5 days and +$2.0–2.3M.',
      'Would you like to add this to the design?',
    ],
    actions: [{ id: 'a1', label: 'Add casing liner', color: 'primary' }],
  },
  {
    id: 'm3',
    role: 'user',
    content: 'Add casing liner',
  },
  {
    id: 'm4',
    role: 'assistant',
    content: ["Great. I'll work on adding the production liner to the well design."],
  },
  {
    id: 't2',
    role: 'tool',
    summary: '4 actions',
    duration: '37s',
    steps: [
      {
        id: 's4',
        label: 'Drafted Production Liner section',
        detail: '5" × 18 lb/ft, 12,600 – 13,900 ft MD',
        duration: '9s',
      },
      {
        id: 's5',
        label: 'Adjusted rig schedule',
        detail: '+0.5 days on Deepsea Atlantic',
        duration: '6s',
      },
      {
        id: 's6',
        label: 'Validated section overlaps',
        detail: '1 conflict found',
        duration: '14s',
      },
      {
        id: 's7',
        label: 'Updated AFE cost estimate',
        detail: '$98M → $100.2M',
        duration: '8s',
      },
    ],
  },
  {
    id: 'm5',
    role: 'assistant',
    content: [
      "I've drafted the new Production Liner section and adjusted the rig schedule to accommodate the extra section. However, the new Production Liner overlaps with the existing Production Casing shoe depth at 13,359 ft MD.",
      'To resolve this, I can set the production casing shoe depth to 7,700 ft MD, allowing the liner to cover the lower interval.',
    ],
    actions: [
      { id: 'a2', label: 'Update shoe depth', color: 'primary' },
      { id: 'a3', label: 'Keep current design', color: 'default' },
    ],
  },
]

export const agentSuggestions = [
  'Compare with Reduced DLS',
  'Summarise cost impact',
  'Show casing schematic',
]

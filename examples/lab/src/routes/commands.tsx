import { createFileRoute } from '@tanstack/react-router'
import { allow, deny, useCommand, useGroups, useUser } from '@company/mfe-react'
import { Badge } from '@tecton/react/components/badge'
import { Kbd } from '@tecton/react/components/kbd'
import { Switch } from '@tecton/react/components/switch'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@tecton/react/components/field'
import { useId, useState, type ReactNode } from 'react'

import { LabPage, LabSection, Readout } from '../lab-page.tsx'

export const Route = createFileRoute('/commands')({
  staticData: { breadcrumb: 'Commands' },
  component: Commands,
})

function Commands(): ReactNode {
  const id = useId()
  const user = useUser()
  const groups = useGroups()
  const [log, setLog] = useState<readonly string[]>([])
  const [armed, setArmed] = useState(true)

  const record = (line: string): void => {
    setLog(current => [`${new Date().toLocaleTimeString()} — ${line}`, ...current].slice(0, 8))
  }

  // Registration is a hook, so scoping follows component lifetime: leave this
  // route and the command leaves the shell's palette with it.
  useCommand({
    name: 'run-simulation',
    label: 'Run the simulation',
    canExecute: () => (armed ? allow() : deny('Arm the simulation first.')),
    execute: () => {
      record('run-simulation executed')
    },
  })

  useCommand({
    name: 'export-results',
    label: 'Export results',
    canExecute: () =>
      groups.includes('well-planning.read')
        ? allow()
        : deny('You need the well-planning.read group to export.'),
    execute: () => {
      record('export-results executed')
    },
  })

  return (
    <LabPage
      eyebrow="Commands"
      title="This App puts actions in the shell's palette"
      description="A command is registered by the mount that owns it and evaluated by its own code. The shell lists it and runs it; it never decides whether it is allowed."
      tryThis={
        <>
          Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> and look under &ldquo;From the mounted application&rdquo;.
          Turn the switch below off and open the palette again — the command is still listed, greyed
          out, with the reason this App gave. Hiding it would leave the user guessing.
        </>
      }
    >
      <LabSection title="A command this page can deny" note="canExecute">
        <Field orientation="horizontal" className="justify-between">
          <FieldContent>
            <FieldLabel htmlFor={`${id}-armed`}>Simulation armed</FieldLabel>
            <FieldDescription>
              When this is off, &ldquo;Run the simulation&rdquo; is denied with a reason.
            </FieldDescription>
          </FieldContent>
          <Switch id={`${id}-armed`} isSelected={armed} onChange={setArmed} />
        </Field>
      </LabSection>

      <LabSection title="A command the session decides" note="groups">
        <p className="text-sm text-muted-foreground">
          &ldquo;Export results&rdquo; is allowed only for the{' '}
          <code className="font-mono">well-planning.read</code> group. This session:
        </p>
        <div className="flex flex-wrap gap-1">
          {groups.map(group => (
            <Badge key={group} variant="secondary">
              {group}
            </Badge>
          ))}
        </div>
        <Readout label="user" value={user?.name ?? null} />
      </LabSection>

      <LabSection title="What ran" note="execute">
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Run a command from the palette.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 font-mono text-xs">
            {log.map(line => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </LabSection>
    </LabPage>
  )
}

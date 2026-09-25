import { createFileRoute } from '@tanstack/react-router'
import { allow, deny, useAction, useGroups, useUser } from '@company/mfe-react'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { Kbd } from '@tecton/react/components/kbd'
import { Switch } from '@tecton/react/components/switch'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@tecton/react/components/field'
import { useId, useState, type ReactNode } from 'react'
import { z } from 'zod'

import { EventLog, LabPage, LabSection, Tags } from '../lab-page.tsx'

/** At module scope: the registry converts it to JSON Schema whenever its identity changes. */
const simulationInput = z.object({ runs: z.number().int().min(1).max(1000).default(100) })

export const Route = createFileRoute('/actions')({
  staticData: { breadcrumb: 'Actions' },
  component: Actions,
})

function Actions(): ReactNode {
  const id = useId()
  const user = useUser()
  const groups = useGroups()
  const [log, setLog] = useState<readonly { at: string; text: string }[]>([])
  const [armed, setArmed] = useState(true)

  const record = (text: string): void => {
    setLog(current => [{ at: new Date().toLocaleTimeString(), text }, ...current].slice(0, 8))
  }

  // Registration is a hook, so leaving this route takes the action out of the shell's palette.
  // What it returns runs the same action as this page's own button.
  const runSimulation = useAction({
    name: 'run-simulation',
    label: 'Run the simulation',
    description: 'Runs the well-planning simulation. More runs take longer and smooth the result.',
    inputSchema: simulationInput,
    // It changes nothing the user keeps, so the agent may run it without asking.
    effect: 'read',
    canExecute: () => (armed ? allow() : deny('Arm the simulation first.')),
    execute: ({ runs }) => {
      record(`Ran the simulation ${runs} times`)
    },
  })

  useAction({
    name: 'export-results',
    label: 'Export results',
    description: 'Exports the simulation results to a file the user downloads.',
    canExecute: () =>
      groups.includes('well-planning.read')
        ? allow()
        : deny('You need the well-planning.read group to export.'),
    execute: () => {
      record('Exported the results')
    },
  })

  return (
    <LabPage
      eyebrow="Actions"
      title="This App puts actions in the shell's palette"
      description="An action is registered by the mount that owns it and evaluated by its own code. The shell lists it and runs it; it never decides whether it is allowed."
      tryThis={
        <>
          Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> and look under &ldquo;From the mounted application&rdquo;.
          Turn the switch below off and open the palette again — the action is still listed, greyed
          out, with the reason this App gave. Hiding it would leave the user guessing.
        </>
      }
    >
      <LabSection title="An action this page can deny" note="canExecute">
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

      <LabSection title="The page's own button" note="useAction's run">
        <p className="text-sm text-muted-foreground">
          This button calls what <code className="font-mono">useAction</code> returned, so it goes
          through the same check as the palette: turn the switch off and it is denied with the same
          reason, and its input is validated against the same schema.
        </p>
        <Button
          variant="outline"
          className="self-start"
          onPress={() => {
            void runSimulation({ runs: 10 }).then(result => {
              if (result.status !== 'executed') record(`Not run: ${result.status}`)
            })
          }}
        >
          Run the simulation 10 times
        </Button>
      </LabSection>

      <LabSection title="An action the session decides" note="groups">
        <p className="text-sm text-muted-foreground">
          &ldquo;Export results&rdquo; is allowed only for the{' '}
          <code className="font-mono">well-planning.read</code> group.{' '}
          {user === null ? 'Nobody is signed in' : `${user.name} is a member of`}:
        </p>
        <Tags values={groups} variant="info" empty="No groups on this session." />
        <p className="text-sm">
          {groups.includes('well-planning.read') ? (
            <Badge variant="success" appearance="outline">
              allowed for this session
            </Badge>
          ) : (
            <Badge variant="warning" appearance="outline">
              denied for this session
            </Badge>
          )}
        </p>
      </LabSection>

      <LabSection title="What ran" note="execute">
        <EventLog
          entries={log}
          empty={
            <>
              Nothing yet. Press <Kbd>⌘</Kbd> <Kbd>K</Kbd> and run one of this page&apos;s actions
              from the palette.
            </>
          }
        />
      </LabSection>
    </LabPage>
  )
}

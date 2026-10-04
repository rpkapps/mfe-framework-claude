import { createFileRoute } from '@tanstack/react-router'
import { useStoredState } from '@company/mfe-react'
import { Button } from '@tecton/react/components/button'
import { Field, FieldDescription, FieldLabel } from '@tecton/react/components/field'
import { Input } from '@tecton/react/components/input'
import { Switch } from '@tecton/react/components/switch'
import { useId, type ReactNode } from 'react'

import { Fields, LabPage, LabSection } from '../lab-page.tsx'
import { draft as draftKey, visits as visitsKey } from '../storage.ts'

export const Route = createFileRoute('/storage')({
  staticData: { breadcrumb: 'Storage' },
  component: Storage,
})

function Storage(): ReactNode {
  const id = useId()

  // A stored value belongs to the browser: it survives a sign-out, and the next person to sign in
  // on this browser reads it (§56).
  // Each key is declared once, in src/storage.ts, with its schema, default and area.
  const draftState = useStoredState(draftKey)
  const visitsState = useStoredState(visitsKey)
  const draft = draftState.value
  const visits = visitsState.value

  return (
    <LabPage
      eyebrow="Storage"
      title="Validated and scoped"
      description="An MFE never touches localStorage. It declares a key with a schema and a default, and gets a subscribed value and an awaitable setter — with the key namespaced under this definition's id, so two MFEs cannot collide."
      tryThis={
        <>
          Type a note, reload the page, and it is still there. Then open devtools and look for
          <code className="font-mono"> lab:draft</code> — the prefix is this App&apos;s id, and the
          stored value carries an envelope the next read validates.
        </>
      }
    >
      <LabSection title="State that outlives a sign-out" note="useStoredState">
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>Note</FieldLabel>
          <Input
            id={`${id}-note`}
            value={draft.note}
            onChange={event => {
              void draftState.set(current => ({ ...current, note: event.target.value }))
            }}
          />
          <FieldDescription>
            Stored under this App&apos;s own prefix. The framework never clears it, so the next
            person to sign in on this browser reads it too: keep nothing personal here.
          </FieldDescription>
        </Field>

        <Field orientation="horizontal" className="justify-between">
          <FieldLabel htmlFor={`${id}-pinned`}>Pinned</FieldLabel>
          <Switch
            id={`${id}-pinned`}
            checked={draft.pinned}
            onCheckedChange={next => {
              void draftState.set(current => ({ ...current, pinned: next }))
            }}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">What is stored right now</span>
          <Fields value={draft} />
        </div>
      </LabSection>

      <LabSection title="State for this tab alone" note="storage: session">
        <p className="text-sm text-muted-foreground">
          Counted {visits} time{visits === 1 ? '' : 's'} in this tab. It survives a reload and goes
          when the tab closes.
        </p>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              void visitsState.set(current => current + 1)
            }}
          >
            Count a visit
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void visitsState.set(0)
            }}
          >
            Reset
          </Button>
        </div>
      </LabSection>

      <LabSection title="Removing the key" note="reset()">
        <p className="text-sm text-muted-foreground">
          <code className="font-mono">reset()</code> removes the stored entry, so the note and the
          pin go back to the key&apos;s default.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void draftState.reset()
            }}
          >
            Remove the key
          </Button>
        </div>
      </LabSection>
    </LabPage>
  )
}

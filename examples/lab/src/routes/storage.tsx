import { createFileRoute } from '@tanstack/react-router'
import { useMfeStorage, useStoredState } from '@company/mfe-react'
import { Button } from '@tecton/react/components/button'
import { Field, FieldDescription, FieldLabel } from '@tecton/react/components/field'
import { Input } from '@tecton/react/components/input'
import { Switch } from '@tecton/react/components/switch'
import { useId, useState, type ReactNode } from 'react'
import { z } from 'zod'

import { DataList, DataRow, Fields, LabPage, LabSection, Value } from '../lab-page.tsx'

export const Route = createFileRoute('/storage')({
  staticData: { breadcrumb: 'Storage' },
  component: Storage,
})

/** Schemas are declared at module scope, as the storage contract requires: one rebuilt every render
 * would rebind the key on every render. */
const draftSchema = z.object({ note: z.string(), pinned: z.boolean() })
const visitsSchema = z.number().int().nonnegative()

function Storage(): ReactNode {
  const id = useId()
  const local = useMfeStorage()
  const [readBack, setReadBack] = useState<unknown>(undefined)

  // `retention: 'browser'` is the default: it survives a sign-out, so the next person to sign in on
  // this browser reads it. Anything derived from the signed-in user declares 'user' (§21).
  const [draft, setDraft] = useStoredState('draft', draftSchema, {
    defaultValue: { note: '', pinned: false },
    retention: 'browser',
  })

  const [visits, setVisits] = useStoredState('visits', visitsSchema, {
    defaultValue: 0,
    retention: 'user',
    storage: 'session',
  })

  return (
    <LabPage
      eyebrow="Storage"
      title="Validated, scoped and retention-aware"
      description="An MFE never touches localStorage. It declares a key with a schema, and gets a subscribed value and a stable setter — with the key namespaced under this definition's id, so two MFEs cannot collide."
      tryThis={
        <>
          Type a note, reload the page, and it is still there. Then open devtools and look for
          <code className="font-mono"> lab:draft</code> — the prefix is this App&apos;s id, and the
          stored value carries an envelope the next read validates.
        </>
      }
    >
      <LabSection title="State that outlives a sign-out" note="retention: browser">
        <Field>
          <FieldLabel htmlFor={`${id}-note`}>Note</FieldLabel>
          <Input
            id={`${id}-note`}
            value={draft.note}
            onChange={event => {
              setDraft(current => ({ ...current, note: event.target.value }))
            }}
          />
          <FieldDescription>
            Stored under this App&apos;s own prefix. `retention: browser` means the framework never
            clears it — so the next person to sign in on this browser reads it too.
          </FieldDescription>
        </Field>

        <Field orientation="horizontal" className="justify-between">
          <FieldLabel htmlFor={`${id}-pinned`}>Pinned</FieldLabel>
          <Switch
            id={`${id}-pinned`}
            isSelected={draft.pinned}
            onChange={next => {
              setDraft(current => ({ ...current, pinned: next }))
            }}
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">What is stored right now</span>
          <Fields value={draft} />
        </div>
      </LabSection>

      <LabSection title="State that belongs to the signed-in user" note="retention: user">
        <p className="text-sm text-muted-foreground">
          Counted {visits} time{visits === 1 ? '' : 's'} this session. An identity or group change
          retires this before anything can read it back.
        </p>
        <div className="flex gap-2">
          <Button
            onPress={() => {
              setVisits(current => current + 1)
            }}
          >
            Count a visit
          </Button>
          <Button
            variant="outline"
            onPress={() => {
              setVisits(0)
            }}
          >
            Reset
          </Button>
        </div>
      </LabSection>

      <LabSection title="The imperative handle" note="useMfeStorage">
        <p className="text-sm text-muted-foreground">
          For reads, migrations and explicit removal. <code className="font-mono">get()</code> does
          not subscribe, which is why rendering stored state uses the hook above instead.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onPress={() => {
              setReadBack(local.key('draft', draftSchema, { retention: 'browser' }).get())
            }}
          >
            Read it back
          </Button>
          <Button
            variant="outline"
            onPress={() => {
              local.remove('draft')
              setReadBack('removed')
            }}
          >
            Remove the key
          </Button>
        </div>
        {readBack === undefined ? null : (
          <DataList>
            <DataRow label="key('draft').get()" hint="a read, not a subscription">
              <Value value={readBack} />
            </DataRow>
          </DataList>
        )}
      </LabSection>
    </LabPage>
  )
}

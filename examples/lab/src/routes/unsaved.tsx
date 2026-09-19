import { createFileRoute } from '@tanstack/react-router'
import { useNavigationBlock } from '@company/mfe-react'
import { Alert, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@tecton/react/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@tecton/react/components/field'
import { Input } from '@tecton/react/components/input'
import { Textarea } from '@tecton/react/components/textarea'
import { CheckIcon, SaveIcon, TriangleAlertIcon } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { DataList, DataRow, Flag, LabPage, LabSection } from '../lab-page.tsx'

export const Route = createFileRoute('/unsaved')({
  staticData: { breadcrumb: 'Unsaved edits' },
  component: Unsaved,
})

const SAVED = { name: 'Reduced DLS, 8½″ section', note: '' }

function Unsaved(): ReactNode {
  const id = useId()
  const [saved, setSaved] = useState(SAVED)
  const [draft, setDraft] = useState(SAVED)

  const isDirty = draft.name !== saved.name || draft.note !== saved.note

  /*
   * The whole demonstration, in one line.
   *
   * This mount is the only thing that knows the edits exist, so it is the only
   * thing that can object to a navigation that would lose them — including
   * navigations it does not own: the shell's application finder, a breadcrumb,
   * the browser's back button. It registers itself with the host's navigator;
   * the host asks, innermost mount first, and renders nothing itself.
   */
  const block = useNavigationBlock(isDirty)

  const save = (): void => {
    setSaved(draft)
  }

  return (
    <LabPage
      eyebrow="Navigation"
      title="An MFE can refuse to be navigated away from"
      description="A mount with unsaved work is the only thing that knows it. The shell asks before it leaves, this application answers in its own dialog, and the decision is this application's — the shell neither draws the dialog nor decides what counts as unsaved."
      tryThis={
        <>
          Type in the form below, then try to leave: switch application from the finder at the top
          left, press <code className="font-mono">⌘K</code> and jump somewhere, or use the
          browser&apos;s back button. This App&apos;s own dialog appears. Save, and the same
          navigation goes straight through.
        </>
      }
    >
      <LabSection title="A form with unsaved edits" note="useNavigationBlock">
        <div className="flex flex-wrap items-center gap-2">
          {isDirty ? (
            <Badge variant="warning" appearance="outline">
              <TriangleAlertIcon aria-hidden /> unsaved changes
            </Badge>
          ) : (
            <Badge variant="success" appearance="outline">
              <CheckIcon aria-hidden /> saved
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">
            {isDirty
              ? 'Leaving this page now is negotiated with this mount first.'
              : 'Nothing to lose, so navigation is never intercepted.'}
          </span>
        </div>

        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Design name</FieldLabel>
          <Input
            id={`${id}-name`}
            value={draft.name}
            onChange={event => {
              setDraft(current => ({ ...current, name: event.target.value }))
            }}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={`${id}-note`}>Engineering note</FieldLabel>
          <Textarea
            id={`${id}-note`}
            rows={3}
            value={draft.note}
            placeholder="Why this design, and what it assumes."
            onChange={event => {
              setDraft(current => ({ ...current, note: event.target.value }))
            }}
          />
          <FieldDescription>
            Nothing here is persisted anywhere — the point is the state, not the storage.
          </FieldDescription>
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button isDisabled={!isDirty} onPress={save}>
            <SaveIcon /> Save
          </Button>
          <Button
            variant="outline"
            isDisabled={!isDirty}
            onPress={() => {
              setDraft(saved)
            }}
          >
            Discard
          </Button>
        </div>
      </LabSection>

      <LabSection title="What the host was told" note="NavigationIntent">
        <p className="text-sm text-muted-foreground">
          The host hands the mount the navigation it is about to perform, including whether it
          leaves this App&apos;s boundary. A wizard step inside the same App and a jump to another
          application are not the same event, and an App may object to one and not the other.
        </p>
        <DataList>
          <DataRow label="pending" hint="a navigation waiting on this mount">
            <Flag value={block.pending !== null} trueLabel="being asked" falseLabel="idle" />
          </DataRow>
          <DataRow label="from" hint="where the page is now">
            {block.pending === null ? (
              <span className="text-sm text-muted-foreground">—</span>
            ) : (
              <code className="font-mono text-xs break-all">{block.pending.from.pathname}</code>
            )}
          </DataRow>
          <DataRow label="to" hint="where it would go">
            {block.pending === null ? (
              <span className="text-sm text-muted-foreground">—</span>
            ) : (
              <code className="font-mono text-xs break-all">{block.pending.to.pathname}</code>
            )}
          </DataRow>
          <DataRow label="leavesBoundary" hint="does it unmount this App?">
            {block.pending === null ? (
              <span className="text-sm text-muted-foreground">—</span>
            ) : (
              <Flag value={block.pending.leavesBoundary} trueLabel="leaves" falseLabel="stays" />
            )}
          </DataRow>
        </DataList>

        <Alert appearance="outline">
          <TriangleAlertIcon />
          <AlertTitle>A reload is not a navigation</AlertTitle>
          <AlertDescription>
            Closing the tab or reloading discards the same edits, and the router never sees it. The
            shell turns a registered blocker into the browser&apos;s own beforeunload prompt, which
            is the only thing a page is allowed to show there.
          </AlertDescription>
        </Alert>
      </LabSection>

      {/*
       * This App's dialog, in this App's design system, mounted inside this
       * App's region. The shell is still there behind it and still working:
       * blocking a navigation does not freeze the page, it declines one.
       */}
      <Dialog
        isOpen={block.pending !== null}
        isDismissable={false}
        showCloseButton={false}
        onOpenChange={open => {
          if (!open) block.stay()
        }}
      >
        <DialogHeader>
          <DialogTitle>Leave with unsaved changes?</DialogTitle>
          <DialogDescription>
            {block.pending === null
              ? null
              : block.pending.to.pathname === '/'
                ? 'This page has edits that are not saved. Leaving discards them.'
                : `This page has edits that are not saved. Going to ${block.pending.to.pathname} discards them.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onPress={block.stay}>
            Keep editing
          </Button>
          <Button
            variant="outline"
            onPress={() => {
              save()
              block.proceed()
            }}
          >
            <SaveIcon /> Save and leave
          </Button>
          <Button variant="destructive" onPress={block.proceed}>
            Discard and leave
          </Button>
        </div>
      </Dialog>
    </LabPage>
  )
}

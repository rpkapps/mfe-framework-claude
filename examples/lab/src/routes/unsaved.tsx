import { createFileRoute, useBlocker } from '@tanstack/react-router'
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

import { DataList, DataRow, Flag, Identifier, LabPage, LabSection } from '../lab-page.tsx'

export const Route = createFileRoute('/unsaved')({
  staticData: { breadcrumb: 'Unsaved edits' },
  component: Unsaved,
})

const SAVED = { name: 'Reduced DLS, 8½″ section', note: '' }

/**
 * TanStack's sentinel for "no route in this tree matched". It is what a
 * navigation out of this App looks like from inside it: the shell is going
 * somewhere this route tree has never heard of.
 */
const NO_MATCH = '__notFound__'

function Unsaved(): ReactNode {
  const id = useId()
  const [saved, setSaved] = useState(SAVED)
  const [draft, setDraft] = useState(SAVED)

  const isDirty = draft.name !== saved.name || draft.note !== saved.note

  /*
   * The whole demonstration, in one hook — and it is TanStack's own.
   *
   * There is no framework API here. `useBlocker` registers with this App's
   * router, which is the only thing that knows the edits exist. The framework
   * takes that registration and also puts the shell's navigations to it, so a
   * click on the application finder, a breadcrumb or the browser's back button
   * arrives as an ordinary `shouldBlockFn` call with `current`, `next` and
   * `action` resolved against this App's own route tree.
   *
   * `withResolver` is what makes the answer this App's: the hook hands back a
   * `proceed`/`reset` pair instead of taking a synchronous verdict, so the
   * confirmation is a real dialog in this App's design system rather than a
   * `window.confirm`.
   */
  const blocker = useBlocker({
    shouldBlockFn: () => isDirty,
    // A reload is not a navigation and no page may draw its own UI for one, so
    // this decides whether the browser offers its prompt. Without the
    // condition a clean form would raise "leave site?" on every refresh.
    enableBeforeUnload: () => isDirty,
    withResolver: true,
  })

  const save = (): void => {
    setSaved(draft)
  }

  const target = blocker.status === 'blocked' ? blocker.next : null
  const leavesApp = target !== null && String(target.routeId) === NO_MATCH

  return (
    <LabPage
      eyebrow="Navigation"
      title="An MFE can refuse to be navigated away from"
      description="A mount with unsaved work is the only thing that knows it. The App blocks with TanStack’s own useBlocker, the shell asks it before leaving, and this application answers in its own dialog — the shell neither draws the dialog nor decides what counts as unsaved."
      tryThis={
        <>
          Type in the form below, then try to leave: pick another page from this App&apos;s own nav,
          switch application from the finder at the top left, press{' '}
          <code className="font-mono">⌘K</code> and jump somewhere, or use the browser&apos;s back
          button. All four are refused by the same hook. Save, and the same navigation goes straight
          through.
        </>
      }
    >
      <LabSection title="A form with unsaved edits" note="useBlocker">
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

      <LabSection title="What shouldBlockFn was given" note="BlockerResolver">
        <p className="text-sm text-muted-foreground">
          The same fields whether the navigation came from this App&apos;s own router or from the
          shell. A target the shell owns simply matches no route here, which is how an App tells a
          wizard step apart from a jump to another application — and it may object to one and not
          the other.
        </p>
        <DataList>
          <DataRow label="status" hint="is a navigation waiting on this App?">
            <Flag value={blocker.status === 'blocked'} trueLabel="being asked" falseLabel="idle" />
          </DataRow>
          <DataRow label="action" hint="what the user did">
            {blocker.status === 'blocked' ? (
              <Identifier value={blocker.action} />
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </DataRow>
          <DataRow label="current.routeId" hint="the page being left">
            {blocker.status === 'blocked' ? (
              <Identifier value={String(blocker.current.routeId)} />
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </DataRow>
          <DataRow label="next.pathname" hint="where it would go">
            {target === null ? (
              <span className="text-sm text-muted-foreground">—</span>
            ) : (
              <Identifier value={target.pathname} />
            )}
          </DataRow>
          <DataRow label="next.routeId" hint={`${NO_MATCH} means it leaves this App`}>
            {target === null ? (
              <span className="text-sm text-muted-foreground">—</span>
            ) : (
              <Flag value={leavesApp} trueLabel="leaves this App" falseLabel="stays in this App" />
            )}
          </DataRow>
        </DataList>

        <Alert appearance="outline">
          <TriangleAlertIcon />
          <AlertTitle>A reload is not a navigation</AlertTitle>
          <AlertDescription>
            Closing the tab or reloading discards the same edits, and no router sees it. This App
            sets <code className="font-mono">enableBeforeUnload</code>, and the shell forwards that
            answer to the browser&apos;s own prompt, which is the only thing a page is allowed to
            show there.
          </AlertDescription>
        </Alert>
      </LabSection>

      {/*
       * This App's dialog, in this App's design system, mounted inside this
       * App's region. The shell is still there behind it and still working:
       * blocking a navigation does not freeze the page, it declines one.
       */}
      <Dialog
        isOpen={blocker.status === 'blocked'}
        isDismissable={false}
        showCloseButton={false}
        onOpenChange={open => {
          if (!open) blocker.reset?.()
        }}
      >
        <DialogHeader>
          <DialogTitle>Leave with unsaved changes?</DialogTitle>
          <DialogDescription>
            {target === null
              ? null
              : leavesApp
                ? `This page has edits that are not saved. Going to ${target.pathname} leaves this application and discards them.`
                : `This page has edits that are not saved. Going to ${target.pathname} discards them.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onPress={() => {
              blocker.reset?.()
            }}
          >
            Keep editing
          </Button>
          <Button
            variant="outline"
            onPress={() => {
              save()
              blocker.proceed?.()
            }}
          >
            <SaveIcon /> Save and leave
          </Button>
          <Button
            variant="destructive"
            onPress={() => {
              blocker.proceed?.()
            }}
          >
            Discard and leave
          </Button>
        </div>
      </Dialog>
    </LabPage>
  )
}

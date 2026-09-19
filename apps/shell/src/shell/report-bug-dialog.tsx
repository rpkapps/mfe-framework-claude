/**
 * Report a bug.
 *
 * The reporter is asked for the two things only they know — what they expected
 * and what happened — and for nothing the shell can read for itself. Build,
 * route, registry state and active overrides are attached automatically,
 * because those are the fields a reporter either guesses wrong or leaves blank,
 * and they are the ones an engineer needs first.
 *
 * This shell has no tracker behind it, and a Send button that quietly did
 * nothing would be worse than no button: the report is assembled and handed to
 * the clipboard, which is an action that genuinely completes. A deployment with
 * an issue API posts the same text from here.
 *
 * Components only, so React Refresh can replace this module in place.
 */

import { useId, useMemo, useState, type ReactNode } from 'react'
import { useMfeRuntime } from '@company/mfe-react'
import { Badge } from '@tecton/react/components/badge'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@tecton/react/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@tecton/react/components/field'
import { Input } from '@tecton/react/components/input'
import { Textarea } from '@tecton/react/components/textarea'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { toast } from 'sonner'

import { collectDiagnostics, formatReport } from './diagnostics.ts'
import { DataList, DataRow, Mono, TagRow } from './readout.tsx'

export function ReportBugDialog({
  isOpen,
  onOpenChange,
}: {
  readonly isOpen: boolean
  readonly onOpenChange: (open: boolean) => void
}): ReactNode {
  const id = useId()
  const runtime = useMfeRuntime('the shell bug report')
  const [summary, setSummary] = useState('')
  const [detail, setDetail] = useState('')

  // Read when the dialog opens, not at boot: a snapshot taken earlier would
  // describe a route the reporter has since navigated away from.
  const diagnostics = useMemo(
    () => (isOpen ? collectDiagnostics(runtime) : null),
    [isOpen, runtime],
  )

  const report =
    diagnostics === null ? '' : formatReport(summary.trim(), detail.trim(), diagnostics)

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="gap-4 max-h-[85svh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden [&>[data-slot=dialog]]:min-h-0 [&>[data-slot=dialog]]:grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl"
    >
      <DialogHeader>
        <DialogTitle>Report a bug</DialogTitle>
        <DialogDescription>
          Everything below the form is attached for you. No tracker is configured in this shell, so
          the report is copied to your clipboard ready to paste.
        </DialogDescription>
      </DialogHeader>

      {/* The design system's sticky-footer dialog; the inset matches its p-6. */}
      <div className="no-scrollbar -mx-6 max-h-[50vh] overflow-y-auto px-6">
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor={`${id}-summary`}>What went wrong</FieldLabel>
            <Input
              id={`${id}-summary`}
              value={summary}
              placeholder="One line — the headline of the report"
              onChange={event => {
                setSummary(event.target.value)
              }}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${id}-detail`}>What you expected, and what happened</FieldLabel>
            <Textarea
              id={`${id}-detail`}
              rows={5}
              value={detail}
              placeholder={'Steps, then the expected result, then the actual one.'}
              onChange={event => {
                setDetail(event.target.value)
              }}
            />
            <FieldDescription>
              The steps matter more than the screenshot: a report that can be reproduced is a report
              that gets fixed.
            </FieldDescription>
          </Field>

          {diagnostics === null ? null : (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Attached automatically</h3>
              <DataList>
                <DataRow label="Page">
                  <Mono>{diagnostics.url}</Mono>
                </DataRow>
                <DataRow label="Mounted">{diagnostics.mounted}</DataRow>
                <DataRow label="Registry">
                  <span className="flex flex-wrap items-center gap-1">
                    <Badge variant="success" appearance="outline">
                      {diagnostics.registryLoaded} loaded
                    </Badge>
                    {diagnostics.registryRejected.length === 0 ? null : (
                      <Badge variant="destructive" appearance="outline">
                        {diagnostics.registryRejected.length} rejected
                      </Badge>
                    )}
                  </span>
                </DataRow>
                <DataRow label="Overrides">
                  <TagRow values={diagnostics.overrides} variant="warning" empty="none active" />
                </DataRow>
                <DataRow label="Session">
                  <span className="flex flex-wrap items-center gap-1">
                    <Mono>{diagnostics.user}</Mono>
                    <TagRow values={diagnostics.groups} variant="secondary" />
                  </span>
                </DataRow>
                <DataRow label="Display">
                  {diagnostics.viewport} · {diagnostics.theme} theme
                </DataRow>
              </DataList>
            </section>
          )}
        </div>
      </div>

      <DialogFooter>
        <DialogClose>Cancel</DialogClose>
        <CopyButton
          variant="default"
          size="default"
          value={report}
          isDisabled={summary.trim() === '' && detail.trim() === ''}
          onCopied={() => {
            toast.success('Report copied', {
              description: 'Paste it into an issue — the environment is already filled in.',
            })
            setSummary('')
            setDetail('')
            onOpenChange(false)
          }}
        >
          Copy the report
        </CopyButton>
      </DialogFooter>
    </Dialog>
  )
}

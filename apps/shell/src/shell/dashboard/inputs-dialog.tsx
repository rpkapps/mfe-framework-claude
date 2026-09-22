/**
 * Every control comes from the input schema that Widget's own build published into the registry,
 * so a Widget with new inputs needs no change here (§28).
 */

import { useId, useState, type ReactNode } from 'react'
import { coerceInputs, type RegistryEntry } from '@company/mfe-react'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@tecton/react/components/dialog'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@tecton/react/components/field'
import { Input } from '@tecton/react/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tecton/react/components/select'
import { Switch } from '@tecton/react/components/switch'
import { Textarea } from '@tecton/react/components/textarea'
import { InfoIcon } from 'lucide-react'

import { initialValues, readInputFields, type InputField } from './input-schema.ts'

export interface InputsDialogProps {
  readonly entry: RegistryEntry | null
  readonly current: Readonly<Record<string, unknown>>
  readonly title: string
  readonly confirmLabel: string
  readonly onConfirm: (inputs: Record<string, unknown>) => void
  readonly onCancel: () => void
}

/** The caller gives this a `key` per tile, so a different tile mounts a fresh dialog rather than copying props into state in an effect. */
export function InputsDialog({
  entry,
  current,
  title,
  confirmLabel,
  onConfirm,
  onCancel,
}: InputsDialogProps): ReactNode {
  const fields = readInputFields(entry?.contract)
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialValues(fields, current),
  )
  const [raw, setRaw] = useState(() => JSON.stringify(current, null, 2))
  const [rawError, setRawError] = useState<string | null>(null)

  if (entry === null) return null

  const set = (name: string, value: unknown): void => {
    setValues(previous => ({ ...previous, [name]: value }))
  }

  const confirm = (): void => {
    if (fields !== null) {
      onConfirm(coerceInputs(fields, values))
      return
    }

    try {
      const parsed: unknown = JSON.parse(raw === '' ? '{}' : raw)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setRawError('Inputs are an object of prop names to values.')
        return
      }
      onConfirm(parsed as Record<string, unknown>)
    } catch (error) {
      setRawError(error instanceof Error ? error.message : 'That is not valid JSON.')
    }
  }

  return (
    <Dialog
      isOpen
      onOpenChange={open => {
        if (!open) onCancel()
      }}
      className="sm:max-w-lg"
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <p className="text-xs text-muted-foreground">
          {entry.id}
          {entry.version === undefined ? '' : ` · ${entry.version}`} · these become the Widget’s
          props, and it validates them itself.
        </p>
      </DialogHeader>

      <div className="flex max-h-96 flex-col gap-4 overflow-y-auto">
        {fields === null ? (
          <UnreadableSchema value={raw} error={rawError} onChange={setRaw} />
        ) : fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">This Widget takes no inputs.</p>
        ) : (
          fields.map(field => (
            <SchemaField
              key={field.name}
              field={field}
              value={values[field.name]}
              onChange={value => {
                set(field.name, value)
              }}
            />
          ))
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onPress={onCancel}>
          Cancel
        </Button>
        <Button onPress={confirm}>{confirmLabel}</Button>
      </DialogFooter>
    </Dialog>
  )
}

/** A stored layout may hold anything, and `String({})` would render "[object Object]" and then write that back as the input. */
function displayValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function SchemaField({
  field,
  value,
  onChange,
}: {
  readonly field: InputField
  readonly value: unknown
  readonly onChange: (value: unknown) => void
}): ReactNode {
  const id = useId()

  const label = (
    <FieldLabel htmlFor={id}>
      {field.name}
      {field.required ? null : (
        <Badge variant="secondary" size="default">
          optional
        </Badge>
      )}
    </FieldLabel>
  )

  const description = (
    <FieldDescription>
      {field.description ?? <code className="font-mono">{field.typeLabel}</code>}
    </FieldDescription>
  )

  if (field.control === 'boolean') {
    return (
      <Field orientation="horizontal" className="justify-between">
        <FieldContent>
          {label}
          {description}
        </FieldContent>
        <Switch id={id} isSelected={value === true} onChange={onChange} />
      </Field>
    )
  }

  if (field.control === 'choice') {
    return (
      <Field>
        {label}
        <Select
          className="w-full"
          selectedKey={typeof value === 'string' ? value : null}
          onSelectionChange={key => {
            onChange(key === null ? '' : String(key))
          }}
        >
          <SelectTrigger id={id}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map(option => (
              <SelectItem key={option} id={option} textValue={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {description}
      </Field>
    )
  }

  if (field.control === 'json') {
    return (
      <Field>
        {label}
        <Textarea
          id={id}
          rows={3}
          value={typeof value === 'string' ? value : JSON.stringify(value ?? '')}
          onChange={event => {
            onChange(event.target.value)
          }}
        />
        {description}
      </Field>
    )
  }

  return (
    <Field>
      {label}
      <Input
        id={id}
        type={field.control === 'number' ? 'number' : 'text'}
        value={displayValue(value)}
        onChange={event => {
          onChange(event.target.value)
        }}
      />
      {description}
    </Field>
  )
}

/** Deliberately not an empty form: one with no fields would say the Widget takes nothing, which is a different and wrong claim (§28). */
function UnreadableSchema({
  value,
  error,
  onChange,
}: {
  readonly value: string
  readonly error: string | null
  readonly onChange: (value: string) => void
}): ReactNode {
  const id = useId()

  return (
    <Field data-invalid={error !== null}>
      <FieldLabel htmlFor={id}>
        <InfoIcon className="size-3.5" /> inputs
      </FieldLabel>
      <Textarea
        id={id}
        rows={6}
        value={value}
        aria-invalid={error !== null}
        onChange={event => {
          onChange(event.target.value)
        }}
      />
      <FieldDescription>
        {error ??
          'This Widget publishes no readable input schema, so the shell cannot offer a form for it. Enter the props as JSON; the Widget validates them.'}
      </FieldDescription>
    </Field>
  )
}

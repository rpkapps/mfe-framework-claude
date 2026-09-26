'use client'

import * as React from 'react'
import { cn } from 'cn'
import { InfoIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@tecton/react/components/field'
import { Input } from '@tecton/react/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tecton/react/components/select'
import { Separator } from '@tecton/react/components/separator'
import { Switch } from '@tecton/react/components/switch'
import { Textarea } from '@tecton/react/components/textarea'
import { ColorSwatch } from '@tecton/react/tecton/color-swatch'

import {
  accents,
  channels,
  densities,
  digests,
  roles,
  themes,
  timezones,
  unitSystems,
} from '../data'
import type { Settings } from '../data'

type SectionProps<TKey extends keyof Settings> = {
  className?: string
  value: Settings[TKey]
  onChange: (next: Settings[TKey]) => void
}

function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      data-slot="settings-section"
      className={cn('grid gap-4 md:grid-cols-[14rem_1fr] md:gap-8', className)}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex max-w-xl flex-col gap-4">{children}</div>
    </section>
  )
}

function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (next: boolean) => void
}) {
  const id = React.useId()
  return (
    <Field orientation="horizontal" data-slot="switch-row" className="justify-between">
      <FieldContent>
        <FieldLabel htmlFor={id} className="text-sm font-normal">
          {label}
        </FieldLabel>
        {description && <FieldDescription className="text-xs">{description}</FieldDescription>}
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={next => onCheckedChange(next)} />
    </Field>
  )
}

type SelectRowOption<TValue extends string> = {
  value: TValue
  /** What the option and, once picked, the trigger show. */
  label: React.ReactNode
}

/** Labelled single `Select` with optional helper text inside a `Field`. */
function SelectRow<TValue extends string>({
  label,
  description,
  options,
  value,
  onValueChange,
}: {
  label: string
  description?: string
  options: SelectRowOption<TValue>[]
  value: TValue
  onValueChange: (value: TValue) => void
}) {
  const id = React.useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={options}
        value={value}
        onValueChange={(next: TValue | null) => {
          if (next !== null) onValueChange(next)
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
}

/** Options for `SelectRow` from `{ id, label }` data. */
function optionsOf<TValue extends string>(
  items: readonly { id: TValue; label: string }[],
): SelectRowOption<TValue>[] {
  return items.map(item => ({ value: item.id, label: item.label }))
}

function ProfileForm({ className, value, onChange }: SectionProps<'profile'>) {
  const id = React.useId()
  const bioError = value.bio.length > 160 ? 'Keep it under 160 characters.' : undefined

  const set = <TKey extends keyof Settings['profile']>(
    key: TKey,
    next: Settings['profile'][TKey],
  ) => onChange({ ...value, [key]: next })

  return (
    <div data-slot="profile-form" className={cn('flex flex-col gap-8', className)}>
      <SettingsSection
        title="Identity"
        description="How you appear to teammates in comments and change history."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-first`}>First name</FieldLabel>
            <Input
              id={`${id}-first`}
              value={value.firstName}
              onChange={event => set('firstName', event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-last`}>Last name</FieldLabel>
            <Input
              id={`${id}-last`}
              value={value.lastName}
              onChange={event => set('lastName', event.target.value)}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
          <Input id={`${id}-email`} type="email" value={value.email} readOnly />
          <FieldDescription>Managed by your identity provider.</FieldDescription>
        </Field>
        <SelectRow
          label="Role"
          options={optionsOf(roles)}
          value={value.role}
          onValueChange={role => set('role', role)}
        />
        <Field data-invalid={!!bioError}>
          <FieldLabel htmlFor={`${id}-bio`}>Bio</FieldLabel>
          <Textarea
            id={`${id}-bio`}
            rows={3}
            value={value.bio}
            onChange={event => set('bio', event.target.value)}
            aria-invalid={!!bioError}
          />
          <FieldDescription>{`${value.bio.length}/160`}</FieldDescription>
          <FieldError>{bioError}</FieldError>
        </Field>
      </SettingsSection>

      <Separator emphasis="subtle" />

      <SettingsSection
        title="Locale"
        description="Time zone and unit system used for readouts across the workspace."
      >
        <SelectRow
          label="Time zone"
          options={optionsOf(timezones)}
          value={value.timezone}
          onValueChange={timezone => set('timezone', timezone)}
        />
        <SelectRow
          label="Unit system"
          options={optionsOf(unitSystems)}
          value={value.units}
          onValueChange={units => set('units', units)}
          description="Changing units re-formats depths, pressures and volumes; stored values are unaffected."
        />
      </SettingsSection>
    </div>
  )
}

function NotificationsForm({ className, value, onChange }: SectionProps<'notifications'>) {
  const set = <TKey extends keyof Settings['notifications']>(
    key: TKey,
    next: Settings['notifications'][TKey],
  ) => onChange({ ...value, [key]: next })

  return (
    <div data-slot="notifications-form" className={cn('flex flex-col gap-8', className)}>
      <Alert variant="info" appearance="outline">
        <InfoIcon />
        <AlertTitle>Rig schedule alerts are off</AlertTitle>
        <AlertDescription>
          You will not be told when a planned spud date moves. Enable them below to stay on top of
          schedule changes.
        </AlertDescription>
      </Alert>
      <SettingsSection title="Delivery" description="Where and how often notifications reach you.">
        <SelectRow
          label="Channel"
          options={optionsOf(channels)}
          value={value.channel}
          onValueChange={channel => set('channel', channel)}
        />
        <SelectRow
          label="Frequency"
          options={optionsOf(digests)}
          value={value.digest}
          onValueChange={digest => set('digest', digest)}
        />
      </SettingsSection>

      <Separator emphasis="subtle" />

      <SettingsSection title="Activity" description="Events in the projects you are a member of.">
        <SwitchRow
          label="Model runs"
          description="When a facies or velocity model you started finishes or fails."
          checked={value.modelRuns}
          onCheckedChange={next => set('modelRuns', next)}
        />
        <SwitchRow
          label="FDA changes"
          description="When an alternative is nominated, archived or its economics change."
          checked={value.fdaChanges}
          onCheckedChange={next => set('fdaChanges', next)}
        />
        <SwitchRow
          label="Mentions"
          description="When someone @mentions you in a comment or the AI agent hands off to you."
          checked={value.mentions}
          onCheckedChange={next => set('mentions', next)}
        />
        <SwitchRow
          label="Rig schedule"
          description="When a spud date or rig assignment moves."
          checked={value.rigSchedule}
          onCheckedChange={next => set('rigSchedule', next)}
        />
      </SettingsSection>

      <Separator emphasis="subtle" />

      <SettingsSection title="Product" description="Occasional product news from Tecton.">
        <SwitchRow
          label="Release notes and tips"
          checked={value.marketing}
          onCheckedChange={next => set('marketing', next)}
        />
      </SettingsSection>
    </div>
  )
}

function AppearanceForm({ className, value, onChange }: SectionProps<'appearance'>) {
  const set = <TKey extends keyof Settings['appearance']>(
    key: TKey,
    next: Settings['appearance'][TKey],
  ) => onChange({ ...value, [key]: next })

  return (
    <div data-slot="appearance-form" className={cn('flex flex-col gap-8', className)}>
      <SettingsSection title="Theme" description="Dark is the canonical Tecton theme.">
        <SelectRow
          label="Colour scheme"
          options={optionsOf(themes)}
          value={value.theme}
          onValueChange={theme => set('theme', theme)}
        />
        <SelectRow
          label="Accent"
          options={accents.map(accent => ({
            value: accent.id,
            label: (
              <>
                <ColorSwatch color={accent.color} size="xs" shape="circle" />
                {accent.label}
              </>
            ),
          }))}
          value={value.accent}
          onValueChange={accent => set('accent', accent)}
        />
        <SelectRow
          label="Density"
          options={optionsOf(densities)}
          value={value.density}
          onValueChange={density => set('density', density)}
        />
      </SettingsSection>

      <Separator emphasis="subtle" />

      <SettingsSection title="Accessibility">
        <SwitchRow
          label="Reduce motion"
          description="Disable panel and chart transitions."
          checked={value.reduceMotion}
          onCheckedChange={next => set('reduceMotion', next)}
        />
        <SwitchRow
          label="Monospace readouts"
          description="Use IBM Plex Mono with tabular figures for depths, costs and percentages."
          checked={value.monoReadouts}
          onCheckedChange={next => set('monoReadouts', next)}
        />
      </SettingsSection>
    </div>
  )
}

export { ProfileForm, NotificationsForm, AppearanceForm, SettingsSection, SwitchRow, SelectRow }

// @ts-nocheck
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
  isSelected,
  onChange,
}: {
  label: string
  description?: string
  isSelected: boolean
  onChange: (next: boolean) => void
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
      <Switch id={id} isSelected={isSelected} onChange={onChange} />
    </Field>
  )
}

/** Labelled single `Select` with optional helper text inside a `Field`. */
function SelectRow({
  label,
  description,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Select<object, 'single'>>, 'children'> & {
  label: string
  description?: string
  children: React.ReactNode
}) {
  const id = React.useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select className="w-full" {...props}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  )
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
          selectedKey={value.role}
          onSelectionChange={key => set('role', String(key))}
        >
          {roles.map(role => (
            <SelectItem key={role.id} id={role.id} textValue={role.label}>
              {role.label}
            </SelectItem>
          ))}
        </SelectRow>
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
          selectedKey={value.timezone}
          onSelectionChange={key => set('timezone', String(key))}
        >
          {timezones.map(zone => (
            <SelectItem key={zone.id} id={zone.id} textValue={zone.label}>
              {zone.label}
            </SelectItem>
          ))}
        </SelectRow>
        <SelectRow
          label="Unit system"
          selectedKey={value.units}
          onSelectionChange={key => set('units', String(key) as Settings['profile']['units'])}
          description="Changing units re-formats depths, pressures and volumes; stored values are unaffected."
        >
          {unitSystems.map(system => (
            <SelectItem key={system.id} id={system.id} textValue={system.label}>
              {system.label}
            </SelectItem>
          ))}
        </SelectRow>
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
          selectedKey={value.channel}
          onSelectionChange={key =>
            set('channel', String(key) as Settings['notifications']['channel'])
          }
        >
          {channels.map(channel => (
            <SelectItem key={channel.id} id={channel.id} textValue={channel.label}>
              {channel.label}
            </SelectItem>
          ))}
        </SelectRow>
        <SelectRow
          label="Frequency"
          selectedKey={value.digest}
          onSelectionChange={key =>
            set('digest', String(key) as Settings['notifications']['digest'])
          }
        >
          {digests.map(digest => (
            <SelectItem key={digest.id} id={digest.id} textValue={digest.label}>
              {digest.label}
            </SelectItem>
          ))}
        </SelectRow>
      </SettingsSection>

      <Separator emphasis="subtle" />

      <SettingsSection title="Activity" description="Events in the projects you are a member of.">
        <SwitchRow
          label="Model runs"
          description="When a facies or velocity model you started finishes or fails."
          isSelected={value.modelRuns}
          onChange={next => set('modelRuns', next)}
        />
        <SwitchRow
          label="FDA changes"
          description="When an alternative is nominated, archived or its economics change."
          isSelected={value.fdaChanges}
          onChange={next => set('fdaChanges', next)}
        />
        <SwitchRow
          label="Mentions"
          description="When someone @mentions you in a comment or the AI agent hands off to you."
          isSelected={value.mentions}
          onChange={next => set('mentions', next)}
        />
        <SwitchRow
          label="Rig schedule"
          description="When a spud date or rig assignment moves."
          isSelected={value.rigSchedule}
          onChange={next => set('rigSchedule', next)}
        />
      </SettingsSection>

      <Separator emphasis="subtle" />

      <SettingsSection title="Product" description="Occasional product news from Tecton.">
        <SwitchRow
          label="Release notes and tips"
          isSelected={value.marketing}
          onChange={next => set('marketing', next)}
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
          selectedKey={value.theme}
          onSelectionChange={key => set('theme', String(key) as Settings['appearance']['theme'])}
        >
          {themes.map(theme => (
            <SelectItem key={theme.id} id={theme.id} textValue={theme.label}>
              {theme.label}
            </SelectItem>
          ))}
        </SelectRow>
        <SelectRow
          label="Accent"
          selectedKey={value.accent}
          onSelectionChange={key => set('accent', String(key))}
        >
          {accents.map(accent => (
            <SelectItem key={accent.id} id={accent.id} textValue={accent.label}>
              <ColorSwatch color={accent.color} size="xs" shape="circle" />
              {accent.label}
            </SelectItem>
          ))}
        </SelectRow>
        <SelectRow
          label="Density"
          selectedKey={value.density}
          onSelectionChange={key =>
            set('density', String(key) as Settings['appearance']['density'])
          }
        >
          {densities.map(density => (
            <SelectItem key={density.id} id={density.id} textValue={density.label}>
              {density.label}
            </SelectItem>
          ))}
        </SelectRow>
      </SettingsSection>

      <Separator emphasis="subtle" />

      <SettingsSection title="Accessibility">
        <SwitchRow
          label="Reduce motion"
          description="Disable panel and chart transitions."
          isSelected={value.reduceMotion}
          onChange={next => set('reduceMotion', next)}
        />
        <SwitchRow
          label="Monospace readouts"
          description="Use IBM Plex Mono with tabular figures for depths, costs and percentages."
          isSelected={value.monoReadouts}
          onChange={next => set('monoReadouts', next)}
        />
      </SettingsSection>
    </div>
  )
}

export { ProfileForm, NotificationsForm, AppearanceForm, SettingsSection, SwitchRow, SelectRow }

/**
 * An A2UI surface drawn with Tecton: each catalogue component maps onto the Tecton component that
 * does the same job. Only what the catalogue names is drawn; an unknown or missing id draws
 * nothing, as the spec asks, and an id reached twice on one branch stops there rather than loop.
 * Text is text, never HTML, and a link opens only over http(s). An Image loads only from where
 * `imageSource` allows; any other is drawn as its description and host, and fetches nothing.
 */

import { useId, useSyncExternalStore, type ReactNode } from 'react'
import { Button } from '@tecton/react/components/button'
import { Card, CardContent } from '@tecton/react/components/card'
import { Checkbox } from '@tecton/react/components/checkbox'
import { Field } from '@tecton/react/components/field'
import { Input } from '@tecton/react/components/input'
import { Label } from '@tecton/react/components/label'
import { RadioGroup, RadioGroupItem } from '@tecton/react/components/radio-group'
import { Separator } from '@tecton/react/components/separator'
import { Textarea } from '@tecton/react/components/textarea'
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckIcon,
  CircleAlertIcon,
  DownloadIcon,
  HomeIcon,
  ImageOffIcon,
  InfoIcon,
  LockIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  Trash2Icon,
  UploadIcon,
  UserIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react'
import { CheckboxGroup, TextField } from 'react-aria-components'

import type { A2uiUserAction } from '../shell-chat.ts'

import {
  boundPath,
  checksPass,
  childrenOf,
  imageSource,
  resolve,
  resolveText,
  safeUrl,
  type A2uiComponent,
  type JsonValue,
  type Scope,
  type Surface,
} from './model.ts'
import type { A2uiSurfaces } from './surfaces.ts'
import { isObject } from '../records.ts'

/** What a surface's components can do: write an input, and send a Button's event. */
export interface SurfaceHandlers {
  readonly write: (path: string, value: JsonValue) => void
  readonly act: (action: A2uiUserAction, label: string) => void
}

const ICONS: Readonly<Record<string, LucideIcon>> = {
  check: CheckIcon,
  close: XIcon,
  warning: AlertTriangleIcon,
  error: CircleAlertIcon,
  info: InfoIcon,
  search: SearchIcon,
  settings: SettingsIcon,
  delete: Trash2Icon,
  edit: PencilIcon,
  add: PlusIcon,
  download: DownloadIcon,
  upload: UploadIcon,
  refresh: RefreshCwIcon,
  star: StarIcon,
  person: UserIcon,
  home: HomeIcon,
  mail: MailIcon,
  calendarToday: CalendarIcon,
  locationOn: MapPinIcon,
  lock: LockIcon,
}

const TEXT_CLASS: Readonly<Record<string, string>> = {
  h1: 'text-lg font-semibold',
  h2: 'text-base font-semibold',
  h3: 'text-sm font-semibold',
  h4: 'text-sm font-medium',
  h5: 'text-xs font-medium',
  caption: 'text-xs text-muted-foreground',
  body: 'text-sm',
}

const JUSTIFY: Readonly<Record<string, string>> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  spaceBetween: 'justify-between',
  spaceAround: 'justify-around',
  spaceEvenly: 'justify-evenly',
  stretch: 'justify-stretch',
}

const ALIGN: Readonly<Record<string, string>> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
}

interface NodeProps {
  readonly surface: Surface
  readonly id: string
  readonly scope: Scope
  readonly handlers: SurfaceHandlers
  /** The origins besides the page's own an Image may load from (`imageOrigins`). */
  readonly imageOrigins: ReadonlySet<string>
  /** The ids above this one, so a component that contains itself is drawn once. */
  readonly path: readonly string[]
}

function Children({
  children,
  ...props
}: Omit<NodeProps, 'id'> & { readonly children: unknown }): ReactNode {
  // By position too: a list may name one id twice.
  return childrenOf(children, props.scope).map((child, index) => (
    <Node
      key={`${String(index)}:${child.id}@${child.scope.path}`}
      {...props}
      id={child.id}
      scope={child.scope}
    />
  ))
}

function textOfChild(surface: Surface, id: unknown, scope: Scope): string {
  const child = typeof id === 'string' ? surface.components.get(id) : undefined
  return child?.component === 'Text' ? resolveText(child['text'], scope) : ''
}

function Node({ surface, id, scope, handlers, imageOrigins, path }: NodeProps): ReactNode {
  const component = surface.components.get(id)
  if (component === undefined || path.includes(id) || path.length > 32) return null
  const inner = { surface, scope, handlers, imageOrigins, path: [...path, id] }
  return <Component component={component} {...inner} />
}

function Component({
  component,
  surface,
  scope,
  handlers,
  imageOrigins,
  path,
}: Omit<NodeProps, 'id'> & { readonly component: A2uiComponent }): ReactNode {
  const inner = { surface, scope, handlers, imageOrigins, path }
  const label = resolveText(component['label'], scope)

  switch (component.component) {
    case 'Text': {
      const variant = typeof component['variant'] === 'string' ? component['variant'] : 'body'
      return (
        <p className={`whitespace-pre-wrap ${TEXT_CLASS[variant] ?? TEXT_CLASS['body'] ?? ''}`}>
          {resolveText(component['text'], scope)}
        </p>
      )
    }

    case 'Column':
    case 'Row':
    case 'List': {
      const row =
        component.component === 'Row' ||
        (component.component === 'List' && component['direction'] === 'horizontal')
      const justify = JUSTIFY[String(component['justify'])] ?? ''
      const align = ALIGN[String(component['align'])] ?? (row ? 'items-center' : '')
      return (
        <div
          className={`flex gap-2 ${row ? 'flex-row flex-wrap' : 'flex-col'} ${justify} ${align} ${
            component.component === 'List' && row ? 'overflow-x-auto' : ''
          }`}
        >
          <Children {...inner} children={component['children']} />
        </div>
      )
    }

    case 'Card':
      return (
        <Card size="sm" className="py-3">
          <CardContent className="px-3">
            {typeof component['child'] === 'string' && <Node {...inner} id={component['child']} />}
          </CardContent>
        </Card>
      )

    case 'Divider':
      return (
        <Separator orientation={component['axis'] === 'vertical' ? 'vertical' : 'horizontal'} />
      )

    case 'Button': {
      const action = component['action']
      const variant =
        component['variant'] === 'primary'
          ? 'default'
          : component['variant'] === 'borderless'
            ? 'ghost'
            : 'outline'
      const text = textOfChild(surface, component['child'], scope)
      return (
        <Button
          size="sm"
          variant={variant}
          isDisabled={!checksPass(component['checks'], scope)}
          onPress={() => {
            if (!isObject(action)) return
            if (isObject(action['event']) && typeof action['event']['name'] === 'string') {
              const context = isObject(action['event']['context']) ? action['event']['context'] : {}
              handlers.act(
                {
                  name: action['event']['name'],
                  surfaceId: surface.surfaceId,
                  sourceComponentId: component.id,
                  timestamp: new Date().toISOString(),
                  context: Object.fromEntries(
                    Object.entries(context).map(([key, value]) => [key, resolve(value, scope)]),
                  ),
                },
                text,
              )
              return
            }
            const call = action['functionCall']
            if (isObject(call) && call['call'] === 'openUrl' && isObject(call['args'])) {
              const url = safeUrl(resolveText(call['args']['url'], scope), window.location.href)
              if (url !== undefined) window.open(url, '_blank', 'noopener,noreferrer')
            }
          }}
        >
          {typeof component['child'] === 'string' ? (
            <Node {...inner} id={component['child']} />
          ) : null}
        </Button>
      )
    }

    case 'TextField': {
      const target = boundPath(component['value'], scope)
      const value = resolveText(component['value'], scope)
      const variant = component['variant']
      return (
        <TextField
          className="flex flex-col gap-1.5"
          value={value}
          isReadOnly={target === undefined}
          isInvalid={!checksPass(component['checks'], scope)}
          type={variant === 'obscured' ? 'password' : variant === 'number' ? 'number' : 'text'}
          onChange={next => {
            if (target !== undefined) handlers.write(target, next)
          }}
        >
          <Label>{label}</Label>
          {variant === 'longText' ? <Textarea /> : <Input />}
        </TextField>
      )
    }

    case 'CheckBox':
      return <CheckBoxView component={component} scope={scope} handlers={handlers} label={label} />

    case 'ChoicePicker':
      return <ChoiceView component={component} scope={scope} handlers={handlers} label={label} />

    case 'Image': {
      const source = imageSource(
        resolveText(component['url'], scope),
        window.location.href,
        imageOrigins,
      )
      const description = resolveText(component['description'], scope)
      if (source === undefined) return null
      // No referrer either: the page's own address says where the user is.
      return source.kind === 'load' ? (
        <img
          src={source.url}
          alt={description}
          referrerPolicy="no-referrer"
          className="max-h-48 max-w-full rounded-md object-contain"
        />
      ) : (
        <WithheldImage description={description} host={source.host} />
      )
    }

    case 'Icon': {
      const Icon = ICONS[resolveText(component['name'], scope)]
      return Icon === undefined ? null : <Icon className="size-4" aria-hidden />
    }

    default:
      return null
  }
}

/**
 * An Image this deployment does not load, as text: what it shows and where it is, so the user can
 * tell what was left out. Not an image to assistive technology, since nothing is drawn.
 */
function WithheldImage({
  description,
  host,
}: {
  readonly description: string
  readonly host: string | undefined
}): ReactNode {
  return (
    <div
      data-slot="chat-a2ui-image-withheld"
      className="flex items-start gap-2 rounded-md border border-dashed border-border-subtle bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
    >
      <ImageOffIcon className="mt-px size-3.5 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="break-words">Image not shown{description === '' ? '' : `: ${description}`}</p>
        {host === undefined ? null : (
          <p className="break-all">From {host}, which this deployment does not load images from</p>
        )}
      </div>
    </div>
  )
}

interface InputViewProps {
  readonly component: A2uiComponent
  readonly scope: Scope
  readonly handlers: SurfaceHandlers
  readonly label: string
}

/** Tecton's checkbox beside its label, as its own examples compose it. */
function CheckBoxView({ component, scope, handlers, label }: InputViewProps): ReactNode {
  const id = useId()
  const target = boundPath(component['value'], scope)
  return (
    <Field orientation="horizontal">
      <Checkbox
        id={id}
        isSelected={resolve(component['value'], scope) === true}
        isReadOnly={target === undefined}
        onChange={next => {
          if (target !== undefined) handlers.write(target, next)
        }}
      />
      <Label htmlFor={id}>{label}</Label>
    </Field>
  )
}

/** One choice (radio buttons) or several (checkboxes); the value is always an array. */
function ChoiceView({ component, scope, handlers, label }: InputViewProps): ReactNode {
  const id = useId()
  const target = boundPath(component['value'], scope)
  const current = resolve(component['value'], scope)
  const selected = Array.isArray(current) ? current.map(String) : []
  const options = Array.isArray(component['options'])
    ? component['options'].flatMap(option =>
        isObject(option) && typeof option['value'] === 'string'
          ? [{ value: option['value'], label: resolveText(option['label'], scope) }]
          : [],
      )
    : []
  const legend = label === '' ? null : <Label>{label}</Label>

  if (component['variant'] === 'multipleSelection') {
    return (
      <CheckboxGroup
        className="flex flex-col gap-2"
        value={selected}
        isReadOnly={target === undefined}
        {...(label === '' ? { 'aria-label': 'Choices' } : {})}
        onChange={next => {
          if (target !== undefined) handlers.write(target, next)
        }}
      >
        {legend}
        {options.map((option, index) => (
          <Field key={option.value} orientation="horizontal">
            <Checkbox id={`${id}-${String(index)}`} value={option.value} />
            <Label htmlFor={`${id}-${String(index)}`}>{option.label}</Label>
          </Field>
        ))}
      </CheckboxGroup>
    )
  }

  return (
    <RadioGroup
      className="gap-2"
      value={selected[0] ?? null}
      isReadOnly={target === undefined}
      {...(label === '' ? { 'aria-label': 'Choices' } : {})}
      onChange={next => {
        if (target !== undefined) handlers.write(target, [next])
      }}
    >
      {legend}
      {options.map((option, index) => (
        <div key={option.value} className="flex items-center gap-3">
          <RadioGroupItem id={`${id}-${String(index)}`} value={option.value} />
          <Label htmlFor={`${id}-${String(index)}`}>{option.label}</Label>
        </div>
      ))}
    </RadioGroup>
  )
}

/** One surface, from the conversation's store, as it is now. */
export function A2uiSurface({
  surfaces,
  surfaceId,
  handlers,
  imageOrigins,
}: {
  readonly surfaces: A2uiSurfaces
  readonly surfaceId: string
  readonly handlers: SurfaceHandlers
  readonly imageOrigins: ReadonlySet<string>
}): ReactNode {
  const all = useSyncExternalStore(surfaces.subscribe, surfaces.getSnapshot, surfaces.getSnapshot)
  const surface = all.get(surfaceId)
  if (surface === undefined) return null
  return (
    <div
      data-slot="chat-a2ui-surface"
      role="group"
      aria-label="Shown by the assistant"
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-card p-3"
    >
      <Node
        surface={surface}
        id="root"
        scope={{ data: surface.data, path: '/' }}
        handlers={handlers}
        imageOrigins={imageOrigins}
        path={[]}
      />
    </div>
  )
}

import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@tecton/react/components/field'
import { Switch } from '@tecton/react/components/switch'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelHeader,
  PanelTitle,
} from '@tecton/react/tecton/panel'
import { ChevronLeftIcon, ChevronRightIcon, SearchXIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { familyTitle } from '../families.ts'
import { defineLoader, loaders, type GalleryLoader } from '../generated/loaders.js'

export const Route = createFileRoute('/$name')({
  component: LoaderRoute,
})

function LoaderRoute(): ReactNode {
  const { name } = Route.useParams()
  const index = loaders.findIndex(loader => loader.name === name)
  const loader = loaders[index]
  return loader === undefined ? (
    <NoSuchLoader name={name} />
  ) : (
    <LoaderPage index={index} loader={loader} />
  )
}

/** A name from an old link, or a typo: every loader there is, is in the list beside this. */
function NoSuchLoader({ name }: { readonly name: string }): ReactNode {
  return (
    <div className="flex h-full w-full">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>No loader is called {name}</EmptyTitle>
          <EmptyDescription>
            Choose one from the list, or <Link to="/">start from the first</Link>.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}

function LoaderPage({
  index,
  loader,
}: {
  readonly index: number
  readonly loader: GalleryLoader
}): ReactNode {
  const navigate = useNavigate()
  const [paused, setPaused] = useState(false)
  const id = useId()
  const previous = loaders[(index - 1 + loaders.length) % loaders.length]
  const next = loaders[(index + 1) % loaders.length]
  const go = (to: GalleryLoader | undefined): void => {
    if (to !== undefined) void navigate({ to: '/$name', params: { name: to.name } })
  }
  const choice = `export const loader = '${loader.name}'`

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>
            {familyTitle(loader.family)} · {index + 1} of {loaders.length}
          </PageHeaderEyebrow>
          <PageHeaderTitle className="text-clip whitespace-normal">{loader.title}</PageHeaderTitle>
          <PageHeaderDescription>
            The shell draws this while sign-in and boot run, in these colours, which follow the
            theme. Choose it with <code className="font-mono">{choice}</code> in the shell&rsquo;s
            src/mfe.config.ts, or with SHELL_LOADER in a deployment.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <Panel>
        <PanelHeader className="flex-wrap gap-y-2">
          <PanelTitle className="font-mono">{loader.name}</PanelTitle>
          <PanelActions className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onPress={() => go(previous)}>
              <ChevronLeftIcon data-icon="inline-start" /> Previous
            </Button>
            <Button variant="outline" size="sm" onPress={() => go(next)}>
              Next <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </PanelActions>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-4">
          <LoaderPreview name={loader.name} title={loader.title} paused={paused} />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Field orientation="horizontal" className="w-auto">
              <Switch id={`${id}-paused`} isSelected={paused} onChange={setPaused} />
              <FieldContent>
                <FieldLabel htmlFor={`${id}-paused`}>Paused</FieldLabel>
                <FieldDescription>As when loading fails.</FieldDescription>
              </FieldContent>
            </Field>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" appearance="outline" className="font-mono">
                {choice}
              </Badge>
              <CopyButton value={choice} aria-label="Copy the line that chooses this loader" />
            </div>
          </div>
        </PanelContent>
      </Panel>
    </div>
  )
}

/**
 * The loader's element, in a box of the loading screen's colours. It is made by hand rather than
 * rendered, because each one owns a worker and a canvas it hands to it: a new loader is a new
 * element, and the old one is removed, which stops its worker.
 */
function LoaderPreview({
  name,
  title,
  paused,
}: {
  readonly name: string
  readonly title: string
  readonly paused: boolean
}): ReactNode {
  const box = useRef<HTMLDivElement>(null)
  const element = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const host = box.current
    if (host === null) return
    defineLoader(name)
    const loader = document.createElement(`${name}-loader`)
    loader.style.position = 'absolute'
    loader.style.inset = '0'
    host.replaceChildren(loader)
    element.current = loader
    return () => {
      loader.remove()
      element.current = null
    }
  }, [name])

  useEffect(() => {
    element.current?.toggleAttribute('paused', paused)
  }, [name, paused])

  return (
    <div
      ref={box}
      role="img"
      aria-label={`${title}, as the loading screen draws it`}
      className="loader-theme relative aspect-video w-full overflow-hidden rounded-lg border border-border-subtle"
    />
  )
}

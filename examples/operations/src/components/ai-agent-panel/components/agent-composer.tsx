'use client'

import * as React from 'react'
import { cn } from 'cn'
import { ArrowUpIcon, MicIcon, PaperclipIcon } from 'lucide-react'

import { Button } from '@tecton/react/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@tecton/react/components/input-group'
import { Tooltip, TooltipTrigger } from '@tecton/react/components/tooltip'

type AgentComposerProps = Omit<React.ComponentProps<'form'>, 'onSubmit'> & {
  placeholder?: string
  suggestions?: string[]
  isDisabled?: boolean
  onSubmit?: (value: string) => void
}

function AgentComposer({
  className,
  placeholder = 'What should we do next?',
  suggestions = [],
  isDisabled = false,
  onSubmit,
  ...props
}: AgentComposerProps) {
  const [value, setValue] = React.useState('')

  const submit = () => {
    const text = value.trim()
    if (!text) return
    onSubmit?.(text)
    setValue('')
  }

  return (
    <form
      data-slot="agent-composer"
      className={cn('flex flex-col gap-2', className)}
      onSubmit={event => {
        event.preventDefault()
        submit()
      }}
      {...props}
    >
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map(suggestion => (
            <Button
              key={suggestion}
              type="button"
              variant="outline"
              size="xs"
              className="rounded-full"
              onPress={() => onSubmit?.(suggestion)}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      )}
      <InputGroup aria-label="Message the agent">
        <InputGroupInput
          value={value}
          placeholder={placeholder}
          disabled={isDisabled}
          onChange={event => setValue(event.target.value)}
        />
        <InputGroupAddon align="inline-start">
          <TooltipTrigger>
            <InputGroupButton size="icon-xs" aria-label="Attach file" isDisabled={isDisabled}>
              <PaperclipIcon />
            </InputGroupButton>
            <Tooltip>Attach</Tooltip>
          </TooltipTrigger>
        </InputGroupAddon>
        <InputGroupAddon align="inline-end">
          <TooltipTrigger>
            <InputGroupButton size="icon-xs" aria-label="Dictate" isDisabled={isDisabled}>
              <MicIcon />
            </InputGroupButton>
            <Tooltip>Dictate</Tooltip>
          </TooltipTrigger>
          <InputGroupButton
            type="submit"
            size="icon-xs"
            variant="default"
            aria-label="Send"
            isDisabled={isDisabled || value.trim().length === 0}
          >
            <ArrowUpIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}

export { AgentComposer }
export type { AgentComposerProps }

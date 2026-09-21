'use client'

import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@tecton/react/components/dropdown-menu'
import { Button } from '@tecton/react/components/button'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'

export function ModeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenuTrigger>
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme">
        <SunIcon className="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
        <MoonIcon className="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
      </Button>
      <DropdownMenu placement="bottom end" className="w-36">
        <DropdownMenuGroup
          selectionMode="single"
          selectedKeys={theme === undefined ? [] : [theme]}
          onSelectionChange={keys => {
            const next = keys === 'all' ? undefined : [...keys][0]
            if (typeof next === 'string') setTheme(next)
          }}
        >
          <DropdownMenuItem id="dark">
            <MoonIcon /> Dark
          </DropdownMenuItem>
          <DropdownMenuItem id="light">
            <SunIcon /> Light
          </DropdownMenuItem>
          <DropdownMenuItem id="system">
            <MonitorIcon /> System
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenu>
    </DropdownMenuTrigger>
  )
}

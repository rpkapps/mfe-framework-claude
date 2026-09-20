// @ts-nocheck
'use client'

import * as React from 'react'
import { cn } from 'cn'
import { BellIcon, LayersIcon, LogOutIcon, SearchIcon, SettingsIcon, UserIcon } from 'lucide-react'

import { Avatar, AvatarFallback } from '@tecton/react/components/avatar'
import { Button } from '@tecton/react/components/button'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@tecton/react/components/dropdown-menu'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@tecton/react/components/input-group'
import { Kbd, KbdGroup } from '@tecton/react/components/kbd'
import { Tooltip, TooltipTrigger } from '@tecton/react/components/tooltip'
import {
  AppShellBrand,
  AppShellHeader,
  AppShellHeaderActions,
  AppShellNav,
} from '@tecton/react/tecton/app-shell'
import { CountBadge } from '@tecton/react/tecton/count-badge'

import { currentUser, navLinks, project } from '../data'

type TopNavProps = React.ComponentProps<typeof AppShellHeader> & {
  activeId?: string
  onNavigate?: (id: string) => void
}

function TopNav({ className, activeId = 'overview', onNavigate, ...props }: TopNavProps) {
  return (
    <AppShellHeader data-slot="top-nav" className={cn('gap-4', className)} {...props}>
      <AppShellBrand>
        <LayersIcon className="text-primary-foreground" aria-hidden />
        <span>Tecton</span>
      </AppShellBrand>
      <AppShellNav className="hidden md:flex" aria-label="Project sections">
        {navLinks.map(link => (
          <Button
            key={link.id}
            variant={link.id === activeId ? 'secondary' : 'ghost'}
            size="sm"
            aria-current={link.id === activeId ? 'page' : undefined}
            onPress={() => onNavigate?.(link.id)}
          >
            {link.label}
          </Button>
        ))}
      </AppShellNav>
      <AppShellHeaderActions className="gap-2">
        <InputGroup className="hidden h-8 w-56 lg:flex" aria-label="Search project">
          <InputGroupInput placeholder="Search…" className="h-8 text-sm" />
          <InputGroupAddon align="inline-start">
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupAddon align="inline-end">
            <KbdGroup>
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </KbdGroup>
          </InputGroupAddon>
        </InputGroup>
        <TooltipTrigger>
          <CountBadge count={project.unreadNotifications} color="error">
            <Button variant="ghost" size="icon-sm" aria-label="Notifications">
              <BellIcon />
            </Button>
          </CountBadge>
          <Tooltip>{project.unreadNotifications} unread</Tooltip>
        </TooltipTrigger>
        <DropdownMenuTrigger>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={`Account: ${currentUser.name}`}
          >
            <Avatar size="sm">
              <AvatarFallback className="text-[0.625rem]">{currentUser.initials}</AvatarFallback>
            </Avatar>
          </Button>
          <DropdownMenu placement="bottom end" className="w-56">
            <DropdownMenuLabel>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-foreground">{currentUser.name}</span>
                <span className="font-normal">{currentUser.role}</span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <UserIcon /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem>
              <SettingsIcon /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <LogOutIcon /> Sign out
            </DropdownMenuItem>
          </DropdownMenu>
        </DropdownMenuTrigger>
      </AppShellHeaderActions>
    </AppShellHeader>
  )
}

export { TopNav }
export type { TopNavProps }

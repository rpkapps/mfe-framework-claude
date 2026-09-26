'use client'

import * as React from 'react'
import { cn } from 'cn'
import { BellIcon, CircleCheckIcon, PaletteIcon, UserIcon, XIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Button } from '@tecton/react/components/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@tecton/react/components/tabs'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'

import { AppearanceForm, NotificationsForm, ProfileForm } from './components/settings-forms'
import { defaultSettings } from './data'
import type { Settings } from './data'

type SettingsPageProps = React.ComponentProps<'div'> & {
  initialSettings?: Settings
  onSave?: (settings: Settings) => void
}

function SettingsPage({
  className,
  initialSettings = defaultSettings,
  onSave,
  ...props
}: SettingsPageProps) {
  const [saved, setSaved] = React.useState<Settings>(initialSettings)
  const [draft, setDraft] = React.useState<Settings>(initialSettings)
  const [toast, setToast] = React.useState(false)
  const toastTimer = React.useRef<number | undefined>(undefined)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  // The timer outlives the page otherwise, and would hide a toast nobody can see any more.
  React.useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const save = () => {
    setSaved(draft)
    onSave?.(draft)
    setToast(true)
    // A second save restarts the three seconds, instead of the first save's timer cutting it short.
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(false), 3000)
  }

  return (
    <div
      data-slot="settings-page"
      className={cn('flex min-h-svh w-full flex-col bg-background text-foreground', className)}
      {...props}
    >
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderEyebrow>Workspace · Account</PageHeaderEyebrow>
            <PageHeaderTitle>Settings</PageHeaderTitle>
            <PageHeaderDescription>
              Manage your profile, how you are notified and how the workspace looks. Changes apply
              after you save.
            </PageHeaderDescription>
          </PageHeaderContent>
        </PageHeader>

        {toast && (
          <Alert variant="success" appearance="outline">
            <CircleCheckIcon />
            <AlertTitle>Settings saved</AlertTitle>
            <AlertDescription>Your preferences are synced across devices.</AlertDescription>
            <AlertAction>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Dismiss"
                onPress={() => setToast(false)}
              >
                <XIcon />
              </Button>
            </AlertAction>
          </Alert>
        )}

        <Tabs defaultSelectedKey="profile" className="gap-6">
          <TabsList variant="line" aria-label="Settings sections">
            <TabsTrigger id="profile">
              <UserIcon /> Profile
            </TabsTrigger>
            <TabsTrigger id="notifications">
              <BellIcon /> Notifications
            </TabsTrigger>
            <TabsTrigger id="appearance">
              <PaletteIcon /> Appearance
            </TabsTrigger>
          </TabsList>
          <TabsContent id="profile">
            <ProfileForm
              value={draft.profile}
              onChange={profile => setDraft({ ...draft, profile })}
            />
          </TabsContent>
          <TabsContent id="notifications">
            <NotificationsForm
              value={draft.notifications}
              onChange={notifications => setDraft({ ...draft, notifications })}
            />
          </TabsContent>
          <TabsContent id="appearance">
            <AppearanceForm
              value={draft.appearance}
              onChange={appearance => setDraft({ ...draft, appearance })}
            />
          </TabsContent>
        </Tabs>
      </div>

      <footer
        data-slot="settings-footer"
        className="sticky bottom-0 border-t border-border-subtle bg-card/95 backdrop-blur"
      >
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3 md:px-8">
          <span className="text-xs text-muted-foreground">
            {dirty ? 'You have unsaved changes.' : 'All changes saved.'}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" isDisabled={!dirty} onPress={() => setDraft(saved)}>
              Discard
            </Button>
            <Button size="sm" isDisabled={!dirty} onPress={save}>
              Save changes
            </Button>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default function SettingsRoute() {
  return <SettingsPage />
}

export { SettingsPage, ProfileForm, NotificationsForm, AppearanceForm }
export { defaultSettings } from './data'
export type { SettingsPageProps }
export type { Settings } from './data'

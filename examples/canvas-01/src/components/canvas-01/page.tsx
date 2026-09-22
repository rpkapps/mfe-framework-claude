'use client'

import * as React from 'react'
import {
  HandIcon,
  LassoIcon,
  LayersIcon,
  MoreVerticalIcon,
  MousePointer2Icon,
  PencilIcon,
  RedoIcon,
  RulerIcon,
  ScanIcon,
  SquareDashedIcon,
  UndoIcon,
  UploadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'

import { Button } from '@tecton/react/components/button'
import { Badge } from '@tecton/react/components/badge'
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@tecton/react/components/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tecton/react/components/select'
import { Separator } from '@tecton/react/components/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@tecton/react/components/sidebar'
import { Tooltip, TooltipTrigger } from '@tecton/react/components/tooltip'
import {
  Canvas,
  CanvasLegend,
  CanvasLegendItem,
  CanvasOverlay,
  CanvasSurface,
  CanvasToolbar,
} from '@tecton/react/tecton/canvas'

import { FairwayMap } from './components/fairway-map'
import { PresetList } from './components/preset-list'
import { depthViews, features, geologyLayers, legend, mapViews, presets, surveys } from './data'

/** Icon button used in the floating rails, with a tooltip as its name. */
function Tool({
  label,
  isActive,
  isDisabled = false,
  children,
  onPress,
}: {
  label: string
  isActive?: boolean
  isDisabled?: boolean
  children: React.ReactNode
  onPress?: () => void
}) {
  return (
    <TooltipTrigger>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        isDisabled={isDisabled}
        className="aria-pressed:bg-ghost-active aria-pressed:text-ghost-active-foreground"
        {...(isActive === undefined ? {} : { 'aria-pressed': isActive })}
        {...(onPress === undefined ? {} : { onPress })}
      >
        {children}
      </Button>
      <Tooltip placement="right">{label}</Tooltip>
    </TooltipTrigger>
  )
}

/** Compact select used in the floating view controls. */
function ViewSelect({
  label,
  options,
  defaultKey,
}: {
  label: string
  options: { id: string; label: string }[]
  defaultKey: string
}) {
  return (
    <Select aria-label={label} defaultSelectedKey={defaultKey} className="w-auto">
      <SelectTrigger
        size="sm"
        className="min-w-28 border-border-subtle bg-card/90 shadow-md backdrop-blur-sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.id} id={option.id} textValue={option.label}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Feature kinds the Layers menu switches on and off. */
const mapLayers = [
  { id: 'field', label: 'Existing fields' },
  { id: 'prospect', label: 'Prospect areas' },
  { id: 'survey', label: 'Survey outlines' },
]

const presetViews: Record<string, { zoom: number; layers: string[] }> = {
  'geologic-background': { zoom: 1, layers: ['field', 'prospect', 'survey'] },
  'framework-model': { zoom: 1.3, layers: ['field'] },
  'well-correlation': { zoom: 1, layers: ['survey'] },
  'property-model': { zoom: 1.5, layers: ['prospect'] },
  'initial-grid': { zoom: 1.2, layers: [] },
  'well-planning': { zoom: 1.4, layers: ['prospect'] },
}

/** Zoom levels the magnifier buttons step through. */
const zoomLevels = [1, 1.5, 2, 3, 4]
const minZoom = zoomLevels[0] ?? 1
const maxZoom = zoomLevels[zoomLevels.length - 1] ?? 1

/** Ground distance the scale bar spans at 1×, in metres and feet. */
const scaleBar = { metres: 750, feet: 2500 }

/**
 * Canvas page: saved view presets in the sidebar and a full-bleed map
 * with its chrome floating over the surface — view selectors, a tool
 * rail on each side, the legend and the scale bar.
 */
export default function Page() {
  const [preset, setPreset] = React.useState(presets[0]?.id ?? '')
  const [tool, setTool] = React.useState('pan')
  const [selected, setSelected] = React.useState<string | null>(null)
  const [zoom, setZoom] = React.useState(1)
  const [layers, setLayers] = React.useState<string[]>(mapLayers.map(layer => layer.id))

  const zoomIn = () => setZoom(level => zoomLevels.find(next => next > level) ?? level)
  const zoomOut = () =>
    setZoom(level => [...zoomLevels].reverse().find(next => next < level) ?? level)
  const applyPreset = (id: string) => {
    const next = presets.find(item => item.id === id)
    if (!next) return

    const view = presetViews[next.id]
    if (!view) return
    setPreset(id)
    setZoom(view.zoom)
    setLayers(view.layers)
    setSelected(null)
  }

  return (
    <SidebarProvider className="relative h-full min-h-0 overflow-hidden [&_[data-slot=sidebar-container]]:!absolute [&_[data-slot=sidebar-container]]:!h-full">
      <PresetList selected={preset} onSelect={applyPreset} />
      <SidebarInset className="min-h-0 min-w-0">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-2">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 h-4 aria-[orientation=vertical]:self-center"
          />
          <span className="text-sm">{presets.find(item => item.id === preset)?.name}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm">
              <UploadIcon data-icon="inline-start" /> Review and publish
            </Button>
            <Button variant="secondary" size="sm">
              Share
            </Button>
          </div>
        </header>
        <Canvas>
          <CanvasSurface>
            <FairwayMap
              zoom={zoom}
              features={features.filter(feature => layers.includes(feature.kind))}
              surveys={layers.includes('survey') ? surveys : []}
              selected={selected}
              onSelect={setSelected}
            />
          </CanvasSurface>

          <CanvasOverlay position="top-left">
            <ViewSelect label="Map type" options={mapViews} defaultKey="fairway" />
            <ViewSelect label="Domain" options={depthViews} defaultKey="depth" />
            <CanvasToolbar aria-label="Navigation tools">
              <Tool label="Zoom in" isDisabled={zoom >= maxZoom} onPress={zoomIn}>
                <ZoomInIcon />
              </Tool>
              <Tool label="Zoom out" isDisabled={zoom <= minZoom} onPress={zoomOut}>
                <ZoomOutIcon />
              </Tool>
              <Tool label="Pan" isActive={tool === 'pan'} onPress={() => setTool('pan')}>
                <HandIcon />
              </Tool>
              <Tool label="Lasso" isActive={tool === 'lasso'} onPress={() => setTool('lasso')}>
                <LassoIcon />
              </Tool>
            </CanvasToolbar>
            <CanvasToolbar aria-label="Editing tools">
              <DropdownMenuTrigger>
                <Tool label="Layers" isActive={layers.length < mapLayers.length}>
                  <LayersIcon />
                </Tool>
                <DropdownMenu placement="right top" className="w-48">
                  <DropdownMenuLabel>Layers</DropdownMenuLabel>
                  <DropdownMenuGroup
                    selectionMode="multiple"
                    selectedKeys={layers}
                    onSelectionChange={keys =>
                      setLayers(
                        keys === 'all'
                          ? mapLayers.map(layer => layer.id)
                          : mapLayers.filter(layer => keys.has(layer.id)).map(layer => layer.id),
                      )
                    }
                  >
                    {mapLayers.map(layer => (
                      <DropdownMenuItem key={layer.id} id={layer.id} textValue={layer.label}>
                        {layer.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenu>
              </DropdownMenuTrigger>
              <Tool
                label="Measure"
                isActive={tool === 'measure'}
                onPress={() => setTool('measure')}
              >
                <RulerIcon />
              </Tool>
              <Tool
                label="Section"
                isActive={tool === 'section'}
                onPress={() => setTool('section')}
              >
                <ScanIcon />
              </Tool>
              <Separator className="mx-1 w-auto" />
              {/* Nothing has been edited yet, so there is nothing to step through. */}
              <Tool label="Undo" isDisabled>
                <UndoIcon />
              </Tool>
              <Tool label="Redo" isDisabled>
                <RedoIcon />
              </Tool>
            </CanvasToolbar>
          </CanvasOverlay>

          <CanvasOverlay position="top-right">
            <ViewSelect label="Background" options={geologyLayers} defaultKey="regional" />
            <CanvasToolbar aria-label="Selection tools">
              <Tool label="Select" isActive={tool === 'select'} onPress={() => setTool('select')}>
                <MousePointer2Icon />
              </Tool>
              <Tool
                label="Marquee"
                isActive={tool === 'marquee'}
                onPress={() => setTool('marquee')}
              >
                <SquareDashedIcon />
              </Tool>
              <Separator className="mx-1 w-auto" />
              <Tool
                label="Edit polygon"
                isActive={tool === 'polygon'}
                onPress={() => setTool('polygon')}
              >
                <PencilIcon />
              </Tool>
              <Tool label="Export">
                <UploadIcon />
              </Tool>
            </CanvasToolbar>
            <CanvasToolbar aria-label="More">
              <DropdownMenuTrigger>
                <Tool label="More">
                  <MoreVerticalIcon />
                </Tool>
                <DropdownMenu placement="bottom end" className="w-48">
                  <DropdownMenuItem onAction={() => setSelected(null)} isDisabled={!selected}>
                    Clear selection
                  </DropdownMenuItem>
                  <DropdownMenuItem onAction={() => setZoom(1)} isDisabled={zoom === 1}>
                    Reset zoom
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>Copy map image</DropdownMenuItem>
                  <DropdownMenuItem>Map settings</DropdownMenuItem>
                </DropdownMenu>
              </DropdownMenuTrigger>
            </CanvasToolbar>
          </CanvasOverlay>

          <CanvasOverlay position="top">
            <Badge variant="secondary">{presets.find(item => item.id === preset)?.name}</Badge>
          </CanvasOverlay>

          <CanvasOverlay position="bottom-left">
            <CanvasLegend aria-label="Legend">
              {legend.map(entry => (
                <CanvasLegendItem
                  key={entry.id}
                  swatch={
                    entry.hatched ? (
                      <span
                        aria-hidden
                        className="size-full bg-[repeating-linear-gradient(45deg,currentColor_0_1px,transparent_1px_3px)] opacity-70"
                      />
                    ) : (
                      entry.color
                    )
                  }
                >
                  {entry.label}
                </CanvasLegendItem>
              ))}
            </CanvasLegend>
          </CanvasOverlay>

          <CanvasOverlay position="bottom-right">
            <div
              data-slot="scale-bar"
              className="grid gap-0.5 rounded-md border border-border-subtle bg-card/90 px-2 py-1 font-mono text-[10px] text-card-foreground shadow-md backdrop-blur-sm"
            >
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-20 border-x border-b border-foreground" />
                {Math.round(scaleBar.metres / zoom).toLocaleString()} m
              </span>
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-24 border-x border-t border-foreground" />
                {Math.round(scaleBar.feet / zoom).toLocaleString()} ft
              </span>
            </div>
          </CanvasOverlay>
        </Canvas>
      </SidebarInset>
    </SidebarProvider>
  )
}

export { PresetList, PresetSketch } from './components/preset-list'
export { FairwayMap } from './components/fairway-map'
export { presets, mapViews, depthViews, geologyLayers, legend, features, surveys } from './data'
export type { ViewPreset, PresetStatus, MapFeature, LegendEntry } from './data'

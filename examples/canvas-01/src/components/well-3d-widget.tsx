'use client'

import { useTheme, type WidgetRenderProps } from '@company/mfe-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Canvas,
  CanvasLegend,
  CanvasLegendItem,
  CanvasOverlay,
  CanvasSurface,
} from '@tecton/react/tecton/canvas'

import type { subsurfaceWell3dContract } from '../mfe.ts'

const vertexShaderSource = `
  attribute vec3 a_position;
  attribute vec4 a_color;
  attribute vec3 a_normal;
  uniform mat4 u_mvp;
  varying vec4 v_color;
  varying float v_light;

  void main() {
    gl_Position = u_mvp * vec4(a_position, 1.0);
    v_color = a_color;
    v_light = 0.6 + 0.4 * max(dot(normalize(a_normal), normalize(vec3(0.35, 0.8, 0.45))), 0.0);
  }
`

const fragmentShaderSource = `
  precision mediump float;
  varying vec4 v_color;
  varying float v_light;

  void main() {
    gl_FragColor = vec4(v_color.rgb * v_light, v_color.a);
  }
`

type RendererControls = {
  readonly rotate: (horizontal: number, vertical: number) => void
  readonly zoom: (amount: number) => void
  readonly reset: () => void
  readonly dispose: () => void
}

type Point = readonly [number, number, number]
type Rgb = readonly [number, number, number]
type Color = readonly [number, number, number, number]
type ThemePalette = {
  readonly background: Rgb
  readonly surfaces: readonly Color[]
  readonly wellSegments: readonly Color[]
  readonly reservoir: Color
  readonly grid: Color
}

const surfaceDefinitions: readonly {
  readonly depth: number
  readonly name: string
}[] = [
  { depth: 1.1, name: 'High elevation' },
  { depth: 0.55, name: 'Upper elevation' },
  { depth: 0, name: 'Middle elevation' },
  { depth: -0.55, name: 'Low elevation' },
]

const wellDefinitions: readonly {
  readonly name: string
  readonly start: Point
  readonly drift: Point
}[] = [
  { name: 'MW-5', start: [-2.85, 1.25, -1.45], drift: [1.2, 0, 2.6] },
  { name: 'MW-4', start: [-1.75, 1.2, -0.8], drift: [0.45, 0, 3.05] },
  { name: 'MW-6', start: [-0.55, 1.25, -0.25], drift: [-0.15, 0, 3.2] },
  { name: 'MW-1', start: [0.65, 1.2, 0.25], drift: [0.35, 0, 3.1] },
  { name: 'MW-2', start: [1.75, 1.15, 0.75], drift: [1.45, 0, 2.4] },
  { name: 'MW-3', start: [2.65, 1.1, 1.15], drift: [2.25, 0, 1.15] },
]

const reservoirDefinitions: readonly {
  readonly center: Point
  readonly scale: Point
}[] = [
  { center: [-1.8, -0.1, 0.05], scale: [1.35, 0.34, 0.8] },
  { center: [0.2, -0.55, 0.65], scale: [0.8, 0.3, 0.6] },
  { center: [1.65, -0.15, -0.35], scale: [0.9, 0.32, 0.65] },
  { center: [-0.2, -1.35, -0.95], scale: [0.68, 0.24, 0.48] },
  { center: [2.3, -1.05, 1.05], scale: [0.48, 0.22, 0.4] },
  { center: [-2.15, -1.25, -1.2], scale: [0.62, 0.2, 0.44] },
]

const darkPalette: ThemePalette = {
  background: [0.035, 0.045, 0.055],
  surfaces: [
    [0.1, 0.34, 0.48, 0.92],
    [0.25, 0.55, 0.46, 0.92],
    [0.7, 0.64, 0.32, 0.92],
    [0.75, 0.35, 0.24, 0.92],
  ],
  wellSegments: [
    [0.12, 0.66, 0.68, 1],
    [0.58, 0.76, 0.18, 1],
    [0.9, 0.56, 0.2, 1],
    [0.78, 0.3, 0.48, 1],
  ],
  reservoir: [0.78, 0.12, 0.22, 0.78],
  grid: [0.72, 0.76, 0.78, 0.42],
}

const lightPalette: ThemePalette = {
  background: [0.91, 0.93, 0.96],
  surfaces: [
    [0.06, 0.3, 0.46, 0.94],
    [0.18, 0.52, 0.4, 0.94],
    [0.67, 0.57, 0.22, 0.94],
    [0.7, 0.25, 0.16, 0.94],
  ],
  wellSegments: [
    [0.04, 0.36, 0.4, 1],
    [0.3, 0.52, 0.04, 1],
    [0.68, 0.32, 0.04, 1],
    [0.58, 0.08, 0.25, 1],
  ],
  reservoir: [0.58, 0.04, 0.14, 0.78],
  grid: [0.22, 0.27, 0.32, 0.42],
}

export function SubsurfaceWell3dWidget(
  _props: WidgetRenderProps<typeof subsurfaceWell3dContract>,
): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const controlsRef = useRef<RendererControls | null>(null)
  const [webglError, setWebglError] = useState(false)
  const [resetVersion, _setResetVersion] = useState(0)
  const theme = useTheme()

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return

    const reportWebglError = () => {
      queueMicrotask(() => {
        setWebglError(true)
      })
    }
    let renderer: RendererControls | null = null
    try {
      renderer = createRenderer(
        canvas,
        theme === 'dark' ? darkPalette : lightPalette,
        reportWebglError,
      )
      controlsRef.current = renderer
    } catch {
      reportWebglError()
    }

    return () => {
      controlsRef.current = null
      renderer?.dispose()
    }
  }, [resetVersion, theme])

  const palette = theme === 'dark' ? darkPalette : lightPalette

  return (
    <section className="flex h-full min-h-80 flex-col overflow-hidden bg-card">
      <Canvas
        className="bg-surface-alt"
        role="img"
        aria-label="Interactive 3D well trajectory crossing four subsurface surfaces"
        tabIndex={0}
        onKeyDown={event => {
          const controls = controlsRef.current
          if (controls === null) return

          if (event.key === 'r' || event.key === 'R') {
            controls.reset()
            return
          }
          if (event.key === 'ArrowLeft') controls.rotate(-0.12, 0)
          if (event.key === 'ArrowRight') controls.rotate(0.12, 0)
          if (event.key === 'ArrowUp') controls.rotate(0, -0.12)
          if (event.key === 'ArrowDown') controls.rotate(0, 0.12)
          if (event.key === '+' || event.key === '=') controls.zoom(-0.3)
          if (event.key === '-' || event.key === '_') controls.zoom(0.3)
        }}
      >
        <CanvasSurface>
          <canvas ref={canvasRef} className="block size-full min-h-64" />
        </CanvasSurface>
        {webglError ? (
          <CanvasOverlay position="top">
            <div className="rounded-md border border-border-subtle bg-card/90 px-3 py-2 text-center text-sm text-muted-foreground shadow-md backdrop-blur-sm">
              WebGL is unavailable in this browser.
            </div>
          </CanvasOverlay>
        ) : (
          <>
            <CanvasOverlay position="top-left">
              <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-card/90 px-2 py-1 text-[10px] text-muted-foreground shadow-md backdrop-blur-sm">
                <div className="whitespace-nowrap">Drag · scroll · R reset</div>
              </div>
            </CanvasOverlay>
            <CanvasOverlay position="bottom-right">
              <CanvasLegend aria-label="Interpreted horizons">
                {surfaceDefinitions.map((surface, index) => (
                  <CanvasLegendItem
                    key={surface.depth}
                    swatch={colorToCss(
                      palette.surfaces[palette.surfaces.length - 1 - index] ?? palette.reservoir,
                    )}
                  >
                    {surface.name}
                  </CanvasLegendItem>
                ))}
              </CanvasLegend>
              <CanvasLegend aria-label="Monitoring wells">
                {wellDefinitions.map((well, index) => (
                  <CanvasLegendItem
                    key={well.name}
                    swatch={colorToCss(
                      palette.wellSegments[index % palette.wellSegments.length] ??
                        palette.reservoir,
                    )}
                  >
                    {well.name}
                  </CanvasLegendItem>
                ))}
              </CanvasLegend>
            </CanvasOverlay>
          </>
        )}
      </Canvas>
    </section>
  )
}

function createRenderer(
  canvas: HTMLCanvasElement,
  palette: ThemePalette,
  onContextFailure: () => void,
): RendererControls {
  const context = canvas.getContext('webgl', {
    alpha: false,
    antialias: true,
    depth: true,
  })
  if (context === null) {
    onContextFailure()
    throw new Error('WebGL is unavailable')
  }
  const gl: WebGLRenderingContext = context

  const program = createProgram(gl, vertexShaderSource, fragmentShaderSource)
  const positionLocation = gl.getAttribLocation(program, 'a_position')
  const colorLocation = gl.getAttribLocation(program, 'a_color')
  const normalLocation = gl.getAttribLocation(program, 'a_normal')
  const matrixLocation = gl.getUniformLocation(program, 'u_mvp')
  if (positionLocation < 0 || colorLocation < 0 || normalLocation < 0 || matrixLocation === null) {
    onContextFailure()
    throw new Error('WebGL shader locations are unavailable')
  }

  const terrain = createTerrain(palette.surfaces)
  const reservoirs = reservoirDefinitions.map(reservoir =>
    createReservoir(reservoir.center, reservoir.scale, palette.reservoir),
  )
  const wells = wellDefinitions.map((well, index) => createWell(well, index, palette.wellSegments))
  const grid = createGrid(palette.grid)
  let yaw = 0.7
  let pitch = 0.55
  let distance = 8
  let dragging = false
  let previousX = 0
  let previousY = 0

  gl.useProgram(program)
  gl.enable(gl.DEPTH_TEST)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          resizeAndDraw()
        })
  resizeObserver?.observe(canvas.parentElement ?? canvas)

  const onWindowResize = () => {
    resizeAndDraw()
  }
  if (resizeObserver === null) window.addEventListener('resize', onWindowResize)

  const onPointerDown = (event: PointerEvent) => {
    dragging = true
    previousX = event.clientX
    previousY = event.clientY
    canvas.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return
    yaw += (event.clientX - previousX) * 0.008
    pitch = clamp(pitch + (event.clientY - previousY) * 0.008, -1.15, 1.15)
    previousX = event.clientX
    previousY = event.clientY
    draw()
  }
  const onPointerUp = (event: PointerEvent) => {
    dragging = false
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    distance = clamp(distance + event.deltaY * 0.006, 4.5, 14)
    draw()
  }
  const onContextLost = (event: Event) => {
    event.preventDefault()
    onContextFailure()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('webglcontextlost', onContextLost)

  function resizeAndDraw() {
    const bounds = canvas.getBoundingClientRect()
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(bounds.width * pixelRatio))
    const height = Math.max(1, Math.round(bounds.height * pixelRatio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    draw()
  }

  function draw() {
    const aspect = canvas.width / Math.max(1, canvas.height)
    const projection = perspective(Math.PI / 4, aspect, 0.1, 30)
    const eye: Point = [
      distance * Math.cos(pitch) * Math.sin(yaw),
      distance * Math.sin(pitch),
      distance * Math.cos(pitch) * Math.cos(yaw),
    ]
    const view = lookAt(eye, [0, 0, 0], [0, 1, 0])
    const matrix = multiply(projection, view)

    gl.clearColor(...palette.background, 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.useProgram(program)

    drawMesh(grid, gl.LINES, matrix)
    gl.depthMask(false)
    drawMesh(terrain, gl.TRIANGLES, matrix)
    gl.depthMask(true)
    for (const reservoir of reservoirs) drawMesh(reservoir, gl.TRIANGLES, matrix)
    for (const well of wells) drawMesh(well, gl.TRIANGLES, matrix)
  }

  function drawMesh(mesh: Mesh, mode: number, matrix: Float32Array) {
    const positionBuffer = gl.createBuffer()
    const colorBuffer = gl.createBuffer()
    if (positionBuffer === null || colorBuffer === null) return

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.colors, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(colorLocation)
    gl.vertexAttribPointer(colorLocation, 4, gl.FLOAT, false, 0, 0)

    const normalBuffer = gl.createBuffer()
    if (normalBuffer === null) {
      gl.deleteBuffer(positionBuffer)
      gl.deleteBuffer(colorBuffer)
      return
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(normalLocation)
    gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0)

    gl.uniformMatrix4fv(matrixLocation, false, matrix)
    gl.drawArrays(mode, 0, mesh.positions.length / 3)
    gl.deleteBuffer(positionBuffer)
    gl.deleteBuffer(colorBuffer)
    gl.deleteBuffer(normalBuffer)
  }

  resizeAndDraw()

  return {
    rotate(horizontal, vertical) {
      yaw += horizontal
      pitch = clamp(pitch + vertical, -1.15, 1.15)
      draw()
    },
    zoom(amount) {
      distance = clamp(distance + amount, 4.5, 14)
      draw()
    },
    reset() {
      yaw = 0.7
      pitch = 0.55
      distance = 8
      draw()
    },
    dispose() {
      resizeObserver?.disconnect()
      if (resizeObserver === null) window.removeEventListener('resize', onWindowResize)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      gl.deleteProgram(program)
    },
  }
}

type Mesh = {
  positions: Float32Array
  colors: Float32Array
  normals: Float32Array
}

function createTerrain(colorRamp: readonly Color[]): Mesh {
  const positions: number[] = []
  const colors: number[] = []
  const normals: number[] = []
  const columns = 28
  const rows = 22

  const append = (point: Point, normal: Point, color: Color) => {
    positions.push(...point)
    colors.push(...color)
    normals.push(...normal)
  }

  const pointAt = (column: number, row: number): { point: Point; normal: Point; color: Color } => {
    const x = -4 + (column / columns) * 8
    const z = -3 + (row / rows) * 6
    const y = terrainHeight(x, z)
    const epsilon = 0.04
    const slopeX = (terrainHeight(x + epsilon, z) - terrainHeight(x - epsilon, z)) / (epsilon * 2)
    const slopeZ = (terrainHeight(x, z + epsilon) - terrainHeight(x, z - epsilon)) / (epsilon * 2)
    const normalizedHeight = clamp((y + 0.05) / 1.75, 0, 1)
    const band = Math.min(colorRamp.length - 1, Math.floor(normalizedHeight * colorRamp.length))
    const color = colorRamp[band] ?? colorRamp[colorRamp.length - 1] ?? [0.2, 0.4, 0.5, 1]
    return {
      point: [x, y, z],
      normal: normalize([-slopeX, 1, -slopeZ]),
      color,
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const first = pointAt(column, row)
      const second = pointAt(column + 1, row)
      const third = pointAt(column, row + 1)
      const fourth = pointAt(column + 1, row + 1)
      append(first.point, first.normal, first.color)
      append(second.point, second.normal, second.color)
      append(third.point, third.normal, third.color)
      append(second.point, second.normal, second.color)
      append(fourth.point, fourth.normal, fourth.color)
      append(third.point, third.normal, third.color)
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    normals: new Float32Array(normals),
  }
}

function terrainHeight(x: number, z: number): number {
  return (
    0.9 +
    Math.sin(x * 0.62 + z * 0.22) * 0.24 +
    Math.cos(z * 0.85 - x * 0.18) * 0.18 +
    Math.sin((x + z) * 1.35) * 0.08
  )
}

function createReservoir(center: Point, scale: Point, color: Color): Mesh {
  const positions: number[] = []
  const colors: number[] = []
  const normals: number[] = []
  const latitudeBands = 9
  const longitudeBands = 18

  const append = (point: Point, normal: Point) => {
    positions.push(...point)
    colors.push(...color)
    normals.push(...normal)
  }
  const pointAt = (latitude: number, longitude: number): { point: Point; normal: Point } => {
    const theta = (latitude / latitudeBands) * Math.PI
    const phi = (longitude / longitudeBands) * Math.PI * 2
    const irregularity = 1 + Math.sin(phi * 3 + theta * 2) * 0.08 + Math.cos(phi * 5 - theta) * 0.04
    const local: Point = [
      Math.sin(theta) * Math.cos(phi) * irregularity,
      Math.cos(theta) * irregularity,
      Math.sin(theta) * Math.sin(phi) * irregularity,
    ]
    return {
      point: [
        center[0] + local[0] * scale[0],
        center[1] + local[1] * scale[1],
        center[2] + local[2] * scale[2],
      ],
      normal: normalize(local),
    }
  }

  for (let latitude = 0; latitude < latitudeBands; latitude += 1) {
    for (let longitude = 0; longitude < longitudeBands; longitude += 1) {
      const first = pointAt(latitude, longitude)
      const second = pointAt(latitude, longitude + 1)
      const third = pointAt(latitude + 1, longitude)
      const fourth = pointAt(latitude + 1, longitude + 1)
      append(first.point, first.normal)
      append(second.point, second.normal)
      append(third.point, third.normal)
      append(second.point, second.normal)
      append(fourth.point, fourth.normal)
      append(third.point, third.normal)
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    normals: new Float32Array(normals),
  }
}

function createGrid(color: Color): Mesh {
  const positions: number[] = []
  const colors: number[] = []
  const normals: number[] = []
  const appendLine = (first: Point, second: Point) => {
    positions.push(...first, ...second)
    colors.push(...color, ...color)
    normals.push(0, 1, 0, 0, 1, 0)
  }

  for (let x = -4; x <= 4; x += 0.5) {
    appendLine([x, -2.75, -3], [x, -2.75, 3])
  }
  for (let z = -3; z <= 3; z += 0.5) {
    appendLine([-4, -2.75, z], [4, -2.75, z])
  }
  for (let z = -3; z <= 3; z += 0.5) {
    appendLine([-4, -2.75, z], [-4, 1.35, z])
  }
  for (let y = -2.75; y <= 1.25; y += 0.5) {
    appendLine([-4, y, -3], [-4, y, 3])
  }
  for (let x = -4; x <= 4; x += 0.5) {
    appendLine([x, -2.75, -3], [x, 1.35, -3])
  }
  for (let y = -2.75; y <= 1.25; y += 0.5) {
    appendLine([-4, y, -3], [4, y, -3])
  }

  const axisColor: Color = [color[0], color[1], color[2], Math.min(1, color[3] + 0.25)]
  positions.push(-4, -2.75, -3, -4, 1.65, -3, -4, -2.75, -3, 4.2, -2.75, -3)
  colors.push(...axisColor, ...axisColor, ...axisColor, ...axisColor)
  normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0)

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    normals: new Float32Array(normals),
  }
}

function createWell(
  definition: (typeof wellDefinitions)[number],
  index: number,
  segmentColors: readonly Color[],
): Mesh {
  const positions: number[] = []
  const colors: number[] = []
  const normals: number[] = []
  const rings = 34
  const sides = 8
  const radius = 0.075
  const fallbackSegment: Color = [1, 1, 1, 1]
  const path: Point[] = Array.from({ length: rings }, (_, ringIndex) => {
    const progress = ringIndex / (rings - 1)
    const verticalProgress = Math.min(1, progress / 0.82)
    return [
      definition.start[0] +
        definition.drift[0] * progress +
        Math.sin(progress * Math.PI * (1.6 + index * 0.01)) * 0.12,
      definition.start[1] - verticalProgress * 4.3,
      definition.start[2] +
        definition.drift[2] * progress +
        Math.cos(progress * Math.PI * 1.3 + index * 0.03) * 0.1,
    ]
  })

  for (let ring = 0; ring < rings - 1; ring += 1) {
    const currentPath = path[ring]
    const nextPath = path[ring + 1]
    if (currentPath === undefined || nextPath === undefined) continue
    for (let side = 0; side < sides; side += 1) {
      const nextSide = (side + 1) % sides
      const first = tubePoint(currentPath, side, sides, radius)
      const second = tubePoint(currentPath, nextSide, sides, radius)
      const third = tubePoint(nextPath, side, sides, radius)
      const fourth = tubePoint(nextPath, nextSide, sides, radius)
      const firstNormal = tubeNormal(side, sides)
      const secondNormal = tubeNormal(nextSide, sides)
      const segment =
        segmentColors[Math.min(segmentColors.length - 1, Math.floor((ring / rings) * 4))] ??
        fallbackSegment
      positions.push(...first, ...second, ...third, ...second, ...fourth, ...third)
      colors.push(...segment, ...segment, ...segment, ...segment, ...segment, ...segment)
      normals.push(
        ...firstNormal,
        ...secondNormal,
        ...firstNormal,
        ...secondNormal,
        ...secondNormal,
        ...firstNormal,
      )
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    normals: new Float32Array(normals),
  }
}

function tubePoint(point: Point, side: number, sides: number, radius: number): Point {
  const angle = (side / sides) * Math.PI * 2
  return [point[0] + Math.cos(angle) * radius, point[1], point[2] + Math.sin(angle) * radius]
}

function tubeNormal(side: number, sides: number): Point {
  const angle = (side / sides) * Math.PI * 2
  return [Math.cos(angle), 0, Math.sin(angle)]
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()
  if (program === null) throw new Error('Unable to create WebGL program')

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'Unknown WebGL program error'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (shader === null) throw new Error('Unable to create WebGL shader')

  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'Unknown WebGL shader error'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2)
  const result = new Float32Array(16)
  result[0] = f / aspect
  result[5] = f
  result[10] = (far + near) / (near - far)
  result[11] = -1
  result[14] = (2 * far * near) / (near - far)
  return result
}

function lookAt(eye: Point, center: Point, up: Point): Float32Array {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]])
  const x = normalize(cross(up, z))
  const y = cross(z, x)
  const result = new Float32Array(16)
  result[0] = x[0]
  result[1] = y[0]
  result[2] = z[0]
  result[4] = x[1]
  result[5] = y[1]
  result[6] = z[1]
  result[8] = x[2]
  result[9] = y[2]
  result[10] = z[2]
  result[12] = -dot(x, eye)
  result[13] = -dot(y, eye)
  result[14] = -dot(z, eye)
  result[15] = 1
  return result
}

function multiply(left: Float32Array, right: Float32Array): Float32Array {
  const result = new Float32Array(16)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] =
        (left[row] ?? 0) * (right[column * 4] ?? 0) +
        (left[row + 4] ?? 0) * (right[column * 4 + 1] ?? 0) +
        (left[row + 8] ?? 0) * (right[column * 4 + 2] ?? 0) +
        (left[row + 12] ?? 0) * (right[column * 4 + 3] ?? 0)
    }
  }
  return result
}

function normalize(vector: Point): Point {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function cross(left: Point, right: Point): Point {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function dot(left: Point, right: Point): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function colorToCss(color: Color): string {
  return `rgb(${String(Math.round(color[0] * 255))}, ${String(Math.round(color[1] * 255))}, ${String(Math.round(color[2] * 255))})`
}

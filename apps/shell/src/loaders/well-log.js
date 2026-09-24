/* <well-log-loader> — themable via CSS custom properties on the element or any ancestor:
   --well-log-bg       background            (default #0a0908)
   --well-log-ink      curves, ticks, text   (default #ece4d8)
   --well-log-accent   bit, resistivity, cursor (default #f2a33a)
   --well-log-speed    playback multiplier   (default 1)
   --well-log-font     readout font family   (default 'JetBrains Mono', monospace)
   --well-log-vignette edge darkening 0–1    (default .6)
   --well-log-texture  strength of the banded texture 0–1 (default 1)
   The `paused` attribute stops the log where it stands, as a speed of 0 does.

   The shell's build emits this file on its own and index.html loads it when the deployment chose it
   (SHELL_LOADER); the loader's styles set each property from a Tecton token. It draws in a worker through an
   OffscreenCanvas where the browser has one, so the animation keeps its frame rate while the page's
   own scripts load and boot on the main thread; elsewhere it draws on the main thread as before.
   On a light background the bit's glow is drawn normally, because additive blending turns it white.
*/
;(() => {
  if (customElements.get('well-log-loader')) return

  /**
   * Everything that draws, self-contained so its source can run in a worker: it takes messages
   * (`init`, `size`, `theme`, `state`, `stop`) and runs its own frame loop.
   */
  function engine(scope) {
    const n = d =>
      Math.sin(d * 0.05) * 0.5 + Math.sin(d * 0.13 + 1.3) * 0.3 + Math.sin(d * 0.41 + 0.2) * 0.2
    const frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : cb => setTimeout(() => cb(performance.now()), 16)
    const layer = (w, h) => {
      if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      return c
    }
    let cv = null
    let w = 0
    let h = 0
    let dpr = 1
    let th = null
    let T = 0
    let visible = true
    let reduce = false
    let running = false
    let last = 0
    let sprite = null
    let vignette = null

    const glowSprite = () => {
      if (sprite) return sprite
      sprite = layer(64, 64)
      const x = sprite.getContext('2d')
      const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32)
      gr.addColorStop(0, `rgba(${th.A},1)`)
      gr.addColorStop(0.22, `rgba(${th.A},.5)`)
      gr.addColorStop(1, `rgba(${th.A},0)`)
      x.fillStyle = gr
      x.fillRect(0, 0, 64, 64)
      return sprite
    }
    // The vignette depends only on the size and the theme, so it is drawn once and blitted.
    const vignetteLayer = () => {
      if (vignette || !(th.vig > 0)) return vignette
      vignette = layer(Math.round(w * dpr), Math.round(h * dpr))
      const c = vignette.getContext('2d')
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      const cx = w / 2
      const g = c.createRadialGradient(
        cx,
        h / 2,
        Math.min(w, h) * 0.35,
        cx,
        h / 2,
        Math.hypot(w, h) * 0.6,
      )
      g.addColorStop(0, `rgba(${th.B},0)`)
      g.addColorStop(1, `rgba(${th.B},${th.vig})`)
      c.fillStyle = g
      c.fillRect(0, 0, w, h)
      return vignette
    }

    const draw = () => {
      if (!cv || !th || !w || !h) return
      const W = Math.round(w * dpr)
      const H = Math.round(h * dpr)
      if (cv.width !== W || cv.height !== H) {
        cv.width = W
        cv.height = H
      }
      const c = cv.getContext('2d')
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.globalCompositeOperation = 'source-over'
      c.setLineDash([])
      const { A, I, B } = th
      const t = T
      const s = Math.min(w, h)
      const cx = w / 2
      const cy = h * 0.56
      const D = 1800 + t * 55
      const k = s / 180
      const F = th.font
      c.fillStyle = `rgb(${B})`
      c.fillRect(0, 0, w, h)
      if (th.texture > 0) {
        for (let y = 0; y < h; y += 3) {
          const v = (n((D + (y - cy) / k) * 0.7) + 1) / 2
          c.fillStyle = `rgba(${I},${(0.015 + v * 0.05) * th.texture})`
          c.fillRect(0, y, w, 3)
        }
      }
      const tL = w * 0.1
      const tW = w * 0.24
      const tR = w * 0.66
      c.strokeStyle = `rgba(${I},.1)`
      c.lineWidth = 1
      ;[tL, tL + tW, tR, tR + tW].forEach(x => {
        c.beginPath()
        c.moveTo(x, 0)
        c.lineTo(x, h)
        c.stroke()
      })
      c.strokeStyle = `rgba(${I},.75)`
      c.lineWidth = 1.2
      c.beginPath()
      for (let y = 0; y <= cy; y += 2) {
        const x = tL + (n(D + (y - cy) / k) * 0.5 + 0.5) * tW
        y ? c.lineTo(x, y) : c.moveTo(x, y)
      }
      c.stroke()
      c.strokeStyle = `rgb(${A})`
      c.beginPath()
      for (let y = 0; y <= cy; y += 2) {
        const x = tR + Math.pow(n((D + (y - cy) / k) * 1.7 + 40) * 0.5 + 0.5, 2) * tW
        y ? c.lineTo(x, y) : c.moveTo(x, y)
      }
      c.stroke()
      c.fillStyle = `rgba(${B},.55)`
      c.fillRect(cx - s * 0.014, 0, s * 0.028, cy)
      c.strokeStyle = `rgba(${I},.45)`
      c.beginPath()
      c.moveTo(cx, 0)
      c.lineTo(cx, cy)
      c.stroke()
      c.fillStyle = `rgba(${I},.4)`
      c.font = `400 ${Math.round(s * 0.022)}px ${F}`
      c.textAlign = 'right'
      c.textBaseline = 'middle'
      for (let m = Math.ceil((D - cy / k) / 10) * 10; m <= D + (h - cy) / k; m += 10) {
        const y = cy + (m - D) * k
        const big = m % 50 === 0
        c.fillRect(cx - s * 0.03 - (big ? s * 0.02 : s * 0.01), y, big ? s * 0.02 : s * 0.01, 1)
        if (big) c.fillText(String(m), cx - s * 0.06, y)
      }
      c.globalCompositeOperation = th.dark ? 'lighter' : 'source-over'
      c.globalAlpha = th.dark ? 0.7 : 0.28
      const r = s * 0.14
      c.drawImage(glowSprite(), cx - r, cy - r, r * 2, r * 2)
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'
      c.strokeStyle = `rgba(${A},.5)`
      c.setLineDash([2, 4])
      c.beginPath()
      c.moveTo(tL, cy)
      c.lineTo(tR + tW, cy)
      c.stroke()
      c.setLineDash([])
      c.fillStyle = `rgb(${A})`
      c.save()
      c.translate(cx, cy)
      c.rotate(Math.PI / 4)
      c.fillRect(-4, -4, 8, 8)
      c.restore()
      c.textAlign = 'left'
      c.fillStyle = `rgb(${I})`
      c.font = `500 ${Math.round(s * 0.03)}px ${F}`
      c.fillText(`${Math.floor(D).toLocaleString('en-US')} m`, cx + s * 0.04, cy - s * 0.03)
      c.fillStyle = `rgba(${I},.5)`
      c.font = `400 ${Math.round(s * 0.02)}px ${F}`
      c.fillText('GR', tL + 6, h * 0.14)
      c.fillText('RES', tR + 6, h * 0.14)
      const v = vignetteLayer()
      if (v) {
        c.setTransform(1, 0, 0, 1, 0, 0)
        c.drawImage(v, 0, 0)
      }
    }

    const tick = now => {
      if (!running) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (visible) {
        T += dt * th.speed * (reduce ? 0.25 : 1)
        draw()
      }
      frame(tick)
    }

    scope.onmessage = ({ data }) => {
      switch (data.type) {
        case 'init':
          cv = data.canvas
          break
        case 'size':
          ;({ w, h, dpr } = data)
          vignette = null
          break
        case 'theme':
          th = data.theme
          sprite = null
          vignette = null
          break
        case 'state':
          visible = data.visible
          reduce = data.reduce
          break
        case 'stop':
          running = false
          return
      }
      // Drawn at once, so the first frame never waits for the loop.
      draw()
      if (!running && cv && th) {
        running = true
        last = performance.now()
        frame(tick)
      }
    }
  }

  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  probe.canvas.width = probe.canvas.height = 1
  const toRgb = (v, fb) => {
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = fb
    probe.fillStyle = (v || '').trim() || fb
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return `${d[0]},${d[1]},${d[2]}`
  }

  /** A worker drawing through an OffscreenCanvas, or null where the browser has neither. */
  function startWorker(canvas) {
    if (typeof Worker !== 'function' || typeof canvas.transferControlToOffscreen !== 'function') {
      return null
    }
    try {
      const url = URL.createObjectURL(
        new Blob([`(${engine.toString()})(self)`], { type: 'text/javascript' }),
      )
      const worker = new Worker(url)
      const offscreen = canvas.transferControlToOffscreen()
      worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen])
      // The worker has fetched its script by the time it answers anything; revoking later is safe.
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      return worker
    } catch {
      return null
    }
  }

  class WellLogLoader extends HTMLElement {
    static observedAttributes = ['paused']

    constructor() {
      super()
      const r = this.attachShadow({ mode: 'open' })
      r.innerHTML = `<style>:host{display:block;position:relative;overflow:hidden;background:var(--well-log-bg,#0a0908);min-height:120px}canvas{position:absolute;inset:0;width:100%;height:100%;display:block}</style><canvas part="canvas" role="img" aria-label="Loading"></canvas>`
      this.cv = r.querySelector('canvas')
      this.vis = true
    }
    connectedCallback() {
      this.worker = startWorker(this.cv)
      if (this.worker) {
        this.send = data => this.worker.postMessage(data)
      } else {
        const scope = {}
        engine(scope)
        this.send = data => scope.onmessage({ data })
        this.send({ type: 'init', canvas: this.cv })
      }
      this.reduce = matchMedia('(prefers-reduced-motion: reduce)')
      this.sendState = () =>
        this.send({ type: 'state', visible: this.vis, reduce: this.reduce.matches })
      this.reduce.addEventListener('change', this.sendState)
      this.readTheme()
      this.sendSize()
      this.sendState()
      this.ro = new ResizeObserver(() => this.sendSize())
      this.ro.observe(this)
      this.io = new IntersectionObserver(es =>
        es.forEach(e => {
          this.vis = e.isIntersecting
          this.sendState()
        }),
      )
      this.io.observe(this)
      // The theme can change under it (the page's stylesheet arriving, a mode switch, an error
      // stopping it), so it is read again on a timer; nothing is sent unless it changed.
      this.poll = setInterval(() => this.readTheme(), 250)
    }
    attributeChangedCallback() {
      if (this.send) this.readTheme()
    }
    disconnectedCallback() {
      clearInterval(this.poll)
      this.ro && this.ro.disconnect()
      this.io && this.io.disconnect()
      this.reduce && this.reduce.removeEventListener('change', this.sendState)
      if (this.worker) this.worker.terminate()
      else this.send && this.send({ type: 'stop' })
    }
    sendSize() {
      const w = this.clientWidth
      const h = this.clientHeight
      const dpr = Math.min(2, devicePixelRatio || 1)
      this.send({ type: 'size', w, h, dpr })
    }
    readTheme() {
      const cs = getComputedStyle(this)
      const g = k => cs.getPropertyValue(k).trim()
      const key = [
        '--well-log-bg',
        '--well-log-ink',
        '--well-log-accent',
        '--well-log-speed',
        '--well-log-font',
        '--well-log-vignette',
        '--well-log-texture',
      ]
        .map(g)
        .concat(this.hasAttribute('paused'))
        .join('|')
      if (key === this.key) return
      this.key = key
      const B = toRgb(g('--well-log-bg'), '#0a0908')
      const [r, gr, b] = B.split(',').map(Number)
      const sp = parseFloat(g('--well-log-speed'))
      const vg = parseFloat(g('--well-log-vignette'))
      const tx = parseFloat(g('--well-log-texture'))
      this.send({
        type: 'theme',
        theme: {
          B,
          I: toRgb(g('--well-log-ink'), '#ece4d8'),
          A: toRgb(g('--well-log-accent'), '#f2a33a'),
          speed: this.hasAttribute('paused') ? 0 : isFinite(sp) ? sp : 1,
          vig: isFinite(vg) ? vg : 0.6,
          texture: isFinite(tx) ? tx : 1,
          font: g('--well-log-font') || "'JetBrains Mono', ui-monospace, monospace",
          dark: r * 0.299 + gr * 0.587 + b * 0.114 < 128,
        },
      })
    }
  }
  customElements.define('well-log-loader', WellLogLoader)
})()

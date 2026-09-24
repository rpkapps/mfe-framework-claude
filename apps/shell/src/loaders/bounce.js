/* <bounce-loader> — the logo as a glossy ball, bouncing on its shadow with squash and stretch. Themable via CSS
   custom properties on the element or any ancestor:
   --bounce-background      the backdrop: a colour, gradient, image or transparent (default #111217)
   --bounce-accent          the logo's disc and its shadow   (default #e50035)
   --bounce-mark            the mark on the disc             (default #fff)
   --bounce-shadow-opacity  the shadow's strength when the logo lands, 0–1 (default .26)
   --bounce-size            the logo's width and height      (default 88px)
   --bounce-floor           how far down the box the logo lands (default 50% + .84 × its size)
   --bounce-speed           playback multiplier              (default 1)

   The `paused` attribute stops the bounce where it stands, and reduced motion rests the logo on
   the floor. It draws in a worker through an OffscreenCanvas where the browser has one, so the
   page loading and booting on the main thread never makes it stutter; elsewhere it draws on the
   main thread. The backdrop is CSS, behind a transparent canvas.

   The shell's build minifies this into index.html, which runs it when the deployment chose it
   (SHELL_LOADER); the loader's styles set each property from a Tecton token.
*/
;(() => {
  if (customElements.get('bounce-loader')) return

  /**
   * Everything that draws, self-contained so its source can run in a worker: it takes messages
   * (`init`, `size`, `theme`, `state`, `stop`) and runs its own frame loop.
   */
  function engine(scope) {
    const PERIOD = 0.96 // Seconds per bounce at a speed of 1.
    const frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : cb => setTimeout(() => cb(performance.now()), 16)

    /* CSS's cubic-bezier() timing function: solves x(s) = t for s, then returns y(s). */
    const bezier = (x1, y1, x2, y2) => {
      const at = (a, b, s) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
      return t => {
        let lo = 0
        let hi = 1
        let s = t
        for (let i = 0; i < 20; i++) {
          if (at(x1, x2, s) < t) lo = s
          else hi = s
          s = (lo + hi) / 2
        }
        return at(y1, y2, s)
      }
    }
    const EASE = bezier(0.25, 0.1, 0.25, 1)
    const EASE_OUT = bezier(0, 0, 0.58, 1)
    const EASE_IN = bezier(0.42, 0, 1, 1)
    /** Keyframes as [offset, value, easing to the next], read at a progress through the cycle. */
    const track = keys => p => {
      let i = 0
      while (i < keys.length - 2 && p > keys[i + 1][0]) i++
      const [o0, v0, ease] = keys[i]
      const [o1, v1] = keys[i + 1]
      return v0 + (v1 - v0) * ease((p - o0) / (o1 - o0))
    }
    // The keyframes of the CSS original, as fractions of one cycle.
    const lift = track([
      [0, 0, bezier(0.23, 0.05, 0.27, 1)],
      [0.48, 0.64, bezier(0.65, 0, 0.85, 0.48)],
      [1, 0],
    ])
    const scaleX = track([
      [0, 1.17, EASE],
      [0.16, 0.92, EASE],
      [0.48, 1.025, EASE],
      [0.82, 0.94, EASE],
      [1, 1.17],
    ])
    const scaleY = track([
      [0, 0.83, EASE],
      [0.16, 1.08, EASE],
      [0.48, 0.975, EASE],
      [0.82, 1.06, EASE],
      [1, 0.83],
    ])
    const landed = track([
      [0, 1, EASE_OUT],
      [0.48, 0, EASE_IN],
      [1, 1],
    ])

    // The mark: an upright H with straight, parallel edges, slanted by a fifth of its height.
    const MARK =
      'M86 239L104.6 146Q110.6 116 140.6 116L174.6 116L164 169L174 169L184.6 116L362.6 116L360 129L264 129Q250 129 247.2 143L233.2 213Q228 239 202 239L166 239L177 184L167 184L156 239Z'
    // The key light, up and to the left of the viewer, and the half-vector of its highlight.
    const unit = v => v.map(x => x / Math.hypot(...v))
    const LIGHT = unit([-0.45, -0.6, 0.66])
    const HALF = unit([LIGHT[0], LIGHT[1], LIGHT[2] + 1])
    const BULGE = 0.4 // How far the logo wraps round the ball, 0–1.
    const layer = (lw, lh) => {
      if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(lw, lh)
      const l = document.createElement('canvas')
      l.width = lw
      l.height = lh
      return l
    }

    /**
     * The logo as a ball, lit per pixel and drawn once per size and colour, then only scaled as
     * it squashes. The flat logo is read from a canvas at twice the ball's resolution, wrapped a
     * little round the sphere, and each pixel averages nine samples, so the edges stay smooth.
     */
    let ballSprite = null
    let ballKey = ''
    const ball = () => {
      // Room for the stretch, so the ball is never drawn larger than it was rendered.
      const px = Math.ceil(th.size * dpr * 1.2)
      const key = `${px}|${th.accent}|${th.mark}`
      if (ballSprite && key === ballKey) return ballSprite
      ballKey = key

      const tw = px * 2
      const flat = layer(tw, tw)
      const f = flat.getContext('2d', { willReadFrequently: true })
      f.fillStyle = `rgb(${th.accent})`
      f.fillRect(0, 0, tw, tw)
      f.scale(tw / 340, tw / 340)
      f.fillStyle = `rgb(${th.mark})`
      f.fill(new Path2D(MARK))
      const tex = f.getImageData(0, 0, tw, tw).data

      ballSprite = layer(px, px)
      const b = ballSprite.getContext('2d')
      const img = b.createImageData(px, px)
      const out = img.data
      const R = (px * 164) / 340
      const TR = (tw * 164) / 340
      const C = px / 2
      const TC = tw / 2
      for (let j = 0; j < px; j++) {
        for (let i = 0; i < px; i++) {
          let r = 0
          let g = 0
          let bl = 0
          let n = 0
          for (let sj = 0; sj < 3; sj++) {
            for (let si = 0; si < 3; si++) {
              const x = (i + (si + 0.5) / 3 - C) / R
              const y = (j + (sj + 0.5) / 3 - C) / R
              const d2 = x * x + y * y
              if (d2 >= 1) continue
              const z = Math.sqrt(1 - d2)
              const d = Math.sqrt(d2)
              const wrap = d > 1e-6 ? (d + BULGE * ((2 / Math.PI) * Math.asin(d) - d)) / d : 1
              const tx = Math.min(tw - 1, Math.max(0, Math.round(TC + x * wrap * TR)))
              const ty = Math.min(tw - 1, Math.max(0, Math.round(TC + y * wrap * TR)))
              const t = (ty * tw + tx) * 4
              const diffuse = Math.max(0, x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2])
              const facing = Math.max(0, x * HALF[0] + y * HALF[1] + z * HALF[2])
              // Ambient and key light, darkened towards the rim, with light thrown back up from the
              // floor on the lower edge; then a sharp highlight and a soft sheen.
              const lit =
                (0.42 + 0.7 * diffuse) * (0.78 + 0.22 * z) + 0.35 * Math.max(0, y) * (1 - z) ** 2
              const shine = 255 * (0.7 * facing ** 90 + 0.1 * facing ** 12)
              r += tex[t] * lit + shine
              g += tex[t + 1] * lit + shine
              bl += tex[t + 2] * lit + shine
              n++
            }
          }
          if (n === 0) continue
          const o = (j * px + i) * 4
          out[o] = r / n
          out[o + 1] = g / n
          out[o + 2] = bl / n
          out[o + 3] = (255 * n) / 9
        }
      }
      b.putImageData(img, 0, 0)
      return ballSprite
    }

    let cv = null
    let w = 0
    let h = 0
    let dpr = 1
    let th = null
    let T = 0
    let last = 0
    let visible = true
    let reduce = false
    let paused = false
    let running = false

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
      c.clearRect(0, 0, w, h)
      const size = th.size
      const cx = w / 2
      // Reduced motion rests the logo on the floor, square, over its full shadow.
      const p = reduce ? null : ((((T * th.speed) / PERIOD) % 1) + 1) % 1
      const down = p === null ? 1 : landed(p)

      // The shadow: a 9px-high ellipse blurred by 5px, drawn as a soft radial falloff.
      const rx = size * 0.47 * (0.42 + 0.58 * down) + 5
      const ry = 9.5
      c.save()
      c.globalAlpha = th.shadow * (0.33 + 0.67 * down)
      c.translate(cx, th.floor + 10.5)
      c.scale(rx, ry)
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 1)
      g.addColorStop(0, `rgba(${th.accent},.75)`)
      g.addColorStop(0.45, `rgba(${th.accent},.45)`)
      g.addColorStop(1, `rgba(${th.accent},0)`)
      c.fillStyle = g
      c.beginPath()
      c.arc(0, 0, 1, 0, Math.PI * 2)
      c.fill()
      c.restore()

      // The logo, squashed and stretched about the middle of its base.
      c.save()
      c.translate(cx, th.floor - (p === null ? 0 : lift(p) * size))
      if (p !== null) c.scale(scaleX(p), scaleY(p))
      c.imageSmoothingQuality = 'high'
      c.drawImage(ball(), -size / 2, -size, size, size)
      c.restore()
    }

    const loop = now => {
      if (!running) return
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      T += dt
      draw()
      frame(loop)
    }
    const sync = () => {
      const run = visible && !reduce && !paused && !!cv
      if (run && !running) {
        running = true
        last = 0
        frame(loop)
      } else if (!run) {
        running = false
        draw()
      }
    }

    scope.onmessage = ({ data }) => {
      if (data.type === 'init') {
        cv = data.canvas
      } else if (data.type === 'size') {
        w = data.w
        h = data.h
        dpr = data.dpr
        draw()
      } else if (data.type === 'theme') {
        th = data.theme
        draw()
      } else if (data.type === 'state') {
        visible = data.visible
        reduce = data.reduce
        paused = data.paused
      } else if (data.type === 'stop') {
        visible = false
      }
      sync()
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

  // The floor and the size are CSS lengths, so the page's layout resolves them: two empty boxes
  // are placed by them, and their positions are read back in pixels.
  const STYLE = `:host{display:block;position:relative;overflow:hidden;min-height:120px;background:var(--bounce-background,#111217)}
canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.floor,.size{position:absolute;left:0;height:0;visibility:hidden}
.size{top:0;width:var(--bounce-size,88px)}
.floor{top:var(--bounce-floor,calc(50% + var(--bounce-size,88px) * .84))}`

  class BounceLoader extends HTMLElement {
    static observedAttributes = ['paused']

    constructor() {
      super()
      const root = this.attachShadow({ mode: 'open' })
      root.innerHTML = `<style>${STYLE}</style><canvas part="canvas" role="img" aria-label="Loading"></canvas><div class="size"></div><div class="floor"></div>`
      this.cv = root.querySelector('canvas')
      this.sizeProbe = root.querySelector('.size')
      this.floorProbe = root.querySelector('.floor')
      this.vis = true
    }

    connectedCallback() {
      // A canvas that has handed its drawing to a worker cannot hand it over again.
      if (this.started) {
        const fresh = this.cv.cloneNode()
        this.cv.replaceWith(fresh)
        this.cv = fresh
      }
      this.started = true
      this.key = null
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
        this.send({
          type: 'state',
          visible: this.vis && !document.hidden,
          reduce: this.reduce.matches,
          paused: this.hasAttribute('paused'),
        })
      this.reduce.addEventListener('change', this.sendState)
      document.addEventListener('visibilitychange', this.sendState)
      this.sendSize()
      this.readTheme()
      this.sendState()
      this.ro = new ResizeObserver(() => {
        this.sendSize()
        this.readTheme()
      })
      this.ro.observe(this)
      this.io = new IntersectionObserver(entries =>
        entries.forEach(entry => {
          this.vis = entry.isIntersecting
          this.sendState()
        }),
      )
      this.io.observe(this)
      // The theme can change under it (the page's stylesheet arriving, a mode switch), so it is
      // read again on a timer; nothing is sent unless it changed.
      this.poll = setInterval(() => this.readTheme(), 250)
    }

    disconnectedCallback() {
      clearInterval(this.poll)
      this.ro && this.ro.disconnect()
      this.io && this.io.disconnect()
      this.reduce && this.reduce.removeEventListener('change', this.sendState)
      document.removeEventListener('visibilitychange', this.sendState)
      if (this.worker) this.worker.terminate()
      else this.send && this.send({ type: 'stop' })
      this.worker = null
      this.send = null
    }

    attributeChangedCallback() {
      if (this.send) this.sendState()
    }

    sendSize() {
      this.send({
        type: 'size',
        w: this.clientWidth,
        h: this.clientHeight,
        dpr: Math.min(2, devicePixelRatio || 1),
      })
    }

    readTheme() {
      const cs = getComputedStyle(this)
      const g = k => cs.getPropertyValue(k).trim()
      const size = this.sizeProbe.offsetWidth || 88
      const floor = this.floorProbe.offsetTop
      const shadow = parseFloat(g('--bounce-shadow-opacity'))
      const speed = parseFloat(g('--bounce-speed'))
      const theme = {
        accent: toRgb(g('--bounce-accent'), '#e50035'),
        mark: toRgb(g('--bounce-mark'), '#fff'),
        shadow: isFinite(shadow) ? shadow : 0.26,
        speed: isFinite(speed) && speed > 0 ? speed : 1,
        size,
        floor,
      }
      const key = JSON.stringify(theme)
      if (key === this.key) return
      this.key = key
      this.send({ type: 'theme', theme })
    }
  }
  customElements.define('bounce-loader', BounceLoader)
})()

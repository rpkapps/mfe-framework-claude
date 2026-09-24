/* The oil-and-gas loaders' kit: every scene in this directory is one draw function, handed to
   `kit.define(name, draw)`, which defines `<name>-loader`. The kit runs the scene in a worker
   through an OffscreenCanvas where the browser has one, so it keeps its frame rate while the page
   loads and boots on the main thread; elsewhere it draws on the main thread.

   A scene is `(c, w, h, t, S, dt, og) => void`: the 2D context, the box in CSS pixels, the time
   in seconds, a state object of its own, the step since the last frame, and the helpers below. It
   paints its whole box, starting with `og.bg(c, w, h)`, and takes its colours from og: `og.B` the
   background, `og.I` the ink, `og.A` the accent, as "r,g,b" strings. A surface that should sit
   just off the background, whichever the mode, is `og.tone(k, alpha)`: a fraction k of the way
   from the background to the ink, or past the background, away from the ink, for a negative k.

   Themable via CSS custom properties on the element or any ancestor:
   --og-background  the backdrop              (default #0a0908)
   --og-ink         lines, labels and marks   (default #ece4d8)
   --og-accent      the accent                (default #f2a33a)
   --og-vignette    the colour the edges darken to (default rgba(0,0,0,.7))
   --og-font        labels' font family       (default a system monospace)
   --og-speed       playback multiplier       (default 1)
   --og-inset-bottom  room left below the scene, where the page puts words of its own (default 0);
                    the scene fades out over the last 48px above it, so no scene ends in an edge

   On a light background additive blending turns glows white, so there a scene's `lighter` and
   `screen` draw normally instead. The `paused` attribute stops the scene where it stands, and
   reduced motion draws one still frame. The mascots follow the pointer.

   The shell's build inlines this once, before the one scene the deployment chose (SHELL_LOADER).
*/
const kit = (() => {
  /**
   * Everything that draws, self-contained so its source can run in a worker together with the
   * scene's: it takes messages (`init`, `size`, `theme`, `state`, `pointer`, `stop`).
   */
  function engine(scope, draw) {
    const frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : cb => setTimeout(() => cb(performance.now()), 16)
    const layer = (lw, lh) => {
      if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(lw, lh)
      const l = document.createElement('canvas')
      l.width = lw
      l.height = lh
      return l
    }

    const og = {
      A: '242,163,58',
      I: '236,228,216',
      B: '10,9,8',
      light: false,
      font: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      /** A canvas of its own to draw into, in a worker or on the page alike. */
      layer,
      tone(k, a = 1) {
        const b = this._b
        const i = this._i
        const at = j => Math.round(Math.min(255, Math.max(0, b[j] + (i[j] - b[j]) * k)))
        return `rgba(${at(0)},${at(1)},${at(2)},${a})`
      },
      _b: [10, 9, 8],
      _i: [236, 228, 216],
      _spr: {},
      /** A soft round glow of one colour, drawn once and scaled. */
      spr(rgb) {
        if (this._spr[rgb]) return this._spr[rgb]
        const s = layer(64, 64)
        const x = s.getContext('2d')
        const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
        g.addColorStop(0, `rgba(${rgb},1)`)
        g.addColorStop(0.22, `rgba(${rgb},.5)`)
        g.addColorStop(1, `rgba(${rgb},0)`)
        x.fillStyle = g
        x.fillRect(0, 0, 64, 64)
        return (this._spr[rgb] = s)
      },
      glow(c, x, y, r, rgb, a) {
        if (a <= 0) return
        c.globalAlpha = Math.min(1, a)
        c.drawImage(this.spr(rgb), x - r, y - r, r * 2, r * 2)
        c.globalAlpha = 1
      },
      bg(c, w, h) {
        c.globalCompositeOperation = 'source-over'
        c.fillStyle = `rgb(${this.B})`
        c.fillRect(0, 0, w, h)
      },
      /** A seeded random number generator, for layouts that must not change between frames. */
      rng(seed) {
        return () => {
          seed |= 0
          seed = (seed + 0x6d2b79f5) | 0
          let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
      },
      spring(S, tx, ty, dt, k, d, w, h) {
        if (S.x == null) {
          S.x = w / 2
          S.y = h / 2
          S.vx = S.vy = 0
        }
        const n = Math.max(1, Math.ceil(dt / 0.008))
        const hh = dt / n
        for (let i = 0; i < n; i++) {
          S.vx += ((tx - S.x) * k - S.vx * d) * hh
          S.vy += ((ty - S.y) * k - S.vy * d) * hh
          S.x += S.vx * hh
          S.y += S.vy * hh
        }
      },
      /** Where a mascot heads: the pointer when it is over the box, a wander otherwise. */
      mt(S, w, h, t, ox, oy) {
        return S.m
          ? [S.m[0] + ox, S.m[1] + oy]
          : [w / 2 + Math.sin(t * 0.6) * w * 0.2, h / 2 + Math.sin(t * 0.9) * h * 0.1]
      },
      /** Which way a mascot's eyes look, from a point on its face. */
      look(S, fx, fy, w, h, t) {
        const [tx, ty] = S.m || [
          w / 2 + Math.sin(t * 0.6 + 1.2) * w * 0.3,
          h * 0.3 + Math.sin(t * 0.4) * h * 0.1,
        ]
        const dx = tx - fx
        const dy = ty - fy
        const d = Math.hypot(dx, dy) || 1
        const k = Math.min(1, d / (Math.min(w, h) * 0.12))
        return [(dx / d) * k, (dy / d) * k]
      },
      blink(t, seed) {
        const p = (t + seed) % 3.7
        return p < 0.14 ? Math.sin((p / 0.14) * Math.PI) : 0
      },
      eye(c, x, y, r, lx, ly, bl) {
        c.save()
        c.translate(x, y)
        c.scale(1, Math.max(0.08, 1 - bl))
        c.fillStyle = '#f4efe6'
        c.beginPath()
        c.arc(0, 0, r, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = '#0a0807'
        c.beginPath()
        c.arc(lx * r * 0.42, ly * r * 0.42, r * 0.55, 0, Math.PI * 2)
        c.fill()
        c.fillStyle = 'rgba(255,255,255,.9)'
        c.beginPath()
        c.arc(lx * r * 0.42 - r * 0.18, ly * r * 0.42 - r * 0.2, r * 0.17, 0, Math.PI * 2)
        c.fill()
        c.restore()
      },
      /** A camera for the wireframe scenes: turn `ry`, tilt `tl`, and a perspective of `d`. */
      cam3(cx, cy, sc, ry, tl, d = 7) {
        const cr = Math.cos(ry)
        const sr = Math.sin(ry)
        const ct = Math.cos(tl)
        const st = Math.sin(tl)
        return ([x, y, z]) => {
          const X = x * cr - z * sr
          let Z = x * sr + z * cr
          const Y = y * ct - Z * st
          Z = y * st + Z * ct
          const k = d / (d + Z)
          return [cx + X * sc * k, cy - Y * sc * k, Z, k]
        }
      },
    }

    let cv = null
    let ctx = null
    let w = 0
    let h = 0
    let dpr = 1
    let T = 0
    let last = 0
    let speed = 1
    let visible = true
    let reduce = false
    let paused = false
    let running = false
    let failed = false
    const S = {}

    /** The context, whose additive modes draw normally on a light background. */
    const context = () => {
      if (ctx) return ctx
      ctx = cv.getContext('2d')
      const mode = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(ctx),
        'globalCompositeOperation',
      )
      Object.defineProperty(ctx, 'globalCompositeOperation', {
        get() {
          return mode.get.call(this)
        },
        set(value) {
          mode.set.call(
            this,
            og.light && (value === 'lighter' || value === 'screen') ? 'source-over' : value,
          )
        },
      })
      return ctx
    }

    const render = dt => {
      if (!cv || !w || !h) return
      const W = Math.round(w * dpr)
      const Hh = Math.round(h * dpr)
      if (cv.width !== W || cv.height !== Hh) {
        cv.width = W
        cv.height = Hh
      }
      const c = context()
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'
      c.lineCap = 'butt'
      c.lineJoin = 'miter'
      c.setLineDash([])
      try {
        draw(c, w, h, T, S, dt, og)
      } catch (error) {
        if (!failed) console.error(error)
        failed = true
      }
    }

    const loop = now => {
      if (!running) return
      const dt = last ? Math.min(0.05, (now - last) / 1000) * speed : 0
      last = now
      T += dt
      render(dt)
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
        // A still frame, a few seconds in, so scenes that build up over time have something.
        if (reduce && T === 0) for (let i = 0; i < 120; i++) T += 1 / 60
        render(0)
      }
    }

    scope.onmessage = ({ data }) => {
      if (data.type === 'init') {
        cv = data.canvas
      } else if (data.type === 'size') {
        w = data.w
        h = data.h
        dpr = data.dpr
      } else if (data.type === 'theme') {
        Object.assign(og, data.theme)
        og._spr = {}
        og._b = og.B.split(',').map(Number)
        og._i = og.I.split(',').map(Number)
        speed = data.speed
      } else if (data.type === 'state') {
        visible = data.visible
        reduce = data.reduce
        paused = data.paused
      } else if (data.type === 'pointer') {
        S.m = data.m
        return
      } else if (data.type === 'stop') {
        visible = false
      }
      sync()
    }
  }

  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  probe.canvas.width = probe.canvas.height = 1
  const toRgb = (value, fallback) => {
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = fallback
    probe.fillStyle = (value || '').trim() || fallback
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return `${d[0]},${d[1]},${d[2]}`
  }

  /** A worker drawing through an OffscreenCanvas, or null where the browser has neither. */
  function startWorker(canvas, draw) {
    if (typeof Worker !== 'function' || typeof canvas.transferControlToOffscreen !== 'function') {
      return null
    }
    try {
      const url = URL.createObjectURL(
        new Blob([`(${engine.toString()})(self, ${draw.toString()})`], {
          type: 'text/javascript',
        }),
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

  const STYLE = `:host{display:block;position:relative;overflow:hidden;min-height:120px;background:var(--og-background,#0a0908)}
canvas{position:absolute;left:0;top:0;right:0;bottom:var(--og-inset-bottom,0px);display:block;width:100%;height:calc(100% - var(--og-inset-bottom,0px));
  -webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - min(48px,var(--og-inset-bottom,0px))),transparent);
  mask-image:linear-gradient(to bottom,#000 calc(100% - min(48px,var(--og-inset-bottom,0px))),transparent)}
.vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 50% 50%,transparent 55%,var(--og-vignette,rgba(0,0,0,.7)) 100%)}`

  class OilAndGasLoader extends HTMLElement {
    static observedAttributes = ['paused']

    constructor() {
      super()
      const root = this.attachShadow({ mode: 'open' })
      root.innerHTML = `<style>${STYLE}</style><canvas part="canvas" role="img" aria-label="Loading"></canvas><div class="vignette"></div>`
      this.cv = root.querySelector('canvas')
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
      const draw = this.constructor.draw
      this.worker = startWorker(this.cv, draw)
      if (this.worker) {
        this.send = data => this.worker.postMessage(data)
      } else {
        const scope = {}
        engine(scope, draw)
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
      this.onPointer = event => {
        const r = this.cv.getBoundingClientRect()
        const x = event.clientX - r.left
        const y = event.clientY - r.top
        const inside = x >= 0 && y >= 0 && x <= r.width && y <= r.height
        this.send({ type: 'pointer', m: event.type === 'pointerleave' || !inside ? null : [x, y] })
      }
      window.addEventListener('pointermove', this.onPointer, { passive: true })
      document.documentElement.addEventListener('pointerleave', this.onPointer)
      this.sendSize()
      this.readTheme()
      this.sendState()
      // The canvas, not the element: the inset can change its size while the element's stays.
      this.ro = new ResizeObserver(() => this.sendSize())
      this.ro.observe(this.cv)
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
      window.removeEventListener('pointermove', this.onPointer)
      document.documentElement.removeEventListener('pointerleave', this.onPointer)
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
        w: this.cv.clientWidth,
        h: this.cv.clientHeight,
        dpr: Math.min(2, devicePixelRatio || 1),
      })
    }

    readTheme() {
      const cs = getComputedStyle(this)
      const g = k => cs.getPropertyValue(k).trim()
      const B = toRgb(g('--og-background'), '#0a0908')
      const [r, gr, b] = B.split(',').map(Number)
      const speed = parseFloat(g('--og-speed'))
      const theme = {
        B,
        I: toRgb(g('--og-ink'), '#ece4d8'),
        A: toRgb(g('--og-accent'), '#f2a33a'),
        light: r * 0.299 + gr * 0.587 + b * 0.114 >= 128,
        font: g('--og-font') || 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }
      const key = JSON.stringify(theme) + speed
      if (key === this.key) return
      this.key = key
      this.send({ type: 'theme', theme, speed: isFinite(speed) && speed > 0 ? speed : 1 })
    }
  }

  return {
    /** Defines `<name>-loader`, drawing `draw`. */
    define(name, draw) {
      const tag = `${name}-loader`
      if (customElements.get(tag)) return
      customElements.define(
        tag,
        class extends OilAndGasLoader {
          static draw = draw
        },
      )
    },
  }
})()

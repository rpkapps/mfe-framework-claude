/* <well-log-loader> — themable via CSS custom properties on the element or any ancestor:
   (The shell inlines this into index.html at build time, so it paints before any script loads, and
   sets each property from a Tecton token in the loader's styles. One change from the original: on a
   light background the bit's glow is drawn normally, because additive blending turns it white.)
   --well-log-bg       background            (default #0a0908)
   --well-log-ink      curves, ticks, text   (default #ece4d8)
   --well-log-accent   bit, resistivity, cursor (default #f2a33a)
   --well-log-speed    playback multiplier   (default 1)
   --well-log-font     readout font family   (default 'JetBrains Mono', monospace)
   --well-log-vignette edge darkening 0–1    (default .6)
*/
;(() => {
  if (customElements.get('well-log-loader')) return
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
  const n = d =>
    Math.sin(d * 0.05) * 0.5 + Math.sin(d * 0.13 + 1.3) * 0.3 + Math.sin(d * 0.41 + 0.2) * 0.2

  class WellLogLoader extends HTMLElement {
    constructor() {
      super()
      const r = this.attachShadow({ mode: 'open' })
      r.innerHTML = `<style>:host{display:block;position:relative;overflow:hidden;background:var(--well-log-bg,#0a0908);min-height:120px}canvas{position:absolute;inset:0;width:100%;height:100%;display:block}</style><canvas part="canvas" role="img" aria-label="Loading"></canvas>`
      this.cv = r.querySelector('canvas')
      this.T = 0
      this.frame = 0
      this.vis = true
    }
    connectedCallback() {
      this.readTheme()
      this.io = new IntersectionObserver(es =>
        es.forEach(e => {
          this.vis = e.isIntersecting
        }),
      )
      this.io.observe(this)
      this.reduce = matchMedia('(prefers-reduced-motion: reduce)')
      let last = performance.now()
      const tick = now => {
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        if (this.frame++ % 20 === 0) this.readTheme()
        if (this.vis) {
          this.T += dt * this.speed * (this.reduce.matches ? 0.25 : 1)
          this.draw()
        }
        this.raf = requestAnimationFrame(tick)
      }
      this.raf = requestAnimationFrame(tick)
    }
    disconnectedCallback() {
      cancelAnimationFrame(this.raf)
      this.io && this.io.disconnect()
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
      ]
        .map(g)
        .join('|')
      if (key === this.key) return
      this.key = key
      this.B = toRgb(g('--well-log-bg'), '#0a0908')
      this.I = toRgb(g('--well-log-ink'), '#ece4d8')
      this.A = toRgb(g('--well-log-accent'), '#f2a33a')
      const [r, gr, b] = this.B.split(',').map(Number)
      this.dark = r * 0.299 + gr * 0.587 + b * 0.114 < 128
      const sp = parseFloat(g('--well-log-speed'))
      this.speed = isFinite(sp) ? sp : 1
      const vg = parseFloat(g('--well-log-vignette'))
      this.vig = isFinite(vg) ? vg : 0.6
      this.font = g('--well-log-font') || "'JetBrains Mono', ui-monospace, monospace"
      this.spr = null
    }
    glowSprite() {
      if (this.spr) return this.spr
      const c = document.createElement('canvas')
      c.width = c.height = 64
      const x = c.getContext('2d')
      const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32)
      gr.addColorStop(0, `rgba(${this.A},1)`)
      gr.addColorStop(0.22, `rgba(${this.A},.5)`)
      gr.addColorStop(1, `rgba(${this.A},0)`)
      x.fillStyle = gr
      x.fillRect(0, 0, 64, 64)
      return (this.spr = c)
    }
    draw() {
      const el = this.cv,
        w = el.clientWidth,
        h = el.clientHeight
      if (!w || !h) return
      const dpr = Math.min(2, devicePixelRatio || 1),
        W = Math.round(w * dpr),
        H = Math.round(h * dpr)
      if (el.width !== W || el.height !== H) {
        el.width = W
        el.height = H
      }
      const c = el.getContext('2d')
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.globalCompositeOperation = 'source-over'
      c.setLineDash([])
      const { A, I, B } = this,
        t = this.T,
        s = Math.min(w, h),
        cx = w / 2,
        cy = h * 0.56,
        D = 1800 + t * 55,
        k = s / 180,
        F = this.font
      c.fillStyle = `rgb(${B})`
      c.fillRect(0, 0, w, h)
      for (let y = 0; y < h; y += 3) {
        const v = (n((D + (y - cy) / k) * 0.7) + 1) / 2
        c.fillStyle = `rgba(${I},${0.015 + v * 0.05})`
        c.fillRect(0, y, w, 3)
      }
      const tL = w * 0.1,
        tW = w * 0.24,
        tR = w * 0.66
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
        const y = cy + (m - D) * k,
          big = m % 50 === 0
        c.fillRect(cx - s * 0.03 - (big ? s * 0.02 : s * 0.01), y, big ? s * 0.02 : s * 0.01, 1)
        if (big) c.fillText(String(m), cx - s * 0.06, y)
      }
      c.globalCompositeOperation = this.dark ? 'lighter' : 'source-over'
      c.globalAlpha = this.dark ? 0.7 : 0.45
      const r = s * 0.14
      c.drawImage(this.glowSprite(), cx - r, cy - r, r * 2, r * 2)
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
      if (this.vig > 0) {
        const g = c.createRadialGradient(
          cx,
          h / 2,
          Math.min(w, h) * 0.35,
          cx,
          h / 2,
          Math.hypot(w, h) * 0.6,
        )
        g.addColorStop(0, `rgba(${B},0)`)
        g.addColorStop(1, `rgba(${B},${this.vig})`)
        c.fillStyle = g
        c.fillRect(0, 0, w, h)
      }
    }
  }
  customElements.define('well-log-loader', WellLogLoader)
})()

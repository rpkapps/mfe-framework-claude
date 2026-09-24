/* The STRATUM loaders' kit: five procedural WebGL models (a pumpjack, a subsea valve tree, a
   pipeline cutaway, an offshore platform and a rock-core scanner) under a scan ring, with a frame
   and two callouts. Every scene in this directory hands `kit.define(name, build)` a builder, which
   gets the geometry helpers below and returns the scene's animation; `<name>-loader` draws it.

   The model is built and drawn in a worker through an OffscreenCanvas where the browser has one, so
   neither slows the page's own scripts; elsewhere it draws on the main thread, and a browser
   without WebGL gets a Canvas 2D wireframe. The frame and the callouts are the page's, in CSS.

   Themable via CSS custom properties on the element or any ancestor:
   --stratum-background     the whole backdrop: a colour, gradient, image or transparent
                            (default: the glow and the ambient pool over --stratum-bg)
   --stratum-bg             the backdrop's base colour           (default #090d0f)
   --stratum-glow           the light behind the model           (default #1a2327)
   --stratum-ambient        the warm pool under it               (default rgba(113,76,34,.12))
   --stratum-grid-color     the blueprint grid's lines           (default rgba(151,177,182,.045))
   --stratum-grid-opacity   the grid, 0–1                        (default .45)
   --stratum-grain-opacity  film grain, 0–1                      (default .025)
   --stratum-accent         the scan ring, its glow and the callouts' dots (default #e7aa64)
   --stratum-ring-color     the floor rings and the scale        (default #637c85)
   --stratum-line-color     the frame and the leaders            (default rgba(140,165,170,.27))
   --stratum-label-color    callout text                         (default #829496)
   --stratum-labels-opacity the frame and the callouts, 0–1      (default 1)
   --stratum-font           callout font family                  (default a system monospace)

   The `paused` attribute stops the animation where it stands. Drag to turn the model. Reduced
   motion stops the automatic turn and keeps the drag. These are conceptual visual models, not
   engineering drawings.

   The shell's build inlines this once, before the one scene the deployment chose (SHELL_LOADER).
*/
const kit = (() => {
  /**
   * Everything that builds and draws, self-contained so its source can run in a worker together
   * with the scene's builder: it takes messages (`init`, `size`, `theme`, `state`, `turn`, `stop`)
   * and posts the scene's callouts back once, as `meta`.
   */
  function engine(scope, build) {
    const TAU = Math.PI * 2
    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
    const mix = (a, b, t) => a + (b - a) * t
    const smooth = t => t * t * (3 - 2 * t)
    const v3 = {
      add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
      sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
      mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
      dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
      cross: (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ],
      norm: a => {
        const l = Math.hypot(...a) || 1
        return a.map(x => x / l)
      },
    }
    const M = {
      identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
      mul: (a, b) => {
        const c = new Float32Array(16)
        for (let j = 0; j < 4; j++)
          for (let i = 0; i < 4; i++)
            c[j * 4 + i] =
              a[i] * b[j * 4] +
              a[4 + i] * b[j * 4 + 1] +
              a[8 + i] * b[j * 4 + 2] +
              a[12 + i] * b[j * 4 + 3]
        return c
      },
      translate: (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]),
      rx: a => {
        const c = Math.cos(a),
          s = Math.sin(a)
        return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1])
      },
      ry: a => {
        const c = Math.cos(a),
          s = Math.sin(a)
        return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])
      },
      rz: a => {
        const c = Math.cos(a),
          s = Math.sin(a)
        return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
      },
      basisY: (d, p = [0, 0, 0]) => {
        const y = v3.norm(d)
        let x = v3.norm(v3.cross(Math.abs(y[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1], y))
        const z = v3.cross(x, y)
        return new Float32Array([...x, 0, ...y, 0, ...z, 0, ...p, 1])
      },
      point: (m, p) => [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      ],
      vector: (m, p) => [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
      ],
      perspective: (fov, aspect, near, far) => {
        const f = 1 / Math.tan(fov / 2),
          nf = 1 / (near - far)
        return new Float32Array([
          f / aspect,
          0,
          0,
          0,
          0,
          f,
          0,
          0,
          0,
          0,
          (far + near) * nf,
          -1,
          0,
          0,
          2 * far * near * nf,
          0,
        ])
      },
      lookAt: (eye, target, up) => {
        const z = v3.norm(v3.sub(eye, target)),
          x = v3.norm(v3.cross(up, z)),
          y = v3.cross(z, x)
        return new Float32Array([
          x[0],
          y[0],
          z[0],
          0,
          x[1],
          y[1],
          z[1],
          0,
          x[2],
          y[2],
          z[2],
          0,
          -v3.dot(x, eye),
          -v3.dot(y, eye),
          -v3.dot(z, eye),
          1,
        ])
      },
    }
    M.scale = (x, y = x, z = x) =>
      new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1])
    M.compose = (...m) => m.reduce((a, b) => M.mul(a, b), M.identity())
    M.normal = m => {
      const a = m[0],
        b = m[4],
        c = m[8],
        d = m[1],
        e = m[5],
        f = m[9],
        g = m[2],
        h = m[6],
        i = m[10]
      const A = e * i - f * h,
        B = f * g - d * i,
        C = d * h - e * g,
        det = a * A + b * B + c * C || 1
      return new Float32Array(
        [
          A,
          c * h - b * i,
          b * f - c * e,
          B,
          a * i - c * g,
          c * d - a * f,
          C,
          b * g - a * h,
          a * e - b * d,
        ].map(x => x / det),
      )
    }
    function triangulate(poly) {
      const ids = poly.map((_, i) => i),
        out = []
      const area = poly.reduce((s, a, i) => {
        const b = poly[(i + 1) % poly.length]
        return s + a[0] * b[1] - b[0] * a[1]
      }, 0)
      if (area < 0) ids.reverse()
      const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      let guard = poly.length * poly.length
      while (ids.length > 3 && guard-- > 0) {
        let found = false
        for (let k = 0; k < ids.length; k++) {
          const ia = ids[(k + ids.length - 1) % ids.length],
            ib = ids[k],
            ic = ids[(k + 1) % ids.length],
            a = poly[ia],
            b = poly[ib],
            c = poly[ic]
          if (cross(a, b, c) <= 1e-9) continue
          if (
            ids.some(
              j =>
                j !== ia &&
                j !== ib &&
                j !== ic &&
                cross(a, b, poly[j]) >= -1e-9 &&
                cross(b, c, poly[j]) >= -1e-9 &&
                cross(c, a, poly[j]) >= -1e-9,
            )
          )
            continue
          out.push([ia, ib, ic])
          ids.splice(k, 1)
          found = true
          break
        }
        if (!found) break
      }
      if (ids.length === 3) out.push(ids.slice())
      return out
    }
    class Geometry {
      constructor() {
        this.data = []
        this.edges = []
      }
      triangle(a, b, c, na, nb, nc, ao = 1) {
        for (const [p, n] of [
          [a, na],
          [b, nb],
          [c, nc],
        ])
          this.data.push(...p, ...n, ao)
      }
      flat(a, b, c, ao = 1) {
        const n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(c, a)))
        this.triangle(a, b, c, n, n, n, ao)
      }
      edge(a, b) {
        this.edges.push(...a, ...b)
      }
      lathe(profile, segments = 48, transform = M.identity(), ao = 1, phase = 0, sweep = TAU) {
        for (let j = 0; j < profile.length - 1; j++) {
          const [r0, y0] = profile[j],
            [r1, y1] = profile[j + 1],
            dy = y1 - y0,
            dr = r1 - r0
          for (let i = 0; i < segments; i++) {
            const a = (i / segments) * sweep + phase,
              b = ((i + 1) / segments) * sweep + phase
            const p = (r, y, t) => M.point(transform, [Math.cos(t) * r, y, Math.sin(t) * r])
            const n = t => v3.norm(M.vector(transform, [Math.cos(t) * dy, -dr, Math.sin(t) * dy]))
            const A = p(r0, y0, a),
              B = p(r0, y0, b),
              C = p(r1, y1, a),
              D = p(r1, y1, b),
              na = n(a),
              nb = n(b)
            this.triangle(A, C, B, na, na, nb, ao)
            this.triangle(B, C, D, nb, na, nb, ao)
            if (i % Math.max(1, Math.round(segments / 12)) === 0) this.edge(A, C)
            if (j % 2 === 0) this.edge(A, B)
          }
        }
      }
      cylinder(a, b, r, segments = 24, ao = 1, r2 = r) {
        const l = Math.hypot(...v3.sub(b, a))
        if (l < 1e-5) return
        this.lathe(
          [
            [0, 0],
            [r, 0],
            [r2, l],
            [0, l],
          ],
          segments,
          M.basisY(v3.sub(b, a), a),
          ao,
        )
      }
      tube(a, b, r, wall = 0.02, segments = 48) {
        const l = Math.hypot(...v3.sub(b, a))
        this.lathe(
          [
            [r - wall, 0],
            [r, 0],
            [r, l],
            [r - wall, l],
            [r - wall, 0],
          ],
          segments,
          M.basisY(v3.sub(b, a), a),
        )
      }
      torus(radius, tube, y = 0, transform = M.identity(), seg = 64, tubeSeg = 8, ao = 1) {
        const p = []
        for (let j = 0; j <= tubeSeg; j++) {
          const a = (j / tubeSeg) * TAU
          p.push([radius + Math.cos(a) * tube, y + Math.sin(a) * tube])
        }
        this.lathe(p, seg, transform, ao)
      }
      sphere(p, r, transform = M.identity(), seg = 20, rings = 12) {
        const prof = []
        for (let j = 0; j <= rings; j++) {
          const t = -Math.PI / 2 + (j / rings) * Math.PI
          prof.push([r * Math.cos(t), r * Math.sin(t)])
        }
        this.lathe(prof, seg, M.mul(transform, M.translate(...p)))
      }
      plate(shape, depth, transform = M.identity(), ao = 1, bevel = 0.06) {
        const center = shape.reduce(
          (a, b) => [a[0] + b[0] / shape.length, a[1] + b[1] / shape.length],
          [0, 0],
        )
        const at = (p, z, scale = 1) =>
          M.point(transform, [
            center[0] + (p[0] - center[0]) * scale,
            center[1] + (p[1] - center[1]) * scale,
            z,
          ])
        const b = clamp(bevel, 0, 0.2),
          s = 1 - b
        for (let i = 0; i < shape.length; i++) {
          const a = shape[i],
            q = shape[(i + 1) % shape.length],
            a0 = at(a, -depth * (0.5 - b)),
            b0 = at(q, -depth * (0.5 - b)),
            a1 = at(a, depth * (0.5 - b)),
            b1 = at(q, depth * (0.5 - b)),
            ai = at(a, depth * 0.5, s),
            bi = at(q, depth * 0.5, s),
            aj = at(a, -depth * 0.5, s),
            bj = at(q, -depth * 0.5, s)
          this.flat(a0, b0, a1, ao * 0.91)
          this.flat(a1, b0, b1, ao * 0.91)
          this.flat(a1, b1, ai, ao)
          this.flat(ai, b1, bi, ao)
          this.flat(b0, a0, bj, ao)
          this.flat(bj, a0, aj, ao)
          this.edge(ai, bi)
          this.edge(aj, bj)
          this.edge(a0, a1)
        }
        for (const [i, j, k] of triangulate(shape)) {
          this.flat(
            at(shape[i], depth * 0.5, s),
            at(shape[j], depth * 0.5, s),
            at(shape[k], depth * 0.5, s),
            ao,
          )
          this.flat(
            at(shape[k], -depth * 0.5, s),
            at(shape[j], -depth * 0.5, s),
            at(shape[i], -depth * 0.5, s),
            ao * 0.86,
          )
        }
      }
      box(p, size, transform = M.identity(), ao = 1, bevel = 0.045) {
        const [x, y, z] = size
        this.plate(
          [
            [-x / 2, -y / 2],
            [x / 2, -y / 2],
            [x / 2, y / 2],
            [-x / 2, y / 2],
          ],
          z,
          M.mul(transform, M.translate(...p)),
          ao,
          bevel,
        )
      }
      beam(a, b, w, d = w, transform = M.identity(), ao = 1) {
        const delta = v3.sub(b, a),
          l = Math.hypot(...delta)
        this.box([0, l / 2, 0], [w, l, d], M.mul(transform, M.basisY(delta, a)), ao)
      }
      path(points, r = 0.025, segments = 10) {
        const frames = points.map((p, i) => {
          const prev = points[Math.max(0, i - 1)],
            next = points[Math.min(points.length - 1, i + 1)]
          return M.basisY(v3.sub(next, prev), p)
        })
        for (let j = 0; j < points.length - 1; j++)
          for (let i = 0; i < segments; i++) {
            const a = (i / segments) * TAU,
              b = ((i + 1) / segments) * TAU
            const norm = (m, t) => v3.norm(M.vector(m, [Math.cos(t), 0, Math.sin(t)]))
            const p = (m, t) => M.point(m, [r * Math.cos(t), 0, r * Math.sin(t)])
            const A = p(frames[j], a),
              B = p(frames[j], b),
              C = p(frames[j + 1], a),
              D = p(frames[j + 1], b),
              na = norm(frames[j], a),
              nb = norm(frames[j], b),
              nc = norm(frames[j + 1], a),
              nd = norm(frames[j + 1], b)
            this.triangle(A, C, B, na, nc, nb)
            this.triangle(B, C, D, nb, nc, nd)
            if (i % 3 === 0) this.edge(A, C)
          }
      }
      sector(inner, outer, start, end, depth, transform = M.identity(), steps = 24) {
        const shape = []
        for (let i = 0; i <= steps; i++) {
          const a = mix(start, end, i / steps)
          shape.push([outer * Math.cos(a), outer * Math.sin(a)])
        }
        for (let i = steps; i >= 0; i--) {
          const a = mix(start, end, i / steps)
          shape.push([inner * Math.cos(a), inner * Math.sin(a)])
        }
        this.plate(shape, depth, transform, 1, 0.015)
      }
    }
    const materials = {
      steel: { color: [0.29, 0.345, 0.37], metal: 0.94, rough: 0.34 },
      silver: { color: [0.5, 0.56, 0.575], metal: 1, rough: 0.245 },
      dark: { color: [0.12, 0.16, 0.18], metal: 0.88, rough: 0.4 },
      black: { color: [0.055, 0.07, 0.078], metal: 0.7, rough: 0.43, ao: 0.85 },
      yellow: { color: [0.68, 0.405, 0.073], metal: 0.42, rough: 0.4 },
      brass: { color: [0.55, 0.37, 0.17], metal: 0.92, rough: 0.29 },
      rubber: { color: [0.025, 0.031, 0.033], metal: 0, rough: 0.85 },
      blue: { color: [0.075, 0.165, 0.21], metal: 0.55, rough: 0.36 },
      ceramic: { color: [0.43, 0.49, 0.48], metal: 0.22, rough: 0.49 },
      stripe: { color: [0.65, 0.43, 0.14], metal: 0.45, rough: 0.37 },
      oil: { color: [0.04, 0.026, 0.016], metal: 0.24, rough: 0.14, kind: 1 },
      scanSteel: {
        color: [0.29, 0.345, 0.37],
        metal: 0.94,
        rough: 0.34,
        kind: 5,
        transparent: true,
        depthWrite: true,
      },
      scanDark: {
        color: [0.12, 0.16, 0.18],
        metal: 0.88,
        rough: 0.4,
        kind: 5,
        transparent: true,
        depthWrite: true,
      },
      rock: {
        color: [0.42, 0.33, 0.25],
        metal: 0,
        rough: 0.87,
        kind: 2,
        transparent: true,
        depthWrite: true,
      },
      slice: { color: [0.43, 0.33, 0.24], metal: 0, rough: 0.87, kind: 4, band: 1 },
      fracture: { color: [0.034, 0.029, 0.024], metal: 0, rough: 0.94 },
      amber: { color: [0.95, 0.46, 0.095], metal: 0.3, rough: 0.25, emissive: 1.4 },
      channel: { color: [0.78, 0.32, 0.065], metal: 0.5, rough: 0.3, emissive: 1.1, band: 1 },
      led: { color: [0.35, 0.64, 0.7], metal: 0.2, rough: 0.26, emissive: 1.3 },
    }
    class Group {
      constructor(name, opts = {}) {
        this.name = name
        this.geometry = {}
        this.matrix = M.identity()
        this.opacity = 1
        Object.assign(this, opts)
      }
      mat(key) {
        if (!materials[key]) throw new Error('Unknown material: ' + key)
        return this.geometry[key] || (this.geometry[key] = new Geometry())
      }
    }
    function bolt(g, p, axis = [0, 1, 0], size = 0.045) {
      const tr = M.basisY(axis, p)
      g.mat('dark').lathe(
        [
          [0, 0],
          [size * 1.34, 0],
          [size * 1.34, 0.012],
          [0, 0.012],
        ],
        16,
        tr,
        0.82,
      )
      g.mat('silver').lathe(
        [
          [size, 0.011],
          [size, 0.048],
          [size * 0.84, 0.058],
          [0, 0.058],
        ],
        6,
        tr,
      )
    }
    function flange(g, p, axis, r = 0.4, length = 0.12, bolts = 8, hole = r * 0.64) {
      const tr = M.basisY(axis, p)
      g.mat('silver').lathe(
        [
          [hole, -length / 2],
          [r * 0.92, -length / 2],
          [r, -length * 0.32],
          [r, length * 0.32],
          [r * 0.94, length / 2],
          [hole, length / 2],
          [hole, -length / 2],
        ],
        48,
        tr,
      )
      g.mat('dark').lathe(
        [
          [r + 0.002, -0.012],
          [r + 0.002, 0.012],
        ],
        48,
        tr,
        0.8,
      )
      for (let i = 0; i < bolts; i++) {
        const a = (i / bolts) * TAU
        bolt(
          g,
          M.point(tr, [r * 0.81 * Math.cos(a), length * 0.5, r * 0.81 * Math.sin(a)]),
          axis,
          r * 0.075,
        )
      }
    }
    function wheel(g, p, axis, r = 0.35, mat = 'brass') {
      const tr = M.basisY(axis, p)
      g.mat(mat).torus(r, r * 0.075, 0, tr, 56, 8)
      g.mat('silver').lathe(
        [
          [0.09, -0.07],
          [0.09, 0.07],
          [0.06, 0.1],
          [0, 0.1],
        ],
        24,
        tr,
      )
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU
        g.mat(mat).cylinder(
          M.point(tr, [0, 0, 0]),
          M.point(tr, [r * Math.cos(a), 0, r * Math.sin(a)]),
          r * 0.045,
          10,
        )
      }
      bolt(g, M.point(tr, [0, 0.1, 0]), axis, r * 0.08)
    }
    function curve(points, steps = 10) {
      // Catmull–Rom path through the supplied waypoints.
      const out = []
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(i - 1, 0)],
          p1 = points[i],
          p2 = points[i + 1],
          p3 = points[Math.min(i + 2, points.length - 1)]
        for (let j = 0; j < steps; j++) {
          const t = j / steps,
            t2 = t * t,
            t3 = t2 * t
          out.push(
            p1.map(
              (x, k) =>
                0.5 *
                (2 * x +
                  (-p0[k] + p2[k]) * t +
                  (2 * p0[k] - 5 * x + 4 * p2[k] - p3[k]) * t2 +
                  (-p0[k] + 3 * x - 3 * p2[k] + p3[k]) * t3),
            ),
          )
        }
      }
      out.push(points[points.length - 1])
      return out
    }
    const vertexSource = `
attribute vec3 aPosition; attribute vec3 aNormal; attribute float aAO;
uniform mat4 uModel; uniform mat4 uPart; uniform mat4 uVP; uniform mat3 uNormal;
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal; varying vec3 vScene; varying float vAO;
void main(){vec4 p=uModel*vec4(aPosition,1.);vWorld=p.xyz;vNormal=uNormal*aNormal;vLocal=aPosition;vScene=(uPart*vec4(aPosition,1.)).xyz;vAO=aAO;gl_Position=uVP*p;}`
    const fragmentSource = `
precision highp float;
varying vec3 vWorld; varying vec3 vNormal; varying vec3 vLocal; varying vec3 vScene; varying float vAO;
uniform vec3 uCamera; uniform vec3 uColor; uniform vec3 uAccent; uniform vec3 uScanAxis;
uniform float uMetal; uniform float uRough; uniform float uAO; uniform float uScan; uniform float uInspect; uniform float uTime; uniform float uKind; uniform float uOpacity; uniform float uEmissive; uniform float uBand; uniform float uProgress;
const float PI=3.14159265359;
float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float a=mix(hash(i),hash(i+vec3(1,0,0)),f.x),b=mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),c=mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),d=mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x);return mix(mix(a,b,f.y),mix(c,d,f.y),f.z);}
vec3 fresnel(float hv,vec3 f0){return f0+(1.-f0)*pow(clamp(1.-hv,0.,1.),5.);}
vec3 light(vec3 n,vec3 v,vec3 l,vec3 radiance,vec3 base,float rough,vec3 f0,float metal){vec3 h=normalize(v+l);float nv=max(dot(n,v),.001),nl=max(dot(n,l),0.),nh=max(dot(n,h),0.),hv=max(dot(h,v),0.);float a=rough*rough,a2=a*a,den=nh*nh*(a2-1.)+1.,D=a2/(PI*den*den+.00001);float k=(rough+1.)*(rough+1.)/8.,G=(nv/(nv*(1.-k)+k))*(nl/(nl*(1.-k)+k));vec3 F=fresnel(hv,f0);return ((1.-F)*(1.-metal)*base/PI+D*G*F/max(4.*nv*nl,.001))*radiance*nl;}
vec3 environment(vec3 r,float rough){
 vec3 base=mix(vec3(.065,.08,.09),vec3(.31,.39,.44),smoothstep(-.3,.9,r.y));float spread=mix(150.,9.,rough*rough);
 base+=vec3(1.9,2.15,2.32)*pow(max(dot(r,normalize(vec3(-.75,1.1,.8))),0.),spread*.34);
 base+=vec3(1.5,1.55,1.4)*pow(max(dot(r,normalize(vec3(.35,.75,-1.))),0.),spread*.5);
 base+=vec3(1.6,1.05,.50)*pow(max(dot(r,normalize(vec3(1.,.05,.8))),0.),spread*.6);
 base+=vec3(.45,.73,.90)*pow(max(dot(r,normalize(vec3(-1.,-.05,-.3))),0.),spread*.6);
 float strip=exp(-pow((r.x+.47)/(rough*.32+.025),2.))*smoothstep(-.15,.3,r.y);return base+vec3(.50,.60,.64)*strip;
}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
vec3 strata(vec3 p){
 float n=noise(p*vec3(5.,2.3,5.)),fine=noise(p*95.);
 float y=p.y+(n-.5)*.13+sin(p.x*3.2+p.z*4.)*.055;
 vec3 c=vec3(.33,.28,.22);
 c=mix(c,vec3(.125,.15,.155),smoothstep(-1.45,-1.36,y));
 c=mix(c,vec3(.42,.32,.205),smoothstep(-.94,-.89,y));
 c=mix(c,vec3(.57,.48,.33),smoothstep(-.51,-.46,y));
 c=mix(c,vec3(.19,.215,.205),smoothstep(-.13,-.06,y));
 c=mix(c,vec3(.34,.305,.25),smoothstep(.29,.35,y));
 c=mix(c,vec3(.15,.155,.15),smoothstep(.57,.61,y));
 c=mix(c,vec3(.59,.495,.355),smoothstep(.84,.89,y));
 float lam=sin(y*93.+noise(p*vec3(6.,1.,6.))*2.)*.5+.5;
 c*=.78+.18*lam+.30*fine;
 float pore=smoothstep(.76,.91,noise(p*64.));c*=1.-pore*.47;
 return c;
}
void main(){
 float dist=dot(vScene,uScanAxis)-uScan;
 if(uBand>.5&&abs(dist)>.19&&uInspect<.1)discard;
 vec3 n=normalize(vNormal);if(!gl_FrontFacing)n=-n;vec3 v=normalize(uCamera-vWorld);
 float grain=noise(vLocal*96.),brushed=sin(vLocal.y*780.+noise(vLocal*25.)*2.);
 float rough=clamp(uRough+(grain-.5)*.035+brushed*.006,.11,.95),metal=uMetal,alpha=uOpacity;
 vec3 base=uColor*(.972+grain*.055);
 if(uKind>1.5&&uKind<4.5){
  base=strata(vScene);rough=.84;
  float bump=noise(vScene*vec3(41.,81.,43.))-.5;
  n=normalize(n+vec3(bump*.07,(grain-.5)*.10,bump*.09));
  if(uKind<2.5){float band=1.-smoothstep(.095,.20,abs(dist));alpha*=mix(1.,.075,band);base=mix(base,vec3(.20,.31,.30),band*.22);}
 }
 if(uKind>4.5&&uKind<5.5){float band=1.-smoothstep(.075,.16,abs(dist));alpha*=mix(1.,.09,band);}
 if(uKind>.5&&uKind<1.5){
  float wave=sin(vScene.x*9.-uTime*2.1+sin(vScene.z*14.+uTime)*.45)*.5+.5;
  n=normalize(n+vec3(sin(vScene.x*11.-uTime*2.4+vScene.z*6.)*.060,0.,sin(vScene.x*7.-uTime*1.7+vScene.z*16.)*.10));rough=.19;
  float fill=1.-smoothstep(-2.1+4.2*uProgress-.08,-2.1+4.2*uProgress+.08,vScene.x);
  base=mix(base,vec3(.09,.046,.012),fill*.65);
 }
 vec3 f0=mix(vec3(.04),base,metal),color=vec3(0.);
 color+=light(n,v,normalize(vec3(-3.5,5.5,5.)-vWorld),vec3(3.7,4.65,5.25),base,rough,f0,metal);
 color+=light(n,v,normalize(vec3(4.,2.6,1.)-vWorld),vec3(3.0,2.2,1.3),base,rough,f0,metal);
 color+=light(n,v,normalize(vec3(-2.,1.8,-4.)-vWorld),vec3(1.8,2.85,3.5),base,rough,f0,metal);
 float nv=max(dot(n,v),0.);vec3 F=fresnel(nv,f0);
 color+=(environment(reflect(-v,n),rough)*F*(1.-rough*.3)+base*.16*(1.-metal))*vAO*uAO;
 color*=.88;if(uKind>1.5&&uKind<4.5)color*=.51;float scan=exp(-pow(dist/.019,2.));color+=uAccent*scan*(.22+pow(1.-nv,2.)*.55);
 color+=base*uEmissive;
 color=mix(color,color*.18+vec3(.025,.065,.073)*(1.-nv),uInspect*.80);
 color=pow(aces(color),vec3(1./2.2));gl_FragColor=vec4(color,alpha);
}`
    const lineVertex = `attribute vec3 aPosition;uniform mat4 uModel;uniform mat4 uPart;uniform mat4 uVP;varying vec3 vScene;void main(){vScene=(uPart*vec4(aPosition,1.)).xyz;gl_Position=uVP*uModel*vec4(aPosition,1.);}`
    const lineFragment = `precision mediump float;uniform vec4 uColor;uniform float uBand;uniform float uScan;uniform vec3 uScanAxis;varying vec3 vScene;void main(){float a=uColor.a;if(uBand>.5)a*=1.-smoothstep(.025,.13,abs(dot(vScene,uScanAxis)-uScan));if(a<.003)discard;gl_FragColor=vec4(uColor.rgb,a);}`

    /* The scene, built here so its geometry never costs the page's main thread. */
    const groups = []
    const scene = build({
      M,
      v3,
      Geometry,
      Group,
      materials,
      TAU,
      clamp,
      mix,
      smooth,
      bolt,
      flange,
      wheel,
      curve,
      group: (name, opts) => {
        const g = new Group(name, opts)
        groups.push(g)
        return g
      },
    })
    const bounds = Object.assign(
      { radius: 3, center: [0, 0.1, 0], floor: -1.7, ring: 2.5 },
      scene.bounds,
    )
    const scanConfig = Object.assign(
      { axis: [0, 1, 0], min: -1.6, max: 1.8, radius: 1.85 },
      scene.scan,
    )
    // The page lays out the callouts, so it is told what they say and where they point.
    scope.postMessage({
      type: 'meta',
      labels: scene.labels,
      callouts: scene.callouts || [
        [0.28, -0.23],
        [0.29, 0.23],
      ],
    })

    const frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : cb => setTimeout(() => cb(performance.now()), 16)
    let canvas = null
    let gl = null
    let ctx = null
    let program = null
    let lineProgram = null
    let lost = false
    let width = 1
    let height = 1
    let dpr = 1
    let VP = M.identity()
    let rootMatrix = M.identity()
    let camera = [4.2, 3.2, 8.5]
    let t = 0
    let last = 0
    let running = false
    let dirty = true
    let visible = true
    let reduced = false
    let paused = false
    let targetYaw = 0
    let yaw = 0
    let targetTilt = 0
    let tilt = 0
    let progress = 0.7
    let scan = 0
    // The accent and the guides' colour, as 0–1 channels; the page's theme replaces both.
    let accent = [0.91, 0.6, 0.27]
    let lineColor = [0.39, 0.51, 0.54]
    const technical = 0
    const extras = []

    function makeProgram(v, f, attrs, uniforms) {
      const compile = (type, source) => {
        const s = gl.createShader(type)
        gl.shaderSource(s, source)
        gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          const e = gl.getShaderInfoLog(s)
          gl.deleteShader(s)
          throw new Error(e)
        }
        return s
      }
      const vs = compile(gl.VERTEX_SHADER, v)
      const fs = compile(gl.FRAGMENT_SHADER, f)
      const p = gl.createProgram()
      gl.attachShader(p, vs)
      gl.attachShader(p, fs)
      gl.linkProgram(p)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p))
      return {
        p,
        a: Object.fromEntries(attrs.map(k => [k, gl.getAttribLocation(p, k)])),
        u: Object.fromEntries(uniforms.map(k => [k, gl.getUniformLocation(p, k)])),
      }
    }
    function buffer(data) {
      const b = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, b)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
      return b
    }
    function ring(r, y, segments = 160, start = 0, end = TAU) {
      const a = []
      for (let i = 0; i < segments; i++) {
        const p = mix(start, end, i / segments)
        const q = mix(start, end, (i + 1) / segments)
        a.push(r * Math.cos(p), y, r * Math.sin(p), r * Math.cos(q), y, r * Math.sin(q))
      }
      return a
    }
    function extra(data, kind, alpha = 0.25) {
      extras.push({ data, buffer: null, count: data.length / 3, kind, alpha })
    }
    // The floor rings, the progress arc, the ticks, the scanner and the calibration scale.
    extra(ring(bounds.ring, bounds.floor), 'base', 0.25)
    extra(ring(bounds.ring * 1.065, bounds.floor), 'base', 0.17)
    extra(ring(bounds.ring, bounds.floor + 0.004, 160), 'progress', 0.74)
    {
      const ticks = []
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * TAU
        const r = bounds.ring * 1.065
        const r2 = r + (i % 8 === 0 ? 0.105 : 0.045)
        ticks.push(
          r * Math.cos(a),
          bounds.floor,
          r * Math.sin(a),
          r2 * Math.cos(a),
          bounds.floor,
          r2 * Math.sin(a),
        )
      }
      extra(ticks, 'base', 0.3)
      extra(ring(scanConfig.radius, 0), 'scanner', 0.19)
      extra(ring(scanConfig.radius + 0.006, 0.003, 32, 0, 0.62), 'scanArc', 0.76)
      const scale = []
      const x = -Math.min(bounds.ring * 0.88, 2.1)
      const z = -0.8
      for (let i = 0; i <= 24; i++) {
        const y = mix(scanConfig.min, scanConfig.max, i / 24)
        scale.push(x, y, z, x + (i % 4 === 0 ? 0.1 : 0.04), y, z)
      }
      scale.push(x - 0.025, scanConfig.min, z, x - 0.025, scanConfig.max, z)
      if (scanConfig.axis[1]) extra(scale, 'base', 0.16)
    }

    function initGL() {
      gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        premultipliedAlpha: true,
        powerPreference: 'high-performance',
      })
      if (!gl) throw new Error('WebGL is unavailable')
      program = makeProgram(
        vertexSource,
        fragmentSource,
        ['aPosition', 'aNormal', 'aAO'],
        [
          'uModel',
          'uPart',
          'uVP',
          'uNormal',
          'uCamera',
          'uColor',
          'uAccent',
          'uScanAxis',
          'uMetal',
          'uRough',
          'uAO',
          'uScan',
          'uInspect',
          'uTime',
          'uKind',
          'uOpacity',
          'uEmissive',
          'uBand',
          'uProgress',
        ],
      )
      lineProgram = makeProgram(
        lineVertex,
        lineFragment,
        ['aPosition'],
        ['uModel', 'uPart', 'uVP', 'uColor', 'uBand', 'uScan', 'uScanAxis'],
      )
      for (const g of groups)
        g.meshes = Object.entries(g.geometry)
          .filter(([, geo]) => geo.data.length)
          .map(([k, geo]) => ({
            buffer: buffer(geo.data),
            wire: buffer(geo.edges),
            count: geo.data.length / 7,
            wireCount: geo.edges.length / 3,
            mat: materials[k],
          }))
      for (const e of extras) e.buffer = buffer(e.data)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.disable(gl.CULL_FACE)
      gl.clearColor(0, 0, 0, 0)
    }
    function drawMesh(mesh, g) {
      const model = M.mul(rootMatrix, g.matrix)
      const p = program
      gl.useProgram(p.p)
      gl.uniformMatrix4fv(p.u.uModel, false, model)
      gl.uniformMatrix4fv(p.u.uPart, false, g.matrix)
      gl.uniformMatrix4fv(p.u.uVP, false, VP)
      gl.uniformMatrix3fv(p.u.uNormal, false, M.normal(model))
      gl.uniform3fv(p.u.uCamera, camera)
      gl.uniform3fv(p.u.uAccent, accent)
      gl.uniform3fv(p.u.uScanAxis, scanConfig.axis)
      gl.uniform1f(p.u.uScan, scan)
      gl.uniform1f(p.u.uInspect, technical)
      gl.uniform1f(p.u.uTime, t)
      gl.uniform1f(p.u.uProgress, progress)
      const m = mesh.mat
      gl.uniform3fv(p.u.uColor, m.color)
      gl.uniform1f(p.u.uMetal, m.metal)
      gl.uniform1f(p.u.uRough, m.rough)
      gl.uniform1f(p.u.uAO, m.ao || 1)
      gl.uniform1f(p.u.uKind, m.kind || 0)
      gl.uniform1f(p.u.uOpacity, g.opacity * (m.opacity || 1))
      gl.uniform1f(p.u.uEmissive, m.emissive || 0)
      gl.uniform1f(p.u.uBand, m.band || 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer)
      gl.enableVertexAttribArray(p.a.aPosition)
      gl.vertexAttribPointer(p.a.aPosition, 3, gl.FLOAT, false, 28, 0)
      gl.enableVertexAttribArray(p.a.aNormal)
      gl.vertexAttribPointer(p.a.aNormal, 3, gl.FLOAT, false, 28, 12)
      gl.enableVertexAttribArray(p.a.aAO)
      gl.vertexAttribPointer(p.a.aAO, 1, gl.FLOAT, false, 28, 24)
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
    }
    function drawLine(item, part, color, band = 0, count = item.count) {
      const p = lineProgram
      gl.disableVertexAttribArray(program.a.aNormal)
      gl.disableVertexAttribArray(program.a.aAO)
      gl.useProgram(p.p)
      gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer)
      gl.enableVertexAttribArray(p.a.aPosition)
      gl.vertexAttribPointer(p.a.aPosition, 3, gl.FLOAT, false, 12, 0)
      gl.uniformMatrix4fv(p.u.uModel, false, M.mul(rootMatrix, part))
      gl.uniformMatrix4fv(p.u.uPart, false, part)
      gl.uniformMatrix4fv(p.u.uVP, false, VP)
      gl.uniform4fv(p.u.uColor, color)
      gl.uniform1f(p.u.uBand, band)
      gl.uniform1f(p.u.uScan, scan)
      gl.uniform3fv(p.u.uScanAxis, scanConfig.axis)
      gl.drawArrays(gl.LINES, 0, Math.max(0, Math.min(count, item.count)))
    }
    function extraTransform(e) {
      if (e.kind === 'scanner' || e.kind === 'scanArc')
        return M.compose(
          M.translate(...v3.mul(scanConfig.axis, scan)),
          M.basisY(scanConfig.axis),
          M.ry(t * 0.25),
        )
      if (e.kind === 'progress') return M.ry(-Math.PI / 2)
      return M.identity()
    }
    function renderGL() {
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.depthMask(true)
      gl.disable(gl.BLEND)
      for (const g of groups)
        if (g.opacity >= 0.999) for (const m of g.meshes) if (!m.mat.transparent) drawMesh(m, g)
      gl.enable(gl.BLEND)
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.depthMask(false)
      for (const g of groups)
        if (g.opacity > 0.003)
          for (const m of g.meshes)
            if (m.mat.transparent || g.opacity < 0.999) {
              gl.depthMask(!!m.mat.depthWrite)
              drawMesh(m, g)
            }
      gl.depthMask(false)
      for (const e of extras) {
        const amber = e.kind !== 'base'
        drawLine(
          e,
          extraTransform(e),
          [...(amber ? accent : lineColor), e.alpha],
          0,
          e.kind === 'progress' ? Math.round((progress * e.count) / 2) * 2 : e.count,
        )
      }
      for (const g of groups) {
        const ghost = scene.buildReveal ? 1 - g.opacity : 0
        if (ghost > 0.005) {
          gl.disable(gl.DEPTH_TEST)
          for (const m of g.meshes)
            drawLine({ buffer: m.wire, count: m.wireCount }, g.matrix, [...lineColor, 0.14 * ghost])
          gl.enable(gl.DEPTH_TEST)
        }
        if (scene.scanWire)
          for (const m of g.meshes)
            drawLine({ buffer: m.wire, count: m.wireCount }, g.matrix, [...accent, 0.33], 1)
      }
      gl.depthMask(true)
      gl.disable(gl.BLEND)
    }
    function project(p, mat = M.identity()) {
      const q = M.point(mat, p)
      const w = VP[3] * q[0] + VP[7] * q[1] + VP[11] * q[2] + VP[15]
      return [
        ((VP[0] * q[0] + VP[4] * q[1] + VP[8] * q[2] + VP[12]) / w) * width * 0.5 + width * 0.5,
        height * 0.5 - ((VP[1] * q[0] + VP[5] * q[1] + VP[9] * q[2] + VP[13]) / w) * height * 0.5,
      ]
    }
    /* A technical wireframe on Canvas 2D, where WebGL is unavailable. */
    function renderCanvas() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.lineWidth = 0.65
      const rgb = c => c.map(v => Math.round(v * 255)).join(',')
      for (const g of groups) {
        const mat = M.mul(rootMatrix, g.matrix)
        for (const [key, geo] of Object.entries(g.geometry)) {
          const c =
            key === 'brass' || key === 'yellow' || key === 'amber' || key === 'channel'
              ? accent
              : lineColor
          ctx.strokeStyle = `rgba(${rgb(c)},${Math.max(0.08, g.opacity * 0.25)})`
          ctx.beginPath()
          const step = geo.edges.length > 20000 ? 18 : 6
          for (let i = 0; i < geo.edges.length; i += step) {
            const a = project(geo.edges.slice(i, i + 3), mat)
            const b = project(geo.edges.slice(i + 3, i + 6), mat)
            ctx.moveTo(...a)
            ctx.lineTo(...b)
          }
          ctx.stroke()
        }
      }
      for (const e of extras) {
        const mat = M.mul(rootMatrix, extraTransform(e))
        const c = e.kind === 'base' ? lineColor : accent
        ctx.strokeStyle = `rgba(${rgb(c)},${e.alpha})`
        ctx.beginPath()
        const count =
          e.kind === 'progress' ? Math.round((progress * e.data.length) / 6) * 6 : e.data.length
        for (let i = 0; i < count; i += 6) {
          const a = project(e.data.slice(i, i + 3), mat)
          const b = project(e.data.slice(i + 3, i + 6), mat)
          ctx.moveTo(...a)
          ctx.lineTo(...b)
        }
        ctx.stroke()
      }
    }
    function resize() {
      if (!canvas) return
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      if (gl && !lost) gl.viewport(0, 0, canvas.width, canvas.height)
      const dir = v3.norm(scene.camera || [4.2, 3.0, 8.5])
      const dist = 10.2
      camera = v3.add(bounds.center, v3.mul(dir, dist))
      const aspect = width / height
      const fit = bounds.radius * (aspect < 1 ? 1 / aspect : 1)
      const fov = 2 * Math.atan(fit / dist)
      VP = M.mul(M.perspective(fov, aspect, 0.1, 75), M.lookAt(camera, bounds.center, [0, 1, 0]))
      dirty = true
    }
    function draw() {
      if (!canvas || (!ctx && (!gl || lost))) return
      // The loader has no progress of its own to show, so the scenes play their demonstration.
      progress = scene.demoProgress ? scene.demoProgress(t) : 0.12 + ((t * 0.042 + 0.51) % 1) * 0.88
      scan = scene.scanAt
        ? scene.scanAt(t, progress, false)
        : mix(scanConfig.min, scanConfig.max, Math.sin(t * 0.43 - 0.7) * 0.5 + 0.5)
      if (scene.animate) scene.animate(t, progress, { reduced, manualProgress: false })
      const auto = reduced ? 0 : scene.rotation ? scene.rotation(t) : t * 0.085
      rootMatrix = M.compose(
        M.translate(0, !reduced && scene.bob !== false ? Math.sin(t * 0.65) * 0.022 : 0, 0),
        M.rx(tilt),
        M.ry(yaw + auto + (scene.yaw || 0)),
        M.rz(scene.lean || 0),
      )
      if (ctx) renderCanvas()
      else renderGL()
      dirty = false
    }
    function tick(now) {
      if (!running) return
      const dt = Math.min(0.06, last ? (now - last) / 1000 : 1 / 60)
      last = now
      if (!paused && !reduced) t += dt
      const e = reduced ? 1 : 1 - Math.exp(-dt * 9)
      yaw = mix(yaw, targetYaw, e)
      tilt = mix(tilt, targetTilt, e)
      const moving = Math.abs(yaw - targetYaw) + Math.abs(tilt - targetTilt) > 0.0003
      if (dirty || moving || (!paused && !reduced)) draw()
      // Nothing is drawn while paused, hidden or under reduced motion, unless a drag is settling.
      if ((!paused && !reduced) || moving) frame(tick)
      else running = false
    }
    function wake() {
      dirty = true
      if (!running && visible && canvas) {
        running = true
        last = 0
        frame(tick)
      }
    }

    scope.onmessage = ({ data }) => {
      if (data.type === 'init') {
        canvas = data.canvas
        try {
          initGL()
          canvas.addEventListener('webglcontextlost', event => {
            event.preventDefault()
            lost = true
          })
          canvas.addEventListener('webglcontextrestored', () => {
            lost = false
            try {
              initGL()
              resize()
              wake()
            } catch {
              gl = null
            }
          })
        } catch (error) {
          console.warn('The 3D loader is drawing a Canvas 2D wireframe.', error)
          gl = null
          ctx = canvas.getContext('2d')
        }
        resize()
      } else if (data.type === 'size') {
        width = Math.max(1, data.w)
        height = Math.max(1, data.h)
        dpr = Math.min(data.dpr || 1, 1.6)
        resize()
      } else if (data.type === 'theme') {
        accent = data.accent
        lineColor = data.line
      } else if (data.type === 'state') {
        visible = data.visible
        reduced = data.reduce
        paused = data.paused
        if (!visible) running = false
      } else if (data.type === 'turn') {
        targetYaw += data.dx
        targetTilt = clamp(targetTilt + data.dy, -0.4, 0.4)
      } else if (data.type === 'stop') {
        visible = false
        running = false
        if (gl && !lost) {
          const ext = gl.getExtension('WEBGL_lose_context')
          if (ext) ext.loseContext()
        }
        return
      }
      wake()
    }
  }

  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  probe.canvas.width = probe.canvas.height = 1
  /** Any CSS colour, as 0–1 channels. */
  const toRgb = (value, fallback) => {
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = fallback
    probe.fillStyle = (value || '').trim() || fallback
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return [d[0] / 255, d[1] / 255, d[2] / 255]
  }

  /** A worker drawing through an OffscreenCanvas, or null where the browser has neither. */
  function startWorker(canvas, build) {
    if (typeof Worker !== 'function' || typeof canvas.transferControlToOffscreen !== 'function') {
      return null
    }
    try {
      const url = URL.createObjectURL(
        new Blob([`(${engine.toString()})(self, ${build.toString()})`], {
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

  const STYLE = `
:host{display:block;position:relative;overflow:hidden;isolation:isolate;min-height:240px;
  background:var(--stratum-background,
    radial-gradient(ellipse at 50% 83%,var(--stratum-ambient,rgba(113,76,34,.12)),transparent 45%),
    radial-gradient(ellipse at 48% 40%,var(--stratum-glow,#1a2327) 0%,transparent 69%),
    var(--stratum-bg,#090d0f));
  color:var(--stratum-label-color,#829496);
  font-family:var(--stratum-font,ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace)}
canvas,.grid,.grain,.hud{position:absolute;inset:0;width:100%;height:100%;display:block}
.grid,.grain,.hud{pointer-events:none}
canvas{z-index:1;touch-action:pan-y;cursor:grab}
canvas:active{cursor:grabbing}
.grid{z-index:0;opacity:var(--stratum-grid-opacity,.45);
  background-image:linear-gradient(var(--stratum-grid-color,rgba(151,177,182,.045)) 1px,transparent 1px),
    linear-gradient(90deg,var(--stratum-grid-color,rgba(151,177,182,.045)) 1px,transparent 1px);
  background-size:72px 72px;
  -webkit-mask-image:radial-gradient(ellipse,black,transparent 72%);mask-image:radial-gradient(ellipse,black,transparent 72%)}
.grain{z-index:5;opacity:var(--stratum-grain-opacity,.025);background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.92' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' opacity='.6' filter='url(%23n)'/%3E%3C/svg%3E")}
.hud{z-index:2;opacity:var(--stratum-labels-opacity,1)}
.hud path{fill:none;stroke:var(--stratum-line-color,rgba(140,165,170,.27));stroke-width:.75}
.callout{position:absolute;z-index:3;display:flex;gap:9px;align-items:center;font-size:8px;letter-spacing:1.4px;
  white-space:nowrap;pointer-events:none;opacity:var(--stratum-labels-opacity,1);transform:translateY(-50%)}
.callout::before{content:'';display:inline-block;width:3px;height:3px;border-radius:50%;background:var(--stratum-accent,#e7aa64)}
.callout[hidden]{display:none}
`

  class StratumLoader extends HTMLElement {
    static observedAttributes = ['paused']

    constructor() {
      super()
      const root = this.attachShadow({ mode: 'open' })
      root.innerHTML = `<style>${STYLE}</style><div class="grid"></div><canvas part="canvas" role="img" aria-label="Loading"></canvas><svg class="hud"><path></path></svg><div class="callout"></div><div class="callout"></div><div class="grain"></div>`
      this.cv = root.querySelector('canvas')
      this.hud = root.querySelector('.hud')
      this.callouts = root.querySelectorAll('.callout')
      this.vis = true
      this.meta = null
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
      const build = this.constructor.build
      const receive = data => {
        if (data.type !== 'meta') return
        this.meta = data
        this.callouts.forEach((el, i) => {
          el.textContent = `0${i + 1} / ${data.labels[i]}`
        })
        this.place()
      }
      this.worker = startWorker(this.cv, build)
      if (this.worker) {
        this.worker.onmessage = event => receive(event.data)
        this.send = data => this.worker.postMessage(data)
      } else {
        const scope = { postMessage: receive }
        engine(scope, build)
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
      this.readTheme()
      this.layout()
      this.sendState()
      this.ro = new ResizeObserver(() => this.layout())
      this.ro.observe(this)
      this.io = new IntersectionObserver(entries =>
        entries.forEach(entry => {
          this.vis = entry.isIntersecting
          this.sendState()
        }),
      )
      this.io.observe(this)
      this.bindDrag()
      // The backdrop and the labels are CSS and follow the theme by themselves; the scan ring and
      // the guides are drawn, so their colours are read again on a timer and sent when they change.
      this.poll = setInterval(() => this.readTheme(), 250)
    }

    disconnectedCallback() {
      clearInterval(this.poll)
      this.ro && this.ro.disconnect()
      this.io && this.io.disconnect()
      this.reduce && this.reduce.removeEventListener('change', this.sendState)
      document.removeEventListener('visibilitychange', this.sendState)
      this.unbindDrag && this.unbindDrag()
      if (this.worker) this.worker.terminate()
      else this.send && this.send({ type: 'stop' })
      this.worker = null
      this.send = null
    }

    attributeChangedCallback() {
      if (this.send) this.sendState()
    }

    bindDrag() {
      const cv = this.cv
      let last = null
      const down = e => {
        if (e.button !== 0 || !e.isPrimary) return
        last = [e.clientX, e.clientY]
        cv.setPointerCapture(e.pointerId)
      }
      const move = e => {
        if (!last || !e.isPrimary) return
        this.send({
          type: 'turn',
          dx: (e.clientX - last[0]) * 0.007,
          dy: (e.clientY - last[1]) * 0.002,
        })
        last = [e.clientX, e.clientY]
      }
      const up = e => {
        last = null
        if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId)
      }
      cv.addEventListener('pointerdown', down)
      cv.addEventListener('pointermove', move)
      cv.addEventListener('pointerup', up)
      cv.addEventListener('pointercancel', up)
      this.unbindDrag = () => {
        cv.removeEventListener('pointerdown', down)
        cv.removeEventListener('pointermove', move)
        cv.removeEventListener('pointerup', up)
        cv.removeEventListener('pointercancel', up)
      }
    }

    layout() {
      this.send({
        type: 'size',
        w: Math.max(1, this.clientWidth),
        h: Math.max(1, this.clientHeight),
        dpr: devicePixelRatio || 1,
      })
      this.place()
    }

    /* The frame, the crosshair and the callouts' leaders share the scene's square. */
    place() {
      if (!this.meta) return
      const width = Math.max(1, this.clientWidth)
      const height = Math.max(1, this.clientHeight)
      const s = Math.min(width, height)
      const cx = width * 0.5
      const cy = height * 0.49
      const xl = cx - s * 0.39
      const xr = cx + s * 0.39
      const yt = cy - s * 0.36
      const yb = cy + s * 0.33
      const labels = this.meta.callouts.map(([x, y]) => [cx + s * x, cy + s * y])
      this.hud.setAttribute('viewBox', `0 0 ${width} ${height}`)
      this.hud.firstElementChild.setAttribute(
        'd',
        `M${xl + 16} ${yt}h-16v16M${xr - 16} ${yt}h16v16M${xl + 16} ${yb}h-16v-16M${xr - 16} ${yb}h16v-16 M${cx - 5} ${yb + 26}h10m-5-5v10 ${labels.map(([x, y]) => `M${x - 9} ${y}h-18l-20 20h-17`).join(' ')}`,
      )
      // Small boxes have no room for the callouts beside the model.
      const compact = width < 800 || height < 430
      this.callouts.forEach((el, i) => {
        el.style.left = labels[i][0] + 'px'
        el.style.top = labels[i][1] + 'px'
        el.hidden = compact
      })
    }

    readTheme() {
      const cs = getComputedStyle(this)
      const accent = cs.getPropertyValue('--stratum-accent')
      const line = cs.getPropertyValue('--stratum-ring-color')
      const key = `${accent}|${line}`
      if (key === this.key) return
      this.key = key
      this.send({ type: 'theme', accent: toRgb(accent, '#e7aa64'), line: toRgb(line, '#637c85') })
    }
  }

  return {
    /** Defines `<name>-loader`, drawing the scene `build` makes. */
    define(name, build) {
      const tag = `${name}-loader`
      if (customElements.get(tag)) return
      customElements.define(
        tag,
        class extends StratumLoader {
          static build = build
        },
      )
    },
  }
})()

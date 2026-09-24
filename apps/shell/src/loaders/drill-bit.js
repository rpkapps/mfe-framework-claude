/* <drill-bit-loader> — a tricone drill bit turning under a scan ring, with technical guides and two
   callouts. Themable via CSS custom properties on the element or any ancestor:
   --drill-background       the backdrop: a colour, gradient, image or transparent (default #0a0c0d)
   --drill-effects-opacity  the glow, ambient wash, grid and grain together, 0–1 (default 1)
   --drill-glow             the halo behind the bit          (default rgba(97,125,135,.17))
   --drill-ambient          the warm wash beneath it         (default rgba(131,77,33,.11))
   --drill-grid-color       the blueprint grid               (default rgba(159,173,177,.022))
   --drill-grain-opacity    film grain, 0–1                  (default .033)
   --drill-line-color       frame corners, guides and rings  (default #809397)
   --drill-accent           the scan ring, its glow and marks (default #efaa63)
   --drill-label-color      callout text                     (default #889698)
   --drill-label-strong     the callouts' separators         (default #b7c0bf)
   --drill-font             callout font family              (default a system monospace)

   The canvas is transparent, so the backdrop and its effects are CSS only: set the effects' opacity
   to 0 for an exact, flat --drill-background. The `paused` attribute stops the animation where it
   stands. Drag to turn the bit. Reduced motion stops the automatic turn and keeps the drag.

   The shell's build emits this file on its own and index.html loads it when the deployment chose it
   (SHELL_LOADER); the loader's styles set each property from a Tecton token. The geometry is built
   and drawn in a worker through an OffscreenCanvas where the browser has one, so neither slows the
   page's own scripts; elsewhere it draws on the main thread. Browsers without WebGL get a simpler
   Canvas 2D drawing. The assembly is a decorative concept model, not an engineering drawing.
*/
;(() => {
  if (customElements.get('drill-bit-loader')) return

  /**
   * Everything that draws, self-contained so its source can run in a worker: it takes messages
   * (`init`, `size`, `theme`, `state`, `turn`, `stop`) and runs its own frame loop.
   */
  function engine(scope) {
    const MAX_PIXEL_RATIO = 1.75
    const ROTATION_RATE = (6 * Math.PI * 2) / 60 // Six turns a minute.
    const INITIAL_ANGLE = 1.19
    const TAU = Math.PI * 2
    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
    const mix = (a, b, t) => a + (b - a) * t
    const frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : cb => setTimeout(() => cb(performance.now()), 16)
    const cancelFrame =
      typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout

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
        const c = Math.cos(a)
        const s = Math.sin(a)
        return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1])
      },
      ry: a => {
        const c = Math.cos(a)
        const s = Math.sin(a)
        return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1])
      },
      rz: a => {
        const c = Math.cos(a)
        const s = Math.sin(a)
        return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
      },
      basisY: (d, p = [0, 0, 0]) => {
        const y = v3.norm(d)
        const x = v3.norm(v3.cross(Math.abs(y[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1], y))
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
        const f = 1 / Math.tan(fov / 2)
        const nf = 1 / (near - far)
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
        const z = v3.norm(v3.sub(eye, target))
        const x = v3.norm(v3.cross(up, z))
        const y = v3.cross(z, x)
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

    /* Every mesh is built procedurally. Position, normal and ambient-occlusion data are
       interleaved. Parts share batches, so hundreds of inserts need few draws. */
    class Geometry {
      constructor() {
        this.data = []
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
      lathe(profile, segments = 64, transform = M.identity(), ao = 1, phase = 0) {
        for (let j = 0; j < profile.length - 1; j++) {
          const [r0, y0] = profile[j]
          const [r1, y1] = profile[j + 1]
          const dy = y1 - y0
          const dr = r1 - r0
          for (let i = 0; i < segments; i++) {
            const a = (i / segments) * TAU + phase
            const b = ((i + 1) / segments) * TAU + phase
            const p = (r, y, t) => M.point(transform, [Math.cos(t) * r, y, Math.sin(t) * r])
            const n = t => v3.norm(M.vector(transform, [Math.cos(t) * dy, -dr, Math.sin(t) * dy]))
            const A = p(r0, y0, a)
            const B = p(r0, y0, b)
            const C = p(r1, y1, a)
            const D = p(r1, y1, b)
            const na = n(a)
            const nb = n(b)
            this.triangle(A, C, B, na, na, nb, ao)
            this.triangle(B, C, D, nb, na, nb, ao)
          }
        }
      }
      torus(radius, tube, y, transform = M.identity(), seg = 80, tubeSeg = 8, ao = 1) {
        const p = []
        for (let j = 0; j <= tubeSeg; j++) {
          const a = (j / tubeSeg) * TAU
          p.push([radius + Math.cos(a) * tube, y + Math.sin(a) * tube])
        }
        this.lathe(p, seg, transform, ao)
      }
      plate(shape, depth, transform, ao = 1) {
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
        for (let i = 0; i < shape.length; i++) {
          const a = shape[i]
          const b = shape[(i + 1) % shape.length]
          const a0 = at(a, -depth * 0.38)
          const b0 = at(b, -depth * 0.38)
          const a1 = at(a, depth * 0.38)
          const b1 = at(b, depth * 0.38)
          const ai = at(a, depth * 0.5, 0.89)
          const bi = at(b, depth * 0.5, 0.89)
          const aj = at(a, -depth * 0.5, 0.89)
          const bj = at(b, -depth * 0.5, 0.89)
          this.flat(a0, b0, a1, ao)
          this.flat(a1, b0, b1, ao)
          this.flat(a1, b1, ai, ao)
          this.flat(ai, b1, bi, ao)
          this.flat(b0, a0, bj, ao)
          this.flat(bj, a0, aj, ao)
          this.flat(at(center, depth * 0.5), ai, bi, ao)
          this.flat(at(center, -depth * 0.5), bj, aj, ao)
        }
      }
      thread(y0, y1, r0, r1, turns) {
        const count = Math.round(turns * 72)
        const pitch = (y1 - y0) / turns
        const cross = [
          [-0.42, 0],
          [-0.2, 0.047],
          [0.12, 0.047],
          [0.43, 0],
        ]
        for (let i = 0; i < count; i++) {
          const a = (i / count) * TAU * turns
          const b = ((i + 1) / count) * TAU * turns
          const point = (ang, pr) => {
            const f = ang / (TAU * turns)
            const r = mix(r0, r1, f) + pr[1]
            return [r * Math.cos(ang), y0 + (y1 - y0) * f + pr[0] * pitch, r * Math.sin(ang)]
          }
          for (let j = 0; j < cross.length - 1; j++) {
            const A = point(a, cross[j])
            const B = point(b, cross[j])
            const C = point(a, cross[j + 1])
            const D = point(b, cross[j + 1])
            this.flat(A, B, C, 0.92)
            this.flat(C, B, D, 0.92)
          }
        }
      }
    }

    const materials = {
      body: { color: [0.31, 0.345, 0.36], metal: 0.95, rough: 0.37, ao: 0.92 },
      machined: { color: [0.48, 0.515, 0.525], metal: 1, rough: 0.27, ao: 1 },
      dark: { color: [0.16, 0.185, 0.195], metal: 0.88, rough: 0.37, ao: 0.78 },
      cutter: { color: [0.57, 0.47, 0.32], metal: 0.9, rough: 0.31, ao: 1 },
      socket: { color: [0.105, 0.12, 0.125], metal: 0.8, rough: 0.42, ao: 0.68 },
      accent: { color: [0.56, 0.36, 0.17], metal: 0.88, rough: 0.29, ao: 1 },
    }
    const newBatches = () => {
      const b = {}
      for (const k of Object.keys(materials)) b[k] = new Geometry()
      return b
    }

    function buildBit() {
      const body = newBatches()
      body.body.lathe(
        [
          [0.74, 0.04],
          [0.91, 0.11],
          [0.96, 0.23],
          [0.93, 0.42],
          [0.87, 0.77],
          [0.77, 1.09],
          [0.67, 1.24],
          [0.57, 1.32],
          [0.54, 1.38],
        ],
        96,
      )
      body.machined.lathe(
        [
          [0.55, 1.29],
          [0.595, 1.33],
          [0.595, 1.47],
          [0.56, 1.52],
          [0.45, 1.53],
        ],
        96,
      )
      body.dark.lathe(
        [
          [0.596, 1.359],
          [0.597, 1.382],
        ],
        96,
      )
      body.accent.lathe(
        [
          [0.596, 1.41],
          [0.596, 1.435],
        ],
        96,
      )
      body.machined.lathe(
        [
          [0.425, 1.48],
          [0.44, 1.58],
          [0.421, 1.64],
          [0.365, 2.63],
          [0.342, 2.68],
          [0.213, 2.68],
          [0.198, 2.64],
          [0.198, 2.26],
        ],
        96,
      )
      body.socket.lathe(
        [
          [0.198, 2.27],
          [0.198, 2.21],
          [0, 2.21],
        ],
        64,
      )
      body.machined.thread(1.66, 2.61, 0.42, 0.366, 7.7)
      body.dark.lathe(
        [
          [0.425, 1.545],
          [0.426, 1.59],
        ],
        96,
      )
      body.dark.lathe(
        [
          [0.65, -0.26],
          [0.75, -0.18],
          [0.86, 0.03],
          [0.88, 0.16],
        ],
        72,
        M.identity(),
        0.75,
      )
      const legShape = [
        [0.42, 1.09],
        [0.72, 1.08],
        [0.95, 0.62],
        [1.11, -0.16],
        [1.09, -0.44],
        [0.97, -0.63],
        [0.8, -0.44],
        [0.66, 0.15],
      ]
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU + 0.12
        const rot = M.ry(-a)
        body.body.plate(legShape, 0.56, rot, 0.95)
        // The narrow machined shirttail plates and two recessed fasteners.
        body.machined.plate(
          [
            [0.925, 0.2],
            [1.047, -0.15],
            [1.038, -0.4],
            [0.973, -0.5],
            [0.929, -0.35],
            [0.88, 0.08],
          ],
          0.576,
          rot,
          0.92,
        )
        for (const y of [0.56, -0.24]) {
          const r = y > 0.1 ? 0.935 : 1.094
          const axis = [Math.cos(a), 0.16, Math.sin(a)]
          const p = [Math.cos(a) * r, y, Math.sin(a) * r]
          const tr = M.basisY(axis, p)
          body.socket.lathe(
            [
              [0.086, -0.014],
              [0.09, 0.0],
              [0.09, 0.015],
              [0.072, 0.033],
            ],
            40,
            tr,
            0.75,
          )
          body.machined.lathe(
            [
              [0.071, 0.016],
              [0.074, 0.028],
              [0.069, 0.043],
              [0.039, 0.043],
            ],
            32,
            tr,
          )
          body.socket.lathe(
            [
              [0.039, 0.043],
              [0.039, 0.017],
              [0, 0.017],
            ],
            6,
            tr,
            0.5,
            Math.PI / 6,
          )
        }
        // A fluid nozzle in each valley, with a genuinely hollow bore.
        const na = a + Math.PI / 3
        const d = [0.37 * Math.cos(na), -0.92, 0.37 * Math.sin(na)]
        const nt = M.basisY(d, [0.77 * Math.cos(na), 0.12, 0.77 * Math.sin(na)])
        body.dark.lathe(
          [
            [0.16, -0.11],
            [0.18, -0.02],
            [0.17, 0.1],
            [0.141, 0.14],
          ],
          48,
          nt,
          0.78,
        )
        body.machined.lathe(
          [
            [0.15, 0.09],
            [0.163, 0.105],
            [0.163, 0.16],
            [0.14, 0.184],
            [0.094, 0.184],
            [0.084, 0.17],
          ],
          48,
          nt,
          0.9,
        )
        body.socket.lathe(
          [
            [0.085, 0.175],
            [0.085, 0.035],
            [0, 0.035],
          ],
          32,
          nt,
          0.42,
        )
        // Discreet circumferential machining and oil channels.
        const bt = M.basisY(
          [Math.cos(na), 0.12, Math.sin(na)],
          [0.82 * Math.cos(na), 0.62, 0.82 * Math.sin(na)],
        )
        body.socket.lathe(
          [
            [0.11, 0],
            [0.112, 0.01],
            [0.089, 0.028],
          ],
          40,
          bt,
          0.7,
        )
        body.accent.lathe(
          [
            [0.08, 0.008],
            [0.087, 0.018],
            [0.079, 0.043],
            [0.047, 0.043],
            [0.043, 0.03],
          ],
          32,
          bt,
          0.85,
        )
      }
      const cones = []
      for (let k = 0; k < 3; k++) {
        const b = newBatches()
        const profile = [
          [0.055, -0.73],
          [0.17, -0.68],
          [0.28, -0.52],
          [0.38, -0.32],
          [0.47, -0.08],
          [0.56, 0.18],
          [0.61, 0.35],
          [0.612, 0.45],
          [0.58, 0.5],
          [0, 0.5],
        ]
        b.dark.lathe(profile, 80, M.identity(), 0.91)
        // Raised, chamfered cutter tracks wrap the cone rather than float above it.
        const rows = [
          { y: -0.58, r: 0.225, n: 7, size: 0.07, h: 0.16 },
          { y: -0.37, r: 0.355, n: 10, size: 0.08, h: 0.18 },
          { y: -0.12, r: 0.452, n: 12, size: 0.085, h: 0.185 },
          { y: 0.15, r: 0.548, n: 14, size: 0.084, h: 0.18 },
          { y: 0.36, r: 0.61, n: 16, size: 0.075, h: 0.155 },
        ]
        rows.forEach((row, ri) => {
          b.body.torus(row.r - 0.012, 0.032, row.y, M.identity(), 72, 6, 0.85)
          for (let j = 0; j < row.n; j++) {
            const a = (j / row.n) * TAU + ri * 0.36 + k * 0.11
            const n = v3.norm([Math.cos(a), -0.43, Math.sin(a)])
            const p = [row.r * Math.cos(a), row.y, row.r * Math.sin(a)]
            const tr = M.basisY(n, p)
            const s = row.size
            const h = row.h
            b.socket.lathe(
              [
                [s * 1.25, -0.01],
                [s * 1.22, 0.018],
                [s * 1.05, 0.034],
              ],
              16,
              tr,
              0.72,
            )
            b.cutter.lathe(
              [
                [s, 0.005],
                [s, 0.06],
                [s * 0.95, h * 0.62],
                [s * 0.78, h * 0.83],
                [s * 0.42, h * 0.97],
                [0, h],
              ],
              16,
              tr,
              1,
            )
          }
        })
        b.body.torus(0.599, 0.025, 0.455, M.identity(), 80, 8, 0.82)
        b.body.lathe(
          [
            [0.47, 0.465],
            [0.475, 0.505],
            [0.44, 0.545],
            [0.3, 0.55],
          ],
          72,
          M.identity(),
          0.72,
        )
        b.socket.lathe(
          [
            [0.3, 0.526],
            [0.3, 0.59],
            [0, 0.59],
          ],
          48,
          M.identity(),
          0.65,
        )
        const a = (k / 3) * TAU + 0.12
        const axis = [Math.cos(a) * 0.67, 0.742, Math.sin(a) * 0.67]
        const frameM = M.basisY(axis, [Math.cos(a) * 0.64, -0.7, Math.sin(a) * 0.64])
        cones.push({ batches: b, frame: frameM })
      }
      return { body, cones }
    }

    /* A compact, physically inspired brushed-metal shader. The environment is an analytic studio
       light rig, so it needs no HDRIs or texture downloads. The scan line glows in the accent. */
    const vertexSource = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute float aAO;
uniform mat4 uModel;
uniform mat4 uVP;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vAO;
void main(){vec4 p=uModel*vec4(aPosition,1.0);vWorld=p.xyz;vNormal=mat3(uModel)*aNormal;vLocal=aPosition;vAO=aAO;gl_Position=uVP*p;}`
    const fragmentSource = `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying float vAO;
uniform vec3 uCamera;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uMetal;
uniform float uRough;
uniform float uAO;
uniform float uScanY;
const float PI=3.14159265359;
float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 float a=mix(hash(i),hash(i+vec3(1,0,0)),f.x);
 float b=mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x);
 float c=mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x);
 float d=mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x);
 return mix(mix(a,b,f.y),mix(c,d,f.y),f.z);
}
vec3 fresnel(float hv,vec3 f0){return f0+(1.-f0)*pow(clamp(1.-hv,0.,1.),5.);}
vec3 light(vec3 n,vec3 v,vec3 l,vec3 radiance,vec3 color,float r,vec3 f0){
 vec3 h=normalize(v+l);float nv=max(dot(n,v),.001),nl=max(dot(n,l),0.),nh=max(dot(n,h),0.),hv=max(dot(h,v),0.);
 float a=r*r,a2=a*a,den=nh*nh*(a2-1.)+1.;float D=a2/(PI*den*den+.00001);
 float k=(r+1.)*(r+1.)/8.;float G=(nv/(nv*(1.-k)+k))*(nl/(nl*(1.-k)+k));
 vec3 F=fresnel(hv,f0);vec3 spec=D*G*F/max(4.*nv*nl,.001);vec3 kd=(1.-F)*(1.-uMetal);
 return (kd*color/PI+spec)*radiance*nl;
}
vec3 environment(vec3 r,float rough){
 vec3 base=mix(vec3(.075,.086,.093),vec3(.34,.40,.43),smoothstep(-.3,.9,r.y));
 float spread=mix(150.,9.,rough*rough);
 base+=vec3(1.85,2.10,2.22)*pow(max(dot(r,normalize(vec3(-.75,1.1,.8))),0.),spread*.34);
 base+=vec3(1.55,1.55,1.38)*pow(max(dot(r,normalize(vec3(.35,.75,-1.))),0.),spread*.5);
 base+=vec3(1.8,1.04,.47)*pow(max(dot(r,normalize(vec3(1.,.05,.8))),0.),spread*.6);
 base+=vec3(.50,.82,.95)*pow(max(dot(r,normalize(vec3(-1.,-.05,-.3))),0.),spread*.6);
 // Reflected vertical strip lights create long, machined edge highlights.
 float strip=exp(-pow((r.x+.47)/(rough*.32+.025),2.))*smoothstep(-.15,.3,r.y);
 base+=vec3(.50,.60,.64)*strip;
 return base;
}
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
void main(){
 vec3 n=normalize(vNormal);if(!gl_FrontFacing)n=-n;vec3 v=normalize(uCamera-vWorld);
 float grain=noise(vLocal*95.);float brushed=sin(vLocal.y*920.+noise(vLocal*25.)*2.);
 float rough=clamp(uRough+(grain-.5)*.028+brushed*.006,.12,.7);
 vec3 base=uColor*(.975+grain*.05);
 vec3 f0=mix(vec3(.04),base,uMetal);
 vec3 color=vec3(0.);
 color+=light(n,v,normalize(vec3(-3.5,5.,5.)-vWorld),vec3(4.2,5.1,5.8),base,rough,f0);
 color+=light(n,v,normalize(vec3(4.,2.,1.)-vWorld),vec3(3.6,2.45,1.35),base,rough,f0);
 color+=light(n,v,normalize(vec3(-2.,1.,-4.)-vWorld),vec3(1.7,2.9,3.5),base,rough,f0);
 vec3 refl=reflect(-v,n);float nv=max(dot(n,v),0.);
 vec3 F=fresnel(nv,f0);float ao=vAO*uAO;
 color+=(environment(refl,rough)*F*(1.-rough*.3)+base*.12*(1.-uMetal))*ao;
 color*=mix(.53,1.,smoothstep(-1.75,1.,vWorld.y))*.95;
 float scan=exp(-pow((vWorld.y-uScanY)/.024,2.));
 color+=uAccent*scan*(.18+pow(1.-nv,2.)*.7);
 color=pow(aces(color),vec3(1./2.2));
 gl_FragColor=vec4(color,1.);
}`
    const lineVertex = `attribute vec3 aPosition;uniform mat4 uModel;uniform mat4 uVP;void main(){gl_Position=uVP*uModel*vec4(aPosition,1.);}`
    const lineFragment = `precision mediump float;uniform vec4 uColor;void main(){gl_FragColor=uColor;}`

    let canvas = null
    let gl = null
    let ctx2d = null
    let program
    let lineProgram
    let meshes = null
    let rings = []
    let contextLost = false
    let width = 1
    let height = 1
    let dpr = 1
    let frameSize = 1
    let frameY = 0
    let VP = M.identity()
    let camera = [5.4, 2.2, 8.9]
    // The accent and the line colour, as 0–1 channels; the page's theme replaces both.
    let accent = [0.937, 0.667, 0.388]
    let line = [0.502, 0.576, 0.592]
    let scanY = 0
    let angle = INITIAL_ANGLE
    let manualAngle = 0
    let manualTilt = 0
    let targetAngle = 0
    let targetTilt = 0
    let visible = true
    let reduce = false
    let paused = false
    let stopped = false
    let raf = 0
    let dirty = true
    let animationTime = 0
    let lastTime = 0
    let lastRenderTime = 0

    function compile(type, source) {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const err = gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        throw new Error('Shader compilation: ' + err)
      }
      return shader
    }
    function makeProgram(v, f, attrs, uniforms) {
      const vs = compile(gl.VERTEX_SHADER, v)
      const fs = compile(gl.FRAGMENT_SHADER, f)
      const p = gl.createProgram()
      gl.attachShader(p, vs)
      gl.attachShader(p, fs)
      gl.linkProgram(p)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error('Program linking: ' + gl.getProgramInfoLog(p))
      const out = { p, a: {}, u: {} }
      for (const k of attrs) out.a[k] = gl.getAttribLocation(p, k)
      for (const k of uniforms) out.u[k] = gl.getUniformLocation(p, k)
      return out
    }
    function buffer(data) {
      const b = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, b)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
      return b
    }
    function uploadBatches(batches) {
      const result = []
      for (const [key, g] of Object.entries(batches)) {
        if (!g.data.length) continue
        result.push({ buffer: buffer(g.data), count: g.data.length / 7, material: materials[key] })
      }
      return result
    }
    /* Each guide takes the line colour or the accent, darkened by `shade`, at its own alpha. */
    function ringMesh(data, tone, shade, alpha, kind = 'fixed') {
      return { buffer: buffer(data), count: data.length / 3, tone, shade, alpha, kind }
    }
    function makeRing(r, y, segments, start = 0, end = TAU) {
      const a = []
      for (let i = 0; i < segments; i++) {
        const p = start + ((end - start) * i) / segments
        const q = start + ((end - start) * (i + 1)) / segments
        a.push(r * Math.cos(p), y, r * Math.sin(p), r * Math.cos(q), y, r * Math.sin(q))
      }
      return a
    }

    function initGL() {
      gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: true,
        powerPreference: 'default',
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      })
      if (!gl) throw new Error('WebGL unavailable')
      program = makeProgram(
        vertexSource,
        fragmentSource,
        ['aPosition', 'aNormal', 'aAO'],
        ['uModel', 'uVP', 'uCamera', 'uColor', 'uAccent', 'uMetal', 'uRough', 'uAO', 'uScanY'],
      )
      lineProgram = makeProgram(
        lineVertex,
        lineFragment,
        ['aPosition'],
        ['uModel', 'uVP', 'uColor'],
      )
      const bit = buildBit()
      meshes = {
        body: uploadBatches(bit.body),
        cones: bit.cones.map(c => ({ frame: c.frame, parts: uploadBatches(c.batches) })),
      }
      rings = []
      rings.push(ringMesh(makeRing(1.88, -1.68, 180), 'line', 0.75, 0.32))
      rings.push(ringMesh(makeRing(2.04, -1.68, 180), 'line', 0.75, 0.18))
      rings.push(ringMesh(makeRing(1.88, -1.677, 60, 0, 1.12), 'accent', 1, 0.68, 'baseArc'))
      const ticks = []
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * TAU
        const r = i % 8 === 0 ? 2.15 : 2.09
        ticks.push(
          2.04 * Math.cos(a),
          -1.68,
          2.04 * Math.sin(a),
          r * Math.cos(a),
          -1.68,
          r * Math.sin(a),
        )
      }
      rings.push(ringMesh(ticks, 'line', 0.9, 0.34))
      rings.push(ringMesh(makeRing(1.64, 0, 160), 'accent', 1, 0.18, 'scanner'))
      rings.push(ringMesh(makeRing(1.645, 0.008, 48, 0, 0.82), 'accent', 1, 0.63, 'scanArc'))
      // A quiet vertical calibration scale behind the body.
      const scale = []
      for (let i = 0; i < 29; i++) {
        const y = -1.65 + i * 0.155
        scale.push(-1.75, y, -0.55, -1.75 + (i % 4 === 0 ? 0.11 : 0.045), y, -0.55)
      }
      scale.push(-1.78, -1.65, -0.55, -1.78, 2.69, -0.55)
      rings.push(ringMesh(scale, 'line', 0.75, 0.18))
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.disable(gl.CULL_FACE)
      gl.clearColor(0, 0, 0, 0)
    }

    function drawBatches(parts, model) {
      gl.useProgram(program.p)
      gl.uniformMatrix4fv(program.u.uModel, false, model)
      gl.uniformMatrix4fv(program.u.uVP, false, VP)
      gl.uniform3fv(program.u.uCamera, camera)
      gl.uniform1f(program.u.uScanY, scanY)
      // The scan line is light added before tone mapping, so the accent is taken to linear first.
      gl.uniform3fv(
        program.u.uAccent,
        accent.map(c => Math.pow(c, 2.2) * 0.92),
      )
      for (const m of parts) {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.buffer)
        gl.enableVertexAttribArray(program.a.aPosition)
        gl.vertexAttribPointer(program.a.aPosition, 3, gl.FLOAT, false, 28, 0)
        gl.enableVertexAttribArray(program.a.aNormal)
        gl.vertexAttribPointer(program.a.aNormal, 3, gl.FLOAT, false, 28, 12)
        gl.enableVertexAttribArray(program.a.aAO)
        gl.vertexAttribPointer(program.a.aAO, 1, gl.FLOAT, false, 28, 24)
        const mat = m.material
        gl.uniform3fv(program.u.uColor, mat.color)
        gl.uniform1f(program.u.uMetal, mat.metal)
        gl.uniform1f(program.u.uRough, mat.rough)
        gl.uniform1f(program.u.uAO, mat.ao)
        gl.drawArrays(gl.TRIANGLES, 0, m.count)
      }
    }
    function drawLine(item, model) {
      gl.disableVertexAttribArray(program.a.aNormal)
      gl.disableVertexAttribArray(program.a.aAO)
      gl.useProgram(lineProgram.p)
      gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer)
      gl.enableVertexAttribArray(lineProgram.a.aPosition)
      gl.vertexAttribPointer(lineProgram.a.aPosition, 3, gl.FLOAT, false, 12, 0)
      gl.uniformMatrix4fv(lineProgram.u.uModel, false, model)
      gl.uniformMatrix4fv(lineProgram.u.uVP, false, VP)
      const rgb = item.tone === 'accent' ? accent : line
      gl.uniform4fv(lineProgram.u.uColor, [...rgb.map(c => c * item.shade), item.alpha])
      gl.drawArrays(gl.LINES, 0, item.count)
    }
    function renderGL() {
      if (!gl || contextLost || !meshes) return
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.depthMask(true)
      gl.disable(gl.BLEND)
      const rot = M.mul(M.rx(0.06 + manualTilt), M.mul(M.rz(-0.16), M.ry(angle + manualAngle)))
      const bob = reduce ? 0 : Math.sin(animationTime * 0.65) * 0.04
      const model = M.mul(M.translate(0, 0.02 + bob, 0), rot)
      drawBatches(meshes.body, model)
      for (let i = 0; i < 3; i++) {
        const c = meshes.cones[i]
        drawBatches(c.parts, M.mul(model, M.mul(c.frame, M.ry(-angle * 1.9 + i * 0.6))))
      }
      gl.enable(gl.BLEND)
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.depthMask(false)
      for (const r of rings) {
        let t = M.identity()
        if (r.kind === 'scanner' || r.kind === 'scanArc')
          t = M.mul(M.translate(0, scanY, 0), M.ry(animationTime * 0.25))
        else if (r.kind === 'baseArc') t = M.ry(animationTime * 0.13)
        drawLine(r, t)
      }
      gl.depthMask(true)
      gl.disable(gl.BLEND)
    }

    /* A simpler Canvas 2D drawing keeps the loader alive where WebGL is unavailable. */
    function renderFallback() {
      if (!ctx2d) return
      const c = ctx2d
      c.setTransform(dpr, 0, 0, dpr, 0, 0)
      c.clearRect(0, 0, width, height)
      const size = frameSize / 5.4
      c.save()
      c.translate(width * 0.5, frameY + frameSize * 0.51)
      c.rotate(-0.16)
      c.scale(size, size)
      const metal = c.createLinearGradient(-0.9, 0, 0.9, 0)
      metal.addColorStop(0, '#111719')
      metal.addColorStop(0.25, '#6d7b7d')
      metal.addColorStop(0.45, '#acb3ab')
      metal.addColorStop(0.56, '#536063')
      metal.addColorStop(0.82, '#29363a')
      metal.addColorStop(1, '#9b7852')
      c.fillStyle = metal
      c.beginPath()
      c.moveTo(-0.75, -0.8)
      c.lineTo(-0.6, -1.2)
      c.lineTo(-0.5, -1.35)
      c.lineTo(0.5, -1.35)
      c.lineTo(0.6, -1.2)
      c.lineTo(0.95, 0.9)
      c.quadraticCurveTo(0, 1.2, -0.95, 0.9)
      c.closePath()
      c.fill()
      c.fillRect(-0.39, -2.55, 0.78, 1.2)
      c.fillRect(-0.54, -1.4, 1.08, 0.22)
      c.strokeStyle = '#141c20'
      c.lineWidth = 0.035
      for (let i = 0; i < 9; i++) {
        c.beginPath()
        c.moveTo(-0.4, -2.48 + i * 0.13)
        c.lineTo(0.4, -2.56 + i * 0.13)
        c.stroke()
      }
      c.fillStyle = '#131a1d'
      c.beginPath()
      c.ellipse(0, -2.55, 0.39, 0.085, 0, 0, TAU)
      c.fill()
      for (let k = 0; k < 3; k++) {
        c.save()
        const a = (k / 3) * TAU + angle + manualAngle
        c.translate(Math.cos(a) * 0.65, 1.0 + Math.sin(a) * 0.13)
        c.rotate(-Math.cos(a) * 0.5)
        c.fillStyle = metal
        c.beginPath()
        c.ellipse(0, 0, 0.53, 0.75, 0, 0, TAU)
        c.fill()
        for (let j = 0; j < 5; j++)
          for (let i = 0; i < 5; i++) {
            const x = (i - 2) * 0.19
            const y = (j - 2) * 0.24
            if ((x * x) / 0.26 + (y * y) / 0.55 > 0.9) continue
            const g = c.createLinearGradient(x - 0.07, y, x + 0.07, y + 0.1)
            g.addColorStop(0, '#ccb681')
            g.addColorStop(0.5, '#9a835d')
            g.addColorStop(1, '#56432c')
            c.fillStyle = g
            c.beginPath()
            c.ellipse(x, y, 0.075, 0.11, 0.15, 0, TAU)
            c.fill()
          }
        c.restore()
      }
      c.restore()
      const [r, g, b] = accent.map(v => Math.round(v * 255))
      c.strokeStyle = `rgba(${r},${g},${b},.35)`
      c.lineWidth = 1
      c.beginPath()
      c.ellipse(width * 0.5, frameY + frameSize * 0.84, size * 1.95, size * 0.32, 0, 0, TAU)
      c.stroke()
    }

    /* The scene fits a square inside its box, so the bit and its rings are never cropped. */
    function resize() {
      frameSize = Math.min(width, height)
      frameY = (height - frameSize) / 2
      const cw = Math.max(1, Math.round(width * dpr))
      const ch = Math.max(1, Math.round(height * dpr))
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
      }
      if (gl && !contextLost) {
        gl.viewport(0, 0, canvas.width, canvas.height)
        const aspect = width / height
        // Keep the drill and base ring fully visible in portrait or landscape.
        const fov = 2 * Math.atan(Math.tan(0.56 / 2) * Math.max(1, 1 / aspect))
        VP = M.mul(M.perspective(fov, aspect, 0.1, 80), M.lookAt(camera, [0, 0.12, 0], [0, 1, 0]))
      }
      requestRender()
    }

    function requestRender() {
      dirty = true
      if (!raf && visible && !stopped && canvas) raf = frame(tick)
    }
    function tick(now) {
      raf = 0
      if (!visible || stopped) {
        lastTime = 0
        return
      }
      const elapsed = lastTime ? Math.max(0, (now - lastTime) / 1000) : 1 / 60
      const dt = Math.min(elapsed, 0.065)
      lastTime = now
      const running = !paused && !reduce
      if (running) {
        animationTime += dt
        angle += dt * ROTATION_RATE
      }
      const ease = reduce ? 1 : 1 - Math.exp(-dt * 9)
      manualAngle = mix(manualAngle, targetAngle, ease)
      manualTilt = mix(manualTilt, targetTilt, ease)
      scanY = reduce ? 1.85 : -1.8 + ((animationTime * 0.36 + 3.65) % 4.7)
      const moving =
        Math.abs(manualAngle - targetAngle) > 0.0002 || Math.abs(manualTilt - targetTilt) > 0.0002
      if ((running || dirty || moving) && (now - lastRenderTime > 15 || dirty)) {
        if (ctx2d) renderFallback()
        else renderGL()
        lastRenderTime = now
        dirty = false
      }
      // Nothing is drawn while paused, hidden or under reduced motion, unless a drag is settling.
      if (running || moving) raf = frame(tick)
      else lastTime = 0
    }

    function start(target) {
      canvas = target
      try {
        initGL()
        canvas.addEventListener('webglcontextlost', event => {
          event.preventDefault()
          contextLost = true
        })
        canvas.addEventListener('webglcontextrestored', () => {
          contextLost = false
          try {
            initGL()
            resize()
          } catch {
            gl = null
          }
        })
      } catch (error) {
        console.warn('<drill-bit-loader>: drawing with Canvas 2D.', error)
        gl = null
        ctx2d = canvas.getContext('2d')
      }
    }

    function stop() {
      stopped = true
      if (raf) cancelFrame(raf)
      raf = 0
      if (gl && !contextLost) {
        const ext = gl.getExtension('WEBGL_lose_context')
        if (ext) ext.loseContext()
      }
    }

    scope.onmessage = ({ data }) => {
      if (data.type === 'init') {
        start(data.canvas)
        requestRender()
      } else if (data.type === 'size') {
        width = Math.max(1, data.w)
        height = Math.max(1, data.h)
        dpr = Math.min(data.dpr || 1, MAX_PIXEL_RATIO)
        if (canvas) resize()
      } else if (data.type === 'theme') {
        accent = data.accent
        line = data.line
        requestRender()
      } else if (data.type === 'state') {
        visible = data.visible
        reduce = data.reduce
        paused = data.paused
        lastTime = 0
        requestRender()
      } else if (data.type === 'turn') {
        targetAngle += data.dx
        targetTilt = clamp(targetTilt + data.dy, -0.32, 0.32)
        requestRender()
      } else if (data.type === 'stop') {
        stop()
      }
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

  const STYLE = `
:host{display:block;position:relative;overflow:hidden;isolation:isolate;min-height:120px;
  background:var(--drill-background,#0a0c0d);color:var(--drill-label-color,#889698);
  font-family:var(--drill-font,ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace)}
.effects,.ambient,.grid,.grain,canvas,.hud{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.effects{opacity:var(--drill-effects-opacity,1)}
.ambient{background:
  radial-gradient(ellipse at 50% 43%,var(--drill-glow,rgba(97,125,135,.17)),transparent 67%),
  radial-gradient(ellipse at 50% 81%,var(--drill-ambient,rgba(131,77,33,.11)),transparent 38%)}
.grid{background-image:
  linear-gradient(var(--drill-grid-color,rgba(159,173,177,.022)) 1px,transparent 1px),
  linear-gradient(90deg,var(--drill-grid-color,rgba(159,173,177,.022)) 1px,transparent 1px);
  background-size:80px 80px;
  -webkit-mask-image:radial-gradient(ellipse at 50% 48%,black 3%,transparent 68%);
  mask-image:radial-gradient(ellipse at 50% 48%,black 3%,transparent 68%)}
.grain{opacity:var(--drill-grain-opacity,.033);background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.93' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' opacity='.6' filter='url(%23n)'/%3E%3C/svg%3E")}
canvas{display:block;pointer-events:auto;cursor:grab;touch-action:pan-y;-webkit-tap-highlight-color:transparent}
canvas:active{cursor:grabbing}
.hud path{fill:none;stroke:var(--drill-line-color,#809397);stroke-width:.65}
.hud .guide{opacity:.27}
.hud .cross{opacity:.35}
.hud .mark{stroke:var(--drill-accent,#efaa63);stroke-width:1;opacity:.45}
.callout{position:absolute;display:flex;align-items:center;gap:calc(9px * var(--scale,1));
  transform:translateY(-50%);font-size:clamp(6px,calc(7px * var(--scale,1)),9px);
  letter-spacing:calc(1.4px * var(--scale,1));line-height:1;white-space:nowrap;pointer-events:none}
.callout::before{content:'';width:calc(28px * var(--scale,1));height:1px;
  background:var(--drill-line-color,#809397);opacity:.4}
.callout i{width:3px;height:3px;border-radius:50%;background:var(--drill-accent,#efaa63)}
.callout b{font-weight:400;color:var(--drill-label-strong,#b7c0bf)}
.callout[hidden]{display:none}
`

  class DrillBitLoader extends HTMLElement {
    static observedAttributes = ['paused']

    constructor() {
      super()
      const root = this.attachShadow({ mode: 'open' })
      root.innerHTML = `<style>${STYLE}</style><div class="effects"><div class="ambient"></div><div class="grid"></div><div class="grain"></div></div><canvas part="canvas" role="img" aria-label="Loading"></canvas><svg class="hud" preserveAspectRatio="none"><path class="guide"></path><path class="cross"></path><path class="guide"></path><path class="mark"></path></svg><div class="callout" data-at="top"><i></i><span>01 <b>/</b> THREADED CONNECTION</span></div><div class="callout" data-at="bottom"><i></i><span>02 <b>/</b> CUTTING STRUCTURE</span></div>`
      this.cv = root.querySelector('canvas')
      this.hud = root.querySelector('.hud')
      this.callouts = root.querySelectorAll('.callout')
      this.vis = true
    }

    connectedCallback() {
      // A canvas that has handed its drawing to a worker cannot hand it over again, so a moved
      // element starts afresh with a new one.
      if (this.started) {
        const fresh = this.cv.cloneNode()
        this.cv.replaceWith(fresh)
        this.cv = fresh
      }
      this.started = true
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
      // The backdrop is CSS and follows the theme by itself; the scan ring and the guides are
      // drawn, so their colours are read again on a timer and sent only when they changed.
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

    /* The guides and callouts share the scene's square, so they stay on the bit at any size. */
    layout() {
      const w = Math.max(1, this.clientWidth)
      const h = Math.max(1, this.clientHeight)
      this.send({ type: 'size', w, h, dpr: devicePixelRatio || 1 })
      const s = Math.min(w, h)
      const x0 = (w - s) / 2
      const y0 = (h - s) / 2
      const X = n => x0 + s * n
      const Y = n => y0 + s * n
      const left = X(0.15)
      const right = X(0.84)
      const top = Y(0.097)
      const bottom = Y(0.795)
      const corner = s * 0.018
      const cross = s * 0.005
      this.hud.setAttribute('viewBox', `0 0 ${w} ${h}`)
      const [corners, crossPath, leaders, mark] = this.hud.children
      corners.setAttribute(
        'd',
        `M${left + corner} ${top}H${left}V${top + corner} M${right - corner} ${top}H${right}V${top + corner} M${left + corner} ${bottom}H${left}V${bottom - corner} M${right - corner} ${bottom}H${right}V${bottom - corner}`,
      )
      crossPath.setAttribute(
        'd',
        `M${X(0.495) - cross} ${Y(0.815)}h${cross * 2}m${-cross} ${-cross}v${cross * 2}`,
      )
      leaders.setAttribute(
        'd',
        `M${X(0.717)} ${Y(0.23)}H${X(0.701)}L${X(0.674)} ${Y(0.261)}H${X(0.654)} M${X(0.746)} ${Y(0.688)}H${X(0.732)}L${X(0.698)} ${Y(0.665)}H${X(0.686)}`,
      )
      mark.setAttribute('d', `M${left} ${bottom - s * 0.003}v${s * 0.003}h${s * 0.018}`)
      const [topCallout, bottomCallout] = this.callouts
      // Small boxes have no room for the callouts beside the bit.
      const place = (el, px, py) => {
        el.style.left = X(px) + 'px'
        el.style.top = Y(py) + 'px'
        el.style.setProperty('--scale', String(s / 1000))
        el.hidden = s < 650
      }
      place(topCallout, 0.724, 0.227)
      place(bottomCallout, 0.754, 0.689)
    }

    readTheme() {
      const cs = getComputedStyle(this)
      const accent = cs.getPropertyValue('--drill-accent')
      const line = cs.getPropertyValue('--drill-line-color')
      const key = `${accent}|${line}`
      if (key === this.key) return
      this.key = key
      this.send({
        type: 'theme',
        accent: toRgb(accent, '#efaa63'),
        line: toRgb(line, '#809397'),
      })
    }
  }
  customElements.define('drill-bit-loader', DrillBitLoader)
})()

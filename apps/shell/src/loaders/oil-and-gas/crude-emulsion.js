// Crude Emulsion. A scene for the oil-and-gas kit (kit.js), which draws it in a worker.
kit.define('crude-emulsion', (c, w, h, t, S, dt, og) => {
  const lw = 170,
    lh = Math.round((170 * h) / w)
  if (!S.o || S.o.height !== lh) {
    S.o = og.layer(lw, lh)
    S.x = S.o.getContext('2d')
    S.id = S.x.createImageData(lw, lh)
  }
  const a = og.A.split(',').map(Number),
    bg = og._b,
    d = S.id.data,
    B = [],
    mn = Math.min(lw, lh)
  for (let i = 0; i < 7; i++)
    B.push([
      lw / 2 + Math.sin(t * (0.4 + i * 0.07) + i * 2) * lw * 0.26,
      lh / 2 + Math.cos(t * (0.33 + i * 0.05) + i * 1.3) * lh * 0.22,
      mn * (0.085 + 0.03 * Math.sin(i * 1.7)),
    ])
  for (let y = 0; y < lh; y++)
    for (let x = 0; x < lw; x++) {
      let v = 0
      for (let j = 0; j < 7; j++) {
        const dx = x - B[j][0],
          dy = y - B[j][1]
        v += (B[j][2] * B[j][2]) / (dx * dx + dy * dy + 1)
      }
      const k = (y * lw + x) * 4
      let r = bg[0],
        g = bg[1],
        b = bg[2]
      if (v > 1) {
        const dep = Math.min(1, (v - 1) / 2.5),
          rim = Math.pow(Math.max(0, 1 - (v - 1) / 0.6), 2)
        r = 16 + (1 - dep) * 22 + a[0] * rim
        g = 9 + (1 - dep) * 9 + a[1] * rim
        b = 6 + a[2] * rim
      } else if (v > 0.55) {
        const o = ((v - 0.55) / 0.45) ** 2 * 0.35
        // A halo of the accent, blended into the background so it reads on a light one too.
        r += (a[0] - r) * o
        g += (a[1] - g) * o
        b += (a[2] - b) * o
      }
      d[k] = r > 255 ? 255 : r
      d[k + 1] = g > 255 ? 255 : g
      d[k + 2] = b > 255 ? 255 : b
      d[k + 3] = 255
    }
  S.x.putImageData(S.id, 0, 0)
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'
  c.drawImage(S.o, 0, 0, w, h)
  c.globalCompositeOperation = 'lighter'
  for (const [bx, by, br] of B)
    og.glow(
      c,
      ((bx - br * 0.35) / lw) * w,
      ((by - br * 0.4) / lh) * h,
      (br / lw) * w * 0.35,
      '255,255,255',
      0.14,
    )
  c.globalCompositeOperation = 'source-over'
})

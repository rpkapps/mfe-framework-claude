/**
 * The browser half of `tools/diagrams/render.mjs`. It is bundled once into
 * `node_modules/.cache/diagrams/` and loaded by the headless page, because
 * `@excalidraw/excalidraw` ships an ES module that imports React, roughjs and a dozen
 * other bare specifiers: nothing a browser can resolve on its own, and nothing this
 * repository may fetch from a CDN.
 */

import { exportToSvg } from '@excalidraw/excalidraw'

globalThis.renderScene = async scene => {
  const svg = await exportToSvg({
    elements: scene.elements,
    files: scene.files ?? {},
    appState: {
      ...scene.appState,
      // Light colours: the docs site darkens the committed SVG with CSS.
      exportWithDarkMode: false,
      // Transparent, so the figure sits on whatever background the page has.
      exportBackground: false,
      // The scene travels inside the SVG, so the committed file is also the source
      // a reader can drop back onto excalidraw.com.
      exportEmbedScene: true,
    },
    exportPadding: 16,
  })

  return svg.outerHTML
}

globalThis.renderSceneReady = true

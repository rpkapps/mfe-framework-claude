/* <bounce-loader> — the logo bouncing on its shadow, with squash and stretch. Themable via CSS
   custom properties on the element or any ancestor:
   --bounce-background      the backdrop: a colour, gradient, image or transparent (default #111217)
   --bounce-accent          the logo's disc and its shadow   (default #e50035)
   --bounce-mark            the mark on the disc             (default #fff)
   --bounce-shadow-opacity  the shadow's strength when the logo lands, 0–1 (default .26)
   --bounce-size            the logo's width and height      (default 88px)
   --bounce-floor           how far down the box the logo lands (default 50% + .84 × its size)
   --bounce-speed           playback multiplier              (default 1)

   The `paused` attribute stops the bounce where it stands, and reduced motion rests the logo on
   the floor. It is CSS animation of transforms and opacity only, which the browser runs off the
   main thread, so it keeps moving while the page's own scripts load and boot.

   The shell's build minifies this into index.html, which runs it when the deployment chose it
   (SHELL_LOADER); the loader's styles set each property from a Tecton token.
*/
;(() => {
  if (customElements.get('bounce-loader')) return

  const DURATION = 'calc(0.96s / var(--bounce-speed, 1))'
  const SIZE = 'var(--bounce-size, 88px)'

  /* Every keyframe is a plain value, with no custom property in it, and each animated box is a
     layer of its own: that is what lets the browser run the bounce on the compositor, so it stays
     smooth while the main thread is busy. The travel is a percentage of the logo's own height,
     and the shadow's strength is its wrapper's opacity. */
  const STYLE = `
:host{display:block;position:relative;overflow:hidden;min-height:120px;background:var(--bounce-background,#111217);
  --floor:var(--bounce-floor,calc(50% + ${SIZE} * .84))}
.shadow{position:absolute;left:50%;top:calc(var(--floor) + 6px);width:calc(${SIZE} * .94);height:9px;
  margin-left:calc(${SIZE} * -.47);opacity:var(--bounce-shadow-opacity,.26)}
.shadow div{width:100%;height:100%;border-radius:50%;background:var(--bounce-accent,#e50035);filter:blur(5px);
  animation:shadow ${DURATION} infinite;will-change:transform,opacity}
.position{position:absolute;left:50%;top:calc(var(--floor) - ${SIZE});width:${SIZE};height:${SIZE};margin-left:calc(${SIZE} * -.5)}
.motion,.squash{width:100%;height:100%;will-change:transform}
.motion{animation:bounce ${DURATION} infinite}
.squash{transform-origin:center bottom;animation:squash ${DURATION} infinite}
svg{display:block;width:100%;height:100%}
.disc{fill:var(--bounce-accent,#e50035)}
.mark{fill:var(--bounce-mark,#fff)}
@keyframes bounce{
  0%,100%{transform:translateY(0);animation-timing-function:cubic-bezier(.23,.05,.27,1)}
  48%{transform:translateY(-64%);animation-timing-function:cubic-bezier(.65,0,.85,.48)}}
@keyframes squash{
  0%,100%{transform:scale(1.17,.83)}
  16%{transform:scale(.92,1.08)}
  48%{transform:scale(1.025,.975)}
  82%{transform:scale(.94,1.06)}}
@keyframes shadow{
  0%,100%{transform:scaleX(1);opacity:1;animation-timing-function:ease-out}
  48%{transform:scaleX(.42);opacity:.33;animation-timing-function:ease-in}}
:host([paused]) *{animation-play-state:paused}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
`

  // A vector drawing of the logo: the disc, and the mark cut off at its edge.
  const LOGO = `<svg viewBox="0 0 340 340" fill="none" role="img" aria-label="Loading"><defs><clipPath id="edge"><circle cx="170" cy="170" r="164"/></clipPath></defs><circle class="disc" cx="170" cy="170" r="164"/><path class="mark" clip-path="url(#edge)" d="M86 240 103 146Q108 116 135 116H174L164 169H173L184 116H338V129H263Q250 129 247 144L233 217Q229 239 203 239H166L177 184H167L156 239Z"/></svg>`

  class BounceLoader extends HTMLElement {
    constructor() {
      super()
      this.attachShadow({ mode: 'open' }).innerHTML =
        `<style>${STYLE}</style><div class="shadow"><div></div></div>` +
        `<div class="position"><div class="motion"><div class="squash">${LOGO}</div></div></div>`
    }
  }
  customElements.define('bounce-loader', BounceLoader)
})()

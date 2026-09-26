---
'@company/mfe-build': patch
---

An SVG icon drops an element that is not a shape together with everything inside it. An icon exported from a design tool, whose `<defs><clipPath>` holds a `<rect fill="white">`, published that rect as a visible shape painted over the icon. A closing tag now closes only the element it names, so a `</title>` inside a `<g>` no longer discards the group.

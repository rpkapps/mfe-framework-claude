---
'@company/mfe-devtools': minor
---

**Breaking:** the developer tools panel is built on the Base UI release of `@tecton/react`, and needs that release: it passes Tecton's `TectonProvider` its overlay layer, where the React Aria release had `PortalProvider`. `react-aria-components` is no longer a development dependency. The public API (`MfeDevtools`, the settings and the store) is unchanged.

The panel behaves as before, with two differences in its header's overflow menu, where a narrow dock moves the outline toggle and the dock control: the outline entry is a checkbox item and the panel positions are a radio group, so a screen reader announces which one is on rather than the menu drawing a check mark only.

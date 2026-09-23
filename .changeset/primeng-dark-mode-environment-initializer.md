---
'@company/mfe-nx': patch
---

The generated `src/primeng.ts`'s `providePrimeNgForMfe()` now binds PrimeNG's dark mode itself, through an environment initializer that reads `injectMfeMount().scopeRoot` and `overlayRoot` and toggles the dark class in an `effect` over `injectTheme()`. `bindPrimeNgDarkModeToShell()` is gone, along with the constructor call it needed in the generated root and Widget components: an environment initializer sees the mount's roots before the application boots, where an app initializer previously fired too early.

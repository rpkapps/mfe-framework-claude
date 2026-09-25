---
'@company/mfe-build': patch
---

A Widget's schemas passed as shorthand properties (`createWidget({ inputSchema, outputSchema, … })`), directly or through a spread contract object, are read like `inputSchema: inputSchema`: an import from the container's own module is re-exported and a top-level const is copied. A schema bound under the field's own name is exported as it is from the generated `.mfe/widgets/<id>.contract.ts`, which no longer declares `inputSchema` or `outputSchema` twice.

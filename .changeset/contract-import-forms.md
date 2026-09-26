---
'@company/mfe-build': patch
---

A generated Widget contract entry repeats each import in the form the entry wrote it. `import * as z from 'zod'`, Zod's documented style, generated `import { * as z } from 'zod'`, which does not parse; a namespace import is now `import * as z from …`, a default import `import x from …`, and a default and named imports of one module share a statement. `ImportedBinding` carries the form as `kind`.

#!/usr/bin/env node
// Browser support policy release gate. Run from the workspace root with
// `pnpm browser-matrix`.
// Node strips the TypeScript types from ./src at load time (unflagged since
// Node 22.18), so this entry needs no build step.
import { main } from './src/report.ts'

process.exitCode = await main()

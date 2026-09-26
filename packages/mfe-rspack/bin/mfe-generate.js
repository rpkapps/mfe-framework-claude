#!/usr/bin/env node
// A file of its own rather than `dist/cli/generate.js` itself: a package manager links a bin only
// when its file exists at install, and in this workspace `dist/` is built after the install.
import { main } from '../dist/cli/generate.js'

process.exitCode = await main(process.argv.slice(2))

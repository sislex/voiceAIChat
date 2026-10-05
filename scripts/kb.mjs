#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { main } from '../packages/kb-tools/kb.mjs'
export { gitHistoryPaths } from '../packages/kb-tools/kb.mjs'
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()

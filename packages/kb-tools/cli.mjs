#!/usr/bin/env node
const args = process.argv.slice(2)
try {
  const module = await import(['prepare', 'verify', 'search', 'context', 'impact'].includes(args[0]) ? './search.mjs' : './kb.mjs')
  module.main(args)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}

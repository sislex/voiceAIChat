import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { StandDiagnostics } from '../e2e/standDiagnostics.ts'

test('retains last 80 lines, both streams and unfinished output', () => {
  const log = new StandDiagnostics([])
  for (let i = 0; i < 100; i++) log.write('stdout', `line-${i}\n`)
  log.write('stderr', 'fatal')
  const message = log.error('failed').message
  assert.equal(message.split('\n').length, 81)
  assert.ok(!message.includes('line-20\n'))
  assert.ok(message.endsWith('[stderr] fatal'))
})

test('redacts split secrets in captured and live output', () => {
  const log = new StandDiagnostics(['internal-token', 'mcp-secret'], true)
  const output = []
  const original = process.stderr.write
  process.stderr.write = chunk => { output.push(String(chunk)); return true }
  try {
    log.write('stdout', 'VC_INTERNAL_TOKEN=internal-')
    assert.equal(output.length, 0)
    log.write('stdout', 'token\n')
    log.write('stderr', 'mcp-')
    log.write('stderr', 'secret')
    assert.ok(!log.error('internal-token').message.includes('mcp-secret'))
    log.end('stderr')
    assert.ok(!output.join('').includes('internal-token'))
    assert.ok(!output.join('').includes('mcp-secret'))
    assert.match(output.join(''), /REDACTED/)
  } finally { process.stderr.write = original }
})

test('oversized unterminated lines stay bounded and are omitted', () => {
  const log = new StandDiagnostics(['secret'])
  for (let i = 0; i < 100; i++) log.write('stdout', 'x'.repeat(8192))
  log.write('stdout', 'secret\nnext\n')
  assert.match(log.error('failed').message, /oversized line omitted/)
  assert.ok(log.error('failed').message.length < 200)
})

test('child exit includes stderr and final partial stdout', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("last"); process.stderr.write("EADDRINUSE\\n"); process.exitCode=1'])
  const log = new StandDiagnostics([])
  log.attach(child)
  await assert.rejects(log.waitFor('http://127.0.0.1:1', 'Kanban', child, 5), /кодом 1[\s\S]*EADDRINUSE[\s\S]*last|кодом 1[\s\S]*last[\s\S]*EADDRINUSE/)
})

test('health timeout contains logs and endpoint', async () => {
  const log = new StandDiagnostics([])
  log.write('stderr', 'migration waiting\n')
  await assert.rejects(log.waitFor('http://127.0.0.1:1', 'Core', { exitCode: null, signalCode: null }, 0.03), /не поднялся[\s\S]*127.0.0.1[\s\S]*migration waiting/)
})

test('signal exits include the signal and captured output', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stderr.write("stopping\\n"); process.kill(process.pid, "SIGTERM")'])
  const log = new StandDiagnostics([])
  log.attach(child)
  await assert.rejects(log.waitFor('http://127.0.0.1:1', 'Kanban', child, 5), /сигнал SIGTERM[\s\S]*stopping/)
})

test('UTF-8 secrets split between bytes are redacted', async () => {
  const secret = 'секрет'
  const child = spawn(process.execPath, ['-e', `const b=Buffer.from("${secret}"); process.stdout.write(b.subarray(0,3)); setTimeout(()=>process.stdout.write(b.subarray(3)), 20)`])
  const log = new StandDiagnostics([secret])
  log.attach(child)
  await new Promise(resolve => child.once('close', resolve))
  assert.match(log.error('failed').message, /REDACTED/)
  assert.ok(!log.error('failed').message.includes(secret))
})

test('spawn errors are diagnosed', async () => {
  const child = spawn('/nonexistent-e2e-command')
  const log = new StandDiagnostics([])
  log.attach(child)
  await assert.rejects(log.waitFor('http://127.0.0.1:1', 'Core', child, 2), /ENOENT/)
})

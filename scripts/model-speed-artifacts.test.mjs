import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { archiveFiles, root } from './shared-chat-artifacts.mjs'

const snapshot = JSON.parse(readFileSync(join(root, 'dependency-snapshots.json'), 'utf8'))
const ownerSnapshot = JSON.parse(readFileSync(join(root, 'vendor/owner-artifacts.json'), 'utf8'))

async function packageText(name) {
  const row = snapshot.packages.find(item => item.name === name)
  assert(row, `Missing ${name} artifact`)
  const files = await archiveFiles(readFileSync(join(root, 'vendor', row.asset)))
  return [...files.entries()]
    .filter(([path]) => /\.(?:js|css|d\.ts)$/.test(path))
    .map(([, bytes]) => bytes.toString('utf8'))
    .join('\n')
}

// @testCase TC-UI-01
test('new-chat artifact contains the current Codex catalog and nested legacy models', async () => {
  const text = (await packageText('@sislexa/core-ui')) + (await packageText('@voicechat/shared'))
  for (const id of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']) {
    assert.match(text, new RegExp(id.replaceAll('.', '\\.')))
  }
  assert.match(text, /Скорость работы/)
  assert.match(text, /Модели/)
})

// @testCase TC-UI-02
test('started-chat artifact exposes all models and an inline current-model check', async () => {
  const text = await packageText('@sislexa/core-ui')
  assert.match(text, /Все модели/)
  assert.match(text, /Текущая модель/)
  assert.match(text, /model-check/)
})

// @testCase TC-UI-03
test('speed menu contains five radio efforts and an independent deep-thinking switch', async () => {
  const text = await packageText('@sislexa/core-ui')
  for (const label of ['Маленькая', 'Средняя', 'Высокая', 'Экстра высокая', 'Максимальная']) {
    assert.match(text, new RegExp(label))
  }
  assert.match(text, /menuitemradio/)
  assert.match(text, /Глубокое мышление/)
  assert.match(text, /switch/)
})

// @testCase TC-UI-04
test('composer artifact places controls after a rounded input and constrains submenus', async () => {
  const text = await packageText('@sislexa/core-ui')
  assert.match(text, /composer-stack/)
  assert.match(text, /composer-controls/)
  assert.match(text, /border-radius:\s*18px/)
  assert.match(text, /max-width:\s*calc\(100vw/)
})

// @testCase TC-REG-02
test('public chat artifacts do not expose the removed prompt assistant', async () => {
  const core = await packageText('@sislexa/core-ui')
  const chat = await packageText('@voicechat/chat-app')
  assert.doesNotMatch(core, /Подсказать формулировку/)
  assert.doesNotMatch(chat, /suggestPrompts/)
})

// @testCase TC-NEG-01
test('runner artifact contains capability-safe reasoning mappings', async () => {
  const row = ownerSnapshot.packages.find(item => item.name === '@sislex/llm-runner')
  assert(row)
  const files = await archiveFiles(readFileSync(join(root, 'vendor', row.asset)))
  const text = [...files.entries()]
    .filter(([path]) => path.endsWith('.ts'))
    .map(([, bytes]) => bytes.toString('utf8'))
    .join('\n')
  assert.match(text, /model_reasoning_effort/)
  assert.match(text, /model_reasoning_summary/)
  assert.match(text, /reasoningEffort === 'max' \? 'xhigh'/)
  assert.match(text, /req\.deepThinking \? 'max'/)
})

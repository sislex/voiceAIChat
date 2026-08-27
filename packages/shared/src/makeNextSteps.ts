// Чипы «следующий шаг» после ответа ассистента (roadmap-4 п.8): три подсказки по состоянию проекта.
// Чистая функция над фактами о проекте — MakePane собирает факты, чат показывает чипы.

export interface MakeProjectFacts {
  hasTokens: boolean
  hasTests: boolean
  hasStories: boolean
  published: boolean
  openComments: number
  a11yIssues: number | null
  files: number
}

export interface MakeNextStep { id: string; title: string; prompt: string }

export function makeNextSteps(f: MakeProjectFacts, limit = 3): MakeNextStep[] {
  const out: MakeNextStep[] = []
  if (f.openComments > 0) out.push({ id: 'comments', title: `Исправить замечания (${f.openComments})`, prompt: 'Исправь открытые замечания к превью из контекста проекта: по каждому — что изменил. ' })
  if (f.a11yIssues && f.a11yIssues > 0) out.push({ id: 'a11y', title: 'Починить доступность', prompt: 'Проверь доступность страницы (контраст, alt, подписи полей, заголовки, фокус) и исправь найденное. ' })
  if (!f.hasTokens) out.push({ id: 'tokens', title: 'Завести дизайн-токены', prompt: 'Вынеси цвета, отступы, радиусы и шрифты в CSS-переменные :root (tokens.css) и переведи стили на них. ' })
  out.push({ id: 'responsive', title: 'Проверить адаптив', prompt: 'Проверь вёрстку на 375px и 768px: переносы, перекрытия, размеры кликабельных элементов — и исправь. ' })
  out.push({ id: 'dark', title: 'Тёмная тема', prompt: 'Добавь тёмную тему через токены: набор [data-theme="dark"] и переключатель в шапке с сохранением выбора. ' })
  if (f.hasStories && !f.hasTests) out.push({ id: 'tests', title: 'Тесты компонентов', prompt: 'Напиши тесты компонентов (*.test.tsx: test(name, async (t) => …) с t.render/t.click и expect) для основных компонентов и запусти проверку. ' })
  if (!f.hasStories && f.files > 3) out.push({ id: 'stories', title: 'Добавить сториз', prompt: 'Вынеси повторяющиеся блоки в компоненты src/components и добавь к ним сториз (CSF) для вкладки «Компоненты». ' })
  out.push({ id: 'motion', title: 'Аккуратные анимации', prompt: 'Добавь сдержанные переходы (hover, появление секций) с уважением к prefers-reduced-motion. ' })
  if (!f.published) out.push({ id: 'publish', title: 'Подготовить к публикации', prompt: 'Проверь мета-теги, title, favicon, Open Graph и 404-состояния — подготовь проект к публикации. ' })
  return out.slice(0, limit)
}

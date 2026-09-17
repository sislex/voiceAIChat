import type { BrowserContext } from 'playwright'
import type { BrowserCookieInfo, BrowserCookieRequest, BrowserEnvironmentOptions, BrowserEnvironmentState } from '@voicechat/shared'

/**
 * The conditions the person is actually in. A page looks and behaves differently
 * under a dark system theme, with reduced motion, in high contrast, on a phone
 * that just lost the network, or from another country — and none of that could
 * be reproduced from the model's side, so those bugs were only ever found by a
 * person who happened to have that setup.
 *
 * All of it is context-level in Playwright: it survives navigation and applies
 * to every tab of the session, which is exactly how a real machine behaves.
 */

/** Emulation currently in effect, kept on the session so `status` can report it. */
export interface EnvironmentHolder {
  context: BrowserContext
  environment?: BrowserEnvironmentState
}

const DEFAULT_ENVIRONMENT: BrowserEnvironmentState = {
  colorScheme: 'light',
  reducedMotion: 'no-preference',
  forcedColors: 'none',
  offline: false,
  geolocation: null,
  permissions: []
}

export function currentEnvironment(session: EnvironmentHolder): BrowserEnvironmentState {
  return session.environment ?? DEFAULT_ENVIRONMENT
}

export async function applyEnvironment(session: EnvironmentHolder, options: BrowserEnvironmentOptions): Promise<BrowserEnvironmentState> {
  const next: BrowserEnvironmentState = { ...currentEnvironment(session) }
  const media: { colorScheme?: 'light' | 'dark' | 'no-preference'; reducedMotion?: 'reduce' | 'no-preference'; forcedColors?: 'active' | 'none' } = {}
  if (options.colorScheme !== undefined) { media.colorScheme = options.colorScheme; next.colorScheme = options.colorScheme }
  if (options.reducedMotion !== undefined) { media.reducedMotion = options.reducedMotion; next.reducedMotion = options.reducedMotion }
  if (options.forcedColors !== undefined) { media.forcedColors = options.forcedColors; next.forcedColors = options.forcedColors }
  if (Object.keys(media).length) {
    // emulateMedia живёт на странице, а не на контексте: применяем ко всем
    // вкладкам, иначе вторая вкладка сессии осталась бы в светлой теме.
    for (const page of session.context.pages()) await page.emulateMedia(media).catch(() => undefined)
  }
  if (options.offline !== undefined) {
    await session.context.setOffline(options.offline)
    next.offline = options.offline
  }
  if (options.geolocation !== undefined) {
    if (options.geolocation === null) {
      await session.context.setGeolocation(null)
      next.geolocation = null
    } else {
      const { latitude, longitude, accuracy } = options.geolocation
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
        throw new Error('Координаты вне допустимого диапазона: широта −90…90, долгота −180…180')
      }
      // Без разрешения geolocation страница получит отказ, даже если координата
      // задана: браузер спросил бы человека, а спрашивать здесь некого.
      await session.context.grantPermissions(['geolocation']).catch(() => undefined)
      await session.context.setGeolocation({ latitude, longitude, ...(accuracy !== undefined ? { accuracy } : {}) })
      next.geolocation = { latitude, longitude, ...(accuracy !== undefined ? { accuracy } : {}) }
      if (!next.permissions.includes('geolocation')) next.permissions = [...next.permissions, 'geolocation']
    }
  }
  if (options.permissions !== undefined) {
    if (options.permissions.length === 0) {
      await session.context.clearPermissions()
      next.permissions = []
    } else {
      await session.context.grantPermissions(options.permissions)
      next.permissions = [...new Set([...next.permissions, ...options.permissions])]
    }
  }
  session.environment = next
  return next
}

/** Emulation applies to a tab opened later, too — otherwise it looks random. */
export async function applyEnvironmentToPage(session: EnvironmentHolder, page: { emulateMedia(options: unknown): Promise<void> }): Promise<void> {
  const environment = session.environment
  if (!environment) return
  await page.emulateMedia({
    colorScheme: environment.colorScheme,
    reducedMotion: environment.reducedMotion,
    forcedColors: environment.forcedColors
  }).catch(() => undefined)
}

export async function runCookieCommand(context: BrowserContext, request: BrowserCookieRequest): Promise<{ cookies: BrowserCookieInfo[]; total: number }> {
  if (request.action === 'add') {
    if (!request.name || request.value === undefined) throw new Error('Для add нужны name и value')
    if (!request.url && !request.domain) throw new Error('Для add нужен url или domain')
    await context.addCookies([{
      name: request.name,
      value: request.value,
      ...(request.url ? { url: request.url } : {}),
      ...(request.domain ? { domain: request.domain, path: request.path ?? '/' } : {}),
      ...(request.expires !== undefined ? { expires: request.expires } : {}),
      ...(request.httpOnly !== undefined ? { httpOnly: request.httpOnly } : {}),
      ...(request.secure !== undefined ? { secure: request.secure } : {}),
      ...(request.sameSite ? { sameSite: request.sameSite } : {})
    }])
  } else if (request.action === 'clear') {
    const all = await context.cookies()
    if (!request.name) await context.clearCookies()
    else {
      // Точечное удаление: Playwright умеет очищать всё, поэтому оставшиеся
      // возвращаем назад — иначе «убрать одну cookie» разлогинивало сессию.
      await context.clearCookies()
      const keep = all.filter((cookie) => cookie.name !== request.name)
      if (keep.length) await context.addCookies(keep)
    }
  }
  const cookies = await context.cookies()
  const filtered = request.action === 'list' && request.name ? cookies.filter((cookie) => cookie.name === request.name) : cookies
  return {
    total: filtered.length,
    // Значение cookie сессии — это доступ к аккаунту; в ход модели уезжает
    // только длина, а полное значение остаётся в браузере.
    cookies: filtered.slice(0, 100).map((cookie) => ({
      name: cookie.name,
      value: cookie.value.length > 12 ? `${cookie.value.slice(0, 4)}…(${cookie.value.length} симв.)` : cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      ...(cookie.expires !== undefined && cookie.expires > 0 ? { expires: cookie.expires } : {}),
      ...(cookie.httpOnly ? { httpOnly: true } : {}),
      ...(cookie.secure ? { secure: true } : {}),
      ...(cookie.sameSite ? { sameSite: String(cookie.sameSite) } : {})
    }))
  }
}

/** Video and audio of the page: what is playing, and the controls a person uses. */
export function mediaScript(selector: string | null, action: string | null, seconds: number | null): string {
  return `(async () => {
    const nodes = [...document.querySelectorAll(${selector ? JSON.stringify(selector) : "'video,audio'"})].filter(node => node.localName === 'video' || node.localName === 'audio');
    if (!nodes.length) return null;
    const act = ${action ? JSON.stringify(action) : 'null'};
    if (act) {
      const target = nodes[0];
      // play() отклоняется, когда автовоспроизведение запрещено, — это не сбой
      // раннера, а то же самое, что увидел бы человек без клика по странице.
      if (act === 'play') { try { await target.play(); } catch (error) { return { error: String(error && error.message || error) }; } }
      if (act === 'pause') target.pause();
      if (act === 'mute') target.muted = true;
      if (act === 'unmute') target.muted = false;
    }
    if (${seconds === null ? 'false' : 'true'}) nodes[0].currentTime = ${seconds ?? 0};
    return nodes.slice(0, 10).map((node, index) => ({
      selector: ${selector ? JSON.stringify(selector) : 'null'} || (node.localName + ':nth-of-type(' + (index + 1) + ')'),
      kind: node.localName,
      paused: node.paused === true,
      muted: node.muted === true,
      currentTime: Math.round(node.currentTime * 10) / 10,
      duration: Number.isFinite(node.duration) ? Math.round(node.duration * 10) / 10 : 0,
      volume: Math.round(node.volume * 100) / 100,
      readyState: node.readyState,
      ...(node.currentSrc ? { src: node.currentSrc } : {})
    }));
  })()`
}

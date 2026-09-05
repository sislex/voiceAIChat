// REST инструмента Make: состояние проекта разговора, чтение/запись/удаление/
// переименование файлов, снимки и откат, сброс к заготовке — для редактора кода в
// панели. Плюс отдача файлов проекта для iframe-превью и ZIP-экспорт под
// `/api/preview/make/…`: там же, где прокси Web Reader, действует preview-cookie
// (iframe и ссылка «Скачать» не умеют слать Bearer). Все маршруты проверяют, что
// разговор принадлежит пользователю; изменения рассылаются владельцу `make.changed`.

import { createHash } from 'node:crypto'
import type { MakeProjectFileEntry, MakeProjectLinkInfo, MakeProjectLinkStatus, MakeProjectPullResult } from '@voicechat/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { SlidingWindowLimiter } from '../make/rateLimit.js'
import { MAKE_PROJECT_SYNC_MAX_FILES, MAKE_COMMENTS_SYNC_PATH as COMMENTS_SYNC_PATH, MAKE_GALLERY_PAGE, MAKE_PUBLIC_COMMENTS_PAGE, MAKE_SNAPSHOT_PREVIEW, MAKE_PUBLIC_PREFIX, MAKE_SLUG_PREFIX, MAKE_STORIES_PAGE, isMakeTranspiledPath, makeMimeType, normalizeMakePath, type MockResponse, MAKE_TESTS_PAGE } from '@voicechat/shared'
import { transpileForPreview } from '../make/transpile.js'
import { renderGalleryPage, renderStoriesPage, renderTestsPage, storyUsageSnippets } from '../make/stories.js'
import { readZip, ZipReadError } from '../make/zipRead.js'
import { importFromUrl, ImportUrlError } from '../make/importUrl.js'
import type { VoiceChatDb } from '../db/database.js'
import { MakeError, MakeWorkspaces } from '../make/workspace.js'
import type { MakeLibrary } from '../make/library.js'
import type { MakeHub } from '../make/hub.js'

export interface MakeRoutesDeps {
  db: VoiceChatDb
  workspaces: MakeWorkspaces
  hub: MakeHub
  library: MakeLibrary
  /** Живая доска после связывания карточки с дизайном из панели Make. */
  boardChanged?: (projectId: string) => void
  /** Ограничители импорта — подменяются в тестах. */
  importLimiter?: SlidingWindowLimiter
  importUrlLimiter?: SlidingWindowLimiter
  passwordLimiter?: SlidingWindowLimiter
  /**
   * Файловая система машины проекта, только чтение (реестр агентов живёт в
   * server.ts). Пути абсолютные на машине. Записи здесь намеренно нет: Make
   * копирует файлы репозитория к себе, но обратно в общую копию проекта не
   * пишет — она принадлежит git-потоку, а файл мимо коммита оставлял её dirty.
   */
  machineFs?: {
    list(agentId: string, path: string): Promise<import('@voicechat/shared').FsResult>
    read(agentId: string, path: string): Promise<import('@voicechat/shared').FsResult>
    isOnline(agentId: string): boolean
  }
}

/** Скрипт «выбрать элемент» для превью: по сообщению родителя подсвечивает элементы и отдаёт выбранный. */
/** Код использования для витрины (п.28): читаем исходники сториз проекта; ошибки чтения — просто без кода. */
async function galleryUsage(workspaces: MakeWorkspaces, conversationId: string): Promise<Record<string, Record<string, string>>> {
  const out: Record<string, Record<string, string>> = {}
  for (const f of await workspaces.stories(conversationId).catch(() => [])) {
    // read(), а не publicFile(): последний отдаёт транспилированный JS, а сниппеты нужны из исходного JSX.
    const src = await workspaces.read(conversationId, f.path).catch(() => null)
    if (src) out[f.path] = storyUsageSnippets(f.path, src.content)
  }
  return out
}

/** Плавающая кнопка «Комментарий» на странице публикации (п.34): имя + текст → POST __comments__, без window.prompt. */
function guestCommentsWidget(base: string): string {
  return `<div data-vc-guest-comments style="position:fixed;right:16px;bottom:16px;z-index:2147483000;font:14px/1.4 system-ui,sans-serif">
<button type="button" data-vc-gc-open style="border:0;border-radius:24px;padding:10px 16px;background:#4f7cff;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.2);cursor:pointer">💬 Комментарий</button>
<form data-vc-gc-form hidden style="width:280px;background:#fff;color:#1a1d23;border-radius:12px;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:grid;gap:8px">
<strong>Комментарий автору</strong>
<input name="name" placeholder="Ваше имя (необязательно)" maxlength="60" style="padding:6px 8px;border:1px solid #d5d8e0;border-radius:6px;font:inherit">
<textarea name="text" required rows="3" maxlength="2000" placeholder="Что поправить или что понравилось?" style="padding:6px 8px;border:1px solid #d5d8e0;border-radius:6px;font:inherit"></textarea>
<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" data-vc-gc-cancel style="border:1px solid #d5d8e0;background:#fff;border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer">Отмена</button><button type="submit" style="border:0;background:#4f7cff;color:#fff;border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer">Отправить</button></div>
<small data-vc-gc-status style="color:#666"></small>
</form></div>
<script>(function(){var root=document.querySelector('[data-vc-guest-comments]');if(!root)return;var open=root.querySelector('[data-vc-gc-open]'),form=root.querySelector('[data-vc-gc-form]'),status=root.querySelector('[data-vc-gc-status]');open.addEventListener('click',function(){form.hidden=false;open.hidden=true;form.querySelector('textarea').focus()});root.querySelector('[data-vc-gc-cancel]').addEventListener('click',function(){form.hidden=true;open.hidden=false});form.addEventListener('submit',function(e){e.preventDefault();var fd=new FormData(form);status.textContent='Отправляю…';fetch(${JSON.stringify(base)}+'__comments__',{method:'POST',headers:{'content-type':'application/json'},credentials:'same-origin',body:JSON.stringify({name:fd.get('name'),text:fd.get('text'),elementLabel:document.title||'страница'})}).then(function(r){if(!r.ok)throw new Error(r.status===429?'Слишком много сообщений, попробуйте позже':'Не удалось отправить');status.textContent='Спасибо! Комментарий появится после проверки автором.';form.querySelector('textarea').value='';setTimeout(function(){form.hidden=true;open.hidden=false;status.textContent=''},2500)}).catch(function(err){status.textContent=err.message})})})();</script>`
}

export const MAKE_INSPECTOR_SCRIPT = `<script data-vc-make-inspector>
(function(){
  if (window.parent === window) return;
  // Консоль превью: console.* и ошибки страницы уходят родителю — панель показывает их под превью.
  (function(){
    var levels = ['log','info','warn','error'];
    function fmt(a){ try { return typeof a === 'string' ? a : (a instanceof Error ? (a.message + (a.stack ? ' | ' + a.stack.split(String.fromCharCode(10)).slice(1,3).join(' | ') : '')) : JSON.stringify(a)); } catch(e){ return String(a); } }
    function send(level, args){ try { window.parent.postMessage({ type: 'vc-make.console', level: level, text: Array.prototype.map.call(args, fmt).join(' ').slice(0, 2000), at: Date.now() }, '*'); } catch(e){} }
    levels.forEach(function(l){ var orig = console[l]; console[l] = function(){ send(l, arguments); if (orig) orig.apply(console, arguments); }; });
    window.addEventListener('error', function(e){ send('error', [e.message + (e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '')]); });
    window.addEventListener('unhandledrejection', function(e){ send('error', ['Unhandled rejection: ' + fmt(e.reason)]); });
    // Сеть превью: fetch и XHR → родителю (метод, адрес, статус, время) — панель «Сеть» под превью.
    function net(kind, method, url, status, ok, started){ try { window.parent.postMessage({ type: 'vc-make.network', kind: kind, method: String(method || 'GET').toUpperCase(), url: String(url).slice(0, 500), status: status, ok: ok, ms: Math.round(performance.now() - started), at: Date.now() }, '*'); } catch(e){} }
    var origFetch = window.fetch;
    if (origFetch) window.fetch = function(input, init){ var started = performance.now(); var url = typeof input === 'string' ? input : (input && input.url) || String(input); var method = (init && init.method) || (input && input.method) || 'GET'; var slow = window.__vcSlowMs || 0; var p = origFetch.apply(this, arguments); if (slow > 0) p = p.then(function(res){ return new Promise(function(done){ setTimeout(function(){ done(res); }, slow); }); }); return p.then(function(res){ net('fetch', method, url, res.status, res.ok, started); return res; }, function(err){ net('fetch', method, url, 0, false, started); throw err; }); };
    var XO = window.XMLHttpRequest && window.XMLHttpRequest.prototype.open, XS = window.XMLHttpRequest && window.XMLHttpRequest.prototype.send;
    if (XO && XS) { window.XMLHttpRequest.prototype.open = function(method, url){ this.__vc = { method: method, url: url }; return XO.apply(this, arguments); }; window.XMLHttpRequest.prototype.send = function(){ var x = this, started = performance.now(); x.addEventListener('loadend', function(){ var m = x.__vc || {}; net('xhr', m.method, m.url, x.status, x.status >= 200 && x.status < 400, started); }); return XS.apply(this, arguments); }; }
  })();
  var on = false, hovered = null, box = null;
  function ensureBox(){ if (box) return box; box = document.createElement('div'); box.setAttribute('data-vc-make-box',''); box.style.cssText='position:fixed;pointer-events:none;border:2px solid #4f7cff;background:rgba(79,124,255,.12);z-index:2147483647;border-radius:3px;transition:all .05s'; document.documentElement.appendChild(box); return box }
  // Линейки (roadmap-4 п.19): бейдж W×H у рамки и расстояния до краёв родителя — четыре направляющие с подписями.
  var sizeBadge = null, guides = null;
  function ensureRulers(){ if (sizeBadge) return; sizeBadge = document.createElement('div'); sizeBadge.setAttribute('data-vc-make-box',''); sizeBadge.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;font:11px/1.4 ui-monospace,Menlo,monospace;background:#4f7cff;color:#fff;padding:1px 6px;border-radius:3px;white-space:nowrap'; document.documentElement.appendChild(sizeBadge); guides = []; for (var i = 0; i < 4; i++) { var g = document.createElement('div'); g.setAttribute('data-vc-make-box',''); g.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;background:rgba(255,120,0,.9);display:none'; var lbl = document.createElement('span'); lbl.style.cssText='position:absolute;font:10px/1.2 ui-monospace,Menlo,monospace;background:#ff7800;color:#fff;padding:0 3px;border-radius:2px;white-space:nowrap'; g.appendChild(lbl); document.documentElement.appendChild(g); guides.push(g); } }
  function guide(i, x, y, vertical, len, text){ var g = guides[i]; if (Math.round(len) < 2) { g.style.display = 'none'; return; } g.style.display='block'; g.style.left=x+'px'; g.style.top=y+'px'; g.style.width=(vertical ? 1 : len)+'px'; g.style.height=(vertical ? len : 1)+'px'; var l = g.firstChild; l.textContent = text; if (!vertical) { l.style.left = (len/2 - 12) + 'px'; l.style.top = '-14px'; } else { l.style.left = '3px'; l.style.top = (len/2 - 7) + 'px'; } }
  function placeRulers(el, r){ ensureRulers(); sizeBadge.style.display='block'; sizeBadge.textContent = Math.round(r.width) + ' × ' + Math.round(r.height); var above = r.top > 18; sizeBadge.style.left = r.left + 'px'; sizeBadge.style.top = (above ? r.top - 18 : r.bottom + 2) + 'px'; var p = el.parentElement; if (!p || p === document.documentElement) { guides.forEach(function(g){ g.style.display='none'; }); return; } var pr = p.getBoundingClientRect(); var cx = r.left + r.width/2, cy = r.top + r.height/2; guide(0, cx, pr.top, true, r.top - pr.top, Math.round(r.top - pr.top) + 'px'); guide(1, cx, r.bottom, true, pr.bottom - r.bottom, Math.round(pr.bottom - r.bottom) + 'px'); guide(2, pr.left, cy, false, r.left - pr.left, Math.round(r.left - pr.left) + 'px'); guide(3, r.right, cy, false, pr.right - r.right, Math.round(pr.right - r.right) + 'px'); }
  function place(el){ var r = el.getBoundingClientRect(), b = ensureBox(); b.style.left=r.left+'px'; b.style.top=r.top+'px'; b.style.width=r.width+'px'; b.style.height=r.height+'px'; b.style.display='block'; placeRulers(el, r) }
  function hide(){ if (box) box.style.display='none'; if (sizeBadge) { sizeBadge.style.display='none'; guides.forEach(function(g){ g.style.display='none'; }); } }
  function selectorOf(el){ var parts=[]; while (el && el.nodeType===1 && el !== document.documentElement){ var s = el.tagName.toLowerCase(); if (el.id){ parts.unshift(s+'#'+el.id); break } var cls = (el.className && typeof el.className==='string') ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0,2) : []; if (cls.length) s += '.'+cls.join('.'); var p = el.parentElement; if (p){ var same = Array.prototype.filter.call(p.children, function(c){ return c.tagName===el.tagName }); if (same.length>1) s += ':nth-of-type('+(Array.prototype.indexOf.call(same, el)+1)+')' } parts.unshift(s); el = p } return parts.join(' > ') }
  function onMove(e){ if (!on) return; var el = e.target; if (!el || el.hasAttribute && el.hasAttribute('data-vc-make-box')) return; hovered = el; place(el) }
  var STYLE_PROPS = ['color','background-color','font-size','font-weight','text-align','padding','margin','border-radius'];
  var selectedEl = null, savedInline = '';
  function computedOf(el){ var cs = getComputedStyle(el), out = {}; STYLE_PROPS.forEach(function(p){ out[p] = cs.getPropertyValue(p); }); return out; }
  function onClick(e){ if (!on) return; e.preventDefault(); e.stopPropagation(); var el = e.target; if (!el) return; if (selectedEl && selectedEl !== el) selectedEl.style.cssText = savedInline; selectedEl = el; savedInline = el.style.cssText; var html = el.outerHTML || ''; window.parent.postMessage({ type: 'vc-make.selected', selector: selectorOf(el), tag: el.tagName.toLowerCase(), text: (el.innerText||'').trim().slice(0,200), html: html.slice(0,1500), id: el.id || '', className: (typeof el.className === 'string' ? el.className : ''), styles: computedOf(el) }, '*'); }
  // Панель стилей родителя: применяем значения inline (мгновенно), сброс возвращает исходный style.
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.style' || !selectedEl) return; selectedEl.style.cssText = savedInline; var v = d.values || {}; Object.keys(v).forEach(function(k){ if (v[k]) selectedEl.style.setProperty(k, v[k]); }); });
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.inspect') return; on = !!d.enabled; document.documentElement.style.cursor = on ? 'crosshair' : ''; if (!on) hide() });
  // Правка текста прямо в превью (roadmap-4 п.17): двойной клик в режиме инспектора делает элемент редактируемым,
  // Enter/blur завершают; изменённый текст уходит панели как vc-make.text — она ищет его в исходнике и записывает файл.
  var editingEl = null, editingBefore = '';
  function finishEdit(){ if (!editingEl) return; var el = editingEl; editingEl = null; el.removeAttribute('contenteditable'); el.style.outline = ''; var after = (el.innerText || '').trim(); if (after && after !== editingBefore) { try { window.parent.postMessage({ type: 'vc-make.text', selector: selectorOf(el), before: editingBefore, after: after }, '*'); } catch (err) {} } }
  function onDbl(e){ if (!on) return; var el = e.target; if (!el || el === document.body || el === document.documentElement) return; if (el.children.length > 3) return; e.preventDefault(); e.stopPropagation(); editingEl = el; editingBefore = (el.innerText || '').trim(); el.setAttribute('contenteditable', 'plaintext-only'); if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true'); el.style.outline = '2px solid #4f7cff'; el.focus(); el.addEventListener('blur', finishEdit, { once: true }); el.addEventListener('keydown', function(ev){ if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.blur(); } if (ev.key === 'Escape') { el.innerText = editingBefore; el.blur(); } }); }
  document.addEventListener('dblclick', onDbl, true);
  // Перетаскивание секций (roadmap-4 п.18): Alt+зажатие в режиме инспектора ведёт элемент среди соседей,
  // отпускание над соседом переставляет узел в DOM и шлёт vc-make.reorder — панель переносит фрагмент в исходнике.
  // outerHTML снимаем до наших inline-правок (opacity/boxShadow): после них браузер пересериализует style и фрагмент не совпадёт с исходником.
  var dragEl = null, dragOver = null, dragPos = 'after', dragHtml = '', overHtml = '';
  function siblingUnder(x, y){ if (!dragEl || !dragEl.parentElement) return null; var kids = dragEl.parentElement.children; for (var i = 0; i < kids.length; i++) { var k = kids[i]; if (k === dragEl || (k.hasAttribute && k.hasAttribute('data-vc-make-box'))) continue; var r = k.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { dragPos = (y - r.top) > r.height / 2 ? 'after' : 'before'; return k; } } return null; }
  function onDragDown(e){ if (!on || !e.altKey || e.button !== 0) return; var el = e.target; if (!el || el === document.body || el === document.documentElement || !el.parentElement) return; e.preventDefault(); e.stopPropagation(); dragEl = el; dragHtml = el.outerHTML; el.style.opacity = '0.5'; document.documentElement.style.cursor = 'grabbing'; }
  function onDragMove(e){ if (!dragEl) return; var over = siblingUnder(e.clientX, e.clientY); if (dragOver && dragOver !== over) dragOver.style.boxShadow = ''; if (over && over !== dragOver) overHtml = over.outerHTML; dragOver = over; if (over) over.style.boxShadow = dragPos === 'after' ? 'inset 0 -3px 0 #4f7cff' : 'inset 0 3px 0 #4f7cff'; }
  function onDragUp(){ if (!dragEl) return; var el = dragEl, over = dragOver, pos = dragPos; dragEl = null; dragOver = null; el.style.opacity = ''; document.documentElement.style.cursor = on ? 'crosshair' : ''; if (over) { over.style.boxShadow = ''; var moved = dragHtml, target = overHtml; if (pos === 'after') over.after(el); else over.before(el); try { window.parent.postMessage({ type: 'vc-make.reorder', moved: moved.slice(0, 20000), target: target.slice(0, 20000), position: pos }, '*'); } catch (err) {} } }
  document.addEventListener('mousedown', onDragDown, true); document.addEventListener('mousemove', onDragMove, true); document.addEventListener('mouseup', onDragUp, true);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  // Телефон (roadmap-3 п.4): пальцем нет hover — подсвечиваем элемент под касанием, тап выбирает (через click).
  document.addEventListener('touchstart', function(e){ if (!on || !e.touches || !e.touches[0]) return; var t = e.touches[0]; var el = document.elementFromPoint(t.clientX, t.clientY); if (el) { hovered = el; place(el); } }, { capture: true, passive: true });
  window.addEventListener('scroll', function(){ if (on && hovered) place(hovered) }, true);
  // Состояние страницы (скролл, hash) — родитель восстановит его после перезагрузки превью по make.changed.
  var scrollTimer = null;
  function reportState(){ try { window.parent.postMessage({ type: 'vc-make.state', x: window.scrollX, y: window.scrollY, hash: location.hash }, '*'); } catch(e){} }
  window.addEventListener('scroll', function(){ clearTimeout(scrollTimer); scrollTimer = setTimeout(reportState, 120); }, true);
  window.addEventListener('hashchange', reportState);
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.restore') return; if (d.hash && d.hash !== location.hash) { try { location.hash = d.hash; } catch(err){} } if (typeof d.y === 'number') { window.scrollTo(d.x || 0, d.y); setTimeout(function(){ window.scrollTo(d.x || 0, d.y); }, 250); } });
  // Тема и язык превью: prefers-color-scheme нельзя подменить, поэтому переписываем media-правила таблиц
  // стилей (dark → all / light → not all) и выставляем color-scheme; язык — <html lang>.
  var envScheme = 'auto';
  function applyScheme(scheme){ envScheme = scheme; document.documentElement.style.colorScheme = scheme === 'auto' ? '' : scheme; var sheets = document.styleSheets; for (var i = 0; i < sheets.length; i++) { var rules; try { rules = sheets[i].cssRules; } catch(e) { continue; } for (var j = 0; j < rules.length; j++) { var r = rules[j]; if (!r.media) continue; var orig = r.__vcMedia || (r.__vcMedia = r.media.mediaText); if (orig.indexOf('prefers-color-scheme') < 0) continue; if (scheme === 'auto') { r.media.mediaText = orig; continue; } var wantsDark = orig.indexOf('dark') >= 0; r.media.mediaText = (wantsDark === (scheme === 'dark')) ? 'all' : 'not all'; } } }
  // Эмуляция состояний (roadmap-4 п.20): правила с :hover/:focus/:active клонируются под классы .vc-force-*, класс ставится выбранному элементу.
  var forcedRulesDone = false, forcedEl = null;
  function cloneStateRules(){ if (forcedRulesDone) return; forcedRulesDone = true; var sheets = document.styleSheets; var extra = []; for (var i = 0; i < sheets.length; i++) { var rules; try { rules = sheets[i].cssRules; } catch(e) { continue; } for (var j = 0; j < rules.length; j++) { var r = rules[j]; if (!r.selectorText || !/:(hover|focus|focus-visible|focus-within|active)(?![a-z-])/.test(r.selectorText)) continue; var sel = r.selectorText.replace(/:hover(?![a-z-])/g, '.vc-force-hover').replace(/:focus(-visible|-within)?(?![a-z-])/g, '.vc-force-focus').replace(/:active(?![a-z-])/g, '.vc-force-active'); extra.push(sel + '{' + r.style.cssText + '}'); } } if (extra.length) { var st = document.createElement('style'); st.setAttribute('data-vc-make-box',''); st.textContent = extra.join(String.fromCharCode(10)); document.head.appendChild(st); } }
  function applyForcedState(state){ if (forcedEl) { forcedEl.classList.remove('vc-force-hover','vc-force-focus','vc-force-active'); } forcedEl = selectedEl; if (!state || !forcedEl) return; cloneStateRules(); forcedEl.classList.add('vc-force-' + state); }
  var motionStyle = null;
  function applyReducedMotion(onOff){ if (!motionStyle) { motionStyle = document.createElement('style'); motionStyle.setAttribute('data-vc-make-box',''); motionStyle.textContent = '*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}'; } if (onOff) { if (!motionStyle.parentNode) document.head.appendChild(motionStyle); } else if (motionStyle.parentNode) motionStyle.parentNode.removeChild(motionStyle); var sheets = document.styleSheets; for (var i = 0; i < sheets.length; i++) { var rules; try { rules = sheets[i].cssRules; } catch(e) { continue; } for (var j = 0; j < rules.length; j++) { var r = rules[j]; if (!r.media) continue; var orig = r.__vcMedia || (r.__vcMedia = r.media.mediaText); if (orig.indexOf('prefers-reduced-motion') < 0) continue; if (!onOff) { r.media.mediaText = orig; continue; } r.media.mediaText = orig.indexOf('no-preference') >= 0 ? 'not all' : 'all'; } } }
  window.__vcSlowMs = 0;
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.env') return; if (d.scheme) applyScheme(d.scheme); if (typeof d.lang === 'string') { if (d.lang) document.documentElement.setAttribute('lang', d.lang); else document.documentElement.removeAttribute('lang'); } if ('state' in d) applyForcedState(d.state || null); if ('reducedMotion' in d) applyReducedMotion(!!d.reducedMotion); if ('slowMs' in d) window.__vcSlowMs = Number(d.slowMs) || 0; });
  // Комментарии (п.32): подсветка элемента по селектору и нумерованные метки, которые едут за элементами.
  var pins = [], pinLayer = null;
  function ensurePinLayer(){ if (pinLayer) return pinLayer; pinLayer = document.createElement('div'); pinLayer.setAttribute('data-vc-make-pins', ''); pinLayer.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;'; document.documentElement.appendChild(pinLayer); return pinLayer; }
  function placePins(){ if (!pinLayer) return; pinLayer.innerHTML = ''; pins.forEach(function(p){ var el = null; try { el = document.querySelector(p.selector); } catch(e){} if (!el) return; var r = el.getBoundingClientRect(); var b = document.createElement('div'); b.textContent = String(p.n); b.title = p.text || ''; b.style.cssText = 'position:absolute;left:' + Math.max(0, r.right - 10) + 'px;top:' + Math.max(0, r.top - 10) + 'px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:' + (p.resolved ? '#8a8f98' : '#e5484d') + ';color:#fff;font:600 12px/20px system-ui,sans-serif;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none;'; pinLayer.appendChild(b); }); }
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.pins') return; pins = Array.isArray(d.items) ? d.items : []; ensurePinLayer(); placePins(); });
  window.addEventListener('scroll', function(){ if (pins.length) placePins(); }, true);
  window.addEventListener('resize', function(){ if (pins.length) placePins(); });
  window.addEventListener('message', function(e){ var d = e.data; if (!d || d.type !== 'vc-make.highlight' || !d.selector) return; var el = null; try { el = document.querySelector(d.selector); } catch(err){} if (!el) return; try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch(err){ el.scrollIntoView(); } var prev = el.style.outline, prevOff = el.style.outlineOffset; el.style.outline = '3px solid #e5484d'; el.style.outlineOffset = '2px'; setTimeout(function(){ el.style.outline = prev; el.style.outlineOffset = prevOff; }, 1600); });
  window.parent.postMessage({ type: 'vc-make.ready' }, '*');
})();
</script>`

/**
 * Единственное место, где ошибка Make превращается в HTTP-статус: через него
 * проходят все ~50 маршрутов файла. Экспортируется ради таблицы в
 * `make.sendError.test.ts` — ошибка в этом отображении меняет контракт сразу
 * всего Make API, а через маршруты каждый код проверять пришлось бы полсотни раз.
 *
 * Не-`MakeError` намеренно пробрасывается наверх: неизвестный сбой обязан
 * дойти до обработчика Fastify и стать 500, а не молча превратиться в 400.
 */
export function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof MakeError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'too_large' || error.code === 'too_many_files' ? 413 : error.code === 'exists' ? 409 : error.code === 'quota' ? 413 : 400
    return reply.code(status).send({ error: error.message, code: error.code })
  }
  throw error
}

export function registerMakeRoutes(app: FastifyInstance, deps: MakeRoutesDeps): void {
  const { db, workspaces, hub, library } = deps
  const uid = (req: { user?: { name: string } | null }): string => req.user?.name ?? ''

  /** Разговор пользователя вида Make, иначе 404 (чужой и несуществующий неотличимы). */
  const own = (userId: string, id: string, reply: FastifyReply): boolean => {
    const conversation = db.getConversation(userId, id)
    if (!conversation || conversation.assistantKind !== 'make') {
      void reply.code(404).send({ error: 'conversation not found' })
      return false
    }
    return true
  }  /**
   * Доступ участника по именному гранту (roadmap-3 п.6): владелец — всё; редактор — файлы, снимки, комментарии;
   * зритель — только чтение. Публикация, шаринг, очистка и удаление остаются за владельцем (`own`).
   */
  const access = async (userId: string, id: string, reply: FastifyReply, level: 'editor' | 'viewer'): Promise<boolean> => {
    const mine = db.getConversation(userId, id)
    if (mine && mine.assistantKind === 'make') return true
    const owner = db.conversationOwner(id)
    if (owner) {
      const role = await workspaces.shareRole(id, userId)
      if (role === 'editor' || (role === 'viewer' && level === 'viewer')) return true
      // Make-проект, привязанный к проекту, читают все его участники: карточка
      // задачи ссылается на дизайн, и он обязан открываться у всей команды.
      if (level === 'viewer' && db.isMakeProjectViewer(userId, id)) return true
    }
    void reply.code(404).send({ error: 'conversation not found' })
    return false
  }


  app.get<{ Params: { id: string } }>('/api/make/:id', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
    try { await workspaces.ensure(req.params.id); return await workspaces.state(req.params.id) } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/make/:id/file', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
    try { return await workspaces.read(req.params.id, req.query.path ?? '') } catch (error) { return sendError(reply, error) }
  })

  app.put<{ Params: { id: string }; Body: { path?: string; content?: string } }>('/api/make/:id/file', async (req, reply) => {
    const userId = uid(req)
    if (!(await access(userId, req.params.id, reply, 'editor'))) return reply
    const { path, content } = req.body ?? {}
    if (typeof path !== 'string' || typeof content !== 'string') return reply.code(400).send({ error: 'path и content обязательны' })
    try {
      await workspaces.ensure(req.params.id)
      const state = await workspaces.write(req.params.id, path, content)
      hub.changed(userId, req.params.id, state.rev, [normalizeMakePath(path) ?? path])
      return state
    } catch (error) { return sendError(reply, error) }
  })

  // Загрузка бинарника из панели (картинка, шрифт): base64 раздувает на треть — лимит тела с запасом.
  app.post<{ Params: { id: string }; Body: { path?: string; dataBase64?: string } }>('/api/make/:id/upload', { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const userId = uid(req)
    if (!(await access(userId, req.params.id, reply, 'editor'))) return reply
    const { path, dataBase64 } = req.body ?? {}
    if (typeof path !== 'string' || typeof dataBase64 !== 'string') return reply.code(400).send({ error: 'path и dataBase64 обязательны' })
    try {
      await workspaces.ensure(req.params.id)
      const state = await workspaces.writeBuffer(req.params.id, path, Buffer.from(dataBase64, 'base64'))
      hub.changed(userId, req.params.id, state.rev, [normalizeMakePath(path) ?? path])
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.delete<{ Params: { id: string }; Querystring: { path?: string } }>('/api/make/:id/file', async (req, reply) => {
    const userId = uid(req)
    if (!(await access(userId, req.params.id, reply, 'editor'))) return reply
    try {
      const state = await workspaces.delete(req.params.id, req.query.path ?? '')
      hub.changed(userId, req.params.id, state.rev, [req.query.path ?? ''])
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { from?: string; to?: string } }>('/api/make/:id/rename', async (req, reply) => {
    const userId = uid(req)
    if (!(await access(userId, req.params.id, reply, 'editor'))) return reply
    const { from, to } = req.body ?? {}
    if (typeof from !== 'string' || typeof to !== 'string') return reply.code(400).send({ error: 'from и to обязательны' })
    try {
      const state = await workspaces.rename(req.params.id, from, to)
      hub.changed(userId, req.params.id, state.rev, [from, to])
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/snapshots', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
    return workspaces.snapshots(req.params.id)
  })

  app.post<{ Params: { id: string }; Body: { label?: string } }>('/api/make/:id/snapshots', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'editor'))) return reply
    try {
      await workspaces.ensure(req.params.id)
      return await workspaces.snapshot(req.params.id, typeof req.body?.label === 'string' ? req.body.label : 'Снимок пользователя')
    } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string; snapshotId: string } }>('/api/make/:id/snapshots/:snapshotId/restore', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      const state = await workspaces.restore(req.params.id, req.params.snapshotId)
      hub.changed(userId, req.params.id, state.rev, state.files.map((f) => f.path))
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string; snapshotId: string } }>('/api/make/:id/snapshots/:snapshotId/diff', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return await workspaces.snapshotDiff(req.params.id, req.params.snapshotId) } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string; snapshotId: string }; Querystring: { path?: string } }>('/api/make/:id/snapshots/:snapshotId/file', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return await workspaces.snapshotFile(req.params.id, req.params.snapshotId, req.query.path ?? '') } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string; snapshotId: string }; Body: { path?: string } }>('/api/make/:id/snapshots/:snapshotId/restore-file', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    if (typeof req.body?.path !== 'string') return reply.code(400).send({ error: 'path обязателен' })
    try {
      const state = await workspaces.restoreFile(req.params.id, req.params.snapshotId, req.body.path)
      hub.changed(userId, req.params.id, state.rev, [normalizeMakePath(req.body.path) ?? req.body.path])
      return state
    } catch (error) { return sendError(reply, error) }
  })

  // Импорт ZIP: base64 в JSON — архив до ~8 МБ (лимит тела с запасом на base64).
  // Rate-limit импорта (п.39): 10 ZIP и 20 URL на пользователя за 10 минут; 429 + Retry-After.
  const importLimiter = deps.importLimiter ?? new SlidingWindowLimiter(10, 10 * 60_000)
  const passwordLimiter = deps.passwordLimiter ?? new SlidingWindowLimiter(10, 10 * 60_000)
  // Комментарии зрителей (roadmap-4 п.34): не больше 10 за 10 минут с одного IP на публикацию.
  const guestCommentLimiter = new SlidingWindowLimiter(10, 10 * 60_000)
  const importUrlLimiter = deps.importUrlLimiter ?? new SlidingWindowLimiter(20, 10 * 60_000)
  const limited = (limiter: SlidingWindowLimiter, userId: string, reply: FastifyReply): boolean => {
    const v = limiter.hit(userId)
    if (v.ok) return false
    void reply.code(429).header('retry-after', String(v.retryAfterSec)).send({ error: `Слишком много импортов — повторите через ${v.retryAfterSec} с` })
    return true
  }
  app.post<{ Params: { id: string }; Body: { dataBase64?: string; mode?: string } }>('/api/make/:id/import', { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    if (limited(importLimiter, userId, reply)) return reply
    if (typeof req.body?.dataBase64 !== 'string') return reply.code(400).send({ error: 'dataBase64 обязателен' })
    const mode = req.body.mode === 'merge' ? 'merge' : 'replace'
    try {
      const entries = readZip(Buffer.from(req.body.dataBase64, 'base64'))
      const state = await workspaces.importFiles(req.params.id, entries, mode)
      hub.changed(userId, req.params.id, state.rev, state.files.map((f) => f.path))
      return state
    } catch (error) {
      if (error instanceof ZipReadError) return reply.code(400).send({ error: error.message, code: 'bad_zip' })
      return sendError(reply, error)
    }
  })

  app.post<{ Params: { id: string }; Body: { url?: string; mode?: string } }>('/api/make/:id/import-url', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    if (limited(importUrlLimiter, userId, reply)) return reply
    if (typeof req.body?.url !== 'string') return reply.code(400).send({ error: 'url обязателен' })
    const mode = req.body.mode === 'merge' ? 'merge' : 'replace'
    try {
      const files = await importFromUrl(req.body.url)
      const state = await workspaces.importFiles(req.params.id, files, mode)
      hub.changed(userId, req.params.id, state.rev, state.files.map((f) => f.path))
      return state
    } catch (error) {
      if (error instanceof ImportUrlError) return reply.code(400).send({ error: error.message, code: 'bad_url' })
      if (error instanceof Error && !(error instanceof MakeError)) return reply.code(400).send({ error: `Не удалось загрузить страницу: ${error.message}`, code: 'bad_url' })
      return sendError(reply, error)
    }
  })

  app.post<{ Params: { id: string } }>('/api/make/:id/reset', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      await workspaces.ensure(req.params.id)
      const state = await workspaces.reset(req.params.id)
      hub.changed(userId, req.params.id, state.rev, state.files.map((f) => f.path))
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { snapshotId?: string | null; slug?: string | null; password?: string | null; allowComments?: boolean } | undefined }>('/api/make/:id/publish', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return await workspaces.publish(req.params.id, { snapshotId: req.body?.snapshotId ?? null, slug: req.body?.slug, password: req.body?.password, allowComments: typeof req.body?.allowComments === 'boolean' ? req.body.allowComments : undefined }) } catch (error) { return sendError(reply, error) }
  })

  // --- Обмен с репозиторием проекта -------------------------------------
  // Компоненты и стили копируются из рабочей директории машины проекта в
  // мастерскую (pull), правятся здесь и возвращаются обратно (push). Связь
  // хранит хеш на момент копирования: по нему считаются статусы, а push без
  // force отклоняется, если файл в проекте уже изменился, — иначе Make молча
  // перезаписал бы чужую работу в репозитории.
  const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex')

  /** Относительный путь внутри проекта: без `..`, ведущих слэшей и пустоты. */
  const safeRelPath = (raw: string): string | null => {
    const path = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (!path || path.startsWith('/') || path.includes('..') || path.includes('\0')) return null
    return path
  }

  /** Машина проекта Make-чата: агент, корень и доступность. Ошибка — словами. */
  const projectMachine = (userId: string, conversationId: string): { agentId: string; root: string } | { error: string } => {
    const conversation = db.getConversation(userId, conversationId)
    if (!conversation?.projectId) return { error: 'Чат не привязан к проекту — копировать не из чего.' }
    const project = db.getProject(userId, conversation.projectId)
    if (!project) return { error: 'Проект недоступен.' }
    const machines = project.machines.filter((machine) => machine.canUse !== false && machine.path.trim())
    const machine = machines.find((candidate) => candidate.agentId === project.defaultAgentId) ?? machines[0]
    if (!machine) return { error: 'У проекта нет машины с рабочей директорией.' }
    if (!deps.machineFs) return { error: 'Файловый мост машин недоступен в этой конфигурации.' }
    if (!deps.machineFs.isOnline(machine.agentId)) return { error: `Машина «${machine.name ?? machine.agentId}» offline.` }
    return { agentId: machine.agentId, root: machine.path.replace(/\/+$/, '') }
  }

  /** Статусы связей: хеш мастерской и хеш машины против хеша на момент копирования. */
  const linkInfos = async (conversationId: string, machine: { agentId: string; root: string }): Promise<MakeProjectLinkInfo[]> => {
    const links = await workspaces.projectLinks(conversationId)
    const out: MakeProjectLinkInfo[] = []
    for (const link of links) {
      const local = await workspaces.readBuffer(conversationId, link.path).catch(() => null)
      const localHash = local ? sha256(local.data) : null
      let remoteHash: string | null = null
      try {
        const result = await deps.machineFs!.read(machine.agentId, `${machine.root}/${link.path}`)
        remoteHash = result.dataBase64 !== undefined ? sha256(Buffer.from(result.dataBase64, 'base64')) : null
      } catch { remoteHash = null }
      const status: MakeProjectLinkStatus = localHash === null
        ? 'missing_in_make'
        : remoteHash === null
          ? 'missing_in_project'
          : localHash === link.importedHash && remoteHash === link.importedHash
            ? 'same'
            : localHash !== link.importedHash && remoteHash !== link.importedHash
              ? 'both'
              : localHash !== link.importedHash
                ? 'edited_in_make'
                : 'changed_in_project'
      out.push({ ...link, status })
    }
    return out
  }

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/make/:id/project-files', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const machine = projectMachine(userId, req.params.id)
    if ('error' in machine) return reply.code(409).send({ error: machine.error })
    const rel = typeof req.query.path === 'string' && req.query.path ? safeRelPath(req.query.path) : ''
    if (rel === null) return reply.code(400).send({ error: 'Некорректный путь' })
    try {
      const result = await deps.machineFs!.list(machine.agentId, rel ? `${machine.root}/${rel}` : machine.root)
      const entries: MakeProjectFileEntry[] = (result.entries ?? [])
        // Служебные каталоги репозитория в Make не носят: скрытое и node_modules
        // — не компоненты, а листинг с ними нечитаем.
        .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
        .filter((entry) => entry.kind === 'dir' || entry.kind === 'file')
        .map((entry) => ({ name: entry.name, path: rel ? `${rel}/${entry.name}` : entry.name, kind: entry.kind as 'dir' | 'file', size: entry.size }))
      return entries
    } catch (error) {
      return reply.code(502).send({ error: `Машина не ответила: ${error instanceof Error ? error.message : String(error)}` })
    }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/project-links', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const machine = projectMachine(userId, req.params.id)
    if ('error' in machine) return reply.code(409).send({ error: machine.error })
    return linkInfos(req.params.id, machine)
  })

  app.post<{ Params: { id: string }; Body: { paths?: string[] } }>('/api/make/:id/project-pull', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const machine = projectMachine(userId, req.params.id)
    if ('error' in machine) return reply.code(409).send({ error: machine.error })
    const rawPaths = Array.isArray(req.body?.paths) ? req.body.paths : []
    if (!rawPaths.length) return reply.code(400).send({ error: 'Выберите файлы' })
    if (rawPaths.length > MAKE_PROJECT_SYNC_MAX_FILES) return reply.code(400).send({ error: `Не больше ${MAKE_PROJECT_SYNC_MAX_FILES} файлов за раз` })
    const paths: string[] = []
    for (const raw of rawPaths) {
      const path = safeRelPath(String(raw))
      if (!path) return reply.code(400).send({ error: `Некорректный путь: ${String(raw)}` })
      paths.push(path)
    }
    try {
      await workspaces.ensure(req.params.id)
      const files: Array<{ path: string; data: Buffer }> = []
      for (const path of paths) {
        const result = await deps.machineFs!.read(machine.agentId, `${machine.root}/${path}`)
        if (result.dataBase64 === undefined) return reply.code(404).send({ error: `«${path}» — не файл или не читается` })
        files.push({ path, data: Buffer.from(result.dataBase64, 'base64') })
      }
      // merge: копирование добавляет и обновляет, не трогая остальной проект.
      const state = await workspaces.importFiles(req.params.id, files, 'merge')
      const now = Date.now()
      const links = await workspaces.projectLinks(req.params.id)
      const byPath = new Map(links.map((link) => [link.path, link]))
      for (const file of files) byPath.set(file.path, { path: file.path, importedHash: sha256(file.data), importedAt: now })
      await workspaces.saveProjectLinks(req.params.id, [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path, 'ru')))
      hub.changed(userId, req.params.id, state.rev, files.map((file) => file.path))
      return { links: await linkInfos(req.params.id, machine), state } satisfies MakeProjectPullResult
    } catch (error) {
      if (error instanceof MakeError) return sendError(reply, error)
      return reply.code(502).send({ error: `Копирование не удалось: ${error instanceof Error ? error.message : String(error)}` })
    }
  })

  // --- Связи с задачами проекта (дизайн ↔ карточка) --------------------
  // Обратное направление к `/api/projects/:id/tasks/:taskId/designs`: панель Make
  // показывает, какие карточки ссылаются на открытую страницу, и связывает новую.
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/api/make/:id/task-links', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
    const path = typeof req.query.path === 'string' ? req.query.path : undefined
    return db.makeTaskLinks(req.params.id, path)
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/task-links/tasks', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
    return db.makeLinkableTasks(uid(req), req.params.id)
  })

  app.post<{ Params: { id: string }; Body: { taskId?: string; path?: string; label?: string } }>('/api/make/:id/task-links', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
    const projectId = db.makeConversationProject(req.params.id)
    const taskId = req.body?.taskId
    if (!taskId || !projectId) return reply.code(400).send({ error: 'Make-проект не привязан к проекту' })
    try {
      db.linkTaskDesign(uid(req), projectId, taskId, { conversationId: req.params.id, path: req.body?.path, label: req.body?.label })
      deps.boardChanged?.(projectId)
      return db.makeTaskLinks(req.params.id, typeof req.body?.path === 'string' ? req.body.path : undefined)
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }) }
  })

  app.delete<{ Params: { id: string; linkId: string } }>('/api/make/:id/task-links/:linkId', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
    const projectId = db.makeConversationProject(req.params.id)
    const link = db.makeTaskLinks(req.params.id).find((l) => l.id === req.params.linkId)
    if (!projectId || !link) return reply.code(404).send({ error: 'Связь не найдена' })
    db.unlinkTaskDesign(uid(req), projectId, link.taskId, link.id)
    deps.boardChanged?.(projectId)
    return db.makeTaskLinks(req.params.id)
  })

  // Read-only ссылка внутри ChatAI (п.33): владелец создаёт/отзывает, любой вошедший читает по токену.
  app.post<{ Params: { id: string } }>('/api/make/:id/share', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return await workspaces.createShare(req.params.id) } catch (error) { return sendError(reply, error) }
  })
  app.post<{ Params: { id: string }; Body: { user?: string; role?: 'editor' | 'viewer' | null } | undefined }>('/api/make/:id/share/grants', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    const user = String(req.body?.user ?? '').trim()
    if (user && !db.getUser(user)) return reply.code(404).send({ error: `Пользователь «${user}» не найден` })
    const role = req.body?.role === 'editor' || req.body?.role === 'viewer' ? req.body.role : null
    try { await workspaces.ensure(req.params.id); return await workspaces.setShareGrant(req.params.id, user, role) } catch (error) { return sendError(reply, error) }
  })
  app.delete<{ Params: { id: string } }>('/api/make/:id/share', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return await workspaces.revokeShare(req.params.id) } catch (error) { return sendError(reply, error) }
  })
  const sharedConv = async (token: string, reply: FastifyReply): Promise<string | null> => {
    const conversationId = await workspaces.sharedTarget(token)
    if (!conversationId) { void reply.code(404).send({ error: 'Ссылка недействительна или отозвана' }); return null }
    return conversationId
  }
  app.get<{ Params: { token: string } }>('/api/make/shared/:token', async (req, reply) => {
    const conversationId = await sharedConv(req.params.token, reply)
    if (!conversationId) return reply
    try {
      const owner = db.conversationOwner(conversationId) ?? ''
      const conv = owner ? db.getConversation(owner, conversationId) : null
      const state = await workspaces.state(conversationId)
      const settings = await workspaces.notes(conversationId)
      return { token: req.params.token, stack: settings.stack, uiKit: settings.uiKit, owner, title: conv?.title ?? 'Проект', role: await workspaces.shareRole(conversationId, uid(req)), conversationId, files: state.files, snapshots: state.snapshots, rev: state.rev }
    } catch (error) { return sendError(reply, error) }
  })
  app.get<{ Params: { token: string }; Querystring: { path?: string } }>('/api/make/shared/:token/file', async (req, reply) => {
    const conversationId = await sharedConv(req.params.token, reply)
    if (!conversationId) return reply
    try { return await workspaces.read(conversationId, req.query.path ?? '') } catch (error) { return sendError(reply, error) }
  })
  app.get<{ Params: { token: string } }>('/api/make/shared/:token/stories', async (req, reply) => {
    const conversationId = await sharedConv(req.params.token, reply)
    if (!conversationId) return reply
    try { return { files: await workspaces.stories(conversationId) } } catch (error) { return sendError(reply, error) }
  })
  app.get<{ Params: { token: string; '*': string } }>('/api/preview/make-shared/:token/*', async (req, reply) => {
    const conversationId = await sharedConv(req.params.token, reply)
    if (!conversationId) return reply
    const raw = req.params['*'] || 'index.html'
    const base = `/api/preview/make-shared/${encodeURIComponent(req.params.token)}/`
    const csp = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'self'"
    if (raw === MAKE_GALLERY_PAGE) return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('content-security-policy', csp).send(renderGalleryPage(await workspaces.stories(conversationId), base, 'Компоненты', await galleryUsage(workspaces, conversationId)))
    if (raw === MAKE_STORIES_PAGE) {
      const q = req.query as { file?: string; story?: string }
      const index = await workspaces.readBuffer(conversationId, 'index.html').catch(() => null)
      return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('content-security-policy', csp).send(renderStoriesPage(q.file ?? '', q.story ?? '', index ? index.data.toString('utf8') : null))
    }
    const path = raw.endsWith('/') ? `${raw}index.html` : raw
    let file
    try { file = await workspaces.readBuffer(conversationId, path) } catch (error) { return sendError(reply, error) }
    if (!file) {
      const mock = await workspaces.resolveMock(conversationId, path, 'GET', false, undefined, req.headers.cookie)
      if (mock) return sendMock(reply, mock)
      return reply.code(404).type('text/plain; charset=utf-8').send(`Файл не найден: ${path}`)
    }
    return reply.header('content-type', makeMimeType(file.path)).header('cache-control', 'no-store').header('x-content-type-options', 'nosniff').header('content-security-policy', csp)
      .send(await previewBody(conversationId, file))
  })

  // Presence вкладок (roadmap-2 п.14): heartbeat от каждой вкладки; ответ и WS-кадр — всем сокетам владельца.
  app.post<{ Params: { id: string }; Body: { clientId?: string; path?: string | null; editing?: boolean; leave?: boolean } | undefined }>('/api/make/:id/presence', async (req, reply) => {
    const userId = uid(req)
    if (!(await access(userId, req.params.id, reply, 'viewer'))) return reply
    const clientId = String(req.body?.clientId ?? '').slice(0, 64)
    if (!clientId) return reply.code(400).send({ error: 'clientId обязателен' })
    const clients = hub.heartbeat(req.params.id, { clientId, user: userId, path: typeof req.body?.path === 'string' ? req.body.path.slice(0, 300) : null, editing: Boolean(req.body?.editing), at: Date.now() }, Boolean(req.body?.leave))
    hub.broadcastPresence(userId, req.params.id, clients)
    return { clients }
  })

  // Комментарии к элементам превью (п.32).
  app.get<{ Params: { id: string } }>('/api/make/:id/comments', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
    try { await workspaces.ensure(req.params.id); return { comments: await workspaces.comments(req.params.id) } } catch (error) { return sendError(reply, error) }
  })
  app.post<{ Params: { id: string }; Body: { selector?: string; elementLabel?: string; text?: string } | undefined }>('/api/make/:id/comments', async (req, reply) => {
    const userId = uid(req)
    if (!(await access(userId, req.params.id, reply, 'editor'))) return reply
    try {
      await workspaces.ensure(req.params.id)
      const comments = await workspaces.addComment(req.params.id, { selector: req.body?.selector ?? '', elementLabel: req.body?.elementLabel ?? '', text: req.body?.text ?? '', author: userId })
      hub.changed(userId, req.params.id, workspaces.rev(req.params.id), [COMMENTS_SYNC_PATH])
      return { comments }
    } catch (error) { return sendError(reply, error) }
  })
  app.patch<{ Params: { id: string; commentId: string }; Body: { resolved?: boolean; text?: string; status?: 'pending' | 'approved' } | undefined }>('/api/make/:id/comments/:commentId', async (req, reply) => {
    const userId = uid(req)
    if (!(await access(userId, req.params.id, reply, 'editor'))) return reply
    try {
      const comments = await workspaces.updateComment(req.params.id, req.params.commentId, { resolved: req.body?.resolved, text: req.body?.text, status: req.body?.status === 'approved' || req.body?.status === 'pending' ? req.body.status : undefined })
      hub.changed(userId, req.params.id, workspaces.rev(req.params.id), [COMMENTS_SYNC_PATH])
      return { comments }
    } catch (error) { return sendError(reply, error) }
  })
  app.delete<{ Params: { id: string; commentId: string } }>('/api/make/:id/comments/:commentId', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      const comments = await workspaces.removeComment(req.params.id, req.params.commentId)
      hub.changed(userId, req.params.id, workspaces.rev(req.params.id), [COMMENTS_SYNC_PATH])
      return { comments }
    } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/usage', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return await workspaces.usage(req.params.id) } catch (error) { return sendError(reply, error) }
  })
  app.post<{ Params: { id: string }; Body: { keepSnapshots?: number; shots?: boolean; unusedAssets?: boolean } | undefined }>('/api/make/:id/cleanup', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      await workspaces.ensure(req.params.id)
      const result = await workspaces.cleanup(req.params.id, { keepSnapshots: req.body?.keepSnapshots, shots: req.body?.shots, unusedAssets: req.body?.unusedAssets })
      hub.changed(userId, req.params.id, result.state.rev, [])
      return result
    } catch (error) { return sendError(reply, error) }
  })
  app.delete<{ Params: { id: string } }>('/api/make/:id/publish', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return await workspaces.unpublish(req.params.id) } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/check', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return { issues: await workspaces.check(req.params.id) } } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { templateId?: string } }>('/api/make/:id/template', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    if (typeof req.body?.templateId !== 'string') return reply.code(400).send({ error: 'templateId обязателен' })
    try {
      const state = await workspaces.applyTemplate(req.params.id, req.body.templateId)
      hub.changed(userId, req.params.id, state.rev, state.files.map((f) => f.path))
      return state
    } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string }; Querystring: { q?: string; regex?: string; matchCase?: string } }>('/api/make/:id/search', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return { matches: await workspaces.search(req.params.id, req.query.q ?? '', 200, { regex: req.query.regex === '1', matchCase: req.query.matchCase === '1' }) } } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { query?: string; replacement?: string; matchCase?: boolean; regex?: boolean; dryRun?: boolean } }>('/api/make/:id/replace', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const { query, replacement, matchCase, regex, dryRun } = req.body ?? {}
    if (typeof query !== 'string' || typeof replacement !== 'string') return reply.code(400).send({ error: 'query и replacement обязательны' })
    try {
      const result = await workspaces.replaceAll(req.params.id, query, replacement, { matchCase: Boolean(matchCase), regex: Boolean(regex), dryRun: Boolean(dryRun) })
      if (result.files > 0) hub.changed(userId, req.params.id, result.state.rev, result.state.files.map((f) => f.path))
      return result
    } catch (error) { return sendError(reply, error) }
  })

  // ---- Личная библиотека компонентов (п.17) ----
  app.get('/api/make/library', async (req) => ({ items: await library.list(uid(req)) }))

  app.delete<{ Params: { slug: string } }>('/api/make/library/:slug', async (req) => {
    await library.remove(uid(req), req.params.slug)
    return { items: await library.list(uid(req)) }
  })

  app.post<{ Params: { id: string }; Body: { name?: string; paths?: string[] } }>('/api/make/:id/library', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    const { name, paths } = req.body ?? {}
    if (typeof name !== 'string' || !Array.isArray(paths) || paths.length === 0) return reply.code(400).send({ error: 'name и paths обязательны' })
    try {
      const files: Array<{ path: string; data: Buffer }> = []
      for (const raw of paths.slice(0, 30)) {
        const file = await workspaces.readBuffer(req.params.id, String(raw))
        if (file) files.push({ path: file.path, data: file.data })
      }
      return { item: await library.save(userId, name, files, req.params.id) }
    } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string; slug: string } }>('/api/make/:id/library/:slug/insert', async (req, reply) => {
    const userId = uid(req)
    if (!own(userId, req.params.id, reply)) return reply
    try {
      const files = await library.files(userId, req.params.slug)
      const { state, mergedTokens, autoImported } = await workspaces.insertLibraryFiles(req.params.id, files)
      hub.changed(userId, req.params.id, state.rev, files.map((f) => f.path))
      return { state, mergedTokens, autoImported }
    } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/notes', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
    try { await workspaces.ensure(req.params.id); return await workspaces.notes(req.params.id) } catch (error) { return sendError(reply, error) }
  })
  app.put<{ Params: { id: string }; Body: { notes?: string; mode?: string } | undefined }>('/api/make/:id/notes', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'editor'))) return reply
    const mode = req.body?.mode === 'designer' || req.body?.mode === 'developer' || req.body?.mode === 'balanced' ? req.body.mode : undefined
    try { await workspaces.ensure(req.params.id); return await workspaces.setNotes(req.params.id, { ...(typeof req.body?.notes === 'string' ? { notes: req.body.notes } : {}), ...(mode ? { mode } : {}) }) } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/tests', async (req, reply) => {
    if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
    try { return { files: await workspaces.tests(req.params.id) } } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/shots', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { return { shots: await workspaces.shots(req.params.id) } } catch (error) { return sendError(reply, error) }
  })

  app.post<{ Params: { id: string }; Body: { file?: string; story?: string; dataBase64?: string } }>('/api/make/:id/shots', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    const { file, story, dataBase64 } = req.body ?? {}
    if (typeof file !== 'string' || typeof story !== 'string' || typeof dataBase64 !== 'string') return reply.code(400).send({ error: 'file, story и dataBase64 обязательны' })
    try { return { shots: await workspaces.addShot(req.params.id, file, story, Buffer.from(dataBase64, 'base64')) } } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string } }>('/api/make/:id/stories', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try { await workspaces.ensure(req.params.id); return { files: await workspaces.stories(req.params.id) } } catch (error) { return sendError(reply, error) }
  })

  /** Тело файла для отдачи: JSX/TS — через esbuild, остальное как есть. */
  const previewBody = async (conversationId: string, file: { path: string; data: Buffer }): Promise<Buffer | string> => {
    if (!isMakeTranspiledPath(file.path)) return file.data
    const paths = new Set((await workspaces.list(conversationId)).map((f) => f.path))
    return transpileForPreview(conversationId, file.path, file.data.toString('utf8'), workspaces.rev(conversationId), (p) => paths.has(p))
  }

  // ---- Публикация: /p/<token>/… — вне /api, без авторизации; знание ссылки = доступ ----

  // Форма пароля публикации: POST сюда же (`__auth__`) с urlencoded-телом; cookie на 30 дней.
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      try { done(null, Object.fromEntries(new URLSearchParams(String(body)))) } catch (e) { done(e as Error, undefined) }
    })
  }
  const gateCookieName = (token: string): string => `vc_pub_${token}`
  const cookieValue = (req: FastifyRequest, name: string): string | null => {
    const m = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${name}=`))
    return m ? decodeURIComponent(m.slice(name.length + 1)) : null
  }
  const passwordPage = (action: string, wrong: boolean, limited = 0): string => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Доступ по паролю</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#f6f7fb;color:#1a1d23}form{background:#fff;padding:28px 32px;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.08);display:grid;gap:12px;min-width:280px}h1{margin:0;font-size:18px}input{font:inherit;padding:10px 12px;border:1px solid #d9dbe3;border-radius:8px}button{font:inherit;padding:10px 12px;border:0;border-radius:8px;background:#4f7cff;color:#fff;cursor:pointer}.err{color:#c0392b;margin:0;font-size:13px}</style></head>
<body><form method="post" action="${action}"><h1>Проект защищён паролем</h1>${limited ? `<p class="err">Слишком много попыток — подождите ${limited} с.</p>` : wrong ? '<p class="err">Пароль не подошёл — попробуйте ещё раз.</p>' : ''}<input type="password" name="password" placeholder="Пароль" autofocus required autocomplete="current-password"><button type="submit">Открыть</button></form></body></html>`

  /** Ответ мок-API (п.29): JSON, статус и заголовки из конверта, искусственная задержка — как у настоящего бэкенда. */
  const sendMock = async (reply: FastifyReply, mock: MockResponse): Promise<unknown> => {
    if (mock.delayMs > 0) await new Promise((r) => setTimeout(r, mock.delayMs))
    reply.code(mock.status).header('content-type', 'application/json; charset=utf-8').header('cache-control', 'no-store').header('x-vc-mock', '1')
    for (const [k, v] of Object.entries(mock.headers)) reply.header(k, v)
    return reply.send(mock.body === null ? '' : JSON.stringify(mock.body))
  }
  // Не-GET запросы превью — только моки: файлов такими методами не отдаём.
  app.route<{ Params: { id: string; '*': string } }>({
    method: ['POST', 'PUT', 'PATCH', 'DELETE'], url: '/api/preview/make/:id/*',
    handler: async (req, reply) => {
      if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
      const mock = await workspaces.resolveMock(req.params.id, req.params['*'] || '', req.method, false, req.body, req.headers.cookie)
      if (!mock) return reply.code(404).type('text/plain; charset=utf-8').send(`Мок не найден: mock/${req.params['*']}.${req.method}.json`)
      return sendMock(reply, mock)
    }
  })

  /** Отдача файла публикации по токену: общий код для /p/<token>/ и /s/<slug>/. */
  const servePublic = async (token: string, rawPath: string, base: string, req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const conversationId = await workspaces.publishedTarget(token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
    const raw = rawPath || 'index.html'
    // Пароль (п.25): без верной cookie — форма для HTML-запросов, 401 для остального.
    const gate = await workspaces.publicGate(conversationId)
    if (gate && cookieValue(req, gateCookieName(token)) !== gate) {
      const wantsHtml = raw === 'index.html' || raw.endsWith('/') || raw.endsWith('.html') || raw === MAKE_STORIES_PAGE || raw === MAKE_GALLERY_PAGE
      if (!wantsHtml) return reply.code(401).type('text/plain; charset=utf-8').send('Публикация защищена паролем')
      const q = req.query as { wrong?: string }
      return reply.code(401).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
        .send(passwordPage(`${base}__auth__?next=${encodeURIComponent(raw)}`, q.wrong === '1'))
    }
    // Комментарии зрителей (roadmap-4 п.34): GET — одобренные, POST — в модерацию; только если владелец включил.
    if (raw === MAKE_PUBLIC_COMMENTS_PAGE) {
      const pub = await workspaces.publication(conversationId)
      if (!pub?.allowComments) return reply.code(404).send({ error: 'Комментарии зрителей выключены' })
      if (req.method === 'GET') return reply.header('cache-control', 'no-store').send({ comments: await workspaces.publicComments(conversationId) })
      if (req.method !== 'POST') return reply.code(405).send({ error: 'method not allowed' })
      if (!guestCommentLimiter.hit(`${req.ip}:${token}`).ok) return reply.code(429).send({ error: 'Слишком много комментариев — попробуйте позже' })
      const b = (req.body ?? {}) as { text?: string; name?: string; selector?: string; elementLabel?: string }
      if (typeof b.text !== 'string' || !b.text.trim()) return reply.code(400).send({ error: 'Нужен текст комментария' })
      try {
        const item = await workspaces.addGuestComment(conversationId, { selector: String(b.selector ?? 'body').slice(0, 500), elementLabel: String(b.elementLabel ?? '').slice(0, 160), text: b.text, guestName: String(b.name ?? '').slice(0, 60) })
        const owner = db.conversationOwner(conversationId)
        if (owner) hub.changed(owner, conversationId, 0, [COMMENTS_SYNC_PATH])
        return reply.code(201).send({ ok: true, id: item.id, pending: true })
      } catch (error) { return sendError(reply, error) }
    }
    // Публичные сториз и галерея (п.15): те же страницы, что в превью, но без входа; файлы — с публикации.
    if (raw === MAKE_STORIES_PAGE || raw === MAKE_GALLERY_PAGE) {
      const headers = (r: FastifyReply): FastifyReply => r.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex')
        .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:")
      if (raw === MAKE_GALLERY_PAGE) return headers(reply).send(renderGalleryPage(await workspaces.stories(conversationId), base, 'Компоненты', await galleryUsage(workspaces, conversationId)))
      const q = req.query as { file?: string; story?: string }
      const index = await workspaces.publicFile(conversationId, 'index.html').catch(() => null)
      return headers(reply).send(renderStoriesPage(q.file ?? '', q.story ?? '', index ? index.data.toString('utf8') : null))
    }
    const path = raw.endsWith('/') ? `${raw}index.html` : raw
    let file
    try { file = await workspaces.publicFile(conversationId, path) } catch { file = null }
    if (!file) {
      const mock = await workspaces.resolveMock(conversationId, path, req.method, true, (req as FastifyRequest & { body?: unknown }).body, req.headers.cookie)
      if (mock) return sendMock(reply, mock)
      return reply.code(404).type('text/plain; charset=utf-8').send(`Файл не найден: ${path}`)
    }
    if (path === 'index.html') { const ref = typeof req.headers.referer === 'string' ? req.headers.referer : null; const own = ref && req.hostname && ref.includes(`//${req.hostname}`); void workspaces.countView(conversationId, own ? null : ref) }
    let body: Buffer | string = isMakeTranspiledPath(file.path)
      ? await transpileForPreview(file.cacheKey, file.path, file.data.toString('utf8'), file.rev, () => true)
      : file.data
    // Виджет комментариев зрителей (roadmap-4 п.34) — только на HTML публикации с включёнными комментариями.
    if (path === 'index.html' && (await workspaces.publication(conversationId))?.allowComments) {
      const html = body.toString('utf8')
      body = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${guestCommentsWidget(base)}</body>`) : html + guestCommentsWidget(base)
    }
    return reply
      .header('content-type', makeMimeType(file.path))
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:")
      .header('x-robots-tag', 'noindex')
      .send(body)
  }
  const authPublic = async (token: string, base: string, req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const conversationId = await workspaces.publishedTarget(token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
    const body = (req.body ?? {}) as { password?: string }
    const q = req.query as { next?: string }
    const next = (q.next ?? 'index.html').replace(/^\/+/, '')
    // Перебор пароля (roadmap-2 п.3): 10 попыток за 10 минут на IP+токен; сверх — 429 с той же формой и обратным отсчётом.
    const verdict = passwordLimiter.hit(`${req.ip}:${token}`)
    if (!verdict.ok) return reply.code(429).header('retry-after', String(verdict.retryAfterSec)).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').send(passwordPage(`${base}__auth__?next=${encodeURIComponent(next)}`, false, verdict.retryAfterSec))
    if (!(await workspaces.verifyPublicPassword(conversationId, body.password ?? ''))) return reply.redirect(`${base}${next}?wrong=1`)
    const gate = await workspaces.publicGate(conversationId)
    return reply
      .header('set-cookie', `${gateCookieName(token)}=${gate ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`)
      .redirect(`${base}${next}`)
  }

  app.get<{ Params: { token: string; '*': string } }>(`${MAKE_PUBLIC_PREFIX}:token/*`, async (req, reply) =>
    servePublic(req.params.token, req.params['*'], `${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/`, req, reply))
  /** Не-GET на публикации: `__auth__` — форма пароля, остальное — моки (после проверки пропуска). */
  const publicMutation = async (token: string, rawPath: string, base: string, req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    if (rawPath === '__auth__') return authPublic(token, base, req, reply)
    // POST комментария зрителя (п.34) — тот же обработчик, что и GET списка.
    if (rawPath === MAKE_PUBLIC_COMMENTS_PAGE) return servePublic(token, rawPath, base, req, reply)
    const conversationId = await workspaces.publishedTarget(token)
    if (!conversationId) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
    const gate = await workspaces.publicGate(conversationId)
    if (gate && cookieValue(req, gateCookieName(token)) !== gate) return reply.code(401).type('text/plain; charset=utf-8').send('Публикация защищена паролем')
    const mock = await workspaces.resolveMock(conversationId, rawPath, req.method, true, (req as FastifyRequest & { body?: unknown }).body, req.headers.cookie)
    if (!mock) return reply.code(404).type('text/plain; charset=utf-8').send('Мок не найден')
    return sendMock(reply, mock)
  }
  app.route<{ Params: { token: string; '*': string } }>({
    method: ['POST', 'PUT', 'PATCH', 'DELETE'], url: `${MAKE_PUBLIC_PREFIX}:token/*`,
    handler: async (req, reply) => publicMutation(req.params.token, req.params['*'] || '', `${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/`, req, reply)
  })
  app.get<{ Params: { token: string } }>(`${MAKE_PUBLIC_PREFIX}:token`, async (req, reply) => reply.redirect(`${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/index.html`))
  app.get<{ Params: { token: string } }>(`${MAKE_PUBLIC_PREFIX}:token/`, async (req, reply) => reply.redirect(`${MAKE_PUBLIC_PREFIX}${encodeURIComponent(req.params.token)}/index.html`))

  // Адрес по slug (п.25): /s/<slug>/… — то же содержимое, токен наружу не уходит.
  const slugBase = (slug: string): string => `${MAKE_SLUG_PREFIX}${encodeURIComponent(slug)}/`
  app.get<{ Params: { slug: string; '*': string } }>(`${MAKE_SLUG_PREFIX}:slug/*`, async (req, reply) => {
    const token = await workspaces.slugToken(req.params.slug)
    if (!token) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
    return servePublic(token, req.params['*'], slugBase(req.params.slug), req, reply)
  })
  app.route<{ Params: { slug: string; '*': string } }>({
    method: ['POST', 'PUT', 'PATCH', 'DELETE'], url: `${MAKE_SLUG_PREFIX}:slug/*`,
    handler: async (req, reply) => {
      const token = await workspaces.slugToken(req.params.slug)
      if (!token) return reply.code(404).type('text/plain; charset=utf-8').send('Публикация не найдена или снята')
      return publicMutation(token, req.params['*'] || '', slugBase(req.params.slug), req, reply)
    }
  })
  app.get<{ Params: { slug: string } }>(`${MAKE_SLUG_PREFIX}:slug`, async (req, reply) => reply.redirect(`${slugBase(req.params.slug)}index.html`))
  app.get<{ Params: { slug: string } }>(`${MAKE_SLUG_PREFIX}:slug/`, async (req, reply) => reply.redirect(`${slugBase(req.params.slug)}index.html`))

  // ---- Превью и экспорт (cookie-аутентификация, см. users/auth.ts) ----------

  app.get<{ Params: { id: string }; Querystring: { vite?: string; pwa?: string; deploy?: string } }>('/api/preview/make/:id/export.zip', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    try {
      await workspaces.ensure(req.params.id)
      const deploy = req.query.deploy === 'netlify' || req.query.deploy === 'vercel' ? req.query.deploy : null
      const zip = await workspaces.exportZip(req.params.id, { vite: req.query.vite === '1', pwa: req.query.pwa === '1', deploy })
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="make-${req.params.id.slice(0, 8)}.zip"`)
        .header('cache-control', 'no-store')
        .send(zip)
    } catch (error) { return sendError(reply, error) }
  })

  app.get<{ Params: { id: string; '*': string } }>('/api/preview/make/:id/*', async (req, reply) => {
    // Превью читают и те, кому проект открыт на чтение: связанный с карточкой дизайн смотрит вся команда.
    if (!(await access(uid(req), req.params.id, reply, 'viewer'))) return reply
    await workspaces.ensure(req.params.id)
    const raw = req.params['*'] || 'index.html'
    // Превью снимка (roadmap-4 п.37): `__snapshot__/<id>/<файл>` — файлы версии, транспиляция с отдельным ключом кэша.
    if (raw.startsWith(`${MAKE_SNAPSHOT_PREVIEW}/`)) {
      const [snapshotId, ...rest] = raw.slice(MAKE_SNAPSHOT_PREVIEW.length + 1).split('/')
      const snapPath = rest.join('/') || 'index.html'
      const file = snapshotId ? await workspaces.snapshotBuffer(req.params.id, snapshotId, snapPath.endsWith('/') ? `${snapPath}index.html` : snapPath) : null
      if (!file) return reply.code(404).type('text/plain; charset=utf-8').send(`В снимке нет файла: ${snapPath}`)
      const snapBase = `/api/preview/make/${encodeURIComponent(req.params.id)}/${MAKE_SNAPSHOT_PREVIEW}/${encodeURIComponent(snapshotId!)}/`
      const body = isMakeTranspiledPath(file.path)
        ? await transpileForPreview(`${req.params.id}:snap:${snapshotId}`, file.path, file.data.toString('utf8'), 0, () => true)
        : file.path === 'index.html' ? file.data.toString('utf8').replace(/<head([^>]*)>/i, `<head$1><base href="${snapBase}">`) : file.data
      return reply.header('content-type', makeMimeType(file.path)).header('cache-control', 'no-store').header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'self'").send(body)
    }
    if (raw.startsWith('__shots__/') && raw.endsWith('.png')) {
      const img = await workspaces.shotImage(req.params.id, raw.slice('__shots__/'.length, -4))
      if (!img) return reply.code(404).type('text/plain; charset=utf-8').send('Снимок не найден')
      return reply.header('content-type', 'image/png').header('cache-control', 'private, max-age=3600').send(img)
    }
    if (raw === MAKE_GALLERY_PAGE) {
      const files = await workspaces.stories(req.params.id)
      return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
        .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'self'")
        .send(renderGalleryPage(files, `/api/preview/make/${encodeURIComponent(req.params.id)}/`, 'Компоненты', await galleryUsage(workspaces, req.params.id)))
    }
    if (raw === MAKE_TESTS_PAGE) {
      const q = req.query as { file?: string }
      const index = await workspaces.readBuffer(req.params.id, 'index.html').catch(() => null)
      return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store')
        .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'self'")
        .send(renderTestsPage(q.file ?? '', index ? index.data.toString('utf8') : null))
    }
    if (raw === MAKE_STORIES_PAGE) {
      const q = req.query as { file?: string; story?: string }
      const index = await workspaces.readBuffer(req.params.id, 'index.html').catch(() => null)
      return reply
        .header('content-type', 'text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'self'")
        .send(renderStoriesPage(q.file ?? '', q.story ?? '', index ? index.data.toString('utf8') : null))
    }
    const path = raw.endsWith('/') ? `${raw}index.html` : raw
    let file
    try { file = await workspaces.readBuffer(req.params.id, path) } catch (error) { return sendError(reply, error) }
    if (!file) {
      const mock = await workspaces.resolveMock(req.params.id, path, 'GET', false, undefined, req.headers.cookie)
      if (mock) return sendMock(reply, mock)
      return reply.code(404).type('text/plain; charset=utf-8').send(`Файл не найден: ${path}`)
    }
    const mime = makeMimeType(file.path)
    reply
      .header('content-type', mime)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      // Превью изолировано: только свои ресурсы и inline-код, без навигации родителя.
      .header('content-security-policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; frame-ancestors 'self'")
    if (mime.startsWith('text/html')) {
      const html = file.data.toString('utf8')
      const injected = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${MAKE_INSPECTOR_SCRIPT}</body>`) : `${html}${MAKE_INSPECTOR_SCRIPT}`
      return reply.send(injected)
    }
    return reply.send(await previewBody(req.params.id, file))
  })

  app.get<{ Params: { id: string } }>('/api/preview/make/:id/', async (req, reply) => {
    if (!own(uid(req), req.params.id, reply)) return reply
    return reply.redirect(`/api/preview/make/${encodeURIComponent(req.params.id)}/index.html`)
  })
}

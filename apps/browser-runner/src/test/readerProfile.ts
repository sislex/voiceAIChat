import { createServer } from 'node:http'

/** Два origin на loopback: cookie и хранилища второго сайта проверяют границу
 * очистки. Здесь только искусственная учётка, внешних аккаунтов стенд не трогает. */
export async function startReaderProfileFixture() {
  const server = createServer((request, response) => {
    if (request.url === '/worker.js') {
      response.setHeader('content-type', 'application/javascript')
      response.end('self.addEventListener("install",e=>e.waitUntil(self.skipWaiting()));self.addEventListener("activate",e=>e.waitUntil(clients.claim()));')
      return
    }
    if (request.url === '/login') {
      response.setHeader('set-cookie', ['reader_session=test-only; Path=/; HttpOnly; SameSite=Lax', 'reader_persistent=test-only; Max-Age=3600; Path=/; SameSite=Lax', 'reader_path=test-only; HttpOnly; Path=/private; SameSite=Lax'])
      response.end('ok'); return
    }
    if (request.url === '/echo' || request.url === '/private/echo') {
      const cookies = request.headers.cookie ?? ''
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ session: cookies.includes('reader_session='), persistent: cookies.includes('reader_persistent='), path: cookies.includes('reader_path='), bootstrap: cookies.includes('vc_preview_run=') }))
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(`<!doctype html><meta charset="utf-8"><title>Профиль сайта</title>
      <style>body{font:18px system-ui;padding:24px}button{padding:12px}output{display:block;margin-top:20px}</style>
      <h1>Проверка входа и данных сайта</h1><button id="login">Войти тестовой учёткой</button><output id="state">Вход не выполнен</output>
      <script>
      document.getElementById('state').textContent=localStorage.getItem('reader-login')?'Тестовый вход сохранён':'Вход не выполнен';
      window.profileState=async()=>({cookies:await(await fetch('/private/echo')).json(),local:localStorage.getItem('reader-login'),session:sessionStorage.getItem('reader-session'),databases:(await indexedDB.databases()).map(x=>x.name),caches:await caches.keys(),workers:(await navigator.serviceWorker.getRegistrations()).length});
      document.getElementById('login').onclick=async()=>{
        await fetch('/login');localStorage.setItem('reader-login','test-user');sessionStorage.setItem('reader-session','test-tab');
        await new Promise((resolve,reject)=>{const r=indexedDB.open('reader-auth',1);r.onupgradeneeded=()=>r.result.createObjectStore('tokens');r.onsuccess=()=>{r.result.close();resolve()};r.onerror=()=>reject(r.error)});
        const cache=await caches.open('reader-cache');await cache.put('/proof',new Response('test-only'));
        await navigator.serviceWorker.register('/worker.js');await navigator.serviceWorker.ready;
        document.getElementById('state').textContent='Тестовый вход сохранён';
      };
      </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Profile fixture port unavailable')
  return {
    origin: `http://127.0.0.1:${address.port}`, otherOrigin: `http://localhost:${address.port}`,
    close: async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  }
}

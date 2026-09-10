# @voicechat/image-studio — студия картинок

Галереи разговоров `images`, загрузка/правка, корзина, метаданные и публикации `/g/*`.
UI остаётся в `packages/ui`; серверный пакет зависит только от `@voicechat/shared` и Fastify.

- Данные — `<dataDir>/image-studio`, каталог совместим со встроенной студией. Таблиц БД нет.
- Порт `ImageStudioCore` (`src/core.ts`): разговор, переименование, чтение результата LLM,
  генерация с отменой. Адаптеры — `apps/server/src/imageStudioBridge/localCore.ts` и
  `src/standalone/httpCore.ts`. Не импортируй ядро, DB или исполнителей.
- Порт `ImageStudioService` (`src/service.ts`): контекст галереи и захват картинок из ответа чата.
  В remote ядро не создаёт `ImageStudioStore` и не пишет в каталог студии.
- `createImageStudioModule` собирает embedded; `buildImageStudioServer` — отдельный процесс.
  По умолчанию у ядра embedded, в compose `VC_IMAGE_STUDIO_MODE=remote`.
- Standalone: `PORT=8796`, `VC_CORE_URL`, общий с ядром `VC_INTERNAL_TOKEN`, `VC_DATA_DIR`
  (или `VC_IMAGE_STUDIO_DATA_DIR`), необязательный `VC_RELEASE_VERSION`. У ядра ещё
  `VC_IMAGE_STUDIO_URL=http://image-studio:8796`. `/v1/health` — состояние процесса и версия.
- Авторизацию каждого `/api/*` запроса проверяет ядро через `/internal/whoami`: Bearer,
  cookie, CSRF. Публикации `/g/*` используют прежний токен/пароль галереи.
- Генерация — отдельный долгий HTTP-запрос к ядру. Отмена разрывает его и отменяет LLM;
  `preClose` отменяет активные раны при остановке студии. Слот генерации живёт у студии,
  поэтому запускай один экземпляр на каталог данных, как встроенный вариант.
- Контракт внутренних путей и лимитов — `packages/shared/src/imageStudioInternal.ts`.
  Прокси ядра и Caddy сохраняют публичные пути; лимит загрузки 20 МБ JSON учитывает base64.
- Тесты пакета используют фейковый порт, без SQLite. Интеграция embedded/remote с настоящими
  HTTP-портами и БД — `apps/server/src/imageStudioBridge/remote.integration.test.ts`.

Запуск: `npm run -w @voicechat/image-studio dev`; гейт приложения: `npm run gate:app -- image-studio`; в разработке — `npm run gate:fast`.
Комментарии по-русски, относительные импорты `.js`, выполнение исходников через `tsx`.

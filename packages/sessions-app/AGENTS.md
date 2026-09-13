# @voicechat/sessions-app — «Сессии и устройства»

UI-модуль: список устройств, с которых выполнен вход, и действия над ними.
Зависит только от `@voicechat/sessions-core` (логика) и `@voicechat/ui-kit`
(примитивы). Ни транспорта, ни `window`, ни сторов хоста — это проверяет
`architecture.test.ts`.

## Поверхность

| Экспорт | Зачем |
|---|---|
| `createSessionsStore({ client, realtime?, host?, notify? })` | состояние и действия без react |
| `SessionsPanel` | список карточек: поиск, переименование, доверие, завершение |
| `SessionsBulkActions` | «выйти на других» и «выйти везде» — обычно в подвале окна |
| `SessionsDialog` | панель, обёрнутая в модальное окно ui-kit |
| `DEFAULT_TEXTS` / проп `texts` | все подписи, переопределяются точечно |
| `makeSessions()` | фикстуры для сториз и тестов |

`SessionsClient` — единственный вход в приложение. Обязательны `list` и `revoke`,
остальное необязательно: `store.capabilities` вычисляется по наличию методов, и
the panel hides actions absent from the client. Admin supplies list and
revocation capabilities; renaming and granting trust remain owner actions.

## Как подключён здесь

- Хост-приложение: `packages/ui/src/components/SessionsDialogHost.tsx` собирает
  клиент из моста `window.session`, окно грузится лениво (`App.tsx`).
- Admin: `packages/admin-app/src/AdminSessions.tsx` mounts the shared panel on
  the selected user's Sessions tab, allowing revocation and revoking other
  sessions. Rename and trust capabilities are intentionally not supplied.
- Стили подключает хост: `import '@voicechat/sessions-app/styles.css'`.

## Правила

- Русские тексты — только в `texts.ts` и форматтерах `format.ts`; в ядре их нет.
- Часы приходят снаружи (`host.now`, проп `now`): иначе «5 минут назад» плывёт
  между рендерами и тесты становятся флаки.
- Отзыв оптимистичен и откатывается при ошибке — ожидание ответа сервера в этом
  месте читается как отказ.

Гейт: `npm run -w @voicechat/sessions-app test` + `npm run frontend:static`.

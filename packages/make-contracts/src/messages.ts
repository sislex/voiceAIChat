// Russian and English system messages used by Make clients and servers.
export const makeSystemMessages = {
  starterReactApp: {
    ru: 'Примени подход React-проекта (index.html с import map на esm.sh, src/main.jsx, компоненты в src/components с файлами *.stories.jsx). Сделай приложение «список покупок»: добавление, отметка, удаление, фильтр, счётчик; компоненты Button, Input, ListItem, EmptyState — каждый со сториз для основных состояний.',
    en: 'Use the React project structure (index.html with an import map for esm.sh, src/main.jsx, components in src/components with *.stories.jsx files). Build a shopping-list app: add, check off, delete, filter, and count items; include Button, Input, ListItem, and EmptyState components, each with stories for its main states.'
  },
  starterReactUiKit: {
    ru: 'Сделай React UI-кит без сборки (import map на esm.sh, JSX в src/components): Button (варианты primary/secondary/danger, размеры sm/md/lg, disabled, loading), Input с подписью и ошибкой, Badge, Card, Toggle, Modal. Для каждого — файл *.stories.jsx со всеми состояниями. Единая палитра через CSS-переменные.',
    en: 'Create a React UI kit without a build step (import map for esm.sh, JSX in src/components): Button (primary/secondary/danger variants, sm/md/lg sizes, disabled, loading), Input with a label and error, Badge, Card, Toggle, and Modal. Give each component a *.stories.jsx file covering every state. Use CSS variables for a shared color palette.'
  },
  "systemValueExceedsValueKb": {
    "ru": "{p0}: больше {p1} КБ",
    "en": "{p0}: exceeds {p1} KB"
  },
  "systemDirectoryValueIsMissingFromTheRepository": {
    "ru": "В репозитории нет каталога {p0}",
    "en": "Directory {p0} is missing from the repository"
  },
  "systemCouldNotDownloadTheRepositoryValue": {
    "ru": "Не удалось скачать репозиторий: {p0}",
    "en": "Could not download the repository: {p0}"
  },
  "systemCouldNotDownloadTheRepository": {
    "ru": "Не удалось скачать репозиторий",
    "en": "Could not download the repository"
  },
  "systemInvalidUrl": {
    "ru": "Некорректный URL",
    "en": "Invalid URL"
  },
  "systemOnlyHttpSUrlsAreSupported": {
    "ru": "Поддерживаются только http(s)-адреса",
    "en": "Only HTTP(S) URLs are supported"
  },
  "systemTheUrlDoesNotPointToAnHtmlPage": {
    "ru": "По адресу не HTML-страница",
    "en": "The URL does not point to an HTML page"
  },
  "systemInvalidComponentName": {
    "ru": "Некорректное имя компонента",
    "en": "Invalid component name"
  },
  "systemNoFilesToSave": {
    "ru": "Нет файлов для сохранения",
    "en": "No files to save"
  },
  "systemComponentNotFound": {
    "ru": "Компонент не найден",
    "en": "Component not found"
  },
  "systemThisWebsiteAddressIsUnavailableForPreview": {
    "ru": "Адрес сайта недоступен для превью",
    "en": "This website address is unavailable for preview"
  },
  "systemPathAndContentAreRequired": {
    "ru": "path и content обязательны",
    "en": "path and content are required"
  },
  "systemPathAndDatabase64AreRequired": {
    "ru": "path и dataBase64 обязательны",
    "en": "path and dataBase64 are required"
  },
  "systemFromAndToAreRequired": {
    "ru": "from и to обязательны",
    "en": "from and to are required"
  },
  "systemPathIsRequired": {
    "ru": "path обязателен",
    "en": "path is required"
  },
  "systemTooManyImportsTryAgainInValueS": {
    "ru": "Слишком много импортов — повторите через {p0} с",
    "en": "Too many imports. Try again in {p0} s"
  },
  "systemDatabase64IsRequired": {
    "ru": "dataBase64 обязателен",
    "en": "dataBase64 is required"
  },
  "systemUrlIsRequired": {
    "ru": "url обязателен",
    "en": "url is required"
  },
  "systemCouldNotLoadThePageValue": {
    "ru": "Не удалось загрузить страницу: {p0}",
    "en": "Could not load the page: {p0}"
  },
  "systemThisChatIsNotLinkedToAProjectSo": {
    "ru": "Чат не привязан к проекту — копировать не из чего.",
    "en": "This chat is not linked to a project, so there is nothing to copy from."
  },
  "systemTheProjectIsUnavailable": {
    "ru": "Проект недоступен.",
    "en": "The project is unavailable."
  },
  "systemTheProjectHasNoMachineWithAWorkingDirectory": {
    "ru": "У проекта нет машины с рабочей директорией.",
    "en": "The project has no machine with a working directory."
  },
  "systemTheMachineFilesystemBridgeIsUnavailableInThisConfiguration": {
    "ru": "Файловый мост машин недоступен в этой конфигурации.",
    "en": "The machine filesystem bridge is unavailable in this configuration."
  },
  "systemMachineValueIsOffline": {
    "ru": "Машина «{p0}» offline.",
    "en": "Machine “{p0}” is offline."
  },
  "systemInvalidPath": {
    "ru": "Некорректный путь",
    "en": "Invalid path"
  },
  "systemTheMachineDidNotRespondValue": {
    "ru": "Машина не ответила: {p0}",
    "en": "The machine did not respond: {p0}"
  },
  "systemSelectFiles": {
    "ru": "Выберите файлы",
    "en": "Select files"
  },
  "systemSelectNoMoreThanValueFilesAtOnce": {
    "ru": "Не больше {p0} файлов за раз",
    "en": "Select no more than {p0} files at once"
  },
  "systemInvalidPathValue": {
    "ru": "Некорректный путь: {p0}",
    "en": "Invalid path: {p0}"
  },
  "systemValueIsNotAFileOrCannotBeRead": {
    "ru": "«{p0}» — не файл или не читается",
    "en": "“{p0}” is not a file or cannot be read"
  },
  "systemCopyFailedValue": {
    "ru": "Копирование не удалось: {p0}",
    "en": "Copy failed: {p0}"
  },
  "systemThisMakeProjectIsNotLinkedToAProject": {
    "ru": "Make-проект не привязан к проекту",
    "en": "This Make project is not linked to a project"
  },
  "systemLinkNotFound": {
    "ru": "Связь не найдена",
    "en": "Link not found"
  },
  "systemUserValueNotFound": {
    "ru": "Пользователь «{p0}» не найден",
    "en": "User “{p0}” not found"
  },
  "systemTheLinkIsInvalidOrHasBeenRevoked": {
    "ru": "Ссылка недействительна или отозвана",
    "en": "The link is invalid or has been revoked"
  },
  "systemFileNotFoundValue": {
    "ru": "Файл не найден: {p0}",
    "en": "File not found: {p0}"
  },
  "systemClientidIsRequired": {
    "ru": "clientId обязателен",
    "en": "clientId is required"
  },
  "systemTemplateidIsRequired": {
    "ru": "templateId обязателен",
    "en": "templateId is required"
  },
  "systemQueryAndReplacementAreRequired": {
    "ru": "query и replacement обязательны",
    "en": "query and replacement are required"
  },
  "systemNameAndPathsAreRequired": {
    "ru": "name и paths обязательны",
    "en": "name and paths are required"
  },
  "systemFileStoryAndDatabase64AreRequired": {
    "ru": "file, story и dataBase64 обязательны",
    "en": "file, story, and dataBase64 are required"
  },
  "systemPClassErrTooManyAttemptsWaitValueS": {
    "ru": "<p class=\"err\">Слишком много попыток — подождите {p0} с.</p>",
    "en": "<p class=\"err\">Too many attempts. Wait {p0} s.</p>"
  },
  "systemPClassErrIncorrectPasswordTryAgainP": {
    "ru": "<p class=\"err\">Пароль не подошёл — попробуйте ещё раз.</p>",
    "en": "<p class=\"err\">Incorrect password. Try again.</p>"
  },
  "systemMockNotFoundMockValueValueJson": {
    "ru": "Мок не найден: mock/{p0}.{p1}.json",
    "en": "Mock not found: mock/{p0}.{p1}.json"
  },
  "systemPublicationNotFoundOrUnpublished": {
    "ru": "Публикация не найдена или снята",
    "en": "Publication not found or unpublished"
  },
  "systemThisPublicationIsPasswordProtected": {
    "ru": "Публикация защищена паролем",
    "en": "This publication is password-protected"
  },
  "systemTooManyCommentsTryAgainLater": {
    "ru": "Слишком много комментариев — попробуйте позже",
    "en": "Too many comments. Try again later."
  },
  "systemCommentTextIsRequired": {
    "ru": "Нужен текст комментария",
    "en": "Comment text is required"
  },
  "systemMockNotFound": {
    "ru": "Мок не найден",
    "en": "Mock not found"
  },
  "systemFileMissingFromSnapshotValue": {
    "ru": "В снимке нет файла: {p0}",
    "en": "File missing from snapshot: {p0}"
  },
  "systemSnapshotNotFound": {
    "ru": "Снимок не найден",
    "en": "Snapshot not found"
  },
  "systemMakeCoreIsUnavailableForSessionVerification": {
    "ru": "[make] ядро недоступно для проверки сессии",
    "en": "[make] core is unavailable for session verification"
  },
  "systemMakeStandaloneRequiresVcMcpSecretTheSameValue": {
    "ru": "Make standalone requires VC_MCP_SECRET (тот же, что у ядра)",
    "en": "Make standalone requires VC_MCP_SECRET (the same value as core)"
  },
  "systemMakeBackgroundCoreCallFailed": {
    "ru": "[make] фоновый вызов ядра не удался",
    "en": "[make] background core call failed"
  },
  "systemMakeCoreRejectedHubEvents": {
    "ru": "[make] ядро не приняло события шины",
    "en": "[make] core rejected hub events"
  },
  "systemMakeHubEventsWereNotDeliveredToCore": {
    "ru": "[make] события шины не доставлены ядру",
    "en": "[make] hub events were not delivered to core"
  },
  "systemDetailsClassCodeSummaryCodeSummaryPreValuePre": {
    "ru": "<details class=\"code\"><summary>Код</summary><pre>{p0}</pre><button type=\"button\" class=\"copy\" data-code=\"{p1}\">Скопировать</button></details>",
    "en": "<details class=\"code\"><summary>Code</summary><pre>{p0}</pre><button type=\"button\" class=\"copy\" data-code=\"{p1}\">Copy</button></details>"
  },
  "systemFigureClassCardDataSearchValueIframeLoadingLazy": {
    "ru": "<figure class=\"card\" data-search=\"{p0}\"><iframe loading=\"lazy\" title=\"{p1} / {p2}\" src=\"{p3}\"></iframe><figcaption><b>{p4}</b> · {p5} <a href=\"{p6}\" target=\"_blank\" rel=\"noreferrer\">открыть</a></figcaption>{p7}</figure>",
    "en": "<figure class=\"card\" data-search=\"{p0}\"><iframe loading=\"lazy\" title=\"{p1} / {p2}\" src=\"{p3}\"></iframe><figcaption><b>{p4}</b> · {p5} <a href=\"{p6}\" target=\"_blank\" rel=\"noreferrer\">open</a></figcaption>{p7}</figure>"
  },
  "systemInputClassSearchTypeSearchPlaceholderSearchComponentsOr": {
    "ru": "<input class=\"search\" type=\"search\" placeholder=\"Поиск компонента или стори…\" aria-label=\"Поиск по витрине\">",
    "en": "<input class=\"search\" type=\"search\" placeholder=\"Search components or stories…\" aria-label=\"Search showcase\">"
  },
  "systemPClassEmptyTheProjectHasNoStoriesYet": {
    "ru": "<p class=\"empty\">В проекте пока нет сториз (*.stories.jsx/tsx).</p>",
    "en": "<p class=\"empty\">The project has no stories yet (*.stories.jsx/tsx).</p>"
  },
  "systemCompilationErrorInValueValue": {
    "ru": "Ошибка компиляции {p0}: {p1}",
    "en": "Compilation error in {p0}: {p1}"
  },
  "systemYourMakeProjectsUseValueMbOfValueClean": {
    "ru": "Все ваши проекты Make заняли {p0} МБ из {p1} — очистите снимки или удалите старые проекты",
    "en": "Your Make projects use {p0} MB of {p1}. Clean up snapshots or delete old projects."
  },
  "systemInvalidConversationId": {
    "ru": "Некорректный id разговора",
    "en": "Invalid conversation ID"
  },
  "systemInvalidFilePathValue": {
    "ru": "Недопустимый путь файла: «{p0}»",
    "en": "Invalid file path: “{p0}”"
  },
  "systemThePathIsOutsideTheProject": {
    "ru": "Путь выходит за пределы проекта",
    "en": "The path is outside the project"
  },
  "systemSymbolicLinksAreNotAllowedInTheProject": {
    "ru": "Символические ссылки в проекте запрещены",
    "en": "Symbolic links are not allowed in the project"
  },
  "systemFileValueIsNotTextOpenItInThe": {
    "ru": "Файл «{p0}» не текстовый — откройте его в превью",
    "en": "File “{p0}” is not text. Open it in the preview."
  },
  "systemFileValueNotFound": {
    "ru": "Файл «{p0}» не найден",
    "en": "File “{p0}” not found"
  },
  "systemFileValueExceedsValueKb": {
    "ru": "Файл «{p0}» больше {p1} КБ",
    "en": "File “{p0}” exceeds {p1} KB"
  },
  "systemTheProjectAlreadyContainsValueFiles": {
    "ru": "В проекте уже {p0} файлов",
    "en": "The project already contains {p0} files"
  },
  "systemTheProjectUsesValueMbOfValueCleanUp": {
    "ru": "Проект занял {p0} МБ из {p1} — очистите снимки в «Место»",
    "en": "The project uses {p0} MB of {p1}. Clean up snapshots in Storage."
  },
  "systemFileValueAlreadyExists": {
    "ru": "Файл «{p0}» уже существует",
    "en": "File “{p0}” already exists"
  },
  "systemTheSearchFragmentIsEmpty": {
    "ru": "Пустой фрагмент для поиска",
    "en": "The search fragment is empty"
  },
  "systemFileValueNotFound_9b8aed": {
    "ru": "Файл {p0} не найден",
    "en": "File {p0} not found"
  },
  "systemFragmentNotFoundInValueRereadItWithMake": {
    "ru": "Фрагмент не найден в {p0}. Перечитай файл make_read_file и передай точный текст.",
    "en": "Fragment not found in {p0}. Reread it with make_read_file and provide the exact text."
  },
  "systemTheFragmentAppearsValueTimesInValueExpandIt": {
    "ru": "Фрагмент встречается {p0} раз в {p1}: расширь его до уникального или передай all=true",
    "en": "The fragment appears {p0} times in {p1}. Expand it until unique or pass all=true."
  },
  "systemProjectDesignTokensValueUseVarNameAndAdd": {
    "ru": "Дизайн-токены проекта ({p0}, используй var(--имя), новые добавляй туда же): {p1}{p2}",
    "en": "Project design tokens ({p0}; use var(--name) and add new tokens there): {p1}{p2}"
  },
  "systemProjectNotesDecisionsToFollowUpdateThroughMakeRemember": {
    "ru": "Заметки проекта (решения, которых нужно придерживаться; дополняй через make_remember):\n{p0}",
    "en": "Project notes (decisions to follow; update through make_remember):\n{p0}"
  },
  "systemOpenUserFeedbackOnThePreviewConsiderItWhen": {
    "ru": "Открытые замечания пользователя к превью (учитывай при правках, если запрос их касается):\n{p0}",
    "en": "Open user feedback on the preview (consider it when relevant to the requested changes):\n{p0}"
  },
  "systemMakeProjectContextValue": {
    "ru": "## Контекст проекта Make\n{p0}",
    "en": "## Make project context\n{p0}"
  },
  "systemInvalidUsername": {
    "ru": "Некорректное имя пользователя",
    "en": "Invalid username"
  },
  "systemASelectorAndCommentTextAreRequired": {
    "ru": "Нужны селектор и текст комментария",
    "en": "A selector and comment text are required"
  },
  "systemTooManyCommentsDeleteResolvedComments": {
    "ru": "Слишком много комментариев — удалите решённые",
    "en": "Too many comments. Delete resolved comments."
  },
  "systemCommentNotFound": {
    "ru": "Комментарий не найден",
    "en": "Comment not found"
  },
  "systemGuest": {
    "ru": "Гость",
    "en": "Guest"
  },
  "systemSnapshot": {
    "ru": "Снимок",
    "en": "Snapshot"
  },
  "systemBeforeSnapshotRestore": {
    "ru": "Перед восстановлением снимка",
    "en": "Before snapshot restore"
  },
  "systemDisallowedPath": {
    "ru": "Недопустимый путь",
    "en": "Disallowed path"
  },
  "systemFileValueIsNotText": {
    "ru": "Файл «{p0}» не текстовый",
    "en": "File “{p0}” is not text"
  },
  "systemFileValueIsMissingFromTheSnapshot": {
    "ru": "В снимке нет файла «{p0}»",
    "en": "File “{p0}” is missing from the snapshot"
  },
  "systemTheImportContainsNoSupportedFiles": {
    "ru": "В импорте нет подходящих файлов",
    "en": "The import contains no supported files"
  },
  "systemTheProjectCannotContainMoreThanValueFiles": {
    "ru": "В проекте не может быть больше {p0} файлов",
    "en": "The project cannot contain more than {p0} files"
  },
  "systemBeforeImportReplace": {
    "ru": "Перед импортом (замена)",
    "en": "Before import (replace)"
  },
  "systemBeforeImport": {
    "ru": "Перед импортом",
    "en": "Before import"
  },
  "systemBeforeProjectReset": {
    "ru": "Перед сбросом проекта",
    "en": "Before project reset"
  },
  "systemInvalidExpressionValue": {
    "ru": "Неверное выражение: {p0}",
    "en": "Invalid expression: {p0}"
  },
  "systemSearchQueryIsEmpty": {
    "ru": "Пустая строка поиска",
    "en": "Search query is empty"
  },
  "systemBeforeReplacingValueValue": {
    "ru": "Перед заменой «{p0}» → «{p1}»",
    "en": "Before replacing “{p0}” → “{p1}”"
  },
  "systemScreenshotExceeds4Mb": {
    "ru": "Снимок больше 4 МБ",
    "en": "Screenshot exceeds 4 MB"
  },
  "systemExpectedPng": {
    "ru": "Ожидается PNG",
    "en": "Expected PNG"
  },
  "systemAddress340CharactersLatinLettersDigitsAndHyphens": {
    "ru": "Адрес: 3–40 символов, латиница, цифры и дефис",
    "en": "Address: 3–40 characters; Latin letters, digits, and hyphens"
  },
  "systemAnotherProjectAlreadyUsesThisAddress": {
    "ru": "Такой адрес уже занят другим проектом",
    "en": "Another project already uses this address"
  },
  "systemThePasswordMustContainAtLeast4Characters": {
    "ru": "Пароль — не короче 4 символов",
    "en": "The password must contain at least 4 characters"
  },
  "systemPublicationIsReadOnly": {
    "ru": "публикация только для чтения",
    "en": "publication is read-only"
  },
  "systemMockValueInvalidJson": {
    "ru": "Мок {p0}: невалидный JSON",
    "en": "Mock {p0}: invalid JSON"
  },
  "systemTheHtmlCssStackDoesNotAllowJavascriptFiles": {
    "ru": "Стек HTML+CSS запрещает JavaScript-файлы",
    "en": "The HTML+CSS stack does not allow JavaScript files"
  },
  "systemReactComponentHasNoAdjacentStoriesFile": {
    "ru": "У React-компонента нет соседнего файла stories",
    "en": "React component has no adjacent stories file"
  },
  "systemNoIndexHtmlFileToOpenInThePreview": {
    "ru": "Нет index.html — превью открывать нечего",
    "en": "No index.html file to open in the preview"
  },
  "systemTheFileIsEmpty": {
    "ru": "Файл пустой",
    "en": "The file is empty"
  },
  "systemCompilationErrorLineValueValue": {
    "ru": "Ошибка компиляции (строка {p0}): {p1}",
    "en": "Compilation error (line {p0}): {p1}"
  },
  "systemTheHtmlCssStackDoesNotAllowScriptTags": {
    "ru": "Стек HTML+CSS запрещает теги script",
    "en": "The HTML+CSS stack does not allow script tags"
  },
  "systemExternalScriptDoesNotUseHttpsValue": {
    "ru": "Внешний скрипт не по https: {p0}",
    "en": "External script does not use HTTPS: {p0}"
  },
  "systemLinkToAMissingFileValue": {
    "ru": "Ссылка на отсутствующий файл: {p0}",
    "en": "Link to a missing file: {p0}"
  },
  "systemTemplateValueNotFound": {
    "ru": "Шаблон «{p0}» не найден",
    "en": "Template “{p0}” not found"
  },
  "systemTemplateValueIsIncompatibleWithStackValue": {
    "ru": "Шаблон «{p0}» несовместим со стеком {p1}",
    "en": "Template “{p0}” is incompatible with stack {p1}"
  },
  "systemBeforeStackChange": {
    "ru": "До смены стека",
    "en": "Before stack change"
  },
  "systemThisIsNotAZipArchive": {
    "ru": "Это не ZIP-архив",
    "en": "This is not a ZIP archive"
  },
  "systemArchiveCentralDirectoryIsCorrupted": {
    "ru": "Повреждён центральный каталог архива",
    "en": "Archive central directory is corrupted"
  },
  "systemArchiveLocalHeaderIsCorrupted": {
    "ru": "Повреждён локальный заголовок архива",
    "en": "Archive local header is corrupted"
  },
  "systemCompressionMethodValueIsUnsupportedFileValue": {
    "ru": "Метод сжатия {p0} не поддерживается (файл «{p1}»)",
    "en": "Compression method {p0} is unsupported (file “{p1}”)"
  },
  "systemTheArchiveContainsMoreThanValueFiles": {
    "ru": "В архиве больше {p0} файлов",
    "en": "The archive contains more than {p0} files"
  },
  "systemHtmlCssStackJavascriptIsNotAllowedDoNot": {
    "ru": "Стек HTML+CSS: JavaScript запрещён. Не создавай .js/.mjs файлы и не добавляй теги <script>.",
    "en": "HTML+CSS stack: JavaScript is not allowed. Do not create .js/.mjs files or add <script> tags."
  },
  "systemHtmlCssJsStackUseBrowserNativeJavascriptWithout": {
    "ru": "Стек HTML+CSS+JS: используй браузерный vanilla JavaScript без сборки и index.html как точку входа.",
    "en": "HTML+CSS+JS stack: use browser-native JavaScript without a build step and index.html as the entry point."
  },
  "systemAngularStandaloneJitStackImportAngularCompilerBeforeBootstrapapplication": {
    "ru": "Стек Angular standalone JIT: импортируй @angular/compiler до bootstrapApplication, используй standalone-компоненты и закреплённые esm.sh зависимости без build step.",
    "en": "Angular standalone JIT stack: import @angular/compiler before bootstrapApplication, use standalone components and pinned esm.sh dependencies without a build step."
  },
  "systemStyleFoundationACustomCssSystemUsingTokenVariables": {
    "ru": "Стилевая база: собственная CSS-система на переменных-токенах; не подключай UI-фреймворки.",
    "en": "Style foundation: a custom CSS system using token variables. Do not add UI frameworks."
  },
  "systemBootstrap533StyleFoundationUseThePinned": {
    "ru": "Стилевая база Bootstrap 5.3.3: используй закреплённый CDN и отдельный CSS поверх Bootstrap-переменных.",
    "en": "Bootstrap 5.3.3 style foundation: use the pinned CDN and separate CSS over Bootstrap variables."
  },
  "systemCustomDesignSystem": {
    "ru": "своя система",
    "en": "custom design system"
  },
  "systemDesignerModePrioritizeTheVisualSystemTokensTypographySpacing": {
    "ru": "Режим «Дизайнер»: приоритет — визуальная система (токены, типографика, отступы, состояния, адаптив, доступность). Логику и данные не переписывай без просьбы; предлагай варианты оформления и объясняй выбор коротко.",
    "en": "Designer mode: prioritize the visual system (tokens, typography, spacing, states, responsiveness, and accessibility). Change logic and data only when requested. Suggest visual options and explain choices briefly."
  },
  "systemDeveloperModePrioritizeCodeStructureStateErrorHandlingComponent": {
    "ru": "Режим «Разработчик»: приоритет — структура кода, состояние, обработка ошибок, тесты компонентов (*.test.tsx), производительность. Визуал меняй минимально и только через существующие токены.",
    "en": "Developer mode: prioritize code structure, state, error handling, component tests (*.test.tsx), and performance. Keep visual changes minimal and use existing tokens."
  },
  "systemBlankPage": {
    "ru": "Пустая страница",
    "en": "Blank page"
  },
  "systemStarterFilesIndexHtmlStylesCssAppJs": {
    "ru": "Стартовая заготовка: index.html, styles.css, app.js.",
    "en": "Starter files: index.html, styles.css, app.js."
  },
  "systemLandingPage": {
    "ru": "Лендинг",
    "en": "Landing page"
  },
  "systemHeaderWithNavigationHeroThreeFeatureCardsAForm": {
    "ru": "Шапка с меню, герой-блок, три карточки преимуществ, форма и подвал.",
    "en": "Header with navigation, hero, three feature cards, a form, and a footer."
  },
  "systemDashboard": {
    "ru": "Дашборд",
    "en": "Dashboard"
  },
  "systemSidebarMetricCardsATableAndASimpleSvg": {
    "ru": "Боковое меню, карточки метрик, таблица и простая диаграмма на SVG.",
    "en": "Sidebar, metric cards, a table, and a simple SVG chart."
  },
  "systemReactAppStorybook": {
    "ru": "React-приложение + Storybook",
    "en": "React app + Storybook"
  },
  "systemReact18FromEsmShWithoutABuildStep": {
    "ru": "React 18 из esm.sh без сборки: JSX транспилируется на сервере. Компоненты в src/components, сториз рядом (*.stories.jsx) — вкладка «Компоненты».",
    "en": "React 18 from esm.sh without a build step. JSX is transpiled on the server. Components live in src/components with adjacent *.stories.jsx files for the Components tab."
  },
  "systemTheReactTemplateUsingTsxTypedComponentPropsAnd": {
    "ru": "То же, что React-шаблон, но на TSX: типизированные пропсы компонентов, сториз *.stories.tsx. TSX транспилируется на сервере (типы не проверяются в рантайме).",
    "en": "The React template using TSX: typed component props and *.stories.tsx files. TSX is transpiled on the server; types are not checked at runtime."
  },
  "systemStaticPageWithoutJavascript": {
    "ru": "Статическая страница без JavaScript.",
    "en": "Static page without JavaScript."
  },
  "systemAngularStandaloneJitUsingPinnedEsmShImports": {
    "ru": "Angular standalone JIT из закреплённых esm.sh импортов.",
    "en": "Angular standalone JIT using pinned esm.sh imports."
  },
  "systemWebsitesAndLandingPages": {
    "ru": "Сайты и лендинги",
    "en": "Websites and landing pages"
  },
  "systemAppsAndDashboards": {
    "ru": "Приложения и дашборды",
    "en": "Apps and dashboards"
  },
  "systemReactAndComponents": {
    "ru": "React и компоненты",
    "en": "React and components"
  },
  "systemToolsAndGames": {
    "ru": "Инструменты и игры",
    "en": "Tools and games"
  },
  "systemSaasProductLandingPage": {
    "ru": "Лендинг SaaS-продукта",
    "en": "SaaS product landing page"
  },
  "systemBuildALandingPageForATeamTaskManagement": {
    "ru": "Сделай лендинг для SaaS-продукта по управлению задачами команды: герой-блок с заголовком и CTA, три преимущества с иконками, секция «как это работает» из трёх шагов, тарифы (3 плана, переключатель месяц/год), FAQ-аккордеон и подвал. Современный светлый стиль, адаптивно.",
    "en": "Build a landing page for a team task-management SaaS product: hero with headline and CTA, three features with icons, a three-step how-it-works section, pricing with three plans and a monthly/yearly toggle, FAQ accordion, and footer. Use a modern light style and responsive layout."
  },
  "systemDesignerPortfolio": {
    "ru": "Портфолио дизайнера",
    "en": "Designer portfolio"
  },
  "systemCreateAProductDesignerPortfolioNameAndShortBio": {
    "ru": "Создай сайт-портфолио продуктового дизайнера: имя и короткое био, сетка из 6 проектов с обложками (inline SVG-заглушки), страница-модалка с деталями проекта, блок «обо мне» и контакты. Минимализм, много воздуха, тёмная тема.",
    "en": "Create a product designer portfolio: name and short bio, six projects with inline SVG cover placeholders, a modal with project details, an about section, and contacts. Use a minimalist layout, generous spacing, and a dark theme."
  },
  "systemRestaurantWebsiteWithMenu": {
    "ru": "Сайт ресторана с меню",
    "en": "Restaurant website with menu"
  },
  "systemBuildASmallRestaurantWebsiteNavigationHeaderHeroWith": {
    "ru": "Сделай сайт небольшого ресторана: шапка с навигацией, герой с фото-заглушкой и кнопкой «Забронировать», меню по категориям с табами, галерея, форма бронирования с валидацией и карта-заглушка в контактах. Тёплая палитра.",
    "en": "Build a small restaurant website: navigation header, hero with an image placeholder and Book a table button, tabbed menu categories, gallery, booking form with validation, and a map placeholder in contacts. Use a warm palette."
  },
  "systemEventPage": {
    "ru": "Страница мероприятия",
    "en": "Event page"
  },
  "systemCreateAConferencePageWithDateAndVenueJavascript": {
    "ru": "Создай страницу конференции: дата и место, обратный отсчёт до начала (JS), программа по трекам с расписанием, спикеры карточками, форма регистрации и блок партнёров. Яркий акцентный цвет, адаптивно.",
    "en": "Create a conference page with date and venue, JavaScript countdown, schedule grouped by track, speaker cards, registration form, and partners. Use a bright accent color and responsive layout."
  },
  "systemAnalyticsDashboard": {
    "ru": "Аналитический дашборд",
    "en": "Analytics dashboard"
  },
  "systemBuildASalesDashboardSidebarRevenueOrderConversionAverage": {
    "ru": "Сделай дашборд продаж: боковое меню, карточки метрик (выручка, заказы, конверсия, средний чек) с трендом, линейный график по месяцам и столбчатый по категориям на чистом SVG, таблица последних заказов с сортировкой и поиском, переключатель тёмной темы.",
    "en": "Build a sales dashboard: sidebar, revenue/order/conversion/average-order metric cards with trends, monthly line chart and category bar chart in SVG, recent orders table with sorting and search, and dark-mode toggle."
  },
  "systemKanbanTaskBoard": {
    "ru": "Канбан-доска задач",
    "en": "Kanban task board"
  },
  "systemCreateAKanbanBoardWithThreeColumnsToDo": {
    "ru": "Создай канбан-доску: три колонки (Сделать, В работе, Готово), добавление/редактирование/удаление карточек, перетаскивание между колонками мышью и пальцем, фильтр по метке, сохранение в localStorage. Аккуратный UI.",
    "en": "Create a kanban board with three columns (To do, In progress, Done), card creation/editing/deletion, mouse and touch drag-and-drop between columns, label filtering, and localStorage persistence. Use a clean UI."
  },
  "systemHabitTracker": {
    "ru": "Трекер привычек",
    "en": "Habit tracker"
  },
  "systemBuildAHabitTrackerHabitsWithDailyCheckmarksStreaks": {
    "ru": "Сделай трекер привычек: список привычек с отметками по дням недели, серия (streak), прогресс за месяц в виде тепловой карты, добавление и удаление привычек, данные в localStorage, мобильный дизайн в первую очередь.",
    "en": "Build a habit tracker: habits with daily checkmarks, streaks, monthly progress heatmap, adding and deleting habits, localStorage persistence, and a mobile-first design."
  },
  "systemMiniContactCrm": {
    "ru": "Мини-CRM контактов",
    "en": "Mini contact CRM"
  },
  "systemCreateAMiniCrmContactsTableWithSearchStatus": {
    "ru": "Создай мини-CRM: таблица контактов с поиском, фильтром по статусу и сортировкой, боковая панель с карточкой контакта и заметками, форма добавления, экспорт в CSV, данные в localStorage.",
    "en": "Create a mini CRM: contacts table with search, status filtering and sorting, sidebar with contact details and notes, add-contact form, CSV export, and localStorage persistence."
  },
  "systemReactAppWithComponents": {
    "ru": "React-приложение с компонентами",
    "en": "React app with components"
  },
  "systemUiKitWith6Components": {
    "ru": "UI-кит из 6 компонентов",
    "en": "UI kit with 6 components"
  },
  "systemMultistepReactForm": {
    "ru": "Многошаговая форма на React",
    "en": "Multistep React form"
  },
  "systemCreateAReactApplicationWithAThreeStepRequest": {
    "ru": "Создай React-приложение с многошаговой формой заявки (3 шага: контакты, детали, подтверждение): валидация полей, индикатор шагов, сохранение черновика в localStorage, итоговый экран. Компоненты Stepper, Field, Summary со сториз.",
    "en": "Create a React application with a three-step request form (contacts, details, confirmation), field validation, step indicator, draft saved in localStorage, and summary screen. Include Stepper, Field, and Summary components with stories."
  },
  "systemMortgageCalculator": {
    "ru": "Калькулятор ипотеки",
    "en": "Mortgage calculator"
  },
  "systemBuildAMortgageCalculatorWithSlidersAndInputsFor": {
    "ru": "Сделай калькулятор ипотеки: сумма, срок, ставка, первоначальный взнос — ползунки и поля; результат: ежемесячный платёж, переплата, график платежей таблицей и диаграмма доли процентов на SVG. Пересчёт на лету.",
    "en": "Build a mortgage calculator with sliders and inputs for amount, term, interest rate, and down payment. Show monthly payment, total interest, payment schedule, and an SVG interest-share chart. Recalculate immediately."
  },
  "systemQuizWithResults": {
    "ru": "Квиз с результатом",
    "en": "Quiz with results"
  },
  "systemCreateAnEightQuestionMultipleChoiceQuizWithA": {
    "ru": "Создай квиз из 8 вопросов с вариантами ответов, прогресс-баром, таймером на вопрос, подсчётом баллов и экраном результата с кнопкой «Поделиться» (копирует текст). Вопросы — в отдельном JSON-файле.",
    "en": "Create an eight-question multiple-choice quiz with a progress bar, timer per question, scoring, and result screen with a Share button that copies text. Store questions in a separate JSON file."
  },
  "system2048Game": {
    "ru": "Игра 2048",
    "en": "2048 game"
  },
  "systemBuild2048A44BoardArrowKeyAnd": {
    "ru": "Сделай игру 2048: поле 4×4, управление стрелками и свайпами, анимация плиток, счёт и лучший результат в localStorage, кнопка «Новая игра», экран победы/поражения. Аккуратная типографика.",
    "en": "Build 2048: a 4×4 board, arrow-key and swipe controls, tile animations, score and best score in localStorage, New game button, and win/lose screen. Use clear typography."
  },
  "systemMarkdownEditor": {
    "ru": "Markdown-редактор",
    "en": "Markdown editor"
  },
  "systemCreateAMarkdownEditorWithLivePreviewInTwo": {
    "ru": "Создай Markdown-редактор с живым превью в две колонки: свой простой парсер (заголовки, списки, жирный/курсив, ссылки, код), панель инструментов, счётчик слов, автосохранение в localStorage и экспорт в .md.",
    "en": "Create a Markdown editor with live preview in two columns, a simple parser for headings/lists/bold/italic/links/code, toolbar, word count, localStorage autosave, and .md export."
  },
  "systemDebugConsoleLogRemoveBeforePublishing": {
    "ru": "Отладочный console.log — уберите перед публикацией",
    "en": "Debug console.log: remove before publishing"
  },
  "systemDebuggerStatementRemains": {
    "ru": "Оставлен debugger",
    "en": "debugger statement remains"
  },
  "systemUseConstLetInsteadOfVar": {
    "ru": "Используйте const/let вместо var",
    "en": "Use const/let instead of var"
  },
  "systemLooseComparisonUse": {
    "ru": "Нестрогое сравнение — используйте === / !==",
    "en": "Loose comparison: use === / !=="
  },
  "systemDangerouslysetinnerhtmlMayAllowXssVerifyTheMarkupSource": {
    "ru": "dangerouslySetInnerHTML — риск XSS, проверьте источник разметки",
    "en": "dangerouslySetInnerHTML may allow XSS. Verify the markup source."
  },
  "systemImgIsMissingAltText": {
    "ru": "У <img> нет alt",
    "en": "<img> is missing alt text"
  },
  "systemElementInMapIsMissingAKey": {
    "ru": "Элемент в .map без key",
    "en": "Element in .map is missing a key"
  },
  "systemAvoidImportantIncreaseSelectorSpecificityInstead": {
    "ru": "!important — лучше поднять специфичность селектора",
    "en": "Avoid !important; increase selector specificity instead"
  },
  "systemInvalidColorValue": {
    "ru": "Некорректный цвет {p0}",
    "en": "Invalid color {p0}"
  },
  "systemPropertyValueIsRepeatedInTheBlockLineValue": {
    "ru": "Свойство {p0} повторяется в блоке (строка {p1})",
    "en": "Property {p0} is repeated in the block (line {p1})"
  },
  "systemEmptyRule": {
    "ru": "Пустое правило",
    "en": "Empty rule"
  },
  "systemStatus200Delay300BodyId1NameAnna": {
    "ru": "{\n  \"$status\": 200,\n  \"$delay\": 300,\n  \"$body\": [\n    { \"id\": 1, \"name\": \"Анна\", \"role\": \"admin\" },\n    { \"id\": 2, \"name\": \"Борис\", \"role\": \"user\" }\n  ]\n}\n",
    "en": "{\n  \"$status\": 200,\n  \"$delay\": 300,\n  \"$body\": [\n    { \"id\": 1, \"name\": \"Anna\", \"role\": \"admin\" },\n    { \"id\": 2, \"name\": \"Boris\", \"role\": \"user\" }\n  ]\n}\n"
  },
  "systemCreatePreviewMockDataInValueUsingTheCollection": {
    "ru": "Создай мок-данные для превью: файл {p0} в формате коллекции {\"$collection\": true, \"$body\": [ … ]}.",
    "en": "Create preview mock data in {p0} using the collection format {\"$collection\": true, \"$body\": [ … ]}."
  },
  "systemDataDescriptionValue": {
    "ru": "Описание данных: {p0}.",
    "en": "Data description: {p0}."
  },
  "systemGenerateValueRealisticEnglishRecordsUniqueWithoutLoremIpsum": {
    "ru": "Сгенерируй {p0} правдоподобных записей на русском (уникальные, без «Lorem ipsum»), у каждой — числовое поле id начиная с 1 и поля из описания; типы соблюдай (числа числами, даты в ISO).",
    "en": "Generate {p0} realistic English records (unique, without Lorem ipsum). Include a numeric id starting at 1 and fields from the description. Preserve types: numbers as numbers and dates in ISO format."
  },
  "systemWriteTheCompleteFileWithMakeWriteFileIf": {
    "ru": "Файл записывай целиком через make_write_file. Если в проекте есть код, который должен показывать эти данные, подключи его через fetch(\"{p0}\") и проверь проект (make_check).",
    "en": "Write the complete file with make_write_file. If project code needs to display this data, connect it through fetch(\"{p0}\") and check the project with make_check."
  },
  "systemPreserveEverythingElseInTheProject": {
    "ru": "Ничего другого в проекте не меняй.",
    "en": "Preserve everything else in the project."
  },
  "systemFixFeedbackValue": {
    "ru": "Исправить замечания ({p0})",
    "en": "Fix feedback ({p0})"
  },
  "systemFixTheOpenPreviewFeedbackFromProjectContextAnd": {
    "ru": "Исправь открытые замечания к превью из контекста проекта: по каждому — что изменил. ",
    "en": "Fix the open preview feedback from project context and explain what changed for each item. "
  },
  "systemFixAccessibility": {
    "ru": "Починить доступность",
    "en": "Fix accessibility"
  },
  "systemCheckPageAccessibilityContrastAltTextFieldLabelsHeadings": {
    "ru": "Проверь доступность страницы (контраст, alt, подписи полей, заголовки, фокус) и исправь найденное. ",
    "en": "Check page accessibility (contrast, alt text, field labels, headings, and focus) and fix the issues found. "
  },
  "systemCreateDesignTokens": {
    "ru": "Завести дизайн-токены",
    "en": "Create design tokens"
  },
  "systemExtractColorsSpacingRadiiAndFontsIntoRootCss": {
    "ru": "Вынеси цвета, отступы, радиусы и шрифты в CSS-переменные :root (tokens.css) и переведи стили на них. ",
    "en": "Extract colors, spacing, radii, and fonts into :root CSS variables in tokens.css and update styles to use them. "
  },
  "systemCheckResponsiveness": {
    "ru": "Проверить адаптив",
    "en": "Check responsiveness"
  },
  "systemCheckTheLayoutAt375pxAnd768pxForWrapping": {
    "ru": "Проверь вёрстку на 375px и 768px: переносы, перекрытия, размеры кликабельных элементов — и исправь. ",
    "en": "Check the layout at 375px and 768px for wrapping, overlaps, and target sizes, then fix the issues. "
  },
  "systemAddADarkThemeUsingTokensADataTheme": {
    "ru": "Добавь тёмную тему через токены: набор [data-theme=\"dark\"] и переключатель в шапке с сохранением выбора. ",
    "en": "Add a dark theme using tokens: a [data-theme=\"dark\"] set and a header toggle that remembers the choice. "
  },
  "systemWriteComponentTestsTestTsxTestNameAsyncT": {
    "ru": "Напиши тесты компонентов (*.test.tsx: test(name, async (t) => …) с t.render/t.click и expect) для основных компонентов и запусти проверку. ",
    "en": "Write component tests (*.test.tsx: test(name, async (t) => …) using t.render/t.click and expect) for key components and run the checks. "
  },
  "systemAddStories": {
    "ru": "Добавить сториз",
    "en": "Add stories"
  },
  "systemExtractRepeatedBlocksIntoSrcComponentsAndAddCsf": {
    "ru": "Вынеси повторяющиеся блоки в компоненты src/components и добавь к ним сториз (CSF) для вкладки «Компоненты». ",
    "en": "Extract repeated blocks into src/components and add CSF stories for the Components tab. "
  },
  "systemSubtleAnimations": {
    "ru": "Аккуратные анимации",
    "en": "Subtle animations"
  },
  "systemAddRestrainedTransitionsForHoverAndSectionEntrancesWhile": {
    "ru": "Добавь сдержанные переходы (hover, появление секций) с уважением к prefers-reduced-motion. ",
    "en": "Add restrained transitions for hover and section entrances while respecting prefers-reduced-motion. "
  },
  "systemPrepareForPublishing": {
    "ru": "Подготовить к публикации",
    "en": "Prepare for publishing"
  },
  "systemCheckMetaTagsTitleFaviconOpenGraphAnd404": {
    "ru": "Проверь мета-теги, title, favicon, Open Graph и 404-состояния — подготовь проект к публикации. ",
    "en": "Check meta tags, title, favicon, Open Graph, and 404 states to prepare the project for publishing. "
  },
  "systemTheExpressionMatchesAnEmptyString": {
    "ru": "Выражение совпадает с пустой строкой",
    "en": "The expression matches an empty string"
  },
  "systemExample": {
    "ru": "Пример",
    "en": "Example"
  },
  "systemContents": {
    "ru": "\"Содержимое\"",
    "en": "\"Contents\""
  },
  "systemProjectDesignTokensChangesHereApplyToEveryComponent": {
    "ru": "/* Дизайн-токены проекта: меняй здесь — подхватят все компоненты. */\n:root {\n  --bg: #f6f7fb;\n  --fg: #1a1d23;\n  --muted: #6b7280;\n  --accent: #4f7cff;\n  --accent-fg: #ffffff;\n  --card: #ffffff;\n  --line: #e5e7eb;\n  --radius: 12px;\n  --space-1: 4px;\n  --space-2: 8px;\n  --space-3: 16px;\n  --space-4: 24px;\n  --font: system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif;\n  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;\n}\n",
    "en": "/* Project design tokens: changes here apply to every component. */\n:root {\n  --bg: #f6f7fb;\n  --fg: #1a1d23;\n  --muted: #6b7280;\n  --accent: #4f7cff;\n  --accent-fg: #ffffff;\n  --card: #ffffff;\n  --line: #e5e7eb;\n  --radius: 12px;\n  --space-1: 4px;\n  --space-2: 8px;\n  --space-3: 16px;\n  --space-4: 24px;\n  --font: system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif;\n  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;\n}\n"
  },
  "systemYourSessionExpiredSignInAgain": {
    "ru": "Сессия истекла — войдите заново.",
    "en": "Your session expired. Sign in again."
  },
  "systemYouDoNotHavePermissionForThisAction": {
    "ru": "Недостаточно прав для этого действия.",
    "en": "You do not have permission for this action."
  },
  "systemTheRequestFailedTheAntiForgeryCheckRefreshThe": {
    "ru": "Запрос отклонён по защите от подделки. Обновите страницу и повторите.",
    "en": "The request failed the anti-forgery check. Refresh the page and try again."
  },
  "systemChangeYourTemporaryPasswordFirstUntilThenAccessIs": {
    "ru": "Сначала смените временный пароль — до этого доступно только чтение.",
    "en": "Change your temporary password first. Until then, access is read-only."
  },
  "systemNoAccessTokenWasProvided": {
    "ru": "Не передан токен доступа.",
    "en": "No access token was provided."
  },
  "systemTheServiceIsTemporarilyUnavailable": {
    "ru": "Сервис временно недоступен.",
    "en": "The service is temporarily unavailable."
  },
  "systemImageStudioIsTemporarilyUnavailableTryAgainLater": {
    "ru": "Студия картинок временно недоступна. Попробуйте ещё раз позже.",
    "en": "Image Studio is temporarily unavailable. Try again later."
  },
  "systemTheServerIsTemporarilyUnavailableTryAgainLater": {
    "ru": "Сервер временно недоступен. Попробуйте ещё раз позже.",
    "en": "The server is temporarily unavailable. Try again later."
  },
  "systemTheRunnerIsUnavailableCheckThatItIsRunning": {
    "ru": "Исполнитель недоступен — проверьте, запущен ли он.",
    "en": "The runner is unavailable. Check that it is running."
  },
  "systemTheBrowserRunnerIsUnavailable": {
    "ru": "Браузерный исполнитель недоступен.",
    "en": "The browser runner is unavailable."
  },
  "systemPreviewIsUnavailableForThisTask": {
    "ru": "Превью недоступно для этой задачи.",
    "en": "Preview is unavailable for this task."
  },
  "systemTheMachineIsOffline": {
    "ru": "Машина не в сети.",
    "en": "The machine is offline."
  },
  "systemNoMachinesAreOnline": {
    "ru": "Нет ни одной машины в сети.",
    "en": "No machines are online."
  },
  "systemNoConnectionToTheServer": {
    "ru": "Нет связи с сервером.",
    "en": "No connection to the server."
  },
  "systemThisRunHasAlreadyStarted": {
    "ru": "Такой ран уже запущен.",
    "en": "This run has already started."
  },
  "systemAnotherRunIsUsingThisCodexConversation": {
    "ru": "Диалог Codex занят другим раном.",
    "en": "Another run is using this Codex conversation."
  },
  "systemTheAddressIsInvalid": {
    "ru": "Некорректный адрес.",
    "en": "The address is invalid."
  },
  "systemObjectNotFound": {
    "ru": "Объект не найден.",
    "en": "Object not found."
  },
  "systemWorkingCopyNotFoundItMayHaveBeenDeleted": {
    "ru": "Рабочая копия не найдена — возможно, её удалили вместе с задачей.",
    "en": "Working copy not found. It may have been deleted with the task."
  },
  "systemTheRunCleanupDeletedThisWorkingCopyStartThe": {
    "ru": "Рабочая копия удалена cleanup-шагом рана — запустите ран задачи заново.",
    "en": "The run cleanup deleted this working copy. Start the task run again."
  },
  "systemAnActiveRunIsUsingThisDirectoryViewingIs": {
    "ru": "Каталог занят активным раном: смотреть можно, менять — нет.",
    "en": "An active run is using this directory. Viewing is allowed; editing is unavailable."
  },
  "systemNoDirectoryIsConfiguredForThisWorkingCopyCheck": {
    "ru": "У рабочей копии не задан каталог — проверьте настройки проекта.",
    "en": "No directory is configured for this working copy. Check project settings."
  },
  "systemTheDirectoryDoesNotContainAGitRepository": {
    "ru": "В каталоге нет git-репозитория.",
    "en": "The directory does not contain a Git repository."
  },
  "systemThisWorkingCopyAllowsReadOnlyAccess": {
    "ru": "Эта рабочая копия доступна только для чтения.",
    "en": "This working copy allows read-only access."
  },
  "systemWorkingCopyChangesAreBlockedByYourRoleThe": {
    "ru": "Изменение рабочей копии запрещено: роль, режим доступа машины или её политика.",
    "en": "Working-copy changes are blocked by your role, the machine access mode, or its policy."
  },
  "systemTheWorkingCopyHasUncommittedChangesCommitOrDiscard": {
    "ru": "В рабочей копии есть незакоммиченные изменения — закоммитьте или отбросьте их.",
    "en": "The working copy has uncommitted changes. Commit or discard them."
  },
  "systemThePanelDoesNotPushToMainMasterOr": {
    "ru": "В main, master и release/* панель не отправляет: это делают merge-ран и релизы.",
    "en": "The panel does not push to main, master, or release/*; merge runs and releases handle those branches."
  },
  "systemOriginRejectedThePushBecauseTheBranchHasAdvanced": {
    "ru": "Origin отклонил отправку: ветка ушла вперёд — подтяните изменения и повторите.",
    "en": "Origin rejected the push because the branch has advanced. Pull changes and try again."
  },
  "systemThePushedCommitWasNotFoundInOriginTry": {
    "ru": "В origin не оказалось отправленного коммита — повторите отправку.",
    "en": "The pushed commit was not found in origin. Try pushing again."
  },
  "systemGitAccessIsNotConfiguredOnTheMachineAdd": {
    "ru": "Git-доступ на машине не настроен: добавьте токен в настройках проекта.",
    "en": "Git access is not configured on the machine. Add a token in project settings."
  },
  "systemAnotherGitOperationIsUsingThisDirectoryIndexLock": {
    "ru": "Git занят другой операцией в этом каталоге (index.lock) — повторите через несколько секунд.",
    "en": "Another Git operation is using this directory (index.lock). Try again in a few seconds."
  },
  "systemAnOperationIsAlreadyRunningInThisWorkingCopy": {
    "ru": "В этой рабочей копии уже идёт операция — дождитесь её окончания.",
    "en": "An operation is already running in this working copy. Wait for it to finish."
  },
  "systemTheGitCommandTimedOut": {
    "ru": "Команда git не завершилась за отведённое время.",
    "en": "The Git command timed out."
  },
  "systemTheGitCommandFailed": {
    "ru": "Команда git завершилась ошибкой.",
    "en": "The Git command failed."
  },
  "systemNothingToCommitTheWorkingCopyHasNoChanges": {
    "ru": "Коммитить нечего: в рабочей копии нет изменений.",
    "en": "Nothing to commit: the working copy has no changes."
  },
  "systemNothingToDiscardTheSelectedFilesHaveNoChanges": {
    "ru": "Отбрасывать нечего: выбранные файлы не изменены.",
    "en": "Nothing to discard: the selected files have no changes."
  },
  "systemConfirmationDidNotMatchEnterTheExactBranchName": {
    "ru": "Подтверждение не совпало — введите имя ветки точно.",
    "en": "Confirmation did not match. Enter the exact branch name."
  },
  "systemTheFileHasNoConflictStagesTheConflictMay": {
    "ru": "У файла нет конфликтных стадий — возможно, конфликт уже разрешён.",
    "en": "The file has no conflict stages. The conflict may already be resolved."
  },
  "systemHeadIsDetachedSwitchToABranchFirst": {
    "ru": "HEAD не на ветке — сначала переключитесь на ветку.",
    "en": "HEAD is detached. Switch to a branch first."
  },
  "systemTheProjectOrRolePolicyDoesNotAllowThis": {
    "ru": "Команда запрещена политикой проекта или роли.",
    "en": "The project or role policy does not allow this command."
  },
  "systemInvalidBranchName": {
    "ru": "Недопустимое имя ветки.",
    "en": "Invalid branch name."
  },
  "systemInvalidRevision": {
    "ru": "Недопустимая ревизия.",
    "en": "Invalid revision."
  },
  "systemTheFilePathIsInvalid": {
    "ru": "Недопустимый путь файла.",
    "en": "The file path is invalid."
  },
  "systemTheCommitMessageIsEmptyOrTooLong": {
    "ru": "Сообщение коммита пустое или слишком длинное.",
    "en": "The commit message is empty or too long."
  },
  "systemTheFileExceedsTheSizeLimitForEditing": {
    "ru": "Файл больше допустимого размера для правки.",
    "en": "The file exceeds the size limit for editing."
  },
  "legacyValueValueSelectorValueValue": {
    "ru": "{p0}. {p1} (селектор `{p2}`): {p3}",
    "en": "{p0}. {p1} (selector `{p2}`): {p3}"
  },
  "legacyComponents": {
    "ru": "Компоненты",
    "en": "Components"
  },
  "legacyValueKb": {
    "ru": "{p0} КБ",
    "en": "{p0} KB"
  },
  "legacyValueB": {
    "ru": "{p0} Б",
    "en": "{p0} B"
  },
  "legacyLinesValueValue": {
    "ru": "строки {p0}–{p1}",
    "en": "lines {p0}–{p1}"
  },
  "legacyUserSnapshot": {
    "ru": "Снимок пользователя",
    "en": "User snapshot"
  },
  "legacyViewerCommentsDisabled": {
    "ru": "Комментарии зрителей выключены",
    "en": "Viewer comments disabled"
  },
  "legacyPublished": {
    "ru": "Опубликован",
    "en": "Published"
  },
  "legacyLibrary": {
    "ru": "Библиотека",
    "en": "Library"
  },
  "legacyMakeProject": {
    "ru": "Проект Make",
    "en": "Make project"
  },
  "legacyBefore": {
    "ru": "до",
    "en": "before"
  },
  "legacyComponentTests": {
    "ru": "Тесты компонентов",
    "en": "Component tests"
  },
  "legacyNew": {
    "ru": "новый",
    "en": "new"
  },
  "legacyDeleted": {
    "ru": "удалён",
    "en": "deleted"
  },
  "legacyModified": {
    "ru": "изменён",
    "en": "modified"
  },
  "legacyAnd": {
    "ru": "и",
    "en": "and"
  },
  "legacyProject": {
    "ru": "Проект",
    "en": "Project"
  },
  "legacyEntireProject": {
    "ru": "проект целиком",
    "en": "entire project"
  },
  "legacyOn_2d38cb": {
    "ru": "на",
    "en": "on"
  },
  "legacyDarkTheme": {
    "ru": "Тёмная тема",
    "en": "Dark theme"
  },
  "legacyValueMb": {
    "ru": "{p0} МБ",
    "en": "{p0} MB"
  },
  "legacyOf": {
    "ru": "из",
    "en": "of"
  }
} as const

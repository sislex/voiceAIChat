// Построители shell-скриптов для git в рабочей копии на машине-агенте.
//
// Правила, которые здесь соблюдаются буквально (и проверяются `scripts.test.ts`):
//
// 1. Пользовательские данные в текст скрипта НЕ подставляются никогда — только через
//    переменные окружения `VC_GIT_*`, а их значения шелл-квотит `buildShellCommand`
//    (`../ci/executor.js`). Поэтому ветка `x; rm -rf /` остаётся одной строкой.
// 2. Никаких `>`/`>>`/`tee`/`mkdir`/`rm`: `WRITE_RE` в `evaluateAgentCommand`
//    запретил бы такую команду на машине с `allowWrite: false`, и панель перестала бы
//    даже читать состояние. Поэтому stderr не перенаправляем — агент и так стримит
//    stdout и stderr одним потоком.
// 3. Всё, что может содержать произвольные байты (`status -z`, содержимое файла,
//    `ls-tree`), уходит через `| base64 | tr -d '\n'`: NUL в тексте испортил бы и
//    журнал команд, и разбор. Тот же приём уже применён в merge-runner.
// 4. Секции разделяются маркером `==VC:name==` (без `>` — см. п.2).
// 5. Читающие команды идут с `--no-optional-locks`, иначе наш `status` возьмёт
//    `index.lock` и сломает идущий рядом CI-ран.

import { GIT_MAX_COMMITS_AHEAD, GIT_TEXT_MAX_BYTES } from '@voicechat/shared'

/** Скрипт + переменные окружения для него. */
export interface GitScript {
  script: string
  env: Record<string, string>
}

/** Флаги, общие для читающих команд. */
const READ = 'git --no-optional-locks -c core.quotepath=false'
/** Метка секции; печатается `printf`, чтобы не зависеть от `echo -e`. */
const mark = (name: string): string => `printf '%s\\n' '==VC:${name}=='`
/** Метка после base64-строки без перевода строки в конце. */
const markAfterB64 = (name: string): string => `printf '\\n%s\\n' '==VC:${name}=='`

/**
 * Состояние рабочей копии одной командой: репозиторий ли это, HEAD, ветка, upstream,
 * отставание, изменения и коммиты сверх базы. Один exec вместо семи — это не
 * оптимизация: каждый вызов идёт до машины пользователя и обратно.
 *
 * Без `set -e` намеренно: у свежей ветки нет upstream, у пустого репозитория нет
 * HEAD — такие секции просто приходят с текстом ошибки git, а остальные заполняются.
 */
export function statusScript(baseBranch: string, maxCommits: number = GIT_MAX_COMMITS_AHEAD): GitScript {
  return {
    env: { VC_GIT_BASE: baseBranch, VC_GIT_MAX_COMMITS: String(maxCommits) },
    script: [
      mark('repo'),
      'git rev-parse --is-inside-work-tree',
      mark('head'),
      'git rev-parse HEAD',
      mark('status_b64'),
      `${READ} status --porcelain=v1 -z -b --untracked-files=all | base64 | tr -d '\\n'`,
      markAfterB64('upstream'),
      `${READ} rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'`,
      mark('track'),
      `${READ} rev-list --left-right --count 'HEAD...@{upstream}'`,
      mark('commits'),
      `git log --format='%H%x09%an%x09%at%x09%s' -n "$VC_GIT_MAX_COMMITS" "origin/$VC_GIT_BASE..HEAD"`,
      mark('done')
    ].join('\n')
  }
}

/** Локальные и удалённые ветки одной командой; `refresh` добавляет обращение к origin. */
export function branchesScript(refresh: boolean): GitScript {
  const format = '%(refname:short)%09%(objectname)%09%(upstream:short)%09%(committerdate:unix)%09%(upstream:track)%09%(contents:subject)'
  return {
    env: {},
    script: [
      ...(refresh ? [mark('fetch'), 'git fetch --prune --quiet origin'] : []),
      mark('current'),
      `${READ} branch --show-current`,
      mark('refs'),
      `git for-each-ref --format='${format}' refs/heads refs/remotes/origin`,
      mark('done')
    ].join('\n')
  }
}

/** Один уровень дерева файлов. Целиком (`ls-files`) не берём: монорепо не влезает в вывод exec. */
export function treeScript(ref: string, dir: string): GitScript {
  const listing = dir
    ? `${READ} ls-tree -l "$VC_GIT_REF" -- "$VC_GIT_DIR/"`
    : `${READ} ls-tree -l "$VC_GIT_REF"`
  return {
    env: { VC_GIT_REF: ref, VC_GIT_DIR: dir },
    script: [
      mark('tree_b64'),
      `${listing} | base64 | tr -d '\\n'`,
      markAfterB64('done')
    ].join('\n')
  }
}

/**
 * Содержимое файла в ревизии. Размер печатается отдельной секцией **до** содержимого,
 * поэтому сервер понимает, обрезан ли файл, даже когда `head -c` уже отрезал хвост.
 */
export function fileAtRefScript(ref: string, path: string, maxBytes: number = GIT_TEXT_MAX_BYTES): GitScript {
  return {
    env: { VC_GIT_REF: ref, VC_GIT_PATH: path, VC_GIT_MAX: String(maxBytes) },
    script: [
      mark('size'),
      'git cat-file -s "$VC_GIT_REF:$VC_GIT_PATH"',
      mark('content_b64'),
      `git cat-file blob "$VC_GIT_REF:$VC_GIT_PATH" | head -c "$VC_GIT_MAX" | base64 | tr -d '\\n'`,
      markAfterB64('done')
    ].join('\n')
  }
}

/**
 * Переключение ветки. Локальной нет — заводим её из origin с отслеживанием.
 * `checkout` идёт **без `-f`**: отказ git на конфликтующих правках — это защита
 * работы человека, а не помеха, и мы показываем его текст как есть.
 */
export function checkoutScript(branch: string): GitScript {
  return {
    env: { VC_GIT_BRANCH: branch },
    script: [
      'set -e',
      mark('mode'),
      'if git show-ref --verify --quiet "refs/heads/$VC_GIT_BRANCH"; then',
      `  printf '%s\\n' 'local'`,
      '  git checkout "$VC_GIT_BRANCH"',
      'else',
      `  printf '%s\\n' 'remote'`,
      '  git fetch --prune origin "+refs/heads/$VC_GIT_BRANCH:refs/remotes/origin/$VC_GIT_BRANCH"',
      '  git checkout -b "$VC_GIT_BRANCH" --track "origin/$VC_GIT_BRANCH"',
      'fi',
      mark('done')
    ].join('\n')
  }
}

/** Новая ветка от указанной точки (по умолчанию — текущий HEAD). */
export function createBranchScript(branch: string, from: string): GitScript {
  return {
    env: { VC_GIT_BRANCH: branch, VC_GIT_FROM: from },
    script: [
      'set -e',
      mark('create'),
      'git checkout -b "$VC_GIT_BRANCH" "$VC_GIT_FROM"',
      mark('done')
    ].join('\n')
  }
}

/**
 * Индексация и коммит. Пути передаются одной переменной, разделённые переводом строки
 * (валидатор `isSafeRepoRelativePath` их запрещает внутри пути), и раскрываются через
 * `xargs -0` — так пробелы и кириллица в именах не разъезжаются по словам.
 *
 * Идентичность — логин человека, а не «voiceAIChat»: так подписывается только
 * merge-runner, а здесь коммит делает пользователь.
 */
export function commitScript(input: { message: string; paths: string[]; all: boolean; user: string; email: string }): GitScript {
  const add = input.all
    ? 'git add -A --'
    : `printf '%s' "$VC_GIT_PATHS" | tr '\\n' '\\0' | xargs -0 git add --`
  return {
    env: {
      VC_GIT_MESSAGE: input.message,
      VC_GIT_PATHS: input.paths.join('\n'),
      VC_GIT_USER: input.user,
      VC_GIT_EMAIL: input.email
    },
    script: [
      'set -e',
      mark('add'),
      add,
      mark('commit'),
      'git -c user.name="$VC_GIT_USER" -c user.email="$VC_GIT_EMAIL" commit -m "$VC_GIT_MESSAGE"',
      mark('sha'),
      'git rev-parse HEAD',
      mark('done')
    ].join('\n')
  }
}

/**
 * Отправка ветки в origin. Ровно то же, что делает push-шаг CI-рана, только по кнопке
 * человека: `HEAD:refs/heads/<branch>` и обязательная сверка, что в origin оказался
 * именно наш SHA (без сверки «успешный» push мог быть ничем).
 *
 * `--force` здесь нет и не будет: перезапись чужой истории — работа merge-рана и
 * релизов, у которых есть свои гейты.
 */
export function pushScript(branch: string): GitScript {
  return {
    env: { VC_GIT_BRANCH: branch },
    script: [
      'set -e',
      mark('head'),
      'git rev-parse HEAD',
      mark('push'),
      'git push origin "HEAD:refs/heads/$VC_GIT_BRANCH"',
      mark('remote'),
      `git ls-remote --heads origin "refs/heads/$VC_GIT_BRANCH" | awk '{print $1}'`,
      mark('done')
    ].join('\n')
  }
}

/**
 * Подтянуть изменения origin в текущую ветку. `rebase` по умолчанию: он оставляет
 * линейную историю, которую потом сливает merge-ран. Конфликт — не «сломалось», а
 * штатный ответ: скрипт откатывает начатое (`rebase --abort` / `merge --abort`) и
 * выходит с кодом 65, чтобы человек увидел причину, а рабочая копия осталась целой.
 */
export function pullScript(branch: string, mode: 'rebase' | 'merge'): GitScript {
  const combine = mode === 'rebase'
    ? ['  git rebase "origin/$VC_GIT_BRANCH" || { git rebase --abort; exit 65; }']
    : ['  git merge --no-edit "origin/$VC_GIT_BRANCH" || { git merge --abort; exit 65; }']
  return {
    env: { VC_GIT_BRANCH: branch },
    script: [
      'set -e',
      mark('before'),
      'git rev-parse HEAD',
      mark('fetch'),
      'git fetch --prune origin "$VC_GIT_BRANCH"',
      mark('combine'),
      'if git rev-parse --verify --quiet "refs/remotes/origin/$VC_GIT_BRANCH"; then',
      ...combine,
      'else',
      `  printf '%s\\n' 'no-upstream'`,
      'fi',
      mark('after'),
      'git rev-parse HEAD',
      mark('done')
    ].join('\n')
  }
}

/**
 * Отбросить правки в перечисленных путях. Единственная опасная по нашим меркам
 * операция панели (`git clean` попадает в `DANGEROUS_COMMAND_PATTERNS`), поэтому она
 * никогда не вызывается «попутно»: только явным действием с вводом имени ветки.
 *
 * Порядок важен: сначала `checkout --` возвращает отслеживаемые файлы, потом
 * `clean -fd --` убирает неотслеживаемые. Обратный порядок удалил бы файл, который
 * checkout мог восстановить.
 */
export function discardScript(paths: string[]): GitScript {
  return {
    env: { VC_GIT_PATHS: paths.join('\n') },
    script: [
      'set -e',
      mark('revert'),
      `printf '%s' "$VC_GIT_PATHS" | tr '\\n' '\\0' | xargs -0 git checkout -- || printf '%s\\n' 'checkout-skipped'`,
      mark('clean'),
      `printf '%s' "$VC_GIT_PATHS" | tr '\\n' '\\0' | xargs -0 git clean -fd --`,
      mark('done')
    ].join('\n')
  }
}

/**
 * Окружение для любой git-команды панели.
 *
 * `GIT_TERMINAL_PROMPT=0` и `GIT_ASKPASS` — чтобы push без настроенного credential
 * падал сразу с понятной ошибкой, а не вешал exec на приглашении ввести пароль.
 * `GIT_OPTIONAL_LOCKS=0` — чтобы наши команды не брали `index.lock` в папке, где
 * может работать CI-ран. `LC_ALL=C` — стабильные тексты ошибок для классификации.
 */
export function gitBaseEnv(): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/echo',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C'
  }
}

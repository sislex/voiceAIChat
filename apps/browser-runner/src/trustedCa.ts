// Доверие дополнительным корневым сертификатам.
//
// Наши стенды стоят за Caddy с его внутренним центром сертификации: цепочка
// корректна, имя в SAN совпадает, но корень не входит ни в один публичный
// список доверия — отсюда `unable to get local issuer certificate`, и
// изолированный Chromium отказывается открывать собственный сайт проекта.
//
// Чиним доверием, а не отключением проверки. Отключать её (`ignoreHTTPSErrors`)
// нельзя: флаг у Playwright контекстный, то есть выключил бы проверку сразу для
// всех адресов, и раннер перестал бы отличать наш стенд от подменённого узла.
//
// Chromium на Linux берёт пользовательские корни из базы NSS в
// `$HOME/.pki/nssdb`, поэтому сертификат добавляется туда через `certutil`.

import { readFileSync } from 'node:fs'

const BEGIN = '-----BEGIN CERTIFICATE-----'
const END = '-----END CERTIFICATE-----'

/** Разбор PEM-связки на отдельные сертификаты; мусор между блоками игнорируется. */
export function splitPemCertificates(pem: string): string[] {
  const out: string[] = []
  let from = 0
  for (;;) {
    const start = pem.indexOf(BEGIN, from)
    if (start < 0) break
    const end = pem.indexOf(END, start)
    if (end < 0) break
    out.push(pem.slice(start, end + END.length))
    from = end + END.length
  }
  return out
}

export interface ExtraCaSource {
  /**
   * PEM в base64 — основной способ. Одна строка без переводов и кавычек
   * переживает и `.env`, и подстановку compose, и шелл; многострочный PEM в
   * переменной ломается на каждом из трёх этапов.
   */
  base64?: string | undefined
  /** PEM-содержимое как есть — удобно в тестах и docker run. */
  pem?: string | undefined
  /**
   * Путь к PEM-файлу внутри контейнера. Годится, только если файл читаем
   * пользователем раннера: том Caddy, например, не годится — весь его `pki`
   * закрыт под root, потому что рядом с корнем лежит приватный ключ центра.
   */
  file?: string | undefined
}

/** Содержимое из значения или файла; ошибка чтения не должна ронять раннер. */
export function readExtraCaPem(source: ExtraCaSource, read = readFileSync): { pem: string | null; error?: string } {
  if (source.base64?.trim()) {
    const decoded = Buffer.from(source.base64.trim(), 'base64').toString('utf8')
    if (decoded.includes(BEGIN)) return { pem: decoded }
    return { pem: null, error: 'VC_BROWSER_EXTRA_CA_B64 не содержит сертификата после декодирования' }
  }
  if (source.pem?.includes(BEGIN)) return { pem: source.pem }
  if (!source.file) return { pem: null }
  try { return { pem: String(read(source.file, 'utf8')) } }
  catch (error) { return { pem: null, error: error instanceof Error ? error.message : 'не прочитан' } }
}

export interface CertutilRunner {
  (args: string[], input?: string): Promise<{ ok: boolean; output: string }>
}

/**
 * Кладёт сертификаты в базу NSS. Возвращает, сколько добавлено — вызывающий
 * решает, что сообщить в лог. Отсутствие `certutil` — не фатально: раннер
 * обязан подняться и без дополнительного доверия.
 */
export async function installTrustedCa(pem: string, dbDir: string, run: CertutilRunner): Promise<{ added: number; error?: string }> {
  const certs = splitPemCertificates(pem)
  if (!certs.length) return { added: 0, error: 'в PEM нет ни одного сертификата' }
  const db = `sql:${dbDir}`
  // Базы может не быть — создаём пустую без пароля; если уже есть, ошибку глотаем.
  await run(['-N', '--empty-password', '-d', db])
  let added = 0
  for (const [index, cert] of certs.entries()) {
    // `C,,` — доверять как центру сертификации для TLS-серверов.
    const result = await run(['-A', '-n', `vc-extra-ca-${index + 1}`, '-t', 'C,,', '-d', db, '-a'], `${cert}\n`)
    if (result.ok) added++
    else return { added, error: result.output.split('\n')[0] || 'certutil отказал' }
  }
  return { added }
}

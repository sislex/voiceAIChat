// Русское склонение по числу. Чистая функция — нужна и серверу (публичная
// страница галереи рендерится строкой на сервере), и клиенту, поэтому живёт
// здесь, а не в UI: «88 файл(ов)» на витрине для зрителя читается как заглушка,
// которую забыли доделать.

/**
 * Слово в форме, согласованной с числом: `pluralRu(1, 'файл', 'файла', 'файлов')`
 * → «файл», `pluralRu(3, …)` → «файла», `pluralRu(11, …)` → «файлов».
 * Одиннадцать–четырнадцать — исключение, поэтому смотрим и последние две цифры.
 */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(count))
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

/** Число вместе со словом: «1 файл», «88 файлов». */
export function countRu(count: number, one: string, few: string, many: string): string {
  return `${count} ${pluralRu(count, one, few, many)}`
}

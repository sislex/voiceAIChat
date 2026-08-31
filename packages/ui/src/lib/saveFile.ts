// Сохранение текста файлом.
//
// Приём повторялся в каждом месте, где что-то выгружается (журнал команд машины,
// теперь журнал безопасности): создать Blob, повесить ссылку, кликнуть, освободить
// URL. Забытый `revokeObjectURL` держит содержимое в памяти вкладки до перезагрузки,
// поэтому правило одно на всех — здесь.

export function saveTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

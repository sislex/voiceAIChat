// Табличный редактор коллекции моков (roadmap-4 п.29): вместо правки JSON руками — строки и колонки.
// Компонент чистый относительно транспорта: получает текст файла и отдаёт новый текст через onChange,
// сохранение делает MakePane той же кнопкой/автосохранением, что и для кода.
import { useMemo, useState } from 'react'
import { Button, IconButton } from '@voicechat/ui-kit'
import { mockJsonToTable, newMockRow, serializeMockJson, tableToMockJson, type MockTable } from '@shared/mockTable'

interface Props {
  path: string
  value: string
  onChange: (next: string) => void
  readOnly?: boolean
}

/** Можно ли показать файл таблицей: JSON с массивом объектов в `$body` или сам массив. */
export function mockTableFor(path: string, value: string): MockTable | null {
  if (!/^mock\/.*\.json$/i.test(path)) return null
  try { return mockJsonToTable(JSON.parse(value)) } catch { return null }
}

export function MakeMockTable({ path, value, onChange, readOnly }: Props): JSX.Element {
  const table = useMemo(() => mockTableFor(path, value), [path, value])
  const [newColumn, setNewColumn] = useState('')
  if (!table) return <p className="make-mock-table-empty">Файл не похож на коллекцию: нужен JSON с массивом объектов в <code>$body</code>.</p>
  const commit = (next: MockTable): void => onChange(serializeMockJson(tableToMockJson(next)))
  const setCell = (row: number, col: string, text: string): void => {
    const rows = table.rows.map((r, i) => (i === row ? { ...r, [col]: text } : r))
    commit({ ...table, rows })
  }
  const addRow = (): void => commit({ ...table, rows: [...table.rows, newMockRow(table)] })
  const removeRow = (row: number): void => commit({ ...table, rows: table.rows.filter((_, i) => i !== row) })
  const addColumn = (): void => {
    const name = newColumn.trim()
    if (!name || table.columns.includes(name)) return
    commit({ ...table, columns: [...table.columns, name], rows: table.rows.map((r) => ({ ...r, [name]: '' })) })
    setNewColumn('')
  }
  const removeColumn = (col: string): void => commit({ ...table, columns: table.columns.filter((c) => c !== col), rows: table.rows.map((r) => { const { [col]: _drop, ...rest } = r; return rest }) })
  return (
    <div className="make-mock-table" data-testid="make-mock-table">
      <table>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c}><span>{c}</span>{!readOnly && c !== 'id' && <IconButton size="sm" aria-label={`Удалить колонку ${c}`} title="Удалить колонку" onClick={() => removeColumn(c)}>✕</IconButton>}</th>
            ))}
            {!readOnly && <th className="make-mock-table-actions" aria-label="Действия" />}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>
              {table.columns.map((c) => (
                <td key={c}><input aria-label={`${c} строки ${i + 1}`} value={r[c] ?? ''} readOnly={readOnly} onChange={(e) => setCell(i, c, e.target.value)} /></td>
              ))}
              {!readOnly && <td className="make-mock-table-actions"><IconButton size="sm" aria-label={`Удалить строку ${i + 1}`} title="Удалить строку" onClick={() => removeRow(i)}>✕</IconButton></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div className="make-mock-table-foot">
          <Button size="sm" variant="secondary" onClick={addRow}>+ Строка</Button>
          <form className="make-mock-table-col" onSubmit={(e) => { e.preventDefault(); addColumn() }}>
            <input aria-label="Имя новой колонки" placeholder="новая колонка" value={newColumn} onChange={(e) => setNewColumn(e.target.value)} />
            <Button size="sm" variant="ghost" type="submit" disabled={!newColumn.trim()}>+ Колонка</Button>
          </form>
          <span className="make-mock-table-hint">Числа, true/false, null и JSON-объекты в ячейках восстанавливаются при записи; пустая ячейка — поле не пишется.</span>
        </div>
      )}
    </div>
  )
}

// Поле поиска с иконкой и кнопкой очистки.
//
// Отдельный компонент нужен не ради рамки: поиск без видимой кнопки «очистить»
// заставляет вычищать строку клавишей, а иконка-лупа без `aria-label` у поля
// оставляет скринридер без подсказки, что это вообще за ввод.

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  /** Обязателен: поле поиска без имени неотличимо от любого другого ввода. */
  label: string
  placeholder?: string
  /** Компактный вариант — поиск внутри секции, а не над списком. */
  compact?: boolean
  className?: string
  testId?: string
}

export function SearchField({ value, onChange, label, placeholder, compact = false, className, testId = 'search-field' }: SearchFieldProps): JSX.Element {
  return (
    <div className={['vc-search', compact && 'vc-search--compact', className].filter(Boolean).join(' ')}>
      <span className="vc-search__ico" aria-hidden="true">⌕</span>
      <input
        type="search"
        className="vc-search__input"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
      />
      {value !== '' && (
        <button
          type="button"
          className="vc-search__clear"
          aria-label={`Очистить: ${label}`}
          title="Очистить"
          onClick={() => onChange('')}
        >
          ✕
        </button>
      )}
    </div>
  )
}

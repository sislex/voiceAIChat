// Тумблер: включено или нет.
//
// Именно `role="switch"`, а не чекбокс: скринридер объявляет «включено/выключено»,
// а не «отмечено», и человек понимает, что действие применится сразу к целой
// группе (например, ко всем моделям провайдера).

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Имя для скринридера: «Доступ к Anthropic Claude». */
  label: string
  disabled?: boolean
  className?: string
  testId?: string
}

export function Switch({ checked, onChange, label, disabled = false, className, testId }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={['vc-switch', checked && 'vc-switch--on', className].filter(Boolean).join(' ')}
      onClick={() => onChange(!checked)}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      <span className="vc-switch__knob" aria-hidden="true" />
    </button>
  )
}

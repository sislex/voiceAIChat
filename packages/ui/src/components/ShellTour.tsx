import { useEffect, useState } from 'react'
import { Button, Dialog } from '@voicechat/ui-kit'
import { usePreference } from '../lib/shellPreferences'
import { SHELL_SECTIONS, type ShellSection } from './MobileNavigation'

export function ShellTour({ userId, onNavigate }: { userId: string; onNavigate: (section: ShellSection) => void }): JSX.Element | null {
  const [done, setDone] = usePreference(userId, 'tour', false, (value): value is boolean => typeof value === 'boolean')
  const [step, setStep] = useState(0)
  const target = SHELL_SECTIONS[step]!
  useEffect(() => {
    if (done) return
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${target.id}"]`))
    const node = nodes.find(item => item.getBoundingClientRect().width > 0)
    node?.classList.add('shell-tour-target')
    return () => node?.classList.remove('shell-tour-target')
  }, [done, target])
  if (done) return null
  return <Dialog className="shell-tour" closeLabel="Пропустить знакомство" title={`Знакомство: ${target.label}`} size="sm" onClose={() => setDone(true)} actions={<>
    <Button variant="ghost" onClick={() => setDone(true)}>Пропустить</Button>
    <Button onClick={() => { if (step === 3) setDone(true); else { onNavigate(SHELL_SECTIONS[step + 1]!.id); setStep(step + 1) } }}>{step === 3 ? 'Завершить' : 'Далее'}</Button>
  </>}>
    <p>Шаг {step + 1} из 4: {target.label}</p>
    <p>{['Здесь находятся ваши беседы.', 'Подключайте машины для работы с файлами и командами.', 'Планируйте задачи на доске проекта.', 'Проверяйте и выпускайте готовые изменения.'][step]}</p>
  </Dialog>
}

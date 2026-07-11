import type { MouseEvent } from 'react'

export interface OnboardingModalProps {
  /** Локальная модель Whisper уже скачана. */
  modelPresent: boolean
  /** Название модели (для подписи). */
  modelLabel: string
  /** Идёт ли скачивание модели. */
  downloading: boolean
  /** Прогресс скачивания (0–100). */
  downloadPercent: number
  /** Запустить скачивание модели. */
  onDownloadModel: () => void
  /** Есть ли установленные голоса TTS. */
  hasVoice: boolean
  /** Завершить/пропустить мастер. */
  onDone: () => void
}

/**
 * Приветственный мастер первого запуска: помогает скачать модель распознавания
 * (голоса TTS обычно уже в комплекте) и уводит в приложение. Ничего не блокирует
 * жёстко — всегда можно «Начать» или «Пропустить».
 */
export function OnboardingModal({
  modelPresent,
  modelLabel,
  downloading,
  downloadPercent,
  onDownloadModel,
  hasVoice,
  onDone
}: OnboardingModalProps): JSX.Element {
  const stop = (e: MouseEvent): void => e.stopPropagation()
  return (
    <div className="ovl" onClick={onDone} data-testid="onboarding-overlay">
      <div className="modal onboarding" onClick={stop} role="dialog" aria-label="Добро пожаловать">
        <div className="mdhead">
          <h2 className="mdh">Добро пожаловать в Голос·Чат</h2>
        </div>
        <div className="mdbody">
          <p className="ob-lead">
            Голосовой ассистент с распознаванием речи и озвучкой — всё локально, ответы через
            Claude. Пара шагов для начала:
          </p>

          <div className="ob-step">
            <span className="ob-num">1</span>
            <div className="ob-body">
              <p className="flab">Модель распознавания речи{modelLabel ? ` (${modelLabel})` : ''}</p>
              {modelPresent ? (
                <p className="ob-ok">✓ Модель установлена</p>
              ) : downloading ? (
                <p className="fsub" data-testid="ob-progress">
                  Скачивание… {downloadPercent}%
                </p>
              ) : (
                <button className="modeldl" onClick={onDownloadModel}>
                  Скачать модель
                </button>
              )}
            </div>
          </div>

          <div className="ob-step">
            <span className="ob-num">2</span>
            <div className="ob-body">
              <p className="flab">Голос озвучки</p>
              <p className="ob-ok">
                {hasVoice ? '✓ Голоса доступны' : 'Голоса можно скачать в настройках'}
              </p>
            </div>
          </div>

          <div className="ob-actions">
            <button className="ob-start" onClick={onDone}>
              {modelPresent ? 'Начать' : 'Пропустить и начать'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

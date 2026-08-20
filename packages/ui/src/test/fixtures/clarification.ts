import type { PreparationClarificationNotification } from '@shared/qa'
import { T0 } from './chat'

export const clarificationNotification: PreparationClarificationNotification = {
  questionId: 'question-1',
  attemptId: 'attempt-1',
  projectId: 'project-1',
  projectName: 'ChatAI',
  taskId: 'task-295',
  taskTitle: 'Уведомления о вопросах при подготовке ТЗ',
  text: 'Нужно ли сохранять закрытие уведомления после перезагрузки?',
  askedAt: T0,
  dismissedAt: null
}

export const longClarificationNotification: PreparationClarificationNotification = {
  ...clarificationNotification,
  questionId: 'question-2',
  taskId: 'task-296',
  taskTitle: 'Длинный вопрос на мобильном экране',
  text: 'Уточните, пожалуйста, как должен вести себя интерфейс при очень длинном тексте вопроса, увеличенном системном шрифте, открытой экранной клавиатуре и одновременно отображаемых действиях перехода и закрытия уведомления.'
}


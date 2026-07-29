// Публичная точка входа изолированной канбан-доски: компонент + типы + атрибутика.
export { KanbanBoard, type KanbanBoardProps, type Swimlane } from './KanbanBoard'
export { TaskCard, epicOf, type TaskCardProps } from './TaskCard'
export { TaskModal, type TaskModalProps, type TaskUpdateFields } from './TaskModal'
export { normalizeBoard, normalizeColumn, normalizeTask } from './normalize'
export * from './kanbanMeta'

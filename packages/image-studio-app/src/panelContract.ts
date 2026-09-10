import type { RendererApi } from '@shared/ipc'


type StudioApi = Pick<RendererApi,
  'imgstudio:list' | 'imgstudio:read' | 'imgstudio:upload' | 'imgstudio:delete' |
  'imgstudio:rename' | 'imgstudio:generate' | 'imgstudio:edit' | 'imgstudio:cancel' |
  'imgstudio:publish' | 'imgstudio:publication' | 'imgstudio:unpublish' | 'imgstudio:run' | 'imgstudio:transfer' |
  'imgstudio:trash' | 'imgstudio:restore' | 'imgstudio:purge'> &
  Partial<Pick<RendererApi, 'prompt:suggest'>>


export interface ImageStudioPaneProps {
  conversationId: string
  api: StudioApi
  /** Ход ассистента идёт — после него в галерее могут появиться картинки. */
  turnActive?: boolean
  /** Прикрепить файл к следующему сообщению чата слева (композер). */
  onAttachToChat?: (file: File) => void
  /** Другие студийные чаты пользователя — цели переноса/копии картинок. */
  otherChats?: Array<{ id: string; title: string }>
}

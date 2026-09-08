/** Ядро не читает каталог студии: контекст и захват картинок доступны через порт. */
export interface ImageStudioService {
  promptContext(conversationId: string): Promise<string>
  captureImages(userId: string, conversationId: string, finalText: string): Promise<void>
}

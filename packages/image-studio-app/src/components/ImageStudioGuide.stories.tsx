// Витрина справочника студии: он длинный и с картинками, поэтому смотреть его
// удобнее отдельно от панели — заодно axe проверяет заголовки и подписи снимков.
import type { Meta, StoryObj } from '@storybook/react'
import { ImageStudioGuide } from './ImageStudioGuide'

const meta: Meta<typeof ImageStudioGuide> = {
  title: 'ImageStudio/Guide',
  component: ImageStudioGuide,
  parameters: { layout: 'fullscreen' }
}
export default meta

export const Default: StoryObj<typeof ImageStudioGuide> = {
  args: { onClose: () => undefined }
}

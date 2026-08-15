# Инвентаризация primitives до выделения ui-kit

Инвентаризация выполнена по `packages/ui/src/components/ui` перед переносом. Ни один компонент не импортировал store, bridge или transport; исключением по границе был только продуктовый `SidebarToggle` внутри файла `IconButton.tsx`, он оставлен в `@voicechat/ui`.

| Элемент | Прямые зависимости | CSS-классы | DOM-тест | Storybook |
|---|---|---|---|---|
| Button | React | `vc-btn*` | Button.dom.test.tsx | Button.stories.tsx |
| IconButton | React, Button | `vc-btn*` | Button.dom.test.tsx | Button.stories.tsx |
| Dialog | React/React DOM, IconButton, useDialogStack, media query | `vc-dialog*`, `mdhead`, `mdh`, `util-head-btns` | Dialog.dom.test.tsx | Dialog.stories.tsx |
| ConfirmDialog | React, Button, Dialog | `vc-confirm*` | ConfirmDialog.dom.test.tsx | ConfirmDialog.stories.tsx |
| ConfirmProvider/useConfirm | React, ConfirmDialog | классы ConfirmDialog | ConfirmDialog.dom.test.tsx | через stories потребителей |
| ToastProvider/useToast | React/React DOM, media query | `vc-toast*`, `vc-toasts*` | Toast.dom.test.tsx | Toast.stories.tsx |
| UiProviders | React, ConfirmProvider, ToastProvider | нет | косвенно | общий decorator |
| Skeleton | React types | `vc-skel*` | Skeleton.dom.test.tsx | Skeleton.stories.tsx |
| RefreshIndicator | React types | `vc-refresh*` | Skeleton.dom.test.tsx | Skeleton.stories.tsx |
| EmptyState | React, Button | `vc-state*` | EmptyState.dom.test.tsx | EmptyState.stories.tsx |
| ErrorState | React, Button | `vc-state*` | ErrorState.dom.test.tsx | ErrorState.stories.tsx |

Stories остаются в общей витрине `@voicechat/ui`, но импортируют primitives только из публичного `@voicechat/ui-kit`. Продуктовые `SidebarToggle`, `PopupFrame` и `ToolFrame` не являются публичными primitives этого шага.

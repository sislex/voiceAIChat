import { useMemo } from 'react'
import {
  Dialog as BaseDialog, ErrorState as BaseErrorState, useConfirm as useBaseConfirm, useToast as useBaseToast,
  type Confirm, type DialogProps, type ErrorStateProps, type ToastApi, type ToastOptions
} from '@voicechat/ui-kit'
import { describeMakeError, getMakeLocale, localizeMakeText, mt, subscribeMakeLocale, useMakeLocale } from './index'

export function Dialog(props: DialogProps): JSX.Element {
  const locale = useMakeLocale()
  return <BaseDialog {...props} title={typeof props.title === 'string' ? localizeMakeText(props.title) : props.title}
    ariaLabel={props.ariaLabel ? localizeMakeText(props.ariaLabel) : undefined} lang={locale} closeLabel={mt('close')} />
}

export function ErrorState(props: ErrorStateProps): JSX.Element {
  useMakeLocale()
  return <BaseErrorState {...props} message={props.message ? localizeMakeText(props.message) : mt('loadingFailed')}
    detail={props.detail ? describeMakeError(props.detail) : props.detail} retryLabel={mt('retry')} detailLabel={mt('details')} />
}

export function useConfirm(): Confirm {
  const confirm = useBaseConfirm()
  return useMemo(() => (request) => confirm({
    ...request, lang: getMakeLocale(), localeSource: makeLocaleSource, closeLabel: mt('close'),
    title: localizeMakeText(request.title),
    message: typeof request.message === 'string' ? localizeMakeText(request.message) : request.message,
    confirmLabel: request.confirmLabel ? localizeMakeText(request.confirmLabel) : mt('continue'),
    cancelLabel: request.cancelLabel ? localizeMakeText(request.cancelLabel) : mt('cancel'),
    requireTextLabel: request.requireText ? mt('typeToConfirm', { p0: request.requireText }) : undefined
  }), [confirm])
}

const makeLocaleSource = { subscribe: subscribeMakeLocale, getSnapshot: getMakeLocale, translate: localizeMakeText }

export function useToast(): ToastApi {
  const toast = useBaseToast()
  return useMemo(() => {
    const options = (value?: ToastOptions): ToastOptions => ({
      ...value, closeLabel: mt('closeNotification'), lang: getMakeLocale(), localeSource: makeLocaleSource,
      ...(value?.action ? { action: { ...value.action, label: localizeMakeText(value.action.label) } } : {})
    })
    return {
      ...toast,
      success: (text, value) => toast.success(localizeMakeText(text), options(value)),
      info: (text, value) => toast.info(localizeMakeText(text), options(value)),
      error: (text, value) => toast.error(describeMakeError(text), options(value))
    }
  }, [toast])
}

import { reactive } from 'vue';

export const confirmState = reactive({
  open: false,
  title: '',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
});

let pendingResolve = null;

export function confirmAction(options) {
  const normalized = typeof options === 'string' ? { message: options } : options;
  if (pendingResolve) pendingResolve(false);

  Object.assign(confirmState, {
    open: true,
    title: normalized.title || '确认操作',
    message: normalized.message || '',
    confirmText: normalized.confirmText || '确定',
    cancelText: normalized.cancelText || '取消',
    danger: Boolean(normalized.danger),
  });

  return new Promise((resolve) => {
    pendingResolve = resolve;
  });
}

export function settleConfirm(result) {
  if (!confirmState.open) return;
  confirmState.open = false;
  const resolve = pendingResolve;
  pendingResolve = null;
  resolve?.(Boolean(result));
}

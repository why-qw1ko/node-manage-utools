<script setup>
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import IconAlertOutline from '~icons/mdi/alert-outline';
import IconClose from '~icons/mdi/close';
import { confirmState, settleConfirm } from '../utils/confirm.js';

const confirmButton = ref(null);
const cancelButton = ref(null);
const dialog = ref(null);
let previousFocus = null;

watch(() => [confirmState.open, confirmState.title, confirmState.message, confirmState.danger], async ([open], [wasOpen]) => {
  if (open) {
    if (!wasOpen) previousFocus = document.activeElement;
    await nextTick();
    const defaultButton = confirmState.danger ? cancelButton.value : confirmButton.value;
    defaultButton?.focus();
  } else {
    previousFocus?.focus?.();
    previousFocus = null;
  }
});

function handleKeydown(event) {
  if (event.key === 'Escape' && confirmState.open) settleConfirm(false);
  if (event.key === 'Tab' && confirmState.open) {
    const focusable = [...(dialog.value?.querySelectorAll(
      'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ) || [])];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="confirmState.open"
      class="confirm-overlay"
      role="presentation"
      @click.self="settleConfirm(false)"
    >
      <div
        ref="dialog"
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div class="confirm-icon" :class="{ danger: confirmState.danger }">
          <IconAlertOutline />
        </div>
        <div class="confirm-content">
          <div class="confirm-head">
            <h3 id="confirm-dialog-title">{{ confirmState.title }}</h3>
            <button class="btn btn-ghost btn-icon btn-sm" aria-label="关闭" @click="settleConfirm(false)">
              <IconClose />
            </button>
          </div>
          <p id="confirm-dialog-message">{{ confirmState.message }}</p>
          <div class="confirm-actions">
            <button ref="cancelButton" class="btn btn-secondary" @click="settleConfirm(false)">
              {{ confirmState.cancelText }}
            </button>
            <button
              ref="confirmButton"
              class="btn"
              :class="confirmState.danger ? 'btn-danger' : 'btn-primary'"
              @click="settleConfirm(true)"
            >
              {{ confirmState.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-overlay { position: fixed; inset: 0; z-index: 4000; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(3px); }
.confirm-dialog { display: flex; gap: 14px; width: min(420px, 100%); padding: 20px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); }
.confirm-icon { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 36px; color: var(--warning); background: var(--warning-dim); border-radius: var(--radius-full); }
.confirm-icon.danger { color: var(--danger); background: var(--danger-dim); }
.confirm-icon svg { width: 20px; height: 20px; }
.confirm-content { flex: 1; min-width: 0; }
.confirm-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
.confirm-head h3 { font-size: 15px; color: var(--text); }
.confirm-content p { color: var(--text-secondary); font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
</style>

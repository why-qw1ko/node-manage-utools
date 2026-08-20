import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmAction, confirmState, settleConfirm } from '../src/utils/confirm.js';

test('custom confirmation resolves the selected result', async () => {
  const pending = confirmAction({
    title: '危险操作',
    message: '确认继续？',
    danger: true,
  });

  assert.equal(confirmState.open, true);
  assert.equal(confirmState.title, '危险操作');
  assert.equal(confirmState.danger, true);
  settleConfirm(true);
  assert.equal(await pending, true);
  assert.equal(confirmState.open, false);
});

test('opening a new confirmation safely cancels the previous one', async () => {
  const previous = confirmAction('第一个确认');
  const current = confirmAction('第二个确认');

  assert.equal(await previous, false);
  settleConfirm(false);
  assert.equal(await current, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProcess, formatBytes } from '../src/utils/process.js';

test('formatBytes converts raw byte counts to readable strings', () => {
  assert.equal(formatBytes(0), '0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(512 * 1024), '512 KB');
});

test('classifyProcess flags system critical processes', () => {
  assert.equal(classifyProcess('System', 4).level, 'critical');
  assert.equal(classifyProcess('smss.exe', 123).level, 'critical');
  assert.equal(classifyProcess('lsass.exe', 999).level, 'critical');
});

test('classifyProcess flags protected system service processes', () => {
  assert.equal(classifyProcess('svchost.exe', 1000).level, 'system');
  assert.equal(classifyProcess('explorer.exe', 2000).level, 'system');
});

test('classifyProcess treats ordinary processes as user level', () => {
  assert.equal(classifyProcess('node.exe', 8080).level, 'user');
  assert.equal(classifyProcess('', 1234).level, 'user');
});

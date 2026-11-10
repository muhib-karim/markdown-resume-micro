import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/storage.js';

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
  };
}

test('store reads back what it wrote and reports success', () => {
  const storage = fakeStorage();
  const store = createStore(() => storage);
  assert.equal(store.get('k'), null);
  assert.equal(store.set('k', 'v'), true);
  assert.equal(store.get('k'), 'v');
});

test('a full or read-only storage makes set() return false instead of throwing', () => {
  const storage = { ...fakeStorage(), setItem() { throw new Error('QuotaExceededError'); } };
  const store = createStore(() => storage);
  assert.equal(store.set('k', 'v'), false);
  assert.equal(store.get('k'), null);
});

test('storage that cannot even be accessed is treated as empty and unwritable', () => {
  const store = createStore(() => { throw new Error('SecurityError'); });
  assert.equal(store.get('k'), null);
  assert.equal(store.set('k', 'v'), false);
});

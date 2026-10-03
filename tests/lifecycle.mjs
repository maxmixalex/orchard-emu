// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { bindLifecycle } from '../dist/lifecycle.js';
const page = new EventTarget(), document = new EventTarget();
document.hidden = false;
const actions = [];
const unbind = bindLifecycle(page, document, () => actions.push('pause'));
const fire = (name, persisted = false) => {
  const event = new Event(name);
  Object.defineProperty(event, 'persisted', { value: persisted });
  page.dispatchEvent(event);
};
fire('pageshow'); assert.equal(actions.length, 0);
document.dispatchEvent(new Event('visibilitychange')); assert.equal(actions.length, 0);
fire('blur'); fire('pagehide', true); fire('pageshow', true);
assert.deepEqual(actions, ['pause', 'pause', 'pause']);
document.hidden = true;
document.dispatchEvent(new Event('visibilitychange')); assert.equal(actions.length, 4);
document.hidden = false;
document.dispatchEvent(new Event('visibilitychange')); assert.equal(actions.length, 4);
fire('pagehide', false); assert.equal(actions.length, 5);
unbind(); fire('blur'); fire('pagehide', true); fire('pageshow', true);
document.hidden = true;
document.dispatchEvent(new Event('visibilitychange')); assert.equal(actions.length, 5);
assert.throws(() => bindLifecycle(page, document, null), TypeError);
console.log('Lifecycle: hidden/blur/pagehide suspend; cached pageshow stays paused; unbind removes listeners. EventTarget test, not actual browser-cache E2E.');

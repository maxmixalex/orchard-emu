// SPDX-License-Identifier: MIT
// Release held input on every departure even when the user chooses to keep
// execution running. pagehide always pauses; a cached document keeps its Worker.
export function bindLifecycle(page, document, suspend, options = {}) {
  if (typeof suspend !== 'function') throw new TypeError('A suspend callback is required');
  const prefs = () => typeof options.preferences === 'function' ? options.preferences() : {pauseOnBlur:true,pauseOnHidden:true};
  const release = () => options.release?.();
  const blurred = () => {release();if(prefs().pauseOnBlur)suspend();options.save?.();};
  const hidden = () => {if(document.hidden){release();if(prefs().pauseOnHidden)suspend();options.save?.();}};
  const leaving = () => {release();suspend();options.save?.();};
  const restored = event => {if(event.persisted){release();suspend();}};
  page.addEventListener('blur', blurred);page.addEventListener('pagehide', leaving);page.addEventListener('pageshow', restored);
  document.addEventListener('visibilitychange', hidden);
  return () => {page.removeEventListener('blur',blurred);page.removeEventListener('pagehide',leaving);page.removeEventListener('pageshow',restored);document.removeEventListener('visibilitychange',hidden);};
}

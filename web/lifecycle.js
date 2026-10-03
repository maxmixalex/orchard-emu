// SPDX-License-Identifier: MIT
// pagehide may freeze the document in the back/forward cache, not destroy it.
// Pause/release the guest; terminating its Worker would leave a restored page dead.
export function bindLifecycle(page, document, suspend) {
  if (typeof suspend !== 'function') throw new TypeError('A suspend callback is required');
  const hidden = () => { if (document.hidden) suspend(); };
  const restored = event => { if (event.persisted) suspend(); };
  page.addEventListener('blur', suspend);
  page.addEventListener('pagehide', suspend);
  page.addEventListener('pageshow', restored);
  document.addEventListener('visibilitychange', hidden);
  return () => {
    page.removeEventListener('blur', suspend);
    page.removeEventListener('pagehide', suspend);
    page.removeEventListener('pageshow', restored);
    document.removeEventListener('visibilitychange', hidden);
  };
}

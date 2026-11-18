'use strict';
/* ═══ modals.js — overlay + focus management ═══ */

/* ── Modals ── */
const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const MODAL_IDS = ['mpOverlay', 'stOverlay', 'cpOverlay'];
let lastFocus = null;
function openModalNow() {
  return MODAL_IDS.map($).filter(o => o && o.classList.contains('open'))[0] || null;
}
function focusablesWithin(root) {
  return root ? [...root.querySelectorAll(FOCUSABLE)] : [];
}
function rememberFocus(el) {
  lastFocus = el || document.activeElement || null;
}
function restoreFocus() {
  if (lastFocus && typeof lastFocus.focus === 'function') {
    try {
      lastFocus.focus();
    } catch {}
  }
  lastFocus = null;
}
function openModalOverlay(id, trigger) {
  const ov = $(id);
  if (!ov) return;
  rememberFocus(trigger);
  ov.classList.add('open');
  const m = ov.querySelector('.mp-modal,.st-modal');
  if (m && !m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1');
  // Move focus into the dialog so SRs announce it and Tab can't land on the page behind.
  if (m && typeof m.focus === 'function')
    setTimeout(() => {
      try {
        m.focus();
      } catch {}
    }, 0);
}
function closeModalOverlay(id) {
  const ov = $(id);
  if (!ov) return;
  ov.classList.remove('open');
  restoreFocus();
}
function openModelPicker() {
  renderModelPicker();
  openModalOverlay('mpOverlay');
  setTimeout(() => {
    const s = $('mpBody').querySelector('.mp-card.selected');
    if (s) s.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 80);
}
function closeModelPicker() {
  closeModalOverlay('mpOverlay');
  mpQuery = '';
}
function openSettings() {
  const trigger = document.activeElement;
  dismissLanding();
  loadAll();
  openModalOverlay('stOverlay', trigger);
}
function closeSettings() {
  closeModalOverlay('stOverlay');
  saveAll();
}
// Keyboard activation for div-based interactive controls (role=button/switch).
// Native buttons/links/inputs already handle Enter/Space, so only synthetic
// controls need this. Calling .click() lets each surface's own delegated
// listener do the real work, so nothing is double-bound.
function syntheticActivatable(t) {
  return (
    t &&
    t.tagName !== 'BUTTON' &&
    t.tagName !== 'A' &&
    t.tagName !== 'INPUT' &&
    t.tagName !== 'TEXTAREA' &&
    t.tagName !== 'SELECT'
  );
}

/* Bound in events.js. Landing dismiss → Escape closes top dialog → Tab trap. */
function onGlobalKeydown(e) {
  if (!landingDismissed) {
    // Let keyboard users Tab to the "Press to enter" control; any other key
    // (Enter/Space/letters) still dismisses the splash.
    if (e.key === 'Tab') return;
    dismissLanding();
    return;
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '');
  if (!typing && !openModalNow() && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openModelPicker();
    return;
  }
  if (!typing && !openModalNow() && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    newChat();
    return;
  }
  const ov = openModalNow();
  if (e.key === 'Escape' && ov) {
    const id = MODAL_IDS.find(x => $(x) === ov);
    if (id === 'mpOverlay') closeModelPicker();
    else if (id === 'stOverlay') closeSettings();
    else if (id === 'cpOverlay') closeChatPrompt();
    return;
  }
  // Trap Tab inside the open dialog so focus never escapes to the page behind.
  if (e.key === 'Tab' && ov) {
    const f = focusablesWithin(ov);
    if (!f.length) {
      e.preventDefault();
      return;
    }
    const first = f[0],
      last = f[f.length - 1],
      active = document.activeElement;
    if (e.shiftKey && (active === first || !ov.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !ov.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }
}
/* Keyboard activation for div-based controls (role=button/switch). Native
   buttons/inputs handle Enter/Space themselves; .click() lets each surface's
   delegated listener do the real work, so nothing is double-bound. */
function onSyntheticActivate(e) {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  const t = e.target;
  if (!t || !syntheticActivatable(t)) return;
  const el = t.closest('#landing,[role="switch"],[role="button"]');
  if (!el) return;
  e.preventDefault();
  if (el.id === 'landing') {
    dismissLanding();
    return;
  }
  if (el.click) el.click();
}

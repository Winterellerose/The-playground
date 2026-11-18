'use strict';
/* ═══ events.js — the single binding site for the app's UI events ═══
   Static buttons declare data-act resolved by ACT; dynamic surfaces delegate
   at their containers so re-renders never re-bind. ACT entries are lazy
   arrows, so function resolution happens at click time and script load
   order never matters. */

const ACT = {
  'new-chat': () => newChat(),
  'close-sidebar': () => closeSidebar(),
  'toggle-sidebar-desktop': () => toggleDesktopSidebar(),
  'toggle-sidebar': () => toggleSidebar(),
  'open-settings': () => openSettings(),
  'close-settings': () => closeSettings(),
  'close-model-picker': () => closeModelPicker(),
  'open-model-picker': () => openModelPicker(),
  'toggle-thinking': () => toggleThinking(),
  'toggle-web-search': () => toggleWebSearch(),
  'open-chat-prompt': () => openChatPrompt(),
  'close-chat-prompt': () => closeChatPrompt(),
  'clear-chat-prompt': () => clearChatPrompt(),
  'save-chat-prompt': () => saveChatPrompt(),
  'export-chats': () => exportChats(),
  'import-chats': () => $('importFile').click(),
  'clear-chat': () => clearChat(),
  attach: () => attachClick(),
  'test-key': b => testKey(b.dataset.pid),
  'jump-latest': () => jumpToLatest(),

  voice: () => toggleVoice(),
};

/* ── Sticky scroll: track reader position on the chat scroll area ── */
function bindScrollTracking() {
  if (!scrollArea) return;
  scrollArea.addEventListener('scroll', syncScrollPinned, { passive: true });
}

/* Named handlers extracted from listeners that used to be bound inline
   next to each feature. */
function mpBodyClick(e) {
  // Ordered: × remove custom → Add → section toggle → card select.
  const rc = e.target.closest('[data-act="remove-custom"]');
  if (rc) {
    removeCustom(rc.dataset.id, e);
    return;
  }
  if (e.target.closest('[data-act="add-custom"]')) {
    addCustomModel();
    return;
  }
  const head = e.target.closest('.mp-section-header');
  if (head) {
    mpSectionToggle(head);
    return;
  }
  const c = e.target.closest('.mp-card');
  if (c && c.dataset.mid) selectModel(c.dataset.mid, true);
}
function sbListClick(e) {
  const item = e.target.closest && e.target.closest('.sb-item');
  if (!item) return;
  if (e.target.closest('.sb-del')) deleteChat(item.dataset.cid);
  else loadChat(item.dataset.cid);
}
function sbListDblClick(e) {
  const item = e.target.closest && e.target.closest('.sb-item');
  if (item && !e.target.closest('.sb-del')) renameChat(item.dataset.cid);
}
function autoResizeInput() {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 300) + 'px';
}

function bindEvents() {
  document.body.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const fn = ACT[b.dataset.act];
    if (fn) fn(b);
  });
  // Modal panels swallow the backdrop-close click — but action buttons INSIDE
  // the panel must still bubble to the delegation.
  document.querySelectorAll('.mp-modal,.st-modal').forEach(m =>
    m.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act && m.contains(act)) return;
      e.stopPropagation();
    })
  );
  // Landing + global keys (defined in app.js / modals.js).
  $('landing').addEventListener('click', dismissLanding);
  document.addEventListener('keydown', onGlobalKeydown);
  document.addEventListener('keydown', onSyntheticActivate);
  // Static form controls.
  $('sbSearch').addEventListener('input', renderSidebar);
  $('sysPrompt').addEventListener('change', saveAll);
  $('extrasMode').addEventListener('change', saveAll);
  $('searchProvider').addEventListener('change', () => {
    saveSearchCfg();
    renderSearchFields();
  });
  $('importFile').addEventListener('change', e => {
    importChats(e.target);
  });
  bindScrollTracking();
  $('scrollJump').addEventListener('click', () => ACT['jump-latest']());
  $('imgFile').addEventListener('change', e => {
    addAttachFiles(e.target.files);
    e.target.value = '';
  });
  userInput.addEventListener('input', autoResizeInput);
  userInput.addEventListener('keydown', handleKey);
  // Send/Stop is state-driven — one listener, no swapping.
  sendBtn.addEventListener('click', () => (isStreaming ? stopStream(true) : sendMessage()));
  // Welcome suggestions carry their prompt in data-suggest.
  welcome.querySelectorAll('.suggest-btn').forEach(b => b.addEventListener('click', () => suggest(b.dataset.suggest)));
  // API key rows: input events delegate at the section containers.
  ['freeKeys', 'paidKeys'].forEach(id =>
    $(id).addEventListener('input', e => {
      const relay = e.target.dataset.relay;
      if (relay) return onRelayEdit(relay);
      const pid = e.target.dataset.pid;
      if (pid) onKeyEdit(pid);
    })
  );
  // Model picker: clicks + live search (input field is re-created per render).
  $('mpBody').addEventListener('click', mpBodyClick);
  $('mpBody').addEventListener('input', e => {
    if (e.target.id === 'mpSearch') mpFilter(e.target.value);
  });
  // Sidebar conversation list.
  $('sbList').addEventListener('click', sbListClick);
  $('sbList').addEventListener('dblclick', sbListDblClick);
  // Staged attachments: remove buttons carry their index.
  $('previewStrip').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'remove-image') removeImage(+b.dataset.i);
    else if (b.dataset.act === 'remove-file') removeFile(+b.dataset.i);
  });
  // Chat surface: follow-up chips first, then data-act buttons, then the
  // thinking disclosure — ordered with early returns so one click = one action.
  chatWrap.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip && chip.dataset.q) return pickFollowup(chip.dataset.q);
    const t = e.target.closest('.thinking-toggle');
    if (t) {
      t.classList.toggle('open');
      t.nextElementSibling.classList.toggle('open');
      t.setAttribute('aria-expanded', t.classList.contains('open') ? 'true' : 'false');
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const idx = b.dataset.idx == null ? null : +b.dataset.idx;
    switch (b.dataset.act) {
      case 'copy-msg':
        return copyMsg(b);
      case 'copy-code':
        return copyCode(b);
      case 'edit-msg':
        return editUserMsg(idx);
      case 'regen':
        return regenerate(idx);
      case 'alt-prev':
        return switchAlt(idx, -1);
      case 'alt-next':
        return switchAlt(idx, 1);
      case 'edit-cancel':
        return reloadUI();
      case 'edit-save':
        return submitEdit(idx);
    }
  });
  // Ctrl/Cmd+Enter submits an in-place message edit.
  chatWrap.addEventListener('keydown', e => {
    if (!e.target.classList || !e.target.classList.contains('edit-ta')) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitEdit(+e.target.dataset.idx);
    }
  });
}

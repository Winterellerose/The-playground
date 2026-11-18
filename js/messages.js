'use strict';
/* ═══ messages.js — message DOM rendering ═══ */

/* ── Message DOM ── */
const COPY_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
const EDIT_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const REGEN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>';
const PREV_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
const NEXT_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 6 15 12 9 18"/></svg>';
const TRUNCATED_NOTE =
  '<div class="truncated-note">⚠️ Response cut off — the model hit the max output tokens limit. Raise "Max output tokens" in Settings.</div>';
function metaLine(meta) {
  if (!meta) return '';
  const ms = Number(meta.ms),
    sec = Number.isFinite(ms) ? (ms / 1000).toFixed(1) : '—';
  const tps = Number.isFinite(Number(meta.tps)) ? ` · ${Number(meta.tps)} tok/s` : '';
  return `<span class="msg-meta">${esc(meta.pName || meta.p || '')} · ${esc(meta.m || '')} · ${sec}s${tps}</span>`;
}
function addUserMsg(text, idx, scroll = true, images, files) {
  if (!document || !document.createElement) return;
  welcome.style.display = 'none';
  const d = document.createElement('div');
  d.className = 'msg user';
  d.dataset.idx = idx;
  const safeImages = Array.isArray(images) ? images.map(safeImageDataUrl).filter(Boolean) : [];
  const imgHtml = safeImages.length
    ? `<div class="msg-images">${safeImages.map(u => `<img src="${esc(u)}" alt="attachment">`).join('')}</div>`
    : '';
  const fileHtml =
    files && files.length ? `<div class="msg-files">${files.map(f => fileChipHtml(f)).join('')}</div>` : '';
  const showBody = !!String(text || '').trim();
  const bodyHtml = showBody
    ? `<div class="msg-body" data-raw="${esc(text)}">${renderMd(text)}</div>`
    : `<div class="msg-body" data-raw="${esc((files || []).map(f => f.name).join(', '))}" style="display:none"></div>`;
  d.innerHTML = `<div class="msg-header"><span class="msg-role user">You</span><div class="msg-actions"><span class="copied-toast">Copied</span><button data-act="copy-msg" title="Copy" aria-label="Copy message">${COPY_SVG}</button><button class="act-edit" data-act="edit-msg" data-idx="${idx}" title="Edit" aria-label="Edit message">${EDIT_SVG}</button></div></div>${imgHtml}${fileHtml}${bodyHtml}`;
  chatWrap.appendChild(d);
  highlight(d);
  if (scroll) scrollToBottom();
}
function thinkingHtml(txt) {
  const prev = (txt || '').slice(0, 120).replace(/\n/g, ' ');
  return `<div class="thinking-block"><div class="thinking-toggle" role="button" tabindex="0" aria-expanded="false"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5l8 7-8 7z"/></svg><span>Thinking</span><span class="preview">${esc(prev)}</span></div><div class="thinking-content">${esc(txt)}</div></div>`;
}
function addAssistantMsg(msg, idx) {
  if (!document || !document.createElement) return;
  const alts = msg.alts || [{ content: msg.content, thinking: msg.thinking, meta: msg.meta }];
  const ai = Math.min(msg.activeAlt || 0, alts.length - 1);
  const alt = alts[ai] || {};
  const nav =
    alts.length > 1
      ? `<div class="alt-nav"><button data-act="alt-prev" data-idx="${idx}" aria-label="Previous version">${PREV_SVG}</button><span class="alt-counter" aria-live="polite">${ai + 1}/${alts.length}</span><button data-act="alt-next" data-idx="${idx}" aria-label="Next version">${NEXT_SVG}</button></div>`
      : '';
  const d = document.createElement('div');
  d.className = 'msg assistant';
  d.dataset.idx = idx;
  d.innerHTML = `<div class="msg-header"><span class="msg-role assistant">AI</span>${nav}${metaLine(alt.meta || msg.meta)}<div class="msg-actions"><span class="copied-toast">Copied</span><button data-act="copy-msg" title="Copy" aria-label="Copy message">${COPY_SVG}</button><button class="act-regen" data-act="regen" data-idx="${idx}" title="Regenerate" aria-label="Regenerate response">${REGEN_SVG}</button></div></div><div class="msg-body" data-raw="${esc(alt.content || '')}">${(alt.thinking ? thinkingHtml(alt.thinking) : '') + renderMd(alt.content || '')}</div>${alt.truncated || msg.truncated ? TRUNCATED_NOTE : ''}${sourcesHtml(alt.sources || msg.sources)}${followupsHtml(msg)}`;
  chatWrap.appendChild(d);
  highlight(d);
}
function copyMsg(btn) {
  const b = btn.closest('.msg').querySelector('.msg-body');
  navigator.clipboard.writeText(b.dataset.raw || b.innerText);
  const t = btn.parentElement.querySelector('.copied-toast');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1200);
}
function switchAlt(idx, dir) {
  const c = getActiveChat();
  if (!c) return;
  const m = c.messages[idx];
  if (!m || !m.alts || m.alts.length < 2) return;
  let ai = (m.activeAlt || 0) + dir;
  if (ai < 0) ai = m.alts.length - 1;
  if (ai >= m.alts.length) ai = 0;
  m.activeAlt = ai;
  m.content = m.alts[ai].content;
  m.thinking = m.alts[ai].thinking;
  m.meta = m.alts[ai].meta;
  m.sources = m.alts[ai].sources;
  m.truncated = !!m.alts[ai].truncated;
  saveChats();
  reloadUI();
}
function reloadUI() {
  const c = getActiveChat();
  if (!c) return;
  chatWrap.innerHTML = '';
  chatWrap.appendChild(welcome);
  welcome.style.display = 'none';
  c.messages.forEach((m, i) => {
    m.role === 'user' ? addUserMsg(m.content, i, false, m.images, m.files) : addAssistantMsg(m, i);
  });
  scrollToBottom();
}
function editUserMsg(idx) {
  const c = getActiveChat();
  if (!c || isStreaming) return;
  const m = c.messages[idx];
  if (!m || m.role !== 'user') return;
  const el = chatWrap.querySelector(`.msg[data-idx="${idx}"]`);
  if (!el) return;
  el.querySelector('.msg-body').innerHTML =
    `<div class="msg-edit-wrap"><textarea class="edit-ta" data-idx="${idx}" aria-label="Edit message">${esc(m.content)}</textarea><div class="msg-edit-btns"><button class="edit-cancel" data-act="edit-cancel">Cancel</button><button class="edit-save" data-act="edit-save" data-idx="${idx}">Save &amp; Send</button></div></div>`;
  const ta = el.querySelector('.edit-ta');
  ta.style.height = Math.min(ta.scrollHeight, 300) + 'px';
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}
function submitEdit(idx) {
  const c = getActiveChat();
  if (!c) return;
  const ta = chatWrap.querySelector(`.msg[data-idx="${idx}"] .edit-ta`);
  if (!ta) return;
  const nt = ta.value.trim();
  if (!nt) return;
  const keepImgs = c.messages[idx] ? c.messages[idx].images : undefined;
  const keepFiles = c.messages[idx] ? c.messages[idx].files : undefined;
  c.messages = c.messages.slice(0, idx);
  c.messages.push({
    role: 'user',
    content: nt,
    images: keepImgs,
    files: keepFiles,
  });
  c.updatedAt = Date.now();
  saveChats();
  reloadUI();
  runCompletion(c);
}
function regenerate(idx) {
  const c = getActiveChat();
  if (!c || isStreaming) return;
  const m = c.messages[idx];
  if (!m || m.role !== 'assistant') return;
  stopStream();
  removeFrom(idx);
  resetScrollPin(); // a fresh answer the user asked for → re-engage auto-scroll
  runCompletion(c, idx);
}
function removeFrom(idx) {
  const els = [...chatWrap.querySelectorAll('.msg')];
  els.forEach(e => {
    if (parseInt(e.dataset.idx) >= idx) e.remove();
  });
}
function showError(msg, retryFn) {
  if (!document || !document.createElement || !chatWrap) return;
  chatWrap.querySelectorAll('.error-msg').forEach(e => e.remove());
  const d = document.createElement('div');
  d.className = 'error-msg';
  d.innerHTML = `<span>${esc(msg)}</span>${retryFn ? '<button class="btn-retry">Retry</button>' : ''}`;
  if (retryFn)
    d.querySelector('.btn-retry').addEventListener(
      'click',
      () => {
        d.remove();
        retryFn();
      },
      { once: true }
    );
  chatWrap.appendChild(d);
  scrollToBottom();
}

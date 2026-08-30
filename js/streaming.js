"use strict";
/* ═══ streaming.js — input handling, streaming core, send/run ═══ */

/* ── Input ── */
function handleKey(e) {
  if (e.key === "Tab") {
    e.preventDefault();
    const s = userInput.selectionStart,
      en = userInput.selectionEnd;
    userInput.value =
      userInput.value.slice(0, s) + "  " + userInput.value.slice(en);
    userInput.selectionStart = userInput.selectionEnd = s + 2;
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!isStreaming) sendMessage();
  }
}
function setStreamingUI(on) {
  isStreaming = on;
  if (window) window.isStreaming = on;
  if (on) {
    sendBtn.innerHTML =
      'Stop <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    sendBtn.classList.add("stopping");
  } else {
    sendBtn.innerHTML =
      'Send <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>';
    sendBtn.classList.remove("stopping");
  }
}
function stopStream() {
  if (!isStreaming) return;
  userStop = true;
  streamGen++;
  if (abortCtrl) {
    abortCtrl.abort();
    abortCtrl = null;
  }
  // Reset the UI immediately so the button never wedges even if an async
  // tail is still unwinding. runCompletion's finally is a backstop.
  setStreamingUI(false);
}

/* ── Streaming core ── */
async function doStream(c, msgDiv, tried = [], gen = streamGen, regenIdx) {
  if (gen !== streamGen)
    return { content: "", thinking: "", meta: null, aborted: true };
  const cfg = getCfg(tried);
  const body = msgDiv.querySelector(".msg-body");
  if (cfg.error) {
    body.innerHTML = '<p style="color:var(--text-faint)">—</p>';
    showError(cfg.error);
    return { content: "", thinking: "", meta: null, error: cfg.error };
  }
  const targetIdx = parseInt(msgDiv.dataset.idx);
  const hist = cleanHistory(c, targetIdx);
  // Set up the abort controller BEFORE any async work so Stop works during
  // the web-search pre-fetch too (previously abortCtrl didn't exist yet).
  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;
  const lastUser =
    (hist.filter((x) => x.role === "user").pop() || {}).content || "";
  const doSearch =
    cfg.webSearch === "on" ||
    (cfg.webSearch === "auto" && webNeedsSearch(lastUser));
  if (doSearch) {
    if (searchCache.gen === gen && searchCache.q === lastUser) {
      cfg.webSources = searchCache.srcs;
      cfg.webContext = searchCache.ctx;
    } else {
      const q = lastUser;
      try {
        const srcs = await freeWebSearch(q, signal);
        if (gen !== streamGen)
          return { content: "", thinking: "", meta: null, aborted: true };
        if (srcs && srcs.length) {
          cfg.webContext = formatWebContext(srcs);
          cfg.webSources = srcs;
          logRot(`🌐 Web search: ${srcs.length} sources injected`, "ok");
        } else
          logRot(
            "🌐 Web search: no results (add a search key in Settings)",
            "warn",
          );
      } catch {
        logRot("🌐 Web search failed — sending without context", "warn");
      }
      searchCache = {
        gen,
        q,
        srcs: cfg.webSources || [],
        ctx: cfg.webContext || "",
      };
    }
  }
  const { h, rb } = buildRequest(cfg, hist);
  const { pid, model: m } = cfg;
  let full = "",
    think = "",
    meta = null,
    t0 = performance.now();
  let pulse = null,
    block = null,
    lastHl = 0;

  try {
    logRot(
      `→ ${REG[pid].name} · ${cfg.modelId}${cfg.webSources && cfg.webSources.length ? " · 🌐 web" : ""}`,
      "ok",
    );
    const res = await fetch(REG[pid].url, {
      method: "POST",
      headers: h,
      body: JSON.stringify(rb),
      signal: abortCtrl.signal,
    });
    if (!res.ok) {
      const et = await res.text();
      let em = `${REG[pid].name} error ${res.status}`;
      try {
        em = JSON.parse(et).error?.message || em;
      } catch {}
      if (res.status === 402)
        em =
          "that model needs OpenRouter credits; pick a FREE model (web search itself is free)";
      const retriable =
        res.status === 429 ||
        res.status >= 500 ||
        /rate|quota|overloaded|timeout|capacity|upstream|temporarily|unavailable|no available/i.test(
          em,
        );
      const badKey = res.status === 401 || res.status === 403;
      if (badKey) markBadKey(pid);
      if (retriable) markRateLimited(pid);
      if (retriable || badKey || res.status === 402) {
        // Exclude every provider already attempted for this request. This is
        // request-local: a 402 should permit another configured key/provider
        // without permanently marking the first key bad, but must never select
        // that same provider again and recurse forever.
        const attempted = [...new Set([...tried, pid])];
        const nextCfg = getCfg(attempted);
        if (!nextCfg.error) {
          const via = REG[nextCfg.pid].name;
          logRot(
            retriable
              ? `${REG[pid].name} busy/error → trying ${via}`
              : `${REG[pid].name} rejected request → trying ${via}`,
            "warn",
          );
          return doStream(c, msgDiv, attempted, gen, regenIdx);
        }
        // No fallback. Give a specific, actionable message instead of the
        // generic "all providers rate limited".
        if (res.status === 429 || /rate|quota/i.test(em))
          em = `${m.name}: rate limited on ${REG[pid].name}. Free tiers are shared and can be busy — try again in a moment, pick a different free model, or add an OpenRouter (paid) key.`;
        else if (
          res.status >= 500 ||
          /overloaded|capacity|upstream|unavailable|temporarily|timeout/i.test(
            em,
          )
        )
          em = `${m.name}: ${REG[pid].name} is overloaded or down right now. Free endpoints have limited uptime — try again shortly or choose another model.`;
        else if (badKey)
          em = `${REG[pid].name} rejected your API key (${res.status}). Check it in Settings.`;
      }
      throw new Error(
        em +
          (res.status === 400
            ? " — check model ID / context length. You can add the exact ID as a custom model."
            : ""),
      );
    }
    markOk(pid);
    const reader = res.body.getReader(),
      dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (gen !== streamGen) {
        try {
          reader.cancel();
        } catch {}
        return { content: "", thinking: "", meta: null, aborted: true };
      }
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        const tr = line.trim();
        if (!tr.startsWith("data:")) continue;
        const data = tr.slice(5).trim();
        if (data === "[DONE]") continue;
        let evt;
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        if (evt.usage) {
          meta = meta || {};
          meta.out =
            evt.usage.completion_tokens ?? evt.usage.output_tokens ?? meta.out;
          meta.in =
            evt.usage.prompt_tokens ?? evt.usage.input_tokens ?? meta.in;
        }
        if (evt.type === "message_delta" && evt.usage) {
          meta = meta || {};
          meta.out = evt.usage.output_tokens ?? meta.out;
        }
        let rc = null,
          txt = null;
        if (evt.type === "content_block_delta" && evt.delta) {
          if (evt.delta.type === "thinking_delta") rc = evt.delta.thinking;
          else if (evt.delta.type === "text_delta") txt = evt.delta.text;
        } else {
          const d = evt.choices && evt.choices[0] && evt.choices[0].delta;
          if (!d) continue;
          rc =
            typeof d.reasoning_content === "string"
              ? d.reasoning_content
              : typeof d.reasoning === "string"
                ? d.reasoning
                : null;
          txt = d.content || null;
        }
        if (rc) {
          if (!pulse) {
            pulse = document.createElement("div");
            pulse.className = "thinking-pulse";
            pulse.innerHTML =
              '<span>Thinking</span><span class="dots"><span></span><span></span><span></span></span>';
            body.insertBefore(pulse, body.firstChild);
          }
          think += rc;
          if (think.length > 10 && !block) {
            pulse.remove();
            pulse = null;
            body.insertAdjacentHTML("afterbegin", thinkingHtml(think));
            block = body.querySelector(".thinking-block");
          }
          if (block) {
            const tc = block.querySelector(".thinking-content");
            tc.textContent = think;
            block.querySelector(".preview").textContent = think
              .slice(0, 120)
              .replace(/\n/g, " ");
            tc.scrollTop = tc.scrollHeight;
          }
        }
        if (txt) {
          if (pulse) {
            pulse.remove();
            pulse = null;
          }
          full += txt;
          const tHead = body.querySelector(".thinking-block")
            ? body.querySelector(".thinking-block").outerHTML
            : "";
          body.innerHTML = tHead + renderMd(full, true);
          body.classList.add("streaming-cursor");
          body.dataset.raw = full;
          const now = performance.now();
          if (now - lastHl > 800) {
            highlight(body);
            lastHl = now;
          }
          scrollToBottom();
        }
      }
    }
  } catch (e) {
    if (gen !== streamGen) {
      // A user Stop aborts the in-flight fetch. Keep what streamed so far
      // (runCompletion commits it); other superseding events (new chat,
      // switch) discard it.
      if (userStop && (full || think))
        return {
          content: full,
          thinking: think || undefined,
          meta: null,
          stopped: true,
        };
      return { content: "", thinking: "", meta: null, aborted: true };
    }
    if (e.name !== "AbortError") {
      showError(e.message, () => {
        if (gen === streamGen) {
          msgDiv.remove();
          runCompletion(c, regenIdx);
        }
      });
      logRot(`Error: ${e.message}`, "err");
    }
  }
  if (gen !== streamGen) {
    if (userStop && (full || think))
      return {
        content: full,
        thinking: think || undefined,
        meta: null,
        stopped: true,
      };
    return { content: "", thinking: "", meta: null, aborted: true };
  }
  body.classList.remove("streaming-cursor");
  const ms = performance.now() - t0;
  if (full || think) {
    meta = meta || {};
    meta.p = pid;
    meta.pName = REG[pid].name;
    meta.m = cfg.modelId;
    meta.ms = Math.round(ms);
    const outTok = meta.out || Math.round(full.length / 4);
    meta.tps = Math.round(outTok / (ms / 1000));
    const tHead = body.querySelector(".thinking-block")
      ? body.querySelector(".thinking-block").outerHTML
      : "";
    body.innerHTML = tHead + renderMd(full);
    body.dataset.raw = full;
    highlight(body);
  }
  return {
    content: full,
    thinking: think || undefined,
    meta: full || think ? meta : null,
    sources: cfg.webSources,
  };
}

async function runCompletion(c, regenIdx) {
  const cfgCheck = getCfg();
  if (cfgCheck.error) {
    showError(cfgCheck.error);
    return;
  }
  chatWrap.querySelectorAll(".error-msg").forEach((e) => e.remove());
  const gen = ++streamGen;
  userStop = false;
  setStreamingUI(true);
  const idx = regenIdx !== undefined ? regenIdx : c.messages.length;
  const d = document.createElement("div");
  d.className = "msg assistant";
  d.dataset.idx = idx;
  d.innerHTML = `<div class="msg-header"><span class="msg-role assistant">AI</span><div class="msg-actions"><span class="copied-toast">Copied</span><button data-act="copy-msg" title="Copy" aria-label="Copy message">${COPY_SVG}</button></div></div><div class="msg-body streaming-cursor"></div>`;
  chatWrap.appendChild(d);
  scrollToBottom();
  let result;
  try {
    result = await doStream(c, d, [], gen, regenIdx);
  } finally {
    // Release the streaming lock / restore the Send button. When this run was
    // superseded (Stop, new chat, switch, regen), the superseding action has
    // already reset the UI — only touch it if we're still the active run, so
    // we don't clobber a freshly-started stream.
    if (gen === streamGen) setStreamingUI(false);
  }
  // A genuine supersede (new chat, switch chat, load) — discard the placeholder.
  if (gen !== streamGen && !result?.stopped) {
    d.remove();
    userStop = false;
    return;
  }
  if (result.aborted) {
    d.remove();
    userStop = false;
    return;
  }
  if (result.content || result.thinking) {
    let asstIdx;
    if (regenIdx !== undefined) {
      const m = c.messages[idx];
      m.alts = m.alts || [
        {
          content: m.content,
          thinking: m.thinking,
          meta: m.meta,
          sources: m.sources,
        },
      ];
      m.alts.push({
        content: result.content,
        thinking: result.thinking,
        meta: result.meta,
        sources: result.sources,
      });
      m.activeAlt = m.alts.length - 1;
      m.content = result.content;
      m.thinking = result.thinking;
      m.meta = result.meta;
      m.sources = result.sources;
      delete m.followups; // regenerate chips for the new answer
      asstIdx = idx;
    } else {
      c.messages.push({
        role: "assistant",
        content: result.content,
        thinking: result.thinking,
        meta: result.meta,
        sources: result.sources,
        stopped: result.stopped || false,
      });
      asstIdx = c.messages.length - 1;
    }
    c.updatedAt = Date.now();
    const persisted = saveChats();
    reloadUI();
    renderSidebar();
    if (!persisted)
      showError(
        "This answer is visible now but could not be saved because browser storage is full. Export or delete old chats before reloading.",
      );
    // One cheap non-streaming call → 5-word title + 3 clickable follow-up chips.
    // Skip it when the user manually stopped (partial answer); not worth a call.
    if (!result.stopped && persisted) generateExtras(c, asstIdx);
  } else {
    d.remove(); // never poison history with empty assistant turns
  }
  userStop = false;
}
async function sendMessage() {
  const text = userInput.value.trim();
  const imgs = pendingImages.slice();
  const files = pendingFiles.map((f) => ({
    name: f.name,
    type: f.type,
    size: f.size,
    text: f.text,
  }));
  if ((!text && !imgs.length && !files.length) || isStreaming) return;
  if (imgs.length && !visionCapable()) {
    showError(
      (curModel() ? curModel().name : "This model") +
        " doesn't accept images — pick a model with the VISION tag.",
    );
    return;
  }
  const cfg = getCfg();
  if (cfg.error) {
    showError(cfg.error);
    return;
  }
  const c = ensureChat();
  const previous = { model: c.model, title: c.title, updatedAt: c.updatedAt };
  c.model = selectedModel;
  const storedText = text || (imgs.length && !files.length ? "(image)" : "");
  if (c.messages.length === 0)
    c.title =
      text.slice(0, 60) ||
      (files[0] && files[0].name) ||
      (imgs.length ? "(image)" : "New chat");
  c.messages.push({
    role: "user",
    content: storedText,
    images: imgs.length ? imgs : undefined,
    files: files.length ? files : undefined,
  });
  c.updatedAt = Date.now();
  if (!saveChats()) {
    c.messages.pop();
    Object.assign(c, previous);
    showError(
      "Browser storage is full. Your message and attachments are still staged — export or delete old chats, then try again.",
    );
    return;
  }
  renderSidebar();
  welcome.style.display = "none";
  addUserMsg(
    storedText,
    c.messages.length - 1,
    true,
    imgs.length ? imgs : undefined,
    files.length ? files : undefined,
  );
  userInput.value = "";
  userInput.style.height = "auto";
  pendingImages = [];
  pendingFiles = [];
  renderPreviews();
  await runCompletion(c);
}

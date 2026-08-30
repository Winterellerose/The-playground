"use strict";
/* ═══ markdown.js — marked + DOMPurify rendering pipeline ═══ */

/* ── Markdown — maintained parser (marked) + sanitizer (DOMPurify) ──
   Pipeline: (while streaming: split off a trailing still-open fence) →
   marked (GFM, line breaks) → DOMPurify under a default-deny tag/attr
   allowlist → mdEnhance() DOM post-pass that wraps fenced code in the
   app's .code-block chrome and re-verifies every URL that survived.

   URL policy — explicit allowlist, enforced twice (sanitizer hook AND
   post-pass): a[href] may only be http:, https:, mailto: or a #fragment;
   img[src] may only be http/https. Everything else — javascript:, data:,
   vbscript:, blob:, file:, … — is stripped, as are all event-handler and
   style attributes. Nothing rendered from markdown can auto-navigate.

   Failure posture: if marked or DOMPurify are ever missing or throw,
   renderMd fails CLOSED to escaped plain text — a hand-rolled renderer is
   never silently substituted for the maintained one. */
const LANG_NAMES = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  py: "Python",
  python: "Python",
  rs: "Rust",
  go: "Go",
  java: "Java",
  cpp: "C++",
  c: "C",
  cs: "C#",
  sh: "Shell",
  bash: "Shell",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  yaml: "YAML",
  sql: "SQL",
  md: "Markdown",
  jsx: "JSX",
  tsx: "TSX",
  php: "PHP",
  swift: "Swift",
  kotlin: "Kotlin",
  lua: "Lua",
  diff: "Diff",
  dockerfile: "Dockerfile",
  "": "Code",
};
const MD_TAG_ALLOW = [
  "p",
  "br",
  "strong",
  "em",
  "b",
  "i",
  "del",
  "s",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];
const MD_ATTR_ALLOW = ["href", "title", "start", "class", "src", "alt"];
const MD_SANITIZE_CFG = {
  ALLOWED_TAGS: MD_TAG_ALLOW,
  ALLOWED_ATTR: MD_ATTR_ALLOW,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  FORBID_TAGS: ["#comment"],
};
function mdUrlAllowed(u, forHref) {
  const s = String(u == null ? "" : u).trim();
  if (!s) return false;
  if (/[\u0000-\u001f\u007f]/.test(s)) return false; // control chars (engines ignore \t\r\n inside hrefs → java\tscript:)
  if (s.charAt(0) === "#") return forHref === true; // fragments navigate the page only; never valid for src
  // Absolute only: scheme-relative (//host) and origin-relative (/x, page.html)
  // are refused, so URLs can never resolve against wherever this file happens
  // to be served from (file:// included).
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return false;
  let p;
  try {
    p = new URL(s, location.href);
  } catch {
    return false;
  }
  if (forHref === true)
    return (
      p.protocol === "http:" ||
      p.protocol === "https:" ||
      p.protocol === "mailto:"
    );
  return p.protocol === "http:" || p.protocol === "https:";
}
var MD_READY = false; // var (not let) so CI can force the fail-closed path
(function initMarkdown() {
  const mk = window.marked,
    dp = window.DOMPurify;
  if (!(
    mk &&
    typeof mk.parse === "function" &&
    dp &&
    typeof dp.sanitize === "function" &&
    typeof dp.addHook === "function"
  ))
    return;
  try {
    dp.addHook("afterSanitizeAttributes", (node) => {
      if (!node || node.nodeType !== 1) return;
      if (node.hasAttribute("href")) {
        if (!mdUrlAllowed(node.getAttribute("href"), true))
          node.removeAttribute("href");
        else {
          node.setAttribute("target", "_blank");
          node.setAttribute("rel", "noopener noreferrer");
        }
      }
      if (node.hasAttribute("src")) {
        if (!mdUrlAllowed(node.getAttribute("src"), false))
          node.removeAttribute("src");
        else if (node.tagName === "IMG") {
          node.setAttribute("loading", "lazy");
          node.setAttribute("referrerpolicy", "no-referrer");
        }
      }
      // The only class allowed through is marked's own language-* on <code>.
      if (node.hasAttribute("class")) {
        const c = node.getAttribute("class");
        if (!(node.tagName === "CODE" && /^language-[\w+#.-]*$/.test(c)))
          node.removeAttribute("class");
      }
      if (node.hasAttribute("target") && node.tagName !== "A")
        node.removeAttribute("target");
    });
  } catch {
    return;
  }
  MD_READY = true;
})();
// While streaming, the final fence is usually still open. Render everything
// before it through the full pipeline and hand the open remainder to the
// streaming chrome. Fence state follows GFM: a closer is ```+ (≥ opener
// length), no info string; only line-initial markers count.
function splitOpenFence(src) {
  const lines = String(src).split("\n");
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,})([^`]*)$/.exec(lines[i]);
    if (!m) continue;
    if (open) {
      if (m[1].length >= open.ticks && !m[2].trim()) open = null;
    } else
      open = { i, ticks: m[1].length, lang: m[2].trim().split(/\s+/)[0] || "" };
  }
  if (!open) return { head: String(src), tail: null };
  return {
    head: lines.slice(0, open.i).join("\n"),
    tail: { lang: open.lang, code: lines.slice(open.i + 1).join("\n") },
  };
}
function codeBlockHtml(lang, code, streaming) {
  // Escapes its own inputs — callers pass raw, unescaped text.
  const l = String(lang == null ? "" : lang).toLowerCase();
  return `<div class="code-block${streaming ? " streaming-block" : ""}"><div class="code-header"><span class="code-lang">${esc(LANG_NAMES[l] || (l || "").toUpperCase() || "CODE")}</span>${streaming ? '<span class="code-streaming-dot"></span>' : `<button class="code-copy" data-act="copy-code"><span>Copy</span></button>`}</div><pre><code class="language-${esc(l || "text")}">${esc(code)}</code></pre></div>`;
}
function mdEnhance(root) {
  // Belt-and-braces on top of the sanitizer hook: re-verify every URL that
  // survived, then swap sanitized <pre><code> for the app's code chrome.
  // Model-controlled strings only ever move through esc()'d templates or
  // textContent — never through raw innerHTML of parsed content.
  root.querySelectorAll("a[href]").forEach((a) => {
    if (!mdUrlAllowed(a.getAttribute("href"), true)) a.removeAttribute("href");
    else {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  });
  root.querySelectorAll("img").forEach((img) => {
    if (
      !img.hasAttribute("src") ||
      !mdUrlAllowed(img.getAttribute("src"), false)
    )
      img.remove();
    else {
      img.setAttribute("loading", "lazy");
      img.setAttribute("referrerpolicy", "no-referrer");
    }
  });
  root.querySelectorAll("pre > code").forEach((code) => {
    const lm = /^language-([\w+#.-]*)$/.exec(code.getAttribute("class") || "");
    const tpl = document.createElement("template");
    tpl.innerHTML = codeBlockHtml(
      lm ? lm[1] : "",
      code.textContent || "",
      false,
    );
    code.parentElement.replaceWith(tpl.content.firstChild);
  });
}
function mdFailClosed(s) {
  return s ? "<p>" + esc(s).replace(/\n/g, "<br>") + "</p>" : "<p></p>";
}
function renderMd(src, streaming) {
  const s = String(src == null ? "" : src);
  // Fail closed if the libs are gone OR the document is torn down (a stream
  // tail can outlive its window; it must degrade to escaped text, never throw).
  if (!MD_READY || !document || !document.createElement) return mdFailClosed(s);
  let head = s,
    tail = null;
  if (streaming) {
    const sp = splitOpenFence(s);
    head = sp.head;
    tail = sp.tail;
  }
  let html, clean;
  try {
    html = marked.parse(head, { gfm: true, breaks: true, async: false });
  } catch {
    return mdFailClosed(s);
  }
  try {
    clean = DOMPurify.sanitize(html, MD_SANITIZE_CFG);
  } catch {
    return mdFailClosed(s);
  }
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  mdEnhance(tpl.content);
  if (tail) {
    const t = document.createElement("template");
    t.innerHTML = codeBlockHtml(tail.lang, tail.code, true);
    tpl.content.appendChild(t.content.firstChild);
  }
  return tpl.innerHTML || "<p></p>";
}
function copyCode(btn) {
  const code = btn.closest(".code-block").querySelector("code").textContent;
  navigator.clipboard.writeText(code);
  const s = btn.querySelector("span");
  s.textContent = "Copied";
  btn.classList.add("copied");
  setTimeout(() => {
    s.textContent = "Copy";
    btn.classList.remove("copied");
  }, 1400);
}
function highlight(el) {
  el.querySelectorAll(".code-block pre code").forEach((c) => {
    if (!c.dataset.hl) {
      try {
        hljs.highlightElement(c);
        c.dataset.hl = 1;
      } catch {}
    }
  });
}
function scrollToBottom() {
  scrollArea.scrollTop = scrollArea.scrollHeight;
}

"use strict";
/* ═══ utils.js — pure helpers shared across features ═══ */

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function fmtCtx(n) {
  if (!n || n < 1000) return n ? String(n) : "—";
  return n < 1e6
    ? Math.round(n / 1000) + "K"
    : (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
}
function fmtFileSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}
function parseCtx(v) {
  // "262K" → 262000 · "1.3M" → 1300000 · "131000" → 131000 · garbage → 0
  const m = /([\d.]+)\s*([kKmM])?/.exec(String(v || ""));
  if (!m) return 0;
  const n = parseFloat(m[1]) || 0;
  return Math.round(n * (m[2] ? (/m/i.test(m[2]) ? 1e6 : 1e3) : 1));
}
function nowStamp() {
  try {
    return new Date().toLocaleString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return new Date().toISOString();
  }
}

/* file-type tables + guards (attachments, chat import, message rendering) */
const TEXT_EXTS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "h",
  "hpp",
  "hh",
  "cpp",
  "cc",
  "cxx",
  "cs",
  "html",
  "htm",
  "css",
  "xml",
  "yml",
  "yaml",
  "sql",
  "sh",
  "bash",
  "zsh",
  "ksh",
]);
const EXT_MIME = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  jsx: "text/javascript",
  py: "text/x-python",
  rb: "text/x-ruby",
  go: "text/x-go",
  rs: "text/x-rust",
  java: "text/x-java-source",
  c: "text/x-c",
  h: "text/x-c",
  hpp: "text/x-c++",
  hh: "text/x-c++",
  cpp: "text/x-c++",
  cc: "text/x-c++",
  cxx: "text/x-c++",
  cs: "text/x-csharp",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  xml: "application/xml",
  yml: "text/yaml",
  yaml: "text/yaml",
  sql: "application/sql",
  sh: "text/x-shellscript",
  bash: "text/x-shellscript",
  zsh: "text/x-shellscript",
  ksh: "text/x-shellscript",
};
const EXT_LANG = {
  txt: "",
  md: "markdown",
  markdown: "markdown",
  json: "json",
  csv: "csv",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  hpp: "cpp",
  hh: "cpp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  cs: "csharp",
  html: "html",
  htm: "html",
  css: "css",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ksh: "bash",
};
const TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/css",
  "text/xml",
  "text/javascript",
  "text/typescript",
  "text/x-python",
  "text/x-ruby",
  "text/x-go",
  "text/x-rust",
  "text/x-java",
  "text/x-java-source",
  "text/x-c",
  "text/x-c++",
  "text/x-csharp",
  "text/x-sh",
  "text/x-shellscript",
  "text/yaml",
  "text/x-yaml",
  "application/json",
  "application/javascript",
  "application/typescript",
  "application/xml",
  "application/sql",
  "application/x-sh",
  "application/x-yaml",
]);
function fileExt(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}
function isImageFile(f) {
  return !!(f && f.type && f.type.startsWith("image/"));
}
function isSupportedTextFile(f) {
  if (!f) return false;
  const ext = fileExt(f.name);
  if (ext === "pdf") return false;
  if (TEXT_EXTS.has(ext)) return true;
  const t = String(f.type || "").toLowerCase();
  if (!t) return false;
  if (t === "application/pdf" || t === "application/octet-stream") return false;
  if (t.startsWith("text/")) return true;
  return TEXT_MIMES.has(t);
}
function looksBinary(text) {
  return typeof text === "string" && text.indexOf("\0") >= 0;
}
function guessMime(name, type) {
  return type || EXT_MIME[fileExt(name)] || "text/plain";
}
const MAX_IMAGE_DATA_URL = 5 * 1024 * 1024;
function safeImageDataUrl(value) {
  const s = String(value || "");
  if (!s || s.length > MAX_IMAGE_DATA_URL) return "";
  const m = /^data:image\/(?:png|jpeg|webp|gif);base64,/i.exec(s);
  if (!m) return "";
  const payload = s.slice(m[0].length);
  return payload && /^[A-Za-z0-9+/=\r\n]+$/.test(payload) ? s : "";
}
function safeWebUrl(value) {
  try {
    const u = new URL(String(value || ""));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

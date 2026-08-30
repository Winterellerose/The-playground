"use strict";
/* ═══ rag.js — pure-JS BM25 retrieval engine (chunk → index → search) ═══
   No dependencies, no DOM, no network. A document is split into overlapping
   chunks; each chunk is tokenized into a term-frequency map; BM25 ranks
   chunks against the user's query. The index is rebuilt from stored chunk
   text on first use per session, so IndexedDB only ever persists plain text.

   Chunking is paragraph-first: paragraphs accumulate up to RAG_CHUNK_SIZE,
   oversized paragraphs are split at whitespace with overlap so no sentence
   gets butchered at an arbitrary byte boundary. */

const RAG_CHUNK_SIZE = 1200; // target chunk length in characters
const RAG_CHUNK_OVERLAP = 150; // character overlap between consecutive chunks
const RAG_MAX_CHUNKS = 6000; // hard cap per document (~7 MB of text)
const RAG_K1 = 1.5; // BM25 term-frequency saturation
const RAG_B = 0.75; // BM25 length normalization
const RAG_MIN_SCORE = 1.2; // below this a chunk is treated as a non-match
const RAG_DEFAULT_TOPK = 6; // max excerpts injected per message (all docs)

/* Small English stopword set. Identifiers, versions and numbers survive on
   purpose — they carry most of the signal in code and docs. */
const RAG_STOP = new Set(
  (
    "a an and are as at be been being but by for from has have he her hers him his " +
    "i if in into is it its of on or she that the their them then there these they " +
    "this those to was were will with you your ours not no nor so too very can just " +
    "should now do does did doing done had having about over under again further " +
    "once all any both each few more most other some such only own same than when " +
    "where which while who whom why how what"
  ).split(" ")
);

/* Lowercase, strip accents, keep letters/numbers/underscore, drop 1-char noise. */
function ragTokenize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/* Split one oversized paragraph at whitespace near `size`, with overlap. */
function ragSplitLong(p, size, overlap) {
  const out = [];
  let i = 0;
  while (i < p.length) {
    let end = Math.min(p.length, i + size);
    if (end < p.length) {
      const brk = Math.max(p.lastIndexOf(" ", end), p.lastIndexOf("\n", end));
      if (brk > i + Math.floor(size * 0.5)) end = brk;
    }
    out.push(p.slice(i, end));
    if (end >= p.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}

/* → [{i, text}] in document order. */
function ragChunkText(text, opts) {
  const size = (opts && opts.size) || RAG_CHUNK_SIZE;
  const overlap = Math.min(
    opts && opts.overlap != null ? opts.overlap : RAG_CHUNK_OVERLAP,
    Math.floor(size / 3)
  );
  const src = String(text || "");
  if (!src.trim()) return [];
  const paras = src.split(/\n{2,}/);
  const chunks = [];
  let cur = "";
  const flush = () => {
    const t = cur.trim();
    if (t) chunks.push(t);
    cur = "";
  };
  for (const para of paras) {
    const p = para.trim();
    if (!p) continue;
    if (p.length > size) {
      flush();
      for (const piece of ragSplitLong(p, size, overlap)) chunks.push(piece);
      continue;
    }
    if (cur && cur.length + p.length + 2 > size) flush();
    cur = cur ? cur + "\n\n" + p : p;
  }
  flush();
  return chunks
    .slice(0, RAG_MAX_CHUNKS)
    .map((text, i) => ({ i, text }));
}

/* Build a BM25 index from chunks. Async only to yield to the UI on large
   documents (progress callback gets 0–100). Returns
   {N, df:Map, tfs:Map[], lens:number[], avgLen}. */
async function ragBuildIndex(chunks, onProgress) {
  const N = chunks.length;
  const df = new Map();
  const tfs = new Array(N);
  const lens = new Array(N);
  let totalLen = 0;
  for (let d = 0; d < N; d++) {
    const toks = ragTokenize(chunks[d].text).filter((t) => !RAG_STOP.has(t));
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    tfs[d] = tf;
    lens[d] = toks.length;
    totalLen += toks.length;
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    if (onProgress && d % 250 === 0 && d > 0) {
      onProgress(Math.round((d / N) * 100));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return { N, df, tfs, lens, avgLen: N ? totalLen / N : 0 };
}

/* BM25 (Okapi). Returns [{chunk, score}] sorted best-first. */
function ragSearchIndex(index, chunks, query, opts) {
  if (!index || !index.N) return [];
  const topK = (opts && opts.topK) || 10;
  const minScore = opts && opts.minScore != null ? opts.minScore : RAG_MIN_SCORE;
  const qTokens = [...new Set(ragTokenize(query).filter((t) => !RAG_STOP.has(t)))];
  if (!qTokens.length) return [];
  const avg = index.avgLen || 1;
  const scores = new Array(index.N).fill(0);
  for (const t of qTokens) {
    const n = index.df.get(t);
    if (!n) continue;
    const idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
    for (let d = 0; d < index.N; d++) {
      const f = index.tfs[d].get(t);
      if (!f) continue;
      scores[d] +=
        (idf * (f * (RAG_K1 + 1))) /
        (f + RAG_K1 * (1 - RAG_B + RAG_B * (index.lens[d] / avg)));
    }
  }
  const hits = [];
  for (let d = 0; d < index.N; d++)
    if (scores[d] >= minScore) hits.push({ chunk: chunks[d], score: scores[d] });
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}

/* A short window around the first query-term hit — used for source tooltips. */
function ragSnippet(text, query, len) {
  const L = len || 160;
  const src = String(text || "").replace(/\s+/g, " ").trim();
  if (src.length <= L) return src;
  const hay = src.toLowerCase();
  let at = -1;
  for (const t of ragTokenize(query).filter((t) => !RAG_STOP.has(t))) {
    const i = hay.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - Math.floor(L / 3));
  return (
    (start > 0 ? "…" : "") +
    src.slice(start, start + L) +
    (start + L < src.length ? "…" : "")
  );
}

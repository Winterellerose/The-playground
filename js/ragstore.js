"use strict";
/* ═══ ragstore.js — IndexedDB persistence for indexed documents ═══
   Two object stores:
     docs  — metadata records {id, name, size, chunks, addedAt, chatId}
     parts — one record per chunk {id: `${docId}:${n}`, docId, n, text}
   Chunk text lives here, never in localStorage (which is capped and already
   carries chat history). Everything degrades gracefully: if IndexedDB is
   unavailable (private mode, disabled storage) RAG simply reports
   unavailable and the rest of the app is untouched. */

const RAG_DB_NAME = "playground-rag";
const RAG_DB_VERSION = 1;
const RAG_MAX_DOCS = 12;
const RAG_MAX_TOTAL_BYTES = 24 * 1024 * 1024; // 24 MB of raw text across docs

let ragDbPromise = null;

function ragAvailable() {
  try {
    return typeof indexedDB !== "undefined" && !!indexedDB;
  } catch {
    return false;
  }
}

function ragOpenDb() {
  if (!ragAvailable()) return Promise.reject(new Error("IndexedDB unavailable"));
  if (ragDbPromise) return ragDbPromise;
  ragDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(RAG_DB_NAME, RAG_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("docs")) {
        const s = db.createObjectStore("docs", { keyPath: "id" });
        s.createIndex("chatId", "chatId", { unique: false });
      }
      if (!db.objectStoreNames.contains("parts")) {
        const s = db.createObjectStore("parts", { keyPath: "id" });
        s.createIndex("docId", "docId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  }).catch((e) => {
    ragDbPromise = null; // allow retry on a later call
    throw e;
  });
  return ragDbPromise;
}

/* Small promisified helpers. */
function ragReq(store, mode, fn) {
  return ragOpenDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const out = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
        tx.onerror = () => reject(tx.error || new Error("IndexedDB error"));
        tx.onabort = () => reject(tx.error || new Error("IndexedDB aborted"));
      })
  );
}
const ragGetAll = (store) => ragReq(store, "readonly", (s) => s.getAll());
const ragPut = (store, val) => ragReq(store, "readwrite", (s) => s.put(val));

/* Persist doc metadata + all chunk texts in one transaction. */
async function ragSaveDoc(doc, chunks) {
  const db = await ragOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["docs", "parts"], "readwrite");
    tx.objectStore("docs").put(doc);
    const parts = tx.objectStore("parts");
    chunks.forEach((c) => parts.put({ id: doc.id + ":" + c.i, docId: doc.id, n: c.i, text: c.text }));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
  });
}

/* Load metadata list, newest first. */
async function ragListDocs() {
  try {
    const docs = await ragGetAll("docs");
    return (docs || []).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  } catch {
    return [];
  }
}

/* Full doc → {doc, chunks:[{i,text}]}. */
async function ragLoadDoc(id) {
  const db = await ragOpenDb();
  const doc = await new Promise((resolve, reject) => {
    const tx = db.transaction(["docs", "parts"], "readonly");
    const d = tx.objectStore("docs").get(id);
    const all = [];
    const idx = tx.objectStore("parts").index("docId");
    idx.openCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) {
        all.push({ i: cur.value.n, text: cur.value.text });
        cur.continue();
      }
    };
    tx.oncomplete = () => resolve({ doc: d.result, chunks: all });
    tx.onerror = () => reject(tx.error || new Error("IndexedDB read failed"));
  });
  if (!doc.doc) return null;
  doc.chunks.sort((a, b) => a.i - b.i);
  return doc;
}

/* Delete one doc and its parts. */
async function ragDeleteDoc(id) {
  const db = await ragOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["docs", "parts"], "readwrite");
    tx.objectStore("docs").delete(id);
    const idx = tx.objectStore("parts").index("docId");
    idx.openCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) {
        cur.delete();
        cur.continue();
      }
    };
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
  });
}

/* Usage summary for the manager UI. */
async function ragUsage() {
  const docs = await ragListDocs();
  const bytes = docs.reduce((n, d) => n + (Number(d.size) || 0), 0);
  const chunks = docs.reduce((n, d) => n + (Number(d.chunks) || 0), 0);
  return { docs, bytes, chunks, maxDocs: RAG_MAX_DOCS, maxBytes: RAG_MAX_TOTAL_BYTES };
}

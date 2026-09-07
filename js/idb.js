"use strict";
/* ═══ idb.js — attachment + full chat history store (IndexedDB migration) ═══
   v2: DB "playground-attachments" (kept for compat) now has two stores:
     - "attachments": image data URLs (existing)
     - "chats": full chat objects keyed by id (new, quota-free)

   Why: localStorage is capped at ~5-10MB and throws on quota. IndexedDB
   gives us hundreds of MB to GBs, so users never lose history.

   Migration: on first load, chats are read from IndexedDB. If empty,
   we fall back to localStorage "chat_history", then bulk-migrate to IDB
   and remove the localStorage copy.
*/

const IDB_ATTACH_LIMIT = 300 * 1024;
const IDB_DB_NAME = "playground-attachments";
const IDB_DB_VERSION = 2;
let idbWarned = false;
let dbPromise = null;

function idbWarn() {
  if (!idbWarned) {
    idbWarned = true;
    logRot("IndexedDB unavailable — large images remain in localStorage", "warn");
  }
}

function idbOpen() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("unavailable"));
    const r = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("attachments")) {
        db.createObjectStore("attachments");
      }
      if (!db.objectStoreNames.contains("chats")) {
        db.createObjectStore("chats", { keyPath: "id" });
      }
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    r.onerror = () => {
      dbPromise = null;
      reject(r.error);
    };
    r.onblocked = () => {
      // Another tab has old version open — close and retry will happen on next call
      try { r.result && r.result.close(); } catch {}
    };
  });
  return dbPromise;
}

/* ── Attachments (existing) ── */
async function idbPut(id, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction("attachments", "readwrite");
    t.objectStore("attachments").put(value, id);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("transaction aborted"));
  });
}

async function idbGet(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction("attachments", "readonly");
    const r = t.objectStore("attachments").get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    t.onabort = () => reject(t.error || new Error("transaction aborted"));
  });
}

async function idbDelete(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction("attachments", "readwrite");
    t.objectStore("attachments").delete(id);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("transaction aborted"));
  });
}

/* ── Chats (new, full history) ── */
async function idbChatsGetAll() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction("chats", "readonly");
    const store = t.objectStore("chats");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    t.onabort = () => reject(t.error || new Error("transaction aborted"));
  });
}

async function idbChatGet(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction("chats", "readonly");
    const r = t.objectStore("chats").get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    t.onabort = () => reject(t.error || new Error("transaction aborted"));
  });
}

async function idbChatPut(chat) {
  if (!chat || !chat.id) return;
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction("chats", "readwrite");
    t.objectStore("chats").put(chat);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("transaction aborted"));
  });
}

async function idbChatsBulkPut(chatsArr) {
  if (!Array.isArray(chatsArr) || !chatsArr.length) return;
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction("chats", "readwrite");
    const store = t.objectStore("chats");
    for (const c of chatsArr) {
      if (c && c.id) store.put(c);
    }
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("transaction aborted"));
  });
}

async function idbChatDelete(id) {
  if (!id) return;
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction("chats", "readwrite");
    t.objectStore("chats").delete(id);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("transaction aborted"));
  });
}

async function idbChatsClear() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const t = db.transaction("chats", "readwrite");
    t.objectStore("chats").clear();
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("transaction aborted"));
  });
}

/* ── Helpers for attachment refs ── */
function idbRef(x) {
  return (
    x &&
    typeof x === "object" &&
    typeof x.idb === "string" &&
    /^image\/[\w+.-]+$/.test(x.mime || "") &&
    typeof x.name === "string" &&
    x.name.length <= 160
  );
}

async function moveLargeImages(chat) {
  for (const m of chat.messages || []) {
    for (let i = 0; i < (m.images || []).length; i++) {
      const x = m.images[i];
      if (typeof x !== "string" || x.length < IDB_ATTACH_LIMIT || !x.startsWith("data:image/"))
        continue;
      try {
        const mime = (/^data:([^;,]+)/.exec(x) || [])[1] || "image/jpeg";
        const id = crypto.randomUUID();
        await idbPut(id, x);
        m.images[i] = { idb: id, mime, name: "image" };
      } catch {
        idbWarn();
        return;
      }
    }
  }
}

async function hydrateImages(chat) {
  for (const m of chat.messages || []) {
    for (let i = 0; i < (m.images || []).length; i++) {
      if (idbRef(m.images[i])) {
        try {
          const data = await idbGet(m.images[i].idb);
          if (typeof data === "string") m.images[i] = data;
          else m.images.splice(i--, 1);
        } catch {
          idbWarn();
          m.images.splice(i--, 1);
        }
      }
    }
  }
}

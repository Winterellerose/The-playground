"use strict";
/* ═══ idb.js — small, optional attachment store ═══ */
const IDB_ATTACH_LIMIT = 300 * 1024;
let idbWarned = false;
function idbWarn() { if (!idbWarned) { idbWarned = true; logRot("IndexedDB unavailable — large images remain in localStorage", "warn"); } }
function idbOpen() { return new Promise((resolve, reject) => { if (!window.indexedDB) return reject(Error("unavailable")); const r = indexedDB.open("playground-attachments", 1); r.onupgradeneeded = () => r.result.createObjectStore("attachments"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
async function idbPut(id, value) { const db = await idbOpen(); return new Promise((resolve,reject) => { const t=db.transaction("attachments","readwrite"); t.objectStore("attachments").put(value,id); t.oncomplete=resolve; t.onerror=()=>reject(t.error); }); }
async function idbGet(id) { const db = await idbOpen(); return new Promise((resolve,reject) => { const r=db.transaction("attachments").objectStore("attachments").get(id); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); }); }
async function idbDelete(id) { const db = await idbOpen(); return new Promise((resolve,reject) => { const t=db.transaction("attachments","readwrite"); t.objectStore("attachments").delete(id); t.oncomplete=resolve; t.onerror=()=>reject(t.error); }); }
function idbRef(x) { return x && typeof x === "object" && typeof x.idb === "string" && /^image\/[\w+.-]+$/.test(x.mime || "") && typeof x.name === "string" && x.name.length <= 160; }
async function moveLargeImages(chat) { for (const m of chat.messages || []) for (let i=0; i<(m.images||[]).length; i++) { const x=m.images[i]; if (typeof x !== "string" || x.length < IDB_ATTACH_LIMIT || !x.startsWith("data:image/")) continue; try { const mime=(/^data:([^;,]+)/.exec(x)||[])[1]||"image/jpeg", id=crypto.randomUUID(); await idbPut(id,x); m.images[i]={idb:id,mime,name:"image"}; } catch { idbWarn(); return; } } }
async function hydrateImages(chat) { for (const m of chat.messages || []) for (let i=0; i<(m.images||[]).length; i++) if (idbRef(m.images[i])) { try { const data=await idbGet(m.images[i].idb); if (typeof data === "string") m.images[i]=data; else m.images.splice(i--,1); } catch { idbWarn(); m.images.splice(i--,1); } } }
/* Resolve IndexedDB image refs on a COPY of wire history. The request builder
   needs data-URL strings, but the live chat objects must keep their refs
   (that's what keeps localStorage small). Images that can't be recovered are
   dropped with a warning instead of being sent as garbage — wireHist would
   otherwise serialize the ref object itself into the request. */
async function hydrateHistImages(hist) {
  const out = hist.map((m) => (m.images ? { ...m, images: m.images.slice() } : m));
  for (const m of out) {
    if (!m.images) continue;
    const resolved = [];
    for (const img of m.images) {
      if (!idbRef(img)) {
        resolved.push(img);
        continue;
      }
      try {
        const data = await idbGet(img.idb);
        if (typeof data === "string" && data) resolved.push(data);
        else logRot("Stored image unavailable — dropped from this request", "warn");
      } catch {
        logRot("Stored image unavailable — dropped from this request", "warn");
      }
    }
    m.images = resolved;
  }
  return out;
}

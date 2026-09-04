"use strict";
/* ═══ app.js — landing, sidebar chrome, boot ═══ */

function dismissLanding() {
  if (landingDismissed) return;
  landingDismissed = true;
  $("landing").classList.add("fading");
  setTimeout(() => ($("landing").style.display = "none"), 450);
  userInput.focus();
}

function sidebarExpanded() {
  const sb = $("sidebar");
  if (!sb) return false;
  if (window.innerWidth <= 700) return sb.classList.contains("open");
  return !sb.classList.contains("collapsed");
}
function syncHamburger() {
  const h = document.querySelector(".hamburger");
  if (h) h.setAttribute("aria-expanded", sidebarExpanded() ? "true" : "false");
}
function toggleSidebar() {
  const sb = $("sidebar");
  if (window.innerWidth <= 700) {
    sb.classList.toggle("open");
    $("sidebarOverlay").classList.toggle("show");
  } else {
    sb.classList.toggle("collapsed");
    localStorage.setItem(
      "sidebar_collapsed",
      sb.classList.contains("collapsed"),
    );
  }
  syncHamburger();
}
function closeSidebar() {
  const sb = $("sidebar");
  sb.classList.remove("open");
  $("sidebarOverlay").classList.remove("show");
  syncHamburger();
}
function toggleDesktopSidebar() {
  if (window.innerWidth <= 700) return;
  const sb = $("sidebar");
  sb.classList.toggle("collapsed");
  localStorage.setItem("sidebar_collapsed", sb.classList.contains("collapsed"));
  syncHamburger();
}
window.addEventListener("resize", () => {
  const sb = $("sidebar");
  if (window.innerWidth > 700) {
    sb.classList.remove("open");
    $("sidebarOverlay").classList.remove("show");
    sb.classList.toggle(
      "collapsed",
      localStorage.getItem("sidebar_collapsed") === "true",
    );
  }
  syncHamburger();
});

(function init() {
  bindEvents();
  loadCustomModels();
  // Self-heal: drop saved entries that no longer register (bad provider,
  // corrupt shape) so a broken add can never wedge the list across reloads.
  const hadJunk =
    customModels.length !==
    customModels.filter((c) => MODELS[c.id]?.custom === true).length;
  if (hadJunk) {
    customModels = customModels.filter((c) => MODELS[c.id]?.custom === true);
    saveCustomModels();
  }
  if (!selectedModel || !MODELS[selectedModel])
    selectedModel = pickDefaultModel();
  buildKeyInputs();
  loadAll();
  const sb = $("sidebar");
  if (
    window.innerWidth > 700 &&
    localStorage.getItem("sidebar_collapsed") === "true"
  )
    sb.classList.add("collapsed");
  syncHamburger();
  selectModel(selectedModel, false);
  renderSidebar();
  if (activeChatId && getActiveChat()) loadChat(activeChatId);
  else resetWelcome();
  syncChatPromptUI();
  initImageDrop();
  syncSearchUI();
  setAttachUI();
  refreshCatalog().then(refreshNativeCatalogs);
  setInterval(() => {
    refreshCatalog().then(refreshNativeCatalogs);
  }, 10 * 60e3);
  const nKeys = KEY_DEFS.filter(([pid]) => getKey(pid)).length;
  logRot(
    nKeys
      ? nKeys + " key(s) loaded"
      : "No keys yet — add a free OpenRouter key to start",
    nKeys ? "ok" : "warn",
  );
  if (!nKeys) setTimeout(openSettings, 1600);
})();

if (window.SpeechRecognition || window.webkitSpeechRecognition) { const b=$("micBtn"); if(b) b.hidden=false; }

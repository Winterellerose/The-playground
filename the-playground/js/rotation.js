'use strict';
/* ═══ rotation.js — provider rotation, backoff, getCfg ═══ */

/* ── Rotation engine ── */
function logRot(msg,type='evt'){
  const log=$('rotLog');if(!log)return;
  const now=new Date(),t=[now.getHours(),now.getMinutes(),now.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':');
  const e=document.createElement('div');e.className='rot-entry';
  e.innerHTML=`<span class="rot-time">${t}</span><span class="rot-evt ${type}">${esc(msg)}</span>`;
  log.appendChild(e);log.scrollTop=log.scrollHeight;
  while(log.children.length>25)log.removeChild(log.firstChild);
}
function avail(pid){const s=rotState[pid];if(!s)return true;if(s.bad)return false;if(s.backoffUntil&&Date.now()<s.backoffUntil)return false;return true}
function markRateLimited(pid){const s=rotState[pid]=(rotState[pid]||{errors:0});s.errors=(s.errors||0)+1;const sec=Math.min(30*Math.pow(2,s.errors-1),120);s.backoffUntil=Date.now()+sec*1000;logRot(`${REG[pid].name} rate-limited → backing off ${sec}s`,'warn')}
function markBadKey(pid){rotState[pid]={...(rotState[pid]||{}),bad:true};refreshKeyUI();logRot(`${REG[pid].name}: key rejected (401/403) — fix it in Settings`,'err')}
function markOk(pid){const s=rotState[pid];if(s){s.errors=0;s.backoffUntil=0}}
const OR_STYLE=['openrouter','openrouter_paid'];
const OR_HOSTABLE=/^[a-z0-9~-][a-z0-9._~-]*\/[a-z0-9._~-]+$/i;
function canServe(pid,m){if(pid===m.provider)return true;if(OR_STYLE.includes(pid)&&OR_HOSTABLE.test(m.apiId))return true;return false}
function idFor(pid,m){if(pid===m.provider)return m.apiId;if(OR_STYLE.includes(pid)&&OR_HOSTABLE.test(m.apiId))return m.apiId;return FALLBACK_ID[pid]||m.apiId}
function getCfg(excludedPids=[]){
  const m=MODELS[selectedModel];if(!m)return{error:'Select a model.'};
  const pool=REG[m.provider].type==='free'?FREE_PIDS:PAID_PIDS;
  const excluded=new Set(excludedPids||[]);
  let cands=[];
  const push=pid=>{if(!excluded.has(pid)&&!cands.includes(pid)&&getKey(pid)&&avail(pid)&&canServe(pid,m))cands.push(pid)};
  push(m.provider);
  OR_STYLE.forEach(push);           // same exact id via OpenRouter
  pool.forEach(push);               // provider-native fallback models
  [...PAID_PIDS,...FREE_PIDS].forEach(push); // last resort
  if(!cands.length){
    // There ARE providers for this model, but every key is missing/bad/limited.
    const haveKey=KEY_DEFS.some(([pid])=>getKey(pid));
    if(!haveKey)return{error:'No API keys configured. Open Settings and add at least one free key (OpenRouter recommended).'};
    const canHost=Object.keys(REG).filter(p=>canServe(p,m));
    const missing=canHost.filter(p=>!getKey(p));
    if(missing.length)return{error:`"${m.name}" needs ${missing.map(p=>REG[p].name).join(' or ')} — add that key in Settings, or pick a model you have a key for.`};
    return{error:`All providers for "${m.name}" are rate-limited or rejected the request. Free tiers can be busy — wait a moment, pick another free model, or add a paid key.`};
  }
  const pid=cands[0],prov=REG[pid];
  if(pid!==m.provider)logRot(`Routing ${m.badge||m.apiId} via ${prov.name} → ${idFor(pid,m)}`,prov.type==='free'?'ok':'warn');
  return{model:m,pid,modelId:idFor(pid,m),apiKey:getKey(pid),
    thinking:$('thinkingToggle').classList.contains('on'),
    effort:$('effortSelect').value,temp:parseFloat($('tempSelect').value),
    maxTok:Math.max(256,parseInt($('maxTok').value)||8192),
    sys:$('sysPrompt').value.trim(),
    chatSys:chatSysText(),
    webSearch:webSearchMode};
}


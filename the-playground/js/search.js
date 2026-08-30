'use strict';
/* ═══ search.js — web search (Tavily / Serper / Brave) ═══ */

/* ── Web search (Google Custom Search JSON API) ──
   Modes: off | auto | on. 'auto' searches automatically when your
   question looks like it needs current info (dates, "latest", news,
   prices, versions, scores, etc.). Needs a free Google API key + a
   Custom Search Engine ID (100 searches/day free). Configure in Settings. */
function webNeedsSearch(q){
  const t=String(q||'').toLowerCase();
  if(t.length<4)return false;
  const year=new Date().getFullYear();
  return /\b(latest|recent(ly)?|current(ly)?|today|tonight|right now|as of|news|update[d]?|this (year|week|month)|last (night|week|month|year)|next (week|month|year)|price[sd]?|cost|release[d]?|launch(ed)?|version|score[sd]?|result[s]?|who won|election|weather|forecast|stock|standings|schedule|obituary|died|breaking)\b/.test(t)
    || new RegExp('\\b(20[0-9]{2}|'+year+')\\b').test(t)
    || /\b(how (old|tall|much|many)|when (is|was|did|does)|where (is|was|are)|what(?:'s| is| are) (the |a )?(new|latest|current|next|today))\b/.test(t);
}
function toggleWebSearch(){
  webSearchMode=webSearchMode==='off'?'auto':webSearchMode==='auto'?'on':'off';
  localStorage.setItem('pg_web_search',webSearchMode);
  syncSearchUI();
  logRot('Web search: '+webSearchMode.toUpperCase()+(webSearchMode==='auto'?' (searches for recent/current topics)':''),'ok');
}
function syncSearchUI(){
  const b=$('webSearchToggle'),s=$('webSearchState');if(!b)return;
  const on=webSearchMode!=='off';
  b.classList.toggle('on',on);
  b.classList.toggle('auto',webSearchMode==='auto');
  s.textContent=webSearchMode==='on'?'ON':webSearchMode==='auto'?'AUTO':'OFF';
  b.setAttribute('aria-pressed',on?'true':'false');
  b.setAttribute('aria-label','Web search: '+(webSearchMode==='off'?'OFF':webSearchMode==='auto'?'AUTO (recent topics)':'ON')+'. Click to cycle OFF / AUTO / ON.');
}

/* ── Live web search — multi-provider (Tavily / Serper / Brave) ──
   All three are CORS-enabled with free tiers and official JSON APIs,
   so no single service shutting down breaks search. 'auto' tries each
   configured provider in order until one returns results.
   Get keys: tavily.com · serper.dev · brave.com/search/api */
const SEARCH_PROVIDERS={
  tavily:{name:'Tavily',url:'https://api.tavily.com/search',max:8,key:'pg_search_tavily_key'},
  serper:{name:'Serper',url:'https://google.serper.dev/search',max:8,key:'pg_search_serper_key'},
  brave:{name:'Brave',url:'https://api.search.brave.com/res/v1/web/search',max:8,key:'pg_search_brave_key'}
};
async function searchTavily(q,key,signal){
  const res=await fetch(SEARCH_PROVIDERS.tavily.url,{method:'POST',signal,
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({api_key:key,query:q,max_results:SEARCH_PROVIDERS.tavily.max,
      search_depth:'basic',include_answer:false})});
  if(!res.ok)throw new Error('Tavily '+res.status);
  const j=await res.json();
  return (j.results||[]).map(r=>({title:r.title||'',url:r.url||'',
    snippet:(r.content||'').replace(/\s+/g,' ').trim()})).filter(r=>r.url);
}
async function searchSerper(q,key,signal){
  const res=await fetch(SEARCH_PROVIDERS.serper.url,{method:'POST',signal,
    headers:{'X-API-KEY':key,'Content-Type':'application/json'},
    body:JSON.stringify({q,num:SEARCH_PROVIDERS.serper.max})});
  if(!res.ok)throw new Error('Serper '+res.status);
  const j=await res.json();
  return (j.organic||[]).map(r=>({title:r.title||'',url:r.link||'',
    snippet:(r.snippet||'').replace(/\s+/g,' ').trim()})).filter(r=>r.url);
}
async function searchBrave(q,key,signal){
  const url=SEARCH_PROVIDERS.brave.url+'?q='+encodeURIComponent(q)+'&count='+SEARCH_PROVIDERS.brave.max;
  const res=await fetch(url,{signal,headers:{'X-Subscription-Token':key,'Accept':'application/json'}});
  if(!res.ok)throw new Error('Brave '+res.status);
  const j=await res.json();
  return (j.web?.results||[]).map(r=>({title:r.title||'',url:r.url||'',
    snippet:(r.description||'').replace(/\s+/g,' ').trim()})).filter(r=>r.url);
}
const SEARCH_IMPL={tavily:searchTavily,serper:searchSerper,brave:searchBrave};
async function runSearch(provider,q,signal){
  const p=SEARCH_PROVIDERS[provider];if(!p)return [];
  const key=(localStorage.getItem(p.key)||'').trim();
  if(!key)return [];
  return SEARCH_IMPL[provider](q,key,signal);
}
// Try configured providers in order; 'auto' uses tavily,serper,brave.
async function webSearch(query,signal){
  const q=String(query||'').replace(/\s+/g,' ').trim();
  if(!q)return [];
  const chosen=(localStorage.getItem('pg_search_provider')||'auto').trim();
  const order=chosen==='auto'?['tavily','serper','brave']:[chosen];
  let lastErr='';
  for(const prov of order){
    try{
      const r=await runSearch(prov,q,signal);
      if(r&&r.length){logRot(`🌐 Web search: ${r.length} results via ${SEARCH_PROVIDERS[prov].name}`,'ok');return r;}
    }catch(e){lastErr=e.message;}
  }
  const haveAny=Object.values(SEARCH_PROVIDERS).some(p=>(localStorage.getItem(p.key)||'').trim());
  if(!haveAny)logRot('🌐 Web search: add a free Tavily/Serper/Brave key in Settings → Web Search','warn');
  else if(lastErr)logRot('🌐 Web search failed across providers ('+lastErr+')','warn');
  return [];
}
// Generic entry point used by the streaming pipeline.
async function freeWebSearch(query,signal){
  try{return await webSearch(query,signal);}
  catch(e){logRot('🌐 Web search error: '+e.message,'warn');return [];}
}
function composeSys(cfg){
  const bits=[`Today is ${nowStamp()}. Treat this as the current date and time.`];
  if(cfg&&cfg.sys)bits.push(cfg.sys);
  // Per-chat prompt goes AFTER the global one so it takes precedence on conflict,
  // while both still apply — that's the whole point of layering instead of replacing.
  if(cfg&&cfg.chatSys)bits.push('THIS CONVERSATION\'S INSTRUCTIONS (applies to this chat only — where they conflict with anything above, follow these):\n'+cfg.chatSys);
  if(cfg&&cfg.webContext)bits.push(cfg.webContext);
  return bits.join('\n\n');
}
function formatWebContext(srcs){
  if(!srcs||!srcs.length)return '';
  const lines=srcs.map((s,i)=>`${i+1}. ${s.title}\n   ${s.url}${s.snippet?'\n   '+s.snippet:''}`);
  return 'LIVE SEARCH CONTEXT (fetched just now — use these current sources to answer; cite them):\n'+lines.join('\n\n');
}
function sourcesHtml(srcs){
  if(!srcs||!srcs.length)return '';
  const links=srcs.map(s=>({...s,safeUrl:safeWebUrl(s&&s.url)})).filter(s=>s.safeUrl);
  if(!links.length)return '';
  return `<div class="msg-sources"><span class="src-label">🌐 Web</span>${links.map(s=>`<a href="${esc(s.safeUrl)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title||s.safeUrl)}">${esc(s.title||s.safeUrl)}</a>`).join('')}</div>`;
}


'use strict';
/* ═══ api.js — provider request builders + history mapping ═══ */

/* ── Request builders ── */
function mapEffort(e,pid){
  if(pid==='deepseek')return e==='low'?'low':e==='max'?'max':'high';
  return(e==='max'||e==='xhigh')?'high':e;
}
function applyReasoning(rb,pid,cfg,m){
  const capable=m.thinking===true&&!m.adaptive; // only models that actually support manual thinking
  const on=cfg.thinking&&capable;
  const st=REG[pid].style;
  if(st==='ds'){rb.thinking={type:on?'enabled':'disabled'};if(on)rb.reasoning_effort=mapEffort(cfg.effort,pid);return true}
  if(!on)return false;
  if(st==='or')rb.reasoning={effort:mapEffort(cfg.effort,pid)};
  else if(st==='openai')rb.reasoning_effort=mapEffort(cfg.effort,pid);
  else if(st==='gemini')rb.reasoning_effort=mapEffort(cfg.effort,pid);
  return true;
}
function buildRequest(cfg,hist){
  const{pid,model:m}=cfg;const st=REG[pid].style;
  const wire=wireHist(hist,cfg);
  const sys=composeSys(cfg);
  if(st==='anthropic'){
    const h={'Content-Type':'application/json','x-api-key':cfg.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'};
    const rb={model:cfg.modelId,max_tokens:cfg.maxTok,stream:true,messages:wire};
    if(sys)rb.system=sys;
    if(m.adaptive){/* adaptive models manage thinking themselves; no temp */}
    else if(cfg.thinking&&m.thinking===true){rb.thinking={type:'enabled',budget_tokens:Math.min(10240,Math.max(2048,cfg.maxTok-2048))}}
    else rb.temperature=cfg.temp;
    return{h,rb};
  }
  const h={'Content-Type':'application/json','Authorization':'Bearer '+cfg.apiKey};
  const rb={model:cfg.modelId,messages:sys?[{role:'system',content:sys},...wire]:wire,stream:true};
  if(pid==='openai')rb.max_completion_tokens=cfg.maxTok;else rb.max_tokens=cfg.maxTok;
  if(REG[pid].usage)rb.stream_options={include_usage:true};
  const reasoningOn=applyReasoning(rb,pid,cfg,m);
  const lockTemp=(st==='openai'&&reasoningOn)||(st==='or'&&m.noTemp)||(m.noTemp);
  if(!lockTemp)rb.temperature=cfg.temp;
  if(REG[pid].hdr)Object.assign(h,REG[pid].hdr());
  return{h,rb};
}
/* maps stored history to each provider's wire format; images ride along on vision models */
function wireHist(hist,cfg){
  const st=REG[cfg.pid].style;
  const useImg=!!(cfg.model&&cfg.model.vision)&&st!=='ds'; // no image format for ds-style providers
  return hist.map(x=>{
    const text=x.role==='user'?userContentWithFiles(x.content,x.files):x.content;
    const imgs=useImg&&x.role==='user'&&x.images&&x.images.length?x.images.slice(0,MAX_IMGS):[];
    if(!imgs.length)return {role:x.role,content:text};
    if(st==='anthropic')return {role:'user',content:[
      ...imgs.map(u=>{const g=/^data:(image\/[a-z+.-]+);base64,(.*)$/s.exec(u);return {type:'image',source:{type:'base64',media_type:g?g[1]:'image/jpeg',data:g?g[2]:''}}}),
      {type:'text',text:text}]};
    return {role:'user',content:[{type:'text',text:text},...imgs.map(u=>({type:'image_url',image_url:{url:u}}))]};
  });
}
function cleanHistory(c,targetIdx){
  return c.messages.slice(0,targetIdx)
    .filter(x=>(x.role==='user'&&((x.content&&x.content.trim())||(x.images&&x.images.length)||(x.files&&x.files.length)))||(x.role==='assistant'&&((x.content||'').trim()||(x.thinking||'').trim())))
    .slice(-60)
    .map(x=>{const o={role:x.role,content:x.content||''};if(x.role==='user'&&x.images&&x.images.length)o.images=x.images;if(x.role==='user'&&x.files&&x.files.length)o.files=x.files;return o});
}


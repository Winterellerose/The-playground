import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { pathToFileURL } from 'node:url';

export function updateModels(source, catalog) {
  if (!Array.isArray(catalog?.data) || !catalog.data.length) throw Error('Empty or invalid catalog; refusing update');
  const models = runInNewContext(source + '\nMODELS;', { window: {} });
  const start = source.indexOf('  /* ── OpenRouter free ── */');
  const end = source.indexOf('  /* ── Groq ── */', start);
  if (start < 0 || end < 0) throw Error('Catalog section boundaries missing');
  const old = new Map(Object.entries(models).filter(([, m]) => m.group === 'or_free').map(([id, m]) => [m.apiId, [id, m]]));
  const free = catalog.data.filter(m => typeof m.id === 'string' && m.id.endsWith(':free'));
  if (!free.length) throw Error('No free models; refusing destructive update');
  const seen = new Set();
  const entries = free.sort((a, b) => a.id.localeCompare(b.id)).map(m => {
    if (seen.has(m.id)) throw Error('Duplicate catalog ID');
    seen.add(m.id);
    const previous = old.get(m.id);
    const id = previous?.[0] || 'or-' + createHash('sha256').update(m.id).digest('hex').slice(0, 16);
    const model = previous ? { ...previous[1] } : {
      name: m.name || m.id, badge: (m.name || m.id).slice(0, 12), group: 'or_free',
      provider: 'openrouter', apiId: m.id, isFree: true, intel: 3, ctx: '—', desc: 'Free via OpenRouter.',
    };
    if (Number.isFinite(m.context_length) && m.context_length > 0) model.ctx = String(m.context_length);
    if (Array.isArray(m.architecture?.input_modalities)) model.vision = m.architecture.input_modalities.includes('image');
    return `  ${JSON.stringify(id)}: ${JSON.stringify(model, null, 2)},`;
  });
  const updated = source.slice(0, start) + '  /* ── OpenRouter free ── */\n' + entries.join('\n') + '\n' + source.slice(end);
  runInNewContext(updated, { window: {} }); // Validate before touching source.
  return updated;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const catalog = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const path = 'js/config.js';
  writeFileSync(path, updateModels(readFileSync(path, 'utf8'), catalog));
}

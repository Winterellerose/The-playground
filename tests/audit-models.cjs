/* Curated OpenRouter IDs are deliberately listed by provider in config. Network failures warn only. */
const https = require('https'),
  fs = require('fs');
https
  .get('https://openrouter.ai/api/v1/models', r => {
    let s = '';
    r.on('data', x => (s += x));
    r.on('end', () => {
      try {
        const have = new Set(JSON.parse(s).data.map(x => x.id));
        const src = fs.readFileSync('js/config.js', 'utf8');
        const entries = [
          ...src.matchAll(/provider:\s*["'](openrouter(?:_paid)?)["'][\s\S]{0,700}?apiId:\s*["']([^"']+)/g),
        ]
          .map(x => x[2])
          .filter(x => !x.startsWith('~'));
        const bad = entries.filter(x => !have.has(x));
        if (bad.length) {
          console.error('catalog drift:', bad.join(', '));
          process.exit(1);
        }
      } catch (e) {
        console.error('model audit failed:', e.message);
        process.exitCode = 2;
      }
    });
  })
  .on('error', e => { console.error('model audit failed (network):', e.message); process.exitCode = 2; })
  .setTimeout(30000, function () { this.destroy(new Error('Catalog request timed out')); });

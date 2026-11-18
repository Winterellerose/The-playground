const { execFileSync } = require('child_process'),
  fs = require('fs');
execFileSync(process.execPath, ['tests/no-inline-handlers.cjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tests/provider-semantics.cjs'], { stdio: 'inherit' });
for (const f of fs.readdirSync('js').filter(f => f.endsWith('.js')))
  execFileSync(process.execPath, ['--check', 'js/' + f], { stdio: 'inherit' });
execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });

#!/usr/bin/env node
'use strict';
/* ═══ verify-vendor.js — ensure vendored libs match npm artifacts ═══
   Run: npm run verify:vendor
   Fails if any vendor file diverges from its locked npm version.
   Cross-platform: uses Node.js built-ins + tar package. */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { extract } from 'tar';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VENDOR_DIR = join(ROOT, 'js', 'vendor');
const LOCK_FILE = join(ROOT, 'vendor-lock.json');

const VENDORS = [
  { name: 'marked', file: 'marked.umd.js', pkg: 'marked@15.0.7', extract: 'lib/marked.umd.js' },
  { name: 'dompurify', file: 'purify.min.js', pkg: 'dompurify@3.4.18', extract: 'dist/purify.min.js' },
  // highlight.js: npm package has source only; built min is generated at release
  // CSS theme is included in npm package
  {
    name: 'highlight.js-css',
    file: 'github-dark-dimmed.min.css',
    pkg: 'highlight.js@11.11.1',
    extract: 'styles/github-dark-dimmed.min.css',
  },
];

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function fetchNpmFile(pkg, extractPath) {
  const tmpDir = join(ROOT, '.vendor-tmp', pkg.split('@')[0]);
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  // npm pack outputs tarball to the pack destination
  const packOutput = execSync(`npm pack "${pkg}" --pack-destination "${tmpDir}"`, {
    encoding: 'utf8',
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

  const tgzName = packOutput.split('\n').pop().trim();
  const tgzPath = join(tmpDir, tgzName);

  // Extract all files (tar.extract doesn't support filter reliably across versions)
  await extract({
    file: tgzPath,
    cwd: tmpDir,
  });

  // The tarball extracts to package/ subdirectory
  const extractedPath = join(tmpDir, 'package', extractPath);
  if (!existsSync(extractedPath)) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw new Error(`File not found in package: ${extractPath}`);
  }

  const buf = readFileSync(extractedPath);
  rmSync(tmpDir, { recursive: true, force: true });
  return buf;
}

async function main() {
  console.log('Verifying vendored libraries...\n');

  let hasError = false;
  const lockData = {};

  for (const v of VENDORS) {
    const localPath = join(VENDOR_DIR, v.file);
    if (!existsSync(localPath)) {
      console.error(`❌ ${v.name}: MISSING — ${localPath}`);
      hasError = true;
      continue;
    }

    const localBuf = readFileSync(localPath);
    const localHash = sha256(localBuf);
    lockData[v.name] = { file: v.file, sha256: localHash, version: v.pkg.split('@')[1] };

    // Fetch the npm artifact and compare
    let npmHash;
    try {
      const npmBuf = await fetchNpmFile(v.pkg, v.extract);
      npmHash = sha256(npmBuf);
    } catch (e) {
      console.error(`❌ ${v.name}: Failed to fetch npm artifact — ${e.message}`);
      hasError = true;
      continue;
    }

    if (localHash === npmHash) {
      console.log(`✅ ${v.name} (${v.pkg.split('@')[1]}) — MATCH`);
    } else {
      console.error(`❌ ${v.name}: DIVERGED from npm`);
      console.error(`   Local:  ${localHash}`);
      console.error(`   NPM:    ${npmHash}`);
      hasError = true;
    }
  }

  // Write/update lock file
  writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2));
  console.log(`\n📝 Lock file written: ${LOCK_FILE}`);

  if (hasError) {
    console.error('\n⚠️  Vendor verification FAILED');
    console.error('Run: npm install marked@15.0.7 dompurify@3.4.18 highlight.js@11.11.1');
    console.error('Then copy files from node_modules to js/vendor/');
    process.exit(1);
  }

  console.log('\n✅ All vendored libraries match npm artifacts');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

// Upload a store PDF to Vercel Blob and record its URL in data/store-blobs.json.
//
// Usage:   node scripts/upload-book.mjs <sku> "<path-to-pdf>"
// Example: node scripts/upload-book.mjs infantry-11-series "C:/Users/vince/Downloads/Veteran_Career_Path_Infantry_11_Series_Career_Handbook.pdf"
//
// Requires BLOB_READ_WRITE_TOKEN in the environment (from your Vercel Blob store).
//   PowerShell:  $env:BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."; node scripts/upload-book.mjs ...
//   bash:        BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..." node scripts/upload-book.mjs ...
//
// The blob is stored with a random suffix (unguessable URL) and served only via
// /api/store-download after payment verification, so the URL is never exposed to buyers.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { put } from '@vercel/blob';

const require = createRequire(import.meta.url);
const { getProduct } = require('../api/_lib/store-catalog.js');

const here = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = resolve(here, '../data/store-blobs.json');

async function main() {
  const [sku, pdfPath] = process.argv.slice(2);
  if (!sku || !pdfPath) {
    console.error('Usage: node scripts/upload-book.mjs <sku> "<path-to-pdf>"');
    process.exit(1);
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('Missing BLOB_READ_WRITE_TOKEN. Set it from your Vercel Blob store first.');
    process.exit(1);
  }
  const product = getProduct(sku);
  if (!product) {
    console.error(`Unknown sku "${sku}". Add it to api/_lib/store-catalog.js first.`);
    process.exit(1);
  }
  if (!existsSync(pdfPath)) {
    console.error(`File not found: ${pdfPath}`);
    process.exit(1);
  }

  const bytes = await readFile(pdfPath);
  console.log(`Uploading ${(bytes.length / 1024 / 1024).toFixed(2)} MB to blob key "${product.blobKey}" ...`);

  const blob = await put(product.blobKey, bytes, {
    access: 'public',          // unguessable URL; kept server-side, gated by /api/store-download
    addRandomSuffix: true,     // random suffix so the path can't be guessed from the sku
    contentType: 'application/pdf',
    allowOverwrite: true,
  });

  // Merge into the sku -> url map.
  let map = {};
  if (existsSync(MAP_PATH)) {
    try { map = JSON.parse(await readFile(MAP_PATH, 'utf8')); } catch (_) { map = {}; }
  } else {
    await mkdir(dirname(MAP_PATH), { recursive: true });
  }
  map[sku] = blob.url;
  await writeFile(MAP_PATH, JSON.stringify(map, null, 2) + '\n');

  console.log(`\nDone. Recorded locally in ${MAP_PATH} (gitignored):`);
  console.log(`  ${sku} -> ${blob.url}`);
  console.log('\nThe repo is PUBLIC, so DO NOT commit the URL. Set it as the STORE_BLOBS env var instead:');
  console.log('\n  STORE_BLOBS=' + JSON.stringify(map) + '\n');
  console.log('Set it in Vercel for production + preview, then redeploy:');
  console.log("  printf '%s' '" + JSON.stringify(map) + "' | vercel env add STORE_BLOBS production");
  console.log("  printf '%s' '" + JSON.stringify(map) + "' | vercel env add STORE_BLOBS preview");
}

main().catch((err) => { console.error('Upload failed:', err && err.message); process.exit(1); });

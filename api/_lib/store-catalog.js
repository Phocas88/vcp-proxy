// Veteran Career Path store - SERVER-AUTHORITATIVE product catalog.
// Price and file mapping are defined HERE and never trusted from the client.
// Each SKU maps to a Vercel Blob object (blobKey) that store-download.js streams
// to the buyer AFTER verifying the Stripe payment server-side.
//
// To add a book:
//   1. Add an entry below (sku -> name, priceCents, blobKey, fileName).
//   2. Add the matching public card to the site's data/store-products.json.
//   3. Upload the PDF:  node scripts/upload-book.mjs <sku> "<path-to-pdf>"
'use strict';

const CATALOG = {
  'infantry-11-series': {
    name: 'Infantry (11 Series) Career Handbook',
    priceCents: 999,
    blobKey: 'handbooks/infantry-11-series.pdf',
    // Filename the buyer's browser saves the download as.
    fileName: 'Veteran-Career-Path-Infantry-11-Series-Career-Handbook.pdf',
  },
};

function getProduct(sku) {
  if (typeof sku !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(CATALOG, sku)) return null;
  return CATALOG[sku];
}

// SKUs are lowercase kebab; keep validation tight so they're safe in metadata/URLs.
const SKU_REGEX = /^[a-z0-9][a-z0-9-]{1,63}$/;

module.exports = { CATALOG, getProduct, SKU_REGEX };

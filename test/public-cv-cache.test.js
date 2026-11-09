'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/veteran/[slug]');
function wire(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(wire) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, wire(item)])) } };
}
test('public CV reloads reflect approved updates and unpublishing without browser or CDN snapshots', async t => {
  const original = global.fetch;
  let profile = { source: 'vcp-resume-program', name: 'Fictional Veteran', summary: 'First approved summary.', published: true };
  global.fetch = async (_url, options) => {
    assert.equal(options.cache, 'no-store');
    return profile ? { ok: true, status: 200, json: async () => wire(profile).mapValue } : { ok: false, status: 404 };
  };
  t.after(() => { global.fetch = original; });
  async function visit(slug = 'vcp-resume-fictional') {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.code = value; return this; }, send(value) { this.body = value; return this; } };
    await handler({ query: { slug }, headers: { host: 'profiles.veterancareerpath.com' } }, res);
    for (const key of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control']) assert.equal(res.headers[key], 'no-store');
    return res;
  }
  const first = await visit();
  assert.equal(first.code, 200); assert.match(first.body, /First approved summary/);
  profile.summary = 'New approved summary.';
  const updated = await visit();
  assert.equal(updated.code, 200); assert.match(updated.body, /New approved summary/); assert.doesNotMatch(updated.body, /First approved summary/);
  profile.published = false; assert.equal((await visit()).code, 404);
  profile = null; assert.equal((await visit()).code, 404);
  assert.equal((await visit('')).code, 404);
});

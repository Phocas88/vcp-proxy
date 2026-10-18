'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkspaceHandler, consumeQuota } = require('../api/_lib/resume-workspace');
const resume = 'ALEX EXAMPLE\nMILITARY EXPERIENCE\nSupply specialist\nU.S. Navy\nMaintained accurate equipment records and trained staff on inventory processes.';
const result = { score: 70, summary: 'The duties need clearer civilian language.', strengths: ['Verified responsibilities.'], findings: [], suggestions: [], nextSteps: ['Add job dates.'], revisedResume: resume.replace('Supply specialist', 'Logistics specialist'), rewriteNotes: ['Translated the duty title; verify it reflects your role.'] };
function setup(overrides = {}) {
  let paidCalls = 0;
  const handler = createWorkspaceHandler({ sessions: { bearerToken: req => req.headers.authorization, verifySession: value => ({ valid: value === 'valid-entitlement' }) }, verifyIdToken: async token => { if (token !== 'valid-firebase') throw new Error('invalid'); return { uid: 'verified-owner' }; }, quota: async uid => { assert.equal(uid, 'verified-owner'); return true; }, anthropic: { DEFAULT_MODEL: 'test-only', anthropicRequest: async body => { paidCalls++; assert.equal(body.tool_choice.name, 'submit_resume_review'); return { ok: true, data: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_resume_review', input: result }] } }; } }, ...overrides });
  return { calls: () => paidCalls, async run(change = {}) { const req = { headers: { origin: 'https://veterancareerpath.com', 'content-type': 'application/json', authorization: 'valid-entitlement', 'x-vcp-firebase-token': 'valid-firebase', ...change.headers }, body: { workspace: true, consent: true, input: { resume }, ...change.body } }; const res = { code: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } }; await handler(req, res); return res; } };
}
test('review requires both existing AI entitlement and a verified Firebase identity before any provider call', async () => {
  const s = setup();
  for (const headers of [{ authorization: '' }, { 'x-vcp-firebase-token': '' }, { 'x-vcp-firebase-token': 'forged' }, { origin: 'https://evil.example' }]) assert.ok((await s.run({ headers })).code >= 400);
  assert.equal((await s.run({ body: { consent: false } })).code, 400); assert.equal(s.calls(), 0);
  const response = await s.run(); assert.equal(response.code, 200); assert.equal(s.calls(), 1); assert.match(response.data.revisedResume, /Logistics specialist/);
});
test('invalid inputs, exhausted quota and truncated AI results never overwrite a resume', async () => {
  const s = setup(); assert.equal((await s.run({ body: { input: { resume: 'short' } } })).code, 400); assert.equal(s.calls(), 0);
  const limited = setup({ quota: async () => false }); assert.equal((await limited.run()).code, 429); assert.equal(limited.calls(), 0);
  const truncated = setup({ anthropic: { DEFAULT_MODEL: 'test', anthropicRequest: async () => ({ ok: true, data: { stop_reason: 'max_tokens' } }) } }); assert.equal((await truncated.run()).code, 502);
});
test('shared quota is atomic and cannot be reset by switching function instances', async () => {
  let doc = null; const db = { collection(name) { assert.equal(name, '_privateWorkspaceLimits'); return { doc(uid) { assert.equal(uid, 'owner'); return {}; } }; }, async runTransaction(fn) { return fn({ get: async () => ({ exists: !!doc, data: () => doc }), set: (_, data) => { doc = data; } }); } };
  for (let i = 0; i < 10; i++) assert.equal(await consumeQuota(db, 'owner', 1000), true);
  assert.equal(await consumeQuota(db, 'owner', 1000), false); assert.equal(await consumeQuota(db, 'owner', 901001), true);
  assert.deepEqual(Object.keys(doc).sort(), ['count','reset']);
});

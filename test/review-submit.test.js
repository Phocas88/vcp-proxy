'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const submit = require('../api/_lib/review/submit.js');
const upload = require('../api/_lib/review/upload.js');
const { MAX_FILE_BYTES } = require('../api/_lib/review-common');

const GOOD = {
  fullName: 'Jeremy Floyd', email: 'jeremy@example.com', serviceStatus: 'Veteran',
  branch: 'Army', mos: '12B', rank: 'SSG', yearsService: '8',
  primaryTarget: 'Construction Project Coordinator', industry: 'Construction',
  targetLocation: 'Dallas, TX', requestedHelp: 'Translate my experience.',
};

const GOOD_CIVILIAN = {
  fullName: 'Dana Ruiz', email: 'dana@example.com', employmentStatus: 'Employed',
  currentTitle: 'Warehouse Supervisor', yearsExperience: '6', careerLevel: 'Mid level',
  primaryTarget: 'Operations Coordinator', industry: 'Logistics',
  targetLocation: 'Columbus, OH', requestedHelp: 'Tighten my bullets and add metrics.',
};

test('buildIntake accepts a complete intake and normalizes email', () => {
  const r = submit.buildIntake(GOOD);
  assert.equal(r.missing.length, 0);
  assert.equal(r.track, 'veteran');
  assert.equal(r.client.name, 'Jeremy Floyd');
  assert.equal(r.client.email, 'jeremy@example.com');
  assert.equal(r.military.serviceStatus, 'Veteran');
});

test('buildIntake civilian track builds background, not military', () => {
  const r = submit.buildIntake(GOOD_CIVILIAN, 'civilian');
  assert.equal(r.missing.length, 0);
  assert.equal(r.track, 'civilian');
  assert.equal(r.military, undefined);
  assert.equal(r.background.currentTitle, 'Warehouse Supervisor');
  assert.equal(r.background.employmentStatus, 'Employed');
  assert.equal(r.background.careerLevel, 'Mid level');
  assert.equal(r.client.name, 'Dana Ruiz');
});

test('buildIntake civilian reports its own required fields and rejects bad status', () => {
  const r = submit.buildIntake({}, 'civilian');
  ['Full name', 'Email address', 'Most recent job title', 'Years of experience', 'Current status',
    'Primary target role', 'Target industry', 'What you want help with']
    .forEach((label) => assert.ok(r.missing.includes(label), 'missing ' + label));
  const bad = submit.buildIntake(Object.assign({}, GOOD_CIVILIAN, { employmentStatus: 'Retired general' }), 'civilian');
  assert.ok(bad.missing.includes('Current status'));
});

test('buildIntake ignores an unknown track and falls back to veteran', () => {
  const r = submit.buildIntake(GOOD, 'astronaut');
  assert.equal(r.track, 'veteran');
  assert.ok(r.military);
});

test('buildIntake reports each missing required field', () => {
  const r = submit.buildIntake({});
  ['Full name', 'Email address', 'Military branch', 'MOS / Rate / AFSC', 'Highest rank or grade',
    'Years of service', 'Current status', 'Primary target role', 'Target industry',
    'What you want help with'].forEach((label) => assert.ok(r.missing.includes(label), 'missing ' + label));
});

test('buildIntake rejects bad email and bad service status', () => {
  const r = submit.buildIntake(Object.assign({}, GOOD, { email: 'nope', serviceStatus: 'Civilian' }));
  assert.ok(r.missing.includes('Email address'));
  assert.ok(r.missing.includes('Current status'));
});

test('job posting URL validation', () => {
  assert.equal(submit.career_urlBad(''), false);
  assert.equal(submit.career_urlBad('https://jobs.example.com/1'), false);
  assert.equal(submit.career_urlBad('javascript:alert(1)'), true);
});

test('upload classify enforces type by magic bytes', () => {
  const pdf = Buffer.from('%PDF-1.4\n...');
  const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  const txt = Buffer.from('hello world');
  const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
  assert.equal(upload.classify('pdf', 'application/pdf', pdf).ok, true);
  assert.equal(upload.classify('docx', '', docx).ok, true);
  assert.equal(upload.classify('txt', 'text/plain', txt).ok, true);
  assert.equal(upload.classify('exe', '', exe).ok, false);           // disallowed extension
  assert.equal(upload.classify('pdf', 'application/pdf', exe).ok, false); // wrong magic for pdf
  assert.equal(upload.classify('txt', 'text/plain', Buffer.from([0x00, 0x01])).ok, false); // binary in txt
});

test('filename sanitization strips paths and unsafe chars', () => {
  assert.equal(upload.safeName('../../etc/passwd'), 'passwd');
  assert.equal(upload.safeName('my resume!.pdf'), 'my_resume_.pdf');
  assert.equal(upload.extOf('Resume.PDF'), 'pdf');
});

test('max file size constant is 10 MB', () => {
  assert.equal(MAX_FILE_BYTES, 10 * 1024 * 1024);
});

// Public: load a client's live "Career Journey" portal by its portal token.
// Route: /api/review-journey?token=<raw>   (GET)
//
// The portal is a per-client hub that goes live when the reviewer marks a job "delivered"
// (see review/job.js, which mints the portal token + 30-day window). This endpoint:
//   - looks the job up by the SHA-256 hash of the bearer token (unguessable capability URL),
//   - enforces the active + not-expired + not-archived window,
//   - returns ONLY sanitized, client-safe fields (first name, their own targets, their own
//     review, and computed resource links) — never email/phone, the uploaded resume, internal
//     reviewer notes, payment data, or the raw token.
// Required env: FIREBASE_SERVICE_ACCOUNT_JSON
'use strict';
const { getDb } = require('../firebase-admin');
const { setCors, normStr, clientIp, rateLimiter, hashToken, isRawTokenShape } = require('../review-common');

const limited = rateLimiter({ windowMs: 60_000, max: 60 });
const SITE = 'https://veterancareerpath.com';

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (limited('jny:' + clientIp(req))) return res.status(429).json({ ok: false, reason: 'rate_limited' });

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-journey] init:', e.code || e.message); return res.status(500).json({ ok: false, reason: 'configuration_error' }); }

  const token = normStr(req.query?.token, 128);
  if (!isRawTokenShape(token)) return res.status(200).json({ ok: false, reason: 'invalid' });

  try {
    const portalHash = hashToken(token.trim());
    const snap = await db.collection('resumeReviewJobs').where('portalHash', '==', portalHash).limit(1).get();
    if (snap.empty) return res.status(200).json({ ok: false, reason: 'invalid' });

    const doc = snap.docs[0];
    const j = doc.data();
    const p = j.portal || {};

    if (p.status === 'archived') return res.status(200).json({ ok: false, reason: 'archived' });
    const expMs = p.expiresAt && p.expiresAt.toMillis ? p.expiresAt.toMillis() : 0;
    if (!expMs || expMs < Date.now()) return res.status(200).json({ ok: false, reason: 'expired' });

    const career = j.career || {};
    const client = j.client || {};
    const firstName = (normStr(client.name, 120).split(/\s+/)[0] || '').slice(0, 40);
    const review = buildReview(j);
    const daysRemaining = Math.max(0, Math.ceil((expMs - Date.now()) / 86_400_000));

    return res.status(200).json({
      ok: true,
      firstName,
      track: j.track === 'civilian' ? 'civilian' : 'veteran',
      target: {
        role: normStr(career.primaryTarget, 120),
        secondaryRole: normStr(career.secondaryTarget, 120),
        industry: normStr(career.industry, 80),
        location: normStr(career.targetLocation, 120),
      },
      review,
      resources: buildResources(j),
      portal: {
        publishedAt: p.publishedAt && p.publishedAt.toMillis ? p.publishedAt.toMillis() : null,
        expiresAt: expMs,
        daysRemaining,
      },
    });
  } catch (err) {
    console.error('[review-journey] error:', err && err.message);
    return res.status(500).json({ ok: false, reason: 'server_error' });
  }
};

// ── The delivered review, assembled from the fields the reviewer already fills in the admin.
// Client-safe by construction: reviewerNotes and questionsForClient are NEVER included.
function buildReview(j) {
  const wr = j.workingReview || {};
  const sections = [
    { key: 'summary', label: 'Reviewer’s Summary', body: normStr(wr.summaryFeedback, 20000) },
    { key: 'priorityFixes', label: 'Priority Fixes', body: normStr(wr.priorityFixes, 20000) },
    { key: 'bulletRewrites', label: 'Suggested Bullet Rewrites', body: normStr(wr.bulletRewrites, 20000) },
    { key: 'careerRecommendations', label: 'Career Recommendations', body: normStr(wr.careerRecommendations, 20000) },
    { key: 'finalMessage', label: 'A Note From Your Reviewer', body: normStr(wr.finalMessage, 20000) },
  ].filter((s) => s.body);
  // Legacy / override: a hand-written "Final Review" box, if the reviewer used it instead.
  const finalReview = normStr(j.finalReview, 20000);
  const available = sections.length > 0 || !!finalReview || j.status === 'delivered';
  return { available, sections, finalReview, deliveredAt: j.deliveredAt && j.deliveredAt.toMillis ? j.deliveredAt.toMillis() : null };
}

// ── Resource personalization ────────────────────────────────────────────────
// Everything links to pages that already exist on the site (verified against the repo),
// chosen from the client's target field + location. No per-client admin work required.

// Target field / role keyword -> career-guide slug (first match wins; order = specificity).
const FIELD_GUIDES = [
  [/supply|logistic|warehouse|inventory|distribution|procurement/i, 'veteran-supply-chain-careers', 'Supply Chain & Logistics Careers'],
  [/truck|cdl|freight|driver|driving/i, 'veteran-trucking-careers', 'Trucking & CDL Careers'],
  [/cyber|infosec|information security|soc analyst|penetration/i, 'veteran-cybersecurity-careers', 'Cybersecurity Careers'],
  [/data|analytic|business intelligence|\bbi\b/i, 'veteran-data-analytics-careers', 'Data & Analytics Careers'],
  [/health|medic|nurse|clinical|patient|ems|paramedic/i, 'veteran-healthcare-careers', 'Healthcare Careers'],
  [/police|law enforce|sheriff|corrections|security officer|patrol/i, 'veteran-law-enforcement-careers', 'Law Enforcement Careers'],
  [/project manage|program manage|\bpmp\b|scrum|agile/i, 'veteran-project-management-careers', 'Project Management Careers'],
  [/manufactur|production|assembly|machinist|fabrication|plant/i, 'veteran-manufacturing-careers', 'Manufacturing Careers'],
  [/real estate|realtor|property manage/i, 'veteran-real-estate-careers', 'Real Estate Careers'],
  [/financ|bank|account|invest|insurance|underwrit/i, 'veteran-financial-services-careers', 'Financial Services Careers'],
  [/human resource|\bhr\b|recruit|talent|people ops/i, 'veteran-human-resources-careers', 'Human Resources Careers'],
  [/intel|intelligence|analyst|gis|all-source/i, 'veteran-intelligence-careers', 'Intelligence Careers'],
  [/emergency manage|fire|firefight|disaster|first respond/i, 'veteran-emergency-management-careers', 'Emergency Management Careers'],
  [/energy|oil|gas|power|electric|solar|wind|utility/i, 'veteran-energy-careers', 'Energy Sector Careers'],
  [/govern|federal|contractor|gs-|defense contract/i, 'veteran-government-contractor-careers', 'Government Contractor Careers'],
  [/teach|educat|instructor|trainer|professor|school/i, 'veteran-teaching-careers', 'Teaching & Education Careers'],
  [/avia|pilot|aircraft|airport|airline|drone|\buav\b/i, 'veteran-aviation-careers', 'Aviation Careers'],
  [/construct|carpentr|electric|plumb|hvac|welding|skilled trade/i, 'veteran-construction-management-careers', 'Construction & Skilled Trades Careers'],
];

// State name / abbreviation -> veteran-benefits page slug + Title.
const STATES = [
  ['alabama', 'al'], ['alaska', 'ak'], ['arizona', 'az'], ['arkansas', 'ar'], ['california', 'ca'],
  ['colorado', 'co'], ['connecticut', 'ct'], ['delaware', 'de'], ['florida', 'fl'], ['georgia', 'ga'],
  ['hawaii', 'hi'], ['idaho', 'id'], ['illinois', 'il'], ['indiana', 'in'], ['iowa', 'ia'],
  ['kansas', 'ks'], ['kentucky', 'ky'], ['louisiana', 'la'], ['maine', 'me'], ['maryland', 'md'],
  ['massachusetts', 'ma'], ['michigan', 'mi'], ['minnesota', 'mn'], ['mississippi', 'ms'], ['missouri', 'mo'],
  ['montana', 'mt'], ['nebraska', 'ne'], ['nevada', 'nv'], ['new hampshire', 'nh'], ['new jersey', 'nj'],
  ['new mexico', 'nm'], ['new york', 'ny'], ['north carolina', 'nc'], ['north dakota', 'nd'], ['ohio', 'oh'],
  ['oklahoma', 'ok'], ['oregon', 'or'], ['pennsylvania', 'pa'], ['rhode island', 'ri'], ['south carolina', 'sc'],
  ['south dakota', 'sd'], ['tennessee', 'tn'], ['texas', 'tx'], ['utah', 'ut'], ['vermont', 'vt'],
  ['virginia', 'va'], ['washington', 'wa'], ['west virginia', 'wv'], ['wisconsin', 'wi'], ['wyoming', 'wy'],
];
const STATE_SLUG = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado',
  ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho',
  il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana',
  me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi',
  mo: 'missouri', mt: 'montana', ne: 'nebraska', nv: 'nevada', nh: 'new-hampshire', nj: 'new-jersey',
  nm: 'new-mexico', ny: 'new-york', nc: 'north-carolina', nd: 'north-dakota', oh: 'ohio', ok: 'oklahoma',
  or: 'oregon', pa: 'pennsylvania', ri: 'rhode-island', sc: 'south-carolina', sd: 'south-dakota',
  tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont', va: 'virginia', wa: 'washington',
  wv: 'west-virginia', wi: 'wisconsin', wy: 'wyoming',
};
const STATE_TITLE = {
  al: 'Alabama', ak: 'Alaska', az: 'Arizona', ar: 'Arkansas', ca: 'California', co: 'Colorado',
  ct: 'Connecticut', de: 'Delaware', fl: 'Florida', ga: 'Georgia', hi: 'Hawaii', id: 'Idaho',
  il: 'Illinois', in: 'Indiana', ia: 'Iowa', ks: 'Kansas', ky: 'Kentucky', la: 'Louisiana',
  me: 'Maine', md: 'Maryland', ma: 'Massachusetts', mi: 'Michigan', mn: 'Minnesota', ms: 'Mississippi',
  mo: 'Missouri', mt: 'Montana', ne: 'Nebraska', nv: 'Nevada', nh: 'New Hampshire', nj: 'New Jersey',
  nm: 'New Mexico', ny: 'New York', nc: 'North Carolina', nd: 'North Dakota', oh: 'Ohio', ok: 'Oklahoma',
  or: 'Oregon', pa: 'Pennsylvania', ri: 'Rhode Island', sc: 'South Carolina', sd: 'South Dakota',
  tn: 'Tennessee', tx: 'Texas', ut: 'Utah', vt: 'Vermont', va: 'Virginia', wa: 'Washington',
  wv: 'West Virginia', wi: 'Wisconsin', wy: 'Wyoming',
};

function detectState(location) {
  const loc = ' ' + String(location || '').toLowerCase().replace(/[^a-z, ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  // Prefer a full state-name match (handles "New York", "North Carolina").
  for (const [name, abbr] of STATES) { if (loc.indexOf(' ' + name + ' ') !== -1) return abbr; }
  // Fall back to a ", ST" postal abbreviation.
  const m = /,\s*([a-z]{2})\b/.exec(loc);
  if (m && STATE_TITLE[m[1]]) return m[1];
  return '';
}

function detectGuide(job) {
  const career = job.career || {};
  const hay = [career.primaryTarget, career.secondaryTarget, career.industry, (job.military || {}).mos].map((x) => String(x || '')).join(' ');
  for (const [re, slug, title] of FIELD_GUIDES) { if (re.test(hay)) return { slug, title }; }
  return null;
}

function card(title, desc, url, external) { return { title, desc, url, external: !!external }; }

function buildResources(job) {
  const isVet = job.track !== 'civilian';
  const groups = [];

  // 1) Careers in your field
  const guide = detectGuide(job);
  const careers = [];
  if (guide) careers.push(card(guide.title, 'An in-depth guide to this field: roles, pay, employers, and how your background maps in.', `${SITE}/${guide.slug}.html`));
  if (isVet) careers.push(card('MOS Career Translator', 'See the civilian jobs your military experience maps to, with real titles and keywords.', `${SITE}/mos-career-translator.html`));
  careers.push(card('Top Companies Hiring Veterans (2025)', 'Employers with active veteran-hiring programs and open roles.', `${SITE}/top-companies-hiring-veterans-2025.html`));
  careers.push(card('Veteran Salary Data', 'What your target roles actually pay, so you can benchmark offers.', `${SITE}/veteran-salary-data.html`));
  groups.push({ group: 'Explore your target field', items: careers });

  // 2) Education & certifications (+ local schools by state)
  const edu = [];
  edu.push(card('Certification Roadmap', 'The certifications that matter for your field, in the order to earn them.', `${SITE}/veteran-certification-roadmap.html`));
  edu.push(card('Certification Advisor', 'Match certifications to your goals and see which your GI Bill / benefits can cover.', `${SITE}/tools-cert-advisor.html`));
  edu.push(card('License Finder', 'Find which civilian licenses your target role requires in your state.', `${SITE}/license-finder.html`));
  const st = detectState((job.career || {}).targetLocation);
  if (st) {
    edu.push(card(`Schools & Colleges near ${STATE_TITLE[st]}`, 'Compare GI Bill–approved schools and programs by location, cost, and outcomes (VA tool).', 'https://www.va.gov/education/gi-bill-comparison-tool/', true));
  } else {
    edu.push(card('GI Bill School Comparison', 'Compare approved schools and programs by cost, location, and veteran outcomes.', `${SITE}/gi-bill-school-comparison.html`));
  }
  edu.push(card('Apprenticeships & Trade Programs', 'Earn while you learn — veteran apprenticeship and trade-school pathways.', `${SITE}/veteran-apprenticeship-guide.html`));
  groups.push({ group: 'Education & certifications', items: edu });

  // 3) Land the job
  const land = [];
  land.push(card('Resume Examples', 'Real veteran resumes by field to model yours after.', `${SITE}/veteran-resume-examples.html`));
  land.push(card('Interview Questions & Answers', 'The questions you’ll face and how to answer them with your experience.', `${SITE}/veteran-interview-questions.html`));
  land.push(card('LinkedIn Profile Guide', 'Turn your resume into a recruiter-magnet LinkedIn profile.', `${SITE}/veteran-linkedin-guide.html`));
  land.push(card('Networking Guide', 'How to reach hiring managers and veterans already in your field.', `${SITE}/veteran-networking-guide.html`));
  land.push(card('STAR Story Builder', 'Build the behavioral-interview stories that win offers.', `${SITE}/star-story-builder.html`));
  groups.push({ group: 'Land the job', items: land });

  // 4) Benefits in your state
  if (st) {
    groups.push({
      group: `Benefits & resources in ${STATE_TITLE[st]}`,
      items: [
        card(`${STATE_TITLE[st]} Veteran Benefits`, 'State-specific education, employment, tax, and hiring benefits you’ve earned.', `${SITE}/${STATE_SLUG[st]}-veteran-benefits.html`),
        card('Most Veteran-Friendly Cities', 'Where veterans find the best jobs, benefits, and community.', `${SITE}/veteran-friendly-cities.html`),
      ],
    });
  }

  return groups;
}

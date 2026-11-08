# Inline job-match clarification

The frontend can now submit answers directly from a purchased resume's job comparison through the existing `refine` action. This uses the same one included update, original input, verified payment, quota, lease, repair and recovery checks as Resume review.

Each answer has a canonical `job-<index>` ID, the displayed requirement and question, and the applicant's answer. The server accepts it only when the authenticated owner's stored comparison has the current refinement revision and factual-proof version, the index identifies an unsupported requirement, and both texts equal that stored question. Unknown, supported, changed, stale and noncanonical question IDs are rejected before an update begins. Another owner's build still returns 404.

Only the applicant's answer is appended to verified details. The posting requirement and generated question are stored separately as private recovery metadata; they never become applicant facts through this path. Negative or skipped answers do not establish reporting experience. The existing 1,000-character answer, 4,000-character combined-detail and 16-answer limits remain.

Validation uses actual program handlers, rewrite validation and synthetic identities with injected AI/Stripe responses and in-memory records. No production records, live AI calls or payments are used. The complete backend suite passed 210 tests. Three new tests cover current-question binding, unchanged master/source and a single purchase, stale/altered/supported questions, foreign-owner denials, duplicate-use rejection and negative/blank answers. Existing failure/retry, concurrent execution and payment recovery tests remain in the full suite.

```sh
npm ci --no-audit --no-fund
npm test
node --test test/job-clarifications.test.js
```

Changed files: `api/_lib/resume-program.js`, `test/job-clarifications.test.js`, `.github/workflows/career-exploration.yml`, and this document. The paired frontend verifies the normal landing/upload → comparison → inline answers → editable proposal → explicit use → design/save → PDF/DOCX/TXT workflow.

This is a focused change-boundary review and fixture validation, not a comprehensive security audit or live model-quality evaluation. Original resumes and finished documents are not automatically replaced. No pricing, credentials, private/public storage rules, public CV layout or analytics configuration changes are introduced.

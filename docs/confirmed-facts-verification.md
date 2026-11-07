# Confirmed-duty acceptance verification

This change addresses a reproduced validation gap in the Army 88M workflow. The original validators accepted deliberately incorrect provider fixtures: a software-engineer match supported by `Army | MOS 88M`, and a rewrite that promoted GCSS-Army use to implementation and weekly reporting. These are controlled-provider tests of actual handlers, **not observations of live AI output**.

`api/_lib/confirmed-facts.js` adds a bounded factual safeguard to career matches, job-requirement comparisons, resume rewrites and cover letters. It rejects context-only evidence and specific unsupported promotions involving reporting, named ERP/WMS implementation, civilian CDL status and people-management authority. Existing numeric preservation remains in force. This is not a general semantic verifier: applicants still review generated wording. The writer's existing bounded repair runs within the same purchase; rejected wording is never copied into diagnostics.

## Army 88M acceptance results

| Applicant | Confirmed duties | Accepted matches after the change |
|---|---|---|
| A | Drove convoy vehicles; performed vehicle inspections before and after missions | Freight truck driver, quoting `Drove convoy vehicles.` Inspections remain in the resume; neither a mechanic credential nor a CDL is inferred. |
| B | Dispatched vehicles; trained drivers; recorded vehicle status in GCSS-Army | Transport dispatch coordinator, fleet operations coordinator, and a transferable employee-training connection, respectively quoting each actual duty. No implementation or instructor credential is inferred. |

The fleet-coordinator posting's weekly-reporting requirement becomes **Needs detail** and asks: “Did you prepare or export reports? What did you track, and who used it?” Skipping it leaves reporting out. B's explicit answer about exporting vehicle-status data and preparing a weekly availability report for the dispatch team authorizes those facts, within the same purchase. A does not inherit B's duties. Branch/MOS, rank, skill level and additional qualifications remain separate inputs; rank/skill level/qualifiers are not supplied in these two fixtures. Unknown/legacy code context has separate regression coverage.

The source catalog is the original VCP catalog. No live O*NET integration or O*NET interest questions are added. Career exploration still excludes the target role and job posting. The matching-version and career-kit proof-version keys refresh older cached comparisons; previously approved documents are not silently rewritten.

## Validation and reproduction

Run from this repository after `npm ci --no-audit --no-fund`:

```sh
npm test
node --test test/confirmed-facts.test.js test/88m-acceptance.test.js
```

The full Node 22 suite passed **207 tests** in the isolated verification environment. The acceptance helper uses the actual `createProgramHandler`, rewrite repair, payment checks and normalizers with synthetic owners, in-memory records and injected provider/Stripe responses. It makes no external AI requests, charges or production writes. Two new targets preserve the master and the previous purchased version. A different synthetic owner receives 404 for private get/run/career/template access and cannot assess the first owner's saved resume.

The frontend `resume-workspace-src/scripts/audit-88m.mjs` also exercises the normal landing → workspace → career exploration → uploaded resume → simulated verified checkout → review → job comparison → clarification → editing → finish → downloads path against these real handlers. For both applicants, PDF/DOCX/TXT downloads preserve duties and the confirmed/skipped reporting distinction. PDF.js verifies text, reading order and letter-page boundaries; Mammoth and native Word XML verify editable text and no read-only protection. See the frontend `docs/88m-acceptance-report.md` for screenshots, exact file paths and UI/export results.

These checks are not a live two-account penetration test or a Firestore-emulator test. Existing synthetic ownership and public-CV tests cover the intended boundaries. Live provider quality and announcement-specific federal suitability remain separate checks. Federal formatting, public CV design, prices, authentication, private storage and analytics configuration are unchanged.

## Files changed in this repository

- `api/_lib/confirmed-facts.js` — shared bounded evidence/claim safeguards and prompt guidance.
- `api/_lib/career-matches.js` — concrete evidence, safe explanations and cache version.
- `api/_lib/career-kit.js` — specific requirement questions, safe translations and proof-version cache.
- `api/_lib/cover-letter-ai.js` — reject unsupported duties/credentials in letters.
- `api/_lib/resume-workspace/review.mjs` — validate drafts/suggestions; existing bounded repair receives factual feedback.
- `api/_lib/resume-program.js` — bounded diagnostic types and recoverable factual-error message.
- `test/confirmed-facts.test.js` — evidence/claim, reporting assistance and wrapped-text regressions.
- `test/88m-acceptance.test.js` — real-handler acceptance, target preservation and owner denials.
- `test/helpers/evidence-program.cjs` — reusable synthetic integration fixture.
- `test/fixtures/88m-profiles.json` — fictional A/B inputs and target posting.
- `.github/workflows/career-exploration.yml` — run the existing complete backend suite for the new guard/tests.
- `docs/confirmed-facts-verification.md` — this verification record.

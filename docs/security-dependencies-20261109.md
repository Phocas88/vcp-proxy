# Production dependency repair — 9 November 2026

The production dependency audit initially reported 13 affected packages: five high and eight moderate entries. These are package advisories, not evidence that an account was compromised.

The repair pins Firebase Admin 14.5.0 and Vercel Blob 2.8.2, refreshes the lockfile (including Undici 6.29.1), and declares Node 22 or newer. The deployed Vercel project runs Node 24; CI runs Node 22.

Firebase Admin 14 removed the legacy `admin.auth` and `admin.firestore` namespaces. The bootstrap now imports the supported app, auth and Firestore entrypoints while preserving existing credentials, the singleton application, account verification and database access.

Two temporary dependency overrides close advisories left by upstream constraints:

- `@vercel/cli-config` → Zod 4.6.6: the same Zod major, beyond the affected oversized-collection validation versions.
- Rimraf 6.1.4: Google clients still request Rimraf 5, whose Glob/Minimatch chain remains affected. Version 6 preserves the asynchronous `rimraf(path)` API used by those clients, supports the declared runtime and selects patched Glob 14.0.4 and Minimatch 11.0.5.

Remove each override when its upstream dependency requests a patched version. Do not run `npm audit fix --force` as a substitute for checking API and runtime compatibility.

Verification includes the full backend suite, importing the installed SDK without credentials, reusing an existing SDK application, exercising the auth/Firestore entrypoints without an RPC, and deleting only a newly created temporary cache directory through Rimraf. Production requests are then checked with a fictional account; payment and ownership checks remain enabled.

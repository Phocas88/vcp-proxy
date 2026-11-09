# Production dependency repair — 9 November 2026

The production dependency audit initially reported 13 affected packages: five high and eight moderate entries. These are package advisories, not evidence that an account was compromised.

The repair retains Firebase Admin 13.10.0 and pins Vercel Blob 2.8.2, refreshes the lockfile (including Undici 6.29.1), and declares Node 22 or newer. The deployed Vercel project runs Node 24; CI runs Node 22.

The Firebase Admin 14.5.0 candidate passed unit checks but rejected fresh production client tokens. Retain the verified 13.10.0 authentication implementation until the new major version is proven in a staging environment. The bootstrap uses module entrypoints supported by both versions and preserves existing credentials, the singleton application, account verification and database access.

Temporary dependency overrides close advisories left by upstream constraints:

- UUID 11.1.1: removes the old buffer-bounds advisory from the Firebase 13 dependency tree while preserving the CommonJS v4 interface used by Google clients.
- `@vercel/cli-config` → Zod 4.6.6: the same Zod major, beyond the affected oversized-collection validation versions.

Remove each override when its upstream dependency requests a patched version. Do not run `npm audit fix --force` as a substitute for checking API and runtime compatibility.

Verification includes the full backend suite, importing the installed SDK without credentials, reusing an existing SDK application, exercising the auth/Firestore entrypoints without an RPC, and checking the installed UUID interface and buffer bounds. Production requests are then checked with a fictional account; payment and ownership checks remain enabled.

Retaining Firebase 13 also removes the Rimraf/Glob/Minimatch dependency chain introduced by the Firebase 14 candidate; no unused cleanup override or dependency is retained.

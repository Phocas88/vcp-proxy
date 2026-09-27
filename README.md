# VCP Proxy - Veteran Career Path API Proxy

Vercel serverless proxy for Veteran Career Path AI tools, access-code validation, and Stripe entitlement verification.

## Endpoints

| Route | Purpose |
|-------|---------|
| `POST /api/claude` | Proxy requests to Anthropic Claude API. Requires a valid server-issued bearer session. |
| `POST /api/validate-code` | Validate access codes server-side and issue signed entitlement sessions. |
| `POST /api/verify-subscription` | Verify Stripe identifiers or subscriptions server-side and issue signed entitlement sessions. |
| `POST /api/review-invite` | **Admin.** Create / revoke / list resume-review invitations. |
| `POST /api/review-invite-validate` | Public. Validate a raw invite token; returns only safe display fields. |
| `POST /api/review-upload` | Public (invite-gated). Store one resume file in **private** Vercel Blob. |
| `POST /api/review-submit` | Public (invite-gated). Create the resume-review job (status `awaiting_payment`). |
| `POST /api/review-checkout` | Client. Create the $9.99 Stripe Checkout Session for a job. |
| `POST /api/review-webhook` | Stripe. Marks a job paid → `new`/unread on verified `checkout.session.completed`. |
| `GET /api/review-jobs` | **Admin.** List/filter resume-review jobs. |
| `GET/PATCH /api/review-job` | **Admin.** Read a job; patch status / notes / working review / unread. |
| `GET /api/review-file` | **Admin.** Stream a private resume file (preview/download). |
| `POST /api/review-extract` | **Admin.** Extract resume text (PDF/DOCX/TXT). |
| `POST /api/review-ai` | **Admin.** Run an AI-assisted review tool; logs each run. |

All `/api/review-*` admin endpoints require a Firebase ID token (`Authorization: Bearer <token>`) whose custom claims include `admin: true`.

## Environment Variables

Set these in Vercel Dashboard > Settings > Environment Variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key. Store only in Vercel environment variables. |
| `VCB_SESSION_SECRET` | Yes | At least 32 characters. Used to sign entitlement sessions for AI access. |
| `ACCESS_CODES` | Yes | JSON map of access codes. `0` means permanent access, timestamp means expiry in milliseconds. Example shape: `{"PARTNER_CODE":0,"TEMP_CODE":1767139200000}` |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key from https://dashboard.stripe.com/apikeys. |
| `ONE_TIME_EXPIRY_DAYS` | No | Days of access granted for one-time Stripe payments. Default: `365`. |
| `ANTHROPIC_ALLOWED_MODELS` | No | Comma-separated model allow-list shared by `/api/claude` and `/api/review-ai`. Defaults to `claude-haiku-4-5-20251001`. |

### Resume Review service

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Yes | Firebase service-account JSON (raw or base64) for project `veteran-career-builder`. Enables Firebase Admin (Firestore + ID-token verification). **Never commit this.** |
| `REVIEW_PRICE_CENTS` | No | Resume-review price in cents. Default `999` ($9.99). |
| `STRIPE_WEBHOOK_SECRET_REVIEW` | Yes | Signing secret for the **resume-review** Stripe webhook endpoint (separate from `STRIPE_WEBHOOK_SECRET_RESUME`). |
| `BLOB_REVIEW_RW_TOKEN` | Yes | Read/write token for the **private** Vercel Blob store that holds uploaded resumes. Falls back to `BLOB_READ_WRITE_TOKEN` if unset. |
| `RESUME_REVIEW_ALERT_EMAIL` | No | Address to email when a new paid review arrives. Only sends if an email provider is already configured (`RESEND_API_KEY`); no new vendor is added. |
| `RESEND_API_KEY` | No | Reused only if you already use Resend. Enables the optional new-review email alert. |

The service fails closed if required security configuration is missing. `FIREBASE_SERVICE_ACCOUNT_JSON`, `BLOB_REVIEW_RW_TOKEN`, and all secrets are server-only and never exposed to browser JavaScript.

## Deploy

```bash
npm install -g vercel
cd vcp-proxy
vercel --prod
```

After deploying, add environment variables in Vercel Dashboard, then redeploy.

## Test

```bash
# Validate an access code and capture the returned token.
curl -X POST https://vcp-proxy.vercel.app/api/validate-code \
  -H "Content-Type: application/json" \
  -d '{"code":"PARTNER_CODE"}'

# Verify a Stripe Checkout Session, subscription, or charge identifier and capture the returned token.
curl -X POST https://vcp-proxy.vercel.app/api/verify-subscription \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"cs_test_or_live_checkout_session"}'

# Call Claude only with a server-issued entitlement token.
curl -X POST https://vcp-proxy.vercel.app/api/claude \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SERVER_ISSUED_TOKEN" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":100,"messages":[{"role":"user","content":"Say OK"}]}'
```

## Frontend Configuration

```html
<script>window.VCB_PROXY_URL="https://vcp-proxy.vercel.app";</script>
```

Do not expose Anthropic keys, Stripe secrets, signing secrets, or access-code lists in browser JavaScript.

## CORS

All endpoints restrict CORS to approved Veteran Career Path origins.

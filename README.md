# VCP Proxy - Veteran Career Path API Proxy

Vercel serverless proxy for Veteran Career Path AI tools, access-code validation, and Stripe entitlement verification.

## Endpoints

| Route | Purpose |
|-------|---------|
| `POST /api/claude` | Proxy requests to Anthropic Claude API. Requires a valid server-issued bearer session. |
| `POST /api/validate-code` | Validate access codes server-side and issue signed entitlement sessions. |
| `POST /api/verify-subscription` | Verify Stripe identifiers or subscriptions server-side and issue signed entitlement sessions. |

## Environment Variables

Set these in Vercel Dashboard > Settings > Environment Variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key. Store only in Vercel environment variables. |
| `VCB_SESSION_SECRET` | Yes | At least 32 characters. Used to sign entitlement sessions for AI access. |
| `ACCESS_CODES` | Yes | JSON map of access codes. `0` means permanent access, timestamp means expiry in milliseconds. Example shape: `{"PARTNER_CODE":0,"TEMP_CODE":1767139200000}` |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key from https://dashboard.stripe.com/apikeys. |
| `ONE_TIME_EXPIRY_DAYS` | No | Days of access granted for one-time Stripe payments. Default: `365`. |

The service fails closed if required security configuration is missing.

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

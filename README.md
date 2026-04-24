# VCP Proxy — Veteran Career Path API Proxy

Vercel serverless proxy for Veteran Career Path AI tools and payment verification.

## Endpoints

| Route | Purpose |
|-------|---------|
| `POST /api/claude` | Proxy requests to Anthropic Claude API |
| `POST /api/validate-code` | Validate access codes server-side |
| `POST /api/verify-subscription` | Verify Stripe subscriptions by email |

## Environment Variables

Set these in **Vercel Dashboard > Settings > Environment Variables**:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key (`sk-ant-...`) |
| `ACCESS_CODES` | Yes | JSON map of access codes. `0` = permanent, timestamp = expiry in ms. Example: `{"OWNER2025":0,"OWNER2026":0,"TAP2026":1767139200000,"VSO2026":1767139200000}` |
| `STRIPE_SECRET_KEY` | Yes | Stripe secret key (`sk_live_...` or `sk_test_...`) from https://dashboard.stripe.com/apikeys |

## Deploy

```bash
npm install -g vercel   # first time only
cd vcp-proxy
vercel --prod
```

After deploying, add environment variables in Vercel Dashboard, then redeploy.

## Test

```bash
# Test Claude proxy
curl -X POST https://vcp-proxy.vercel.app/api/claude \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":100,"messages":[{"role":"user","content":"Say OK"}]}'

# Test code validation
curl -X POST https://vcp-proxy.vercel.app/api/validate-code \
  -H "Content-Type: application/json" \
  -d '{"code":"TAP2026"}'

# Test subscription verification
curl -X POST https://vcp-proxy.vercel.app/api/verify-subscription \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

## Set the proxy URL in app.html

```html
<script>window.VCB_PROXY_URL="https://vcp-proxy.vercel.app/api/claude";</script>
```

## CORS

All endpoints restrict CORS to `https://veterancareerpath.com` only.

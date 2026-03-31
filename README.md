# VCP Proxy — Vercel Serverless Function

## Deploy in 3 steps

### 1. Install Vercel CLI (once)
```
npm install -g vercel
```

### 2. Deploy
```
cd vcp-proxy
vercel --prod
```

### 3. Add your API key
After deploying, go to:
**Vercel Dashboard → Your project → Settings → Environment Variables**

Add:
- Name: `ANTHROPIC_API_KEY`
- Value: `sk-ant-api03-...` (your actual Anthropic key)
- Environment: ✅ Production ✅ Preview ✅ Development

Click **Save**, then click **Redeploy** (or run `vercel --prod` again).

## Test it
```bash
curl -X POST https://YOUR-PROXY-URL.vercel.app/api/claude \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":100,"messages":[{"role":"user","content":"Say OK"}]}'
```

Expected response: `{"id":"msg_...","content":[{"type":"text","text":"OK"}],...}`

## Set the proxy URL in app.html
Find this line in app.html and update the URL:
```html
<script>window.VCB_PROXY_URL="https://YOUR-PROXY-URL.vercel.app/api/claude";</script>
```

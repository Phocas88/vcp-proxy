// Shared Anthropic (Claude) request helper for Veteran Career Path.
// Centralizes the model allow-list, token caps, and the raw /v1/messages call so both the
// public proxy (claude.js) and the admin resume-review tool (review-ai.js) use one code path.
// The ANTHROPIC_API_KEY is read here on the server ONLY and never returned to the browser.
'use strict';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS_LIMIT = 3000;

function allowedModels() {
  const configured = (process.env.ANTHROPIC_ALLOWED_MODELS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return new Set(configured.length ? configured : [DEFAULT_MODEL]);
}

function resolveModel(model) {
  const requested = model || DEFAULT_MODEL;
  return allowedModels().has(requested) ? requested : null;
}

function capTokens(n, fallback = 1500) {
  const parsed = Number.parseInt(n, 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(value, 1), MAX_TOKENS_LIMIT);
}

// Low-level: send an already-validated Anthropic message body. Returns { ok, status, data }.
async function anthropicRequest(body, { signal } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 500, data: { error: { message: 'AI service is not configured', type: 'configuration_error' } } };
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

// High-level convenience for server tools: builds the body, throws on error, returns data.
async function callAnthropic({ system, messages, model, maxTokens, signal }) {
  const resolved = resolveModel(model);
  const body = {
    model: resolved || DEFAULT_MODEL,
    max_tokens: capTokens(maxTokens, 2000),
    messages,
  };
  if (system) body.system = system;
  const { ok, status, data } = await anthropicRequest(body, { signal });
  if (!ok) {
    const err = new Error(data?.error?.message || 'AI request failed');
    err.status = status;
    err.type = data?.error?.type;
    throw err;
  }
  return data;
}

function extractText(data) {
  return ((data && data.content) || [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

module.exports = {
  DEFAULT_MODEL,
  MAX_TOKENS_LIMIT,
  allowedModels,
  resolveModel,
  capTokens,
  anthropicRequest,
  callAnthropic,
  extractText,
};

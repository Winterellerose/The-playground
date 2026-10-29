/* ── max-output clamping ──────────────────────────────────────────
   CONSERVATIVE guard values to avoid hard 400/422 rejects, NOT the
   provider's authoritative caps. An unknown provider falls back to
   MAX_OUT_DEFAULT (== the app's own 8192 default), so a missing entry
   is safe, never a crash. Local servers are left unclamped. */
const MAX_OUT_DEFAULT   = 8192;
const MAX_OUT_BY_PROVIDER = {
  groq: 8192, cerebras: 8192, gemini: 8192, mistral: 8192,
  cohere: 8192, nvidia: 4096, deepseek: 8192,
  openai: 32768, anthropic: 64000, sambanova: 8192,
  zai: 8192, _paid: 8192, atria: 8192,
};
const MAX_OUT_BY_APIID = {
  "meta/llama-3.3-70b-instruct": 4096, // NVIDIA free tier caps low
  "ministral-8b-latest":         4096,
  "claude-sonnet-5":             64000,
  "claude-opus-5":               64000,
  "claude-haiku-4-5":            64000,
};
function clampMaxOut(model, userSetting) {
  if (REG[model.provider]?.local) return userSetting; // no known cap; trust the user
  const cap = MAX_OUT_BY_APIID[model.apiId]
            ?? MAX_OUT_BY_PROVIDER[model.provider]
            ?? MAX_OUT_DEFAULT;
  return Math.max(512, Math.min(userSetting, cap));
}

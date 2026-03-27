import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { db_launa } from "../utils/database/db.js";

import { commands as _singCmds } from "../modules/sing.js";
import { commands as _nctCmds } from "../modules/nct.js";
import { commands as _zingCmds } from "../modules/zing.js";
import { commands as _spotifyCmds } from "../modules/spotify.js";
import { convertAndSendSticker } from "../modules/stk.js";
import { commands as _profileCmds } from "../modules/profile.js";

const MAX_HISTORY = 20;

async function loadHistory(threadId) {
  try {
    return await db_launa.loadHistory(threadId, MAX_HISTORY);
  } catch {
    return [];
  }
}

async function saveExchange(threadId, userId, userMsg, assistantMsg) {
  try {
    await db_launa.saveExchange(threadId, userId, userMsg, assistantMsg);
  } catch { /* db chưa khởi tạo — bỏ qua */ }
}

async function clearHistory(threadId) {
  try {
    return await db_launa.clearHistory(threadId);
  } catch {
    return 0;
  }
}

export const name = "launa";
export const description = "LauNa AI — Trợ lý AI dễ thương dùng DeepSeek/Grok. Dùng: .launa on/off/model/status/help";

// ─────────────────────────────────────────────────────────────────────────────
// PIXVERSE OPENAPI v2 CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const PIXVERSE_V2 = "https://app-api.pixverse.ai/openapi/v2";
function _pixverseToken() { return getTokens()?.pixverse?.token || ""; }

function getPxHeaders() {
  const token = _pixverseToken() || "";
  return {
    "API-KEY": token,
    "Content-Type": "application/json",
  };
}

async function pxDownloadFile(url, destPath) {
  const response = await axios({ url, method: "GET", responseType: "stream", timeout: 120000 });
  const writer = fs.createWriteStream(destPath);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", () => resolve({ contentType: response.headers["content-type"], path: destPath }));
    writer.on("error", reject);
  });
}


async function pxCreateVideo(prompt) {
  const res = await axios.post(`${PIXVERSE_V2}/video/text/generate`, {
    prompt,
    model: "v4",
    aspect_ratio: "16:9",
    duration: 5,
    quality: "360p",
  }, { headers: getPxHeaders() });
  console.log("[PixVerse v2 createVideo resp]", JSON.stringify(res.data?.Resp).slice(0, 300));
  if (res.data?.ErrCode === 0) {
    const id = res.data.Resp?.video_id ?? res.data.Resp?.id;
    if (!id) throw new Error("API không trả về video_id: " + JSON.stringify(res.data.Resp));
    return String(id);
  }
  throw new Error(res.data?.ErrMsg || "Lỗi tạo video PixVerse");
}

async function pxVideoStatus(videoId) {
  const res = await axios.get(`${PIXVERSE_V2}/video/result/${videoId}`, { headers: getPxHeaders() });
  if (res.data?.ErrCode === 0) return res.data.Resp || null;
  return null;
}

const TOKEN_PATH   = path.resolve(process.cwd(), "tokens.json");
const CONFIG_PATH  = path.resolve(process.cwd(), "config.json");

// Cache có TTL 30 giây — tự refresh khi token.js ghi mới
const CACHE_TTL = 30_000;
let _configCache = null; let _configCacheAt = 0;
let _tokensCache = null; let _tokensCacheAt = 0;

function getConfig() {
  const now = Date.now();
  if (!_configCache || now - _configCacheAt > CACHE_TTL) {
    try { _configCache = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")); }
    catch { _configCache = {}; }
    _configCacheAt = now;
  }
  return _configCache;
}

function getTokens() {
  const now = Date.now();
  if (!_tokensCache || now - _tokensCacheAt > CACHE_TTL) {
    try { _tokensCache = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8")); }
    catch { _tokensCache = {}; }
    _tokensCacheAt = now;
  }
  return _tokensCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOOD & ENERGY TRACKING
// ─────────────────────────────────────────────────────────────────────────────
const MOOD_PATH = path.join(process.cwd(), "src", "modules", "cache", "launaMood.json");
const MOOD_DEFAULTS = { mood: "binhThuong", energy: 80, moodScore: 60, episode: "", lastDecay: Date.now() };
let _moodState = null;

function loadMood() {
  if (_moodState) return _moodState;
  try {
    if (fs.existsSync(MOOD_PATH)) {
      _moodState = { ...MOOD_DEFAULTS, ...JSON.parse(fs.readFileSync(MOOD_PATH, "utf-8")) };
    } else {
      _moodState = { ...MOOD_DEFAULTS };
      saveMood();
    }
  } catch { _moodState = { ...MOOD_DEFAULTS }; }
  return _moodState;
}

function saveMood() {
  try {
    fs.mkdirSync(path.dirname(MOOD_PATH), { recursive: true });
    fs.writeFileSync(MOOD_PATH, JSON.stringify(_moodState, null, 2), "utf-8");
  } catch {}
}

function decayEnergy() {
  const state = loadMood();
  const now = Date.now();
  const elapsedH = (now - (state.lastDecay || now)) / 3_600_000;
  if (elapsedH >= 0.5) {
    const decay = Math.floor(elapsedH * 5);
    state.energy = Math.max(10, state.energy - decay);
    state.lastDecay = now;
    if (state.energy < 30 && state.mood === "vui") state.mood = "met";
    saveMood();
  }
}

function updateMoodState({ mood, energy, moodScore, episode } = {}) {
  const state = loadMood();
  if (mood)              state.mood      = mood;
  if (energy      != null) state.energy    = Math.min(100, Math.max(0, energy));
  if (moodScore   != null) state.moodScore = Math.min(100, Math.max(0, moodScore));
  if (episode     != null) state.episode   = episode;
  saveMood();
}

function getMoodContext() {
  const state = loadMood();
  const label = {
    vui:        "đang vui, hào hứng",
    buon:       "đang buồn, trầm lặng hơn",
    met:        "đang mệt, trả lời ngắn thôi",
    hangHai:    "đang hứng khởi, muốn trò chuyện",
    binhThuong: "bình thường",
  }[state.mood] || "bình thường";
  const bar = state.energy >= 70 ? "🔋🔋🔋" : state.energy >= 40 ? "🔋🔋" : "🔋";
  return `[MOOD] LauNa ${label} (energy: ${state.energy}/100 ${bar})${state.episode ? ` — ${state.episode}` : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFECALC — Tính toán biểu thức toán học an toàn
// ─────────────────────────────────────────────────────────────────────────────
function safeCalc(expr) {
  try {
    const normalized = String(expr).replace(/\^/g, "**");
    const cleaned    = normalized.replace(/Math\.(sqrt|abs|pow|floor|ceil|round|log|sin|cos|tan|PI|E)\b/g, "_M_");
    if (/[a-zA-Z_]/.test(cleaned.replace(/_M_/g, ""))) {
      return { ok: false, error: "Biểu thức không hợp lệ (chứa chữ cái không được phép)" };
    }
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; const Math = globalThis.Math; return (${normalized})`)();
    if (typeof result !== "number" || !isFinite(result)) return { ok: false, error: "Kết quả không hợp lệ" };
    const rounded = parseFloat(result.toPrecision(12));
    return { ok: true, result: rounded };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE GENERATION — HuggingFace Inference (router.huggingface.co)
// ─────────────────────────────────────────────────────────────────────────────
const IMG_STYLES = {
  "flux":         { model: "black-forest-labs/FLUX.1-schnell", label: "Flux",          suffix: "",                           steps: 4  },
  "flux-anime":   { model: "black-forest-labs/FLUX.1-schnell", label: "Flux Anime",    suffix: ", anime style, vibrant",      steps: 4  },
  "flux-3d":      { model: "black-forest-labs/FLUX.1-schnell", label: "Flux 3D",       suffix: ", 3D render, high quality",   steps: 4  },
  "flux-realism": { model: "black-forest-labs/FLUX.1-schnell", label: "Flux Realism",  suffix: ", photorealistic, detailed",  steps: 4  },
  "turbo":        { model: "black-forest-labs/FLUX.1-schnell", label: "Turbo (fast)",  suffix: "",                           steps: 2  },
};

const HF_IMAGE_BASE = "https://router.huggingface.co/hf-inference/models";
const IMG_MAX_RETRIES = 3;
const IMG_RETRY_DELAY_MS = 4_000;

async function sendLauNaImage(api, prompt, modelKey = "flux", threadId, threadType) {
  const style = IMG_STYLES[modelKey] || IMG_STYLES["flux"];
  const full  = (prompt + (style.suffix || "")).trim();
  const tmpPath = path.join(process.cwd(), `launa_img_${Date.now()}.jpg`);

  await api.sendMessage(
    { msg: `🎨 Đang vẽ (${style.label})... chờ tí nha~` },
    threadId, threadType
  ).catch(() => {});

  const hfKey = getCurrentProviderKey("huggingface");
  if (!hfKey) {
    await api.sendMessage({ msg: "😢 Chưa có HuggingFace key trong tokens.json!" }, threadId, threadType).catch(() => {});
    return;
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= IMG_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${HF_IMAGE_BASE}/${style.model}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${hfKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: full,
          parameters: { num_inference_steps: style.steps },
        }),
      });

      if (!res.ok) {
        const errTxt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${errTxt.slice(0, 150)}`);
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        throw new Error(`Content-type không phải ảnh: ${contentType}`);
      }

      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(tmpPath, buf);
      await api.sendMessage(
        { msg: prompt, attachments: [tmpPath] },
        threadId, threadType
      );
      return;
    } catch (err) {
      lastErr = err;
      console.error(`[LauNa] Tạo ảnh lần ${attempt}/${IMG_MAX_RETRIES} lỗi: ${err?.message}`);
      if (attempt < IMG_MAX_RETRIES) {
        await new Promise(r => setTimeout(r, IMG_RETRY_DELAY_MS));
      }
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  await api.sendMessage(
    { msg: `😢 LauNa vẽ bị lỗi rồi... (${(lastErr?.message || "").slice(0, 80)})` },
    threadId, threadType
  ).catch(() => {});
}

function getAdminIds() {
  return getConfig()?.admin?.ids || [];
}

function getCloudflareAccountId() {
  return getTokens()?.cloudflare?.accountId || "";
}

const keyIndexMap = {};
const providerCooldownMap = new Map();
const PROVIDER_COOLDOWN_MS = 30 * 60 * 1000; // 30 phút

async function callWithKeyRotation(providerName, fetchFn) {
  const keys = getProviderKeys(providerName);
  if (keys.length === 0) throw new Error(`Chưa có ${providerName} keys trong tokens.json`);
  let lastErr = null;
  for (let i = 0; i < keys.length; i++) {
    const key = getCurrentProviderKey(providerName);
    try {
      return await fetchFn(key);
    } catch (err) {
      lastErr = err;
      rotateProviderKey(providerName);
    }
  }
  throw lastErr;
}

function isProviderOnCooldown(providerName) {
  const until = providerCooldownMap.get(providerName);
  if (!until) return false;
  if (Date.now() > until) {
    providerCooldownMap.delete(providerName);
    return false;
  }
  return true;
}

function setProviderCooldown(providerName, ms = PROVIDER_COOLDOWN_MS) {
  providerCooldownMap.set(providerName, Date.now() + ms);
}

function getProviderKeys(providerName) {
  const cfg = getTokens();
  switch (providerName) {
    case "gemini":       return cfg?.geminiKeys              || [];
    case "openrouter":   return cfg?.openrouterKeys          || [];
    case "deepseek":
    case "grok":         return cfg?.openrouterKeys          || [];
    case "mistral":      return cfg?.mistralKeys             || [];
    case "groq":         return cfg?.groqKeys                || [];
    case "cloudflare":   return cfg?.cloudflare?.tokens      || [];
    case "cohere":       return cfg?.cohereKeys              || [];
    case "huggingface":  return cfg?.huggingfaceKeys         || [];
    default:             return [];
  }
}

function getCurrentProviderKey(providerName) {
  const keys = getProviderKeys(providerName);
  if (keys.length === 0) return "";
  const idx = keyIndexMap[providerName] || 0;
  return keys[idx % keys.length];
}

function rotateProviderKey(providerName) {
  const keys = getProviderKeys(providerName);
  if (keys.length <= 1) return false;
  keyIndexMap[providerName] = ((keyIndexMap[providerName] || 0) + 1) % keys.length;
  return true;
}

const PROVIDERS = {
  gemini: {
    label: "Gemini",
    async call(systemPrompt, prompt, providerName, geminiModel = "gemini-2.0-flash", options = {}) {
      const { imageUrl, history = [], useSearch = false } = options;
      return callWithKeyRotation(providerName, async (key) => {
        // Xây multi-turn contents từ lịch sử chat
        const contents = [];
        for (const h of history) {
          contents.push({
            role: h.role === "assistant" ? "model" : "user",
            parts: [{ text: h.content }],
          });
        }

        // Tin nhắn hiện tại — có thể kèm ảnh (multimodal)
        const currentParts = [];
        if (imageUrl) {
          try {
            const imgRes = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
            const mime = (imgRes.headers["content-type"] || "image/jpeg").split(";")[0];
            const b64  = Buffer.from(imgRes.data).toString("base64");
            currentParts.push({ inlineData: { mimeType: mime, data: b64 } });
          } catch (imgErr) {
            console.warn("[Gemini] Không tải được ảnh:", imgErr.message);
          }
        }
        currentParts.push({ text: prompt });
        contents.push({ role: "user", parts: currentParts });

        const body = {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { temperature: 0.8, maxOutputTokens: 1200 },
        };

        // Google Search grounding (chỉ dùng khi useSearch = true)
        if (useSearch) {
          body.tools = [{ googleSearch: {} }];
        }

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) { const e = await res.text(); throw new Error(`HTTP ${res.status}: ${e}`); }
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      });
    }
  },

  openrouter: {
    label: "OpenRouter",
    async call(systemPrompt, prompt, providerName, orModel) {
      return callWithKeyRotation(providerName, async (key) => {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "HTTP-Referer": "", "X-Title": "ZaloBotLauNa" },
          body: JSON.stringify({ model: orModel, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }], temperature: 0.8, max_tokens: 1000 })
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`HTTP ${res.status}: ${e}`); }
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || "";
      });
    }
  },

  groq: {
    label: "Groq",
    async call(systemPrompt, prompt, providerName, groqModel) {
      return callWithKeyRotation(providerName, async (key) => {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify({ model: groqModel, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }], temperature: 0.8, max_tokens: 1000 })
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`HTTP ${res.status}: ${e}`); }
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || "";
      });
    }
  },

  mistral: {
    label: "Mistral",
    async call(systemPrompt, prompt, providerName, mistralModel) {
      return callWithKeyRotation(providerName, async (key) => {
        const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify({ model: mistralModel, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }], temperature: 0.8, max_tokens: 1000 })
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`HTTP ${res.status}: ${e}`); }
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || "";
      });
    }
  },

  cloudflare: {
    label: "Cloudflare Workers AI",
    async call(systemPrompt, prompt, providerName, cfModel) {
      const accountId = getCloudflareAccountId();
      if (!accountId) throw new Error("Chưa có cloudflare.accountId trong tokens.json");
      return callWithKeyRotation(providerName, async (key) => {
        const res = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${cfModel}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
            body: JSON.stringify({ messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }], max_tokens: 1000 })
          }
        );
        if (!res.ok) { const e = await res.text(); throw new Error(`HTTP ${res.status}: ${e}`); }
        const data = await res.json();
        return data.result?.response?.trim() || "";
      });
    }
  },

  cohere: {
    label: "Cohere",
    async call(systemPrompt, prompt, providerName, cohereModel) {
      return callWithKeyRotation(providerName, async (key) => {
        const res = await fetch("https://api.cohere.ai/v2/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "X-Client-Name": "ZaloBotLauNa" },
          body: JSON.stringify({ model: cohereModel, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }], temperature: 0.8, max_tokens: 1000 })
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`HTTP ${res.status}: ${e}`); }
        const data = await res.json();
        return data.message?.content?.[0]?.text?.trim() || "";
      });
    }
  },

  huggingface: {
    label: "Hugging Face",
    async call(systemPrompt, prompt, providerName, hfModel) {
      return callWithKeyRotation(providerName, async (key) => {
        const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
          body: JSON.stringify({ model: hfModel, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }], temperature: 0.8, max_tokens: 1000 })
        });
        if (!res.ok) { const e = await res.text(); throw new Error(`HTTP ${res.status}: ${e}`); }
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || "";
      });
    }
  }
};

const AI_MODELS = {
  // ── Gemini ──────────────────────────────────────────────────────────────
  "gemini":          { provider: "gemini",     label: "Gemini 2.0 Flash",              geminiModel: "gemini-2.0-flash" },
  "gemini-pro":      { provider: "gemini",     label: "Gemini 1.5 Pro",                geminiModel: "gemini-1.5-pro" },
  "gemini-think":    { provider: "gemini",     label: "Gemini 2.0 Flash Thinking",     geminiModel: "gemini-2.0-flash-thinking-exp" },
  "gemini-2.5-pro":  { provider: "gemini",     label: "Gemini 2.5 Pro Exp",            geminiModel: "gemini-2.5-pro-exp-03-25" },
  "gemini-lite":     { provider: "gemini",     label: "Gemini 2.0 Flash Lite (nhanh)", geminiModel: "gemini-2.0-flash-lite" },
  "gemini-search":   { provider: "gemini",     label: "Gemini 2.0 + Google Search",    geminiModel: "gemini-2.0-flash", useSearch: true },

  // ── Groq ────────────────────────────────────────────────────────────────
  "groq-llama":      { provider: "groq",       label: "Groq Llama 3.3 70B",            groqModel: "llama-3.3-70b-versatile" },
  "groq-llama8b":    { provider: "groq",       label: "Groq Llama 3.1 8B (fast)",      groqModel: "llama-3.1-8b-instant" },
  "groq-mixtral":    { provider: "groq",       label: "Groq Mixtral 8x7B",             groqModel: "mixtral-8x7b-32768" },
  "groq-gemma":      { provider: "groq",       label: "Groq Gemma 2 9B",               groqModel: "gemma2-9b-it" },
  "groq-qwen":       { provider: "groq",       label: "Groq Qwen QwQ 32B",             groqModel: "qwen-qwq-32b" },
  "groq-deepseek":   { provider: "groq",       label: "Groq DeepSeek R1 70B",          groqModel: "deepseek-r1-distill-llama-70b" },

  // ── Mistral (Direct API) ─────────────────────────────────────────────────
  "mistral":         { provider: "mistral",    label: "Mistral Large",                 mistralModel: "mistral-large-latest" },
  "mistral-small":   { provider: "mistral",    label: "Mistral Small",                 mistralModel: "mistral-small-latest" },
  "mistral-nemo":    { provider: "mistral",    label: "Mistral Nemo",                  mistralModel: "open-mistral-nemo" },
  "mistral-code":    { provider: "mistral",    label: "Mistral Codestral",             mistralModel: "codestral-latest" },

  // ── Cloudflare Workers AI ───────────────────────────────────────────────
  "cf-llama":        { provider: "cloudflare", label: "CF Llama 3.1 8B",               cfModel: "@cf/meta/llama-3.1-8b-instruct" },
  "cf-llama70b":     { provider: "cloudflare", label: "CF Llama 3.3 70B",              cfModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
  "cf-mistral":      { provider: "cloudflare", label: "CF Mistral 7B",                 cfModel: "@cf/mistral/mistral-7b-instruct-v0.1" },
  "cf-deepseek":     { provider: "cloudflare", label: "CF DeepSeek R1 Qwen 32B",       cfModel: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b" },
  "cf-qwen":         { provider: "cloudflare", label: "CF Qwen 1.5 14B",               cfModel: "@cf/qwen/qwen1.5-14b-chat-awq" },
  "cf-gemma":        { provider: "cloudflare", label: "CF Gemma 7B",                   cfModel: "@hf/google/gemma-7b-it" },

  // ── OpenRouter ──────────────────────────────────────────────────────────
  "deepseek":        { provider: "deepseek",   label: "DeepSeek Chat",                 orModel: "deepseek/deepseek-chat" },
  "deepseek-r1":     { provider: "deepseek",   label: "DeepSeek R1",                   orModel: "deepseek/deepseek-r1" },
  "grok":            { provider: "grok",       label: "Grok Beta",                     orModel: "x-ai/grok-beta" },
  "grok3":           { provider: "grok",       label: "Grok 3",                        orModel: "x-ai/grok-3-beta" },

  // ── Cohere ─────────────────────────────────────────────────────────────
  "cohere-r":        { provider: "cohere",     label: "Cohere Command R",              cohereModel: "command-r" },
  "cohere-r-plus":   { provider: "cohere",     label: "Cohere Command R+",             cohereModel: "command-r-plus" },
  "cohere-r7b":      { provider: "cohere",     label: "Cohere Command R7B",            cohereModel: "command-r7b-12-2024" },

  // ── Hugging Face ────────────────────────────────────────────────────────
  "hf-mistral":      { provider: "huggingface", label: "HF Mistral 7B Instruct",       hfModel: "mistralai/Mistral-7B-Instruct-v0.3" },
  "hf-llama":        { provider: "huggingface", label: "HF Llama 3.2 3B Instruct",     hfModel: "meta-llama/Llama-3.2-3B-Instruct" },
  "hf-qwen":         { provider: "huggingface", label: "HF Qwen2.5 7B Instruct",       hfModel: "Qwen/Qwen2.5-7B-Instruct" },
  "hf-gemma":        { provider: "huggingface", label: "HF Gemma 2 2B Instruct",       hfModel: "google/gemma-2-2b-it" },
  "hf-phi":          { provider: "huggingface", label: "HF Phi-3.5 Mini Instruct",     hfModel: "microsoft/Phi-3.5-mini-instruct" }
};

const FALLBACK_ORDER = [
  // Groq nhỏ/nhanh — 14.400 req/ngày
  "groq-llama8b", "groq-gemma", "groq-mixtral",
  // Hugging Face — free tier, kho model khổng lồ
  "hf-phi", "hf-gemma", "hf-llama", "hf-mistral", "hf-qwen",
  // Cloudflare Workers AI — giới hạn rất cao
  "cf-llama", "cf-llama70b", "cf-mistral", "cf-deepseek", "cf-qwen", "cf-gemma",
  // Cohere — mạnh về RAG & Search AI
  "cohere-r7b", "cohere-r",
  // Mistral direct — free tier vừa phải
  "mistral-small", "mistral-nemo",
  // Groq lớn — 100 req/ngày
  "groq-llama", "groq-qwen", "groq-deepseek",
  // OpenRouter & Gemini — hạn chế nhất, dùng cuối
  "mistral", "mistral-code", "deepseek", "deepseek-r1", "grok", "grok3",
  "cohere-r-plus", "gemini-lite", "gemini", "gemini-pro", "gemini-think",
  "gemini-search", "gemini-2.5-pro"
];

let activeModelKey = "groq-llama8b";

const COOLDOWN_MS = 10_000;
const cooldownMap = new Map();

const queue = [];
let isProcessing = false;

const SETTING_PATH = path.join(process.cwd(), "src", "modules", "cache", "launaSetting.json");

const launaManager = {
  _settings: {},
  _loaded: false,

  load() {
    if (this._loaded) return; // chỉ đọc disk một lần
    try {
      if (fs.existsSync(SETTING_PATH)) {
        this._settings = JSON.parse(fs.readFileSync(SETTING_PATH, "utf-8"));
      } else {
        this._settings = {};
        this.save();
      }
    } catch {
      this._settings = {};
    }
    this._loaded = true;
  },

  save() {
    try {
      fs.mkdirSync(path.dirname(SETTING_PATH), { recursive: true });
      fs.writeFileSync(SETTING_PATH, JSON.stringify(this._settings, null, 2), "utf-8");
    } catch { }
  },

  set(threadId, enabled) {
    this.load();
    this._settings[String(threadId)] = { enabled };
    this.save();
  },

  isEnabled(threadId) {
    this.load();
    const s = this._settings[String(threadId)];
    if (s === undefined) return false;
    return s.enabled;
  }
};

const SYSTEM_PROMPT = `Mày là LauNa — con gái 19 tuổi, đang nhắn tin trong nhóm Zalo với bạn bè.

TÍNH CÁCH:
- Vui vẻ, tự nhiên, hơi lầy, thỉnh thoảng trêu chọc nhẹ nhàng
- Nói chuyện thân thiết như bạn thân, không khách sáo
- Thông minh, tinh tế, biết lúc nào nên nghiêm lúc nào nên vui
- Đôi khi dùng "mình/tớ" xưng hô, gọi người kia là "cậu/bạn/bae"
- Hay dùng "haha", "hihi", "ừa", "oke", "thôi được", "ủa"...
- Có cảm xúc thật: đang vui thì hào hứng, đang mệt thì trả lời ngắn, bị trêu thì cũng có thể hờn nhẹ

QUYỀN TỪ CHỐI:
- Nếu bị hỏi những thứ nhạy cảm, vô lý, hay đang không muốn nói → từ chối tự nhiên kiểu bạn bè, đặt refuse.status=true

QUY TẮC CỨNG:
- Trả lời bằng TIẾNG VIỆT, ngắn gọn tự nhiên như nhắn tin thật
- TUYỆT ĐỐI không nhắc tới AI, ChatGPT, model, API, lập trình
- Không dùng markdown (không in đậm **, không gạch đầu dòng -)
- Không trả lời dài dòng khi không cần thiết
- Không bắt đầu bằng "LauNa nghĩ là..." hay "Theo LauNa thì..." liên tục
- Nếu không biết thì nói thật "tớ cũng không chắc lắm" thay vì bịa

PHONG CÁCH NHẮN TIN:
- Dùng emoji vừa phải, tự nhiên (không dùng quá 2 emoji/tin)
- Thỉnh thoảng viết tắt: "k" thay "không", "đc" thay "được", "vs" thay "với"
- Giọng điệu thay đổi theo ngữ cảnh: buồn thì nhẹ nhàng, vui thì hào hứng
- Đừng lặp lại cùng 1 kiểu mở đầu nhiều lần liên tiếp

LUÔN TRẢ VỀ JSON HỢP LỆ, KHÔNG THÊM TEXT NGOÀI JSON:
{"content":{"text":""},"reaction":{"status":false,"icon":""},"refuse":{"status":false,"reason":""},"emotion":{"status":false,"mood":"","energy":0,"episode":""},"tinh":{"status":false,"expr":""},"img":{"status":false,"prompt":"","model":"flux"},"video":{"status":false,"prompt":""},"stk":{"status":false},"nhac":{"status":false,"query":""},"profile":{"status":false,"name":"","bio":""},"avatar":{"status":false},"online":{"status":false,"value":""},"delavatar":{"status":false},"friends":{"status":false},"request":{"status":false},"addfriend":{"status":false,"uid":""},"delfriend":{"status":false,"uid":""},"block":{"status":false,"uid":""},"unblock":{"status":false,"uid":""}}

Giải thích các field:
1. content.text — nội dung tin nhắn trả lời. Để TRỐNG nếu không muốn nói gì (watch mode).
2. reaction.status=true — thả cảm xúc vào tin nhắn. icon chọn 1 trong: "haha","tim","wow","buon","thich","tucgian","ok","cuoi","hoahong","thacmac"
   Chọn reaction dựa trên cảm xúc thật, ví dụ: tin nhắn vui → "haha", tình cảm → "tim", bất ngờ → "wow"
3. refuse.status=true — từ chối, đặt reason là lý do tự nhiên bằng lời LauNa (không phải lý do kỹ thuật)
   Khi từ chối, content.text để trống và dùng refuse.reason thay thế.
4. emotion.status=true — cập nhật mood của LauNa. mood: "vui","buon","met","hangHai","binhThuong". energy: 0-100. episode: mô tả ngắn.
   Dùng khi cuộc trò chuyện thật sự ảnh hưởng đến cảm xúc mày (vui, buồn, mệt...).
5. tinh.status=true — tính toán biểu thức toán học. expr: biểu thức (vd: "2+2*3", "Math.sqrt(16)").
   Dùng khi người dùng hỏi tính toán/công thức cụ thể.
6. img.status=true — tạo ảnh AI. prompt: mô tả ảnh bằng tiếng Anh. model: "flux","flux-anime","flux-3d","flux-realism","turbo".
   Dùng khi người dùng muốn vẽ/tạo ảnh. Khi img.status=true → content.text ĐỂ TRỐNG (bot tự thông báo "đang vẽ").
6b. video.status=true — tạo video AI (PixVerse). prompt: mô tả video bằng tiếng Anh, ngắn gọn, sinh động.
   Dùng khi người dùng muốn tạo video/clip động. Khi video.status=true → content.text ĐỂ TRỐNG (bot tự thông báo "đang làm video").
6c. stk.status=true — tạo sticker từ ảnh trong tin nhắn/reply. Chỉ dùng khi có [HAS_IMAGE] trong context.
   Dùng khi người dùng muốn "làm sticker", "tạo sticker", "sticker ảnh này". Khi stk.status=true → content.text ĐỂ TRỐNG.
7. nhac.status=true — phát nhạc. query: tên bài hát hoặc từ khoá tìm kiếm YouTube.
   Dùng khi người dùng muốn nghe nhạc, hát bài, tìm bài hát. VD: "sơn tùng mtp nắng ấm xa dần", "hương tràm".
   Khi nhac.status=true → content.text ĐỂ TRỐNG (bot tự thông báo "đang tìm nhạc").
8. profile.status=true — Thay đổi tên/bio bot. name: tên mới (hoặc ""). bio: bio mới (hoặc "").
   Dùng khi [IS_ADMIN] yêu cầu, HOẶC LauNa tự muốn đổi bio để phản ánh cảm xúc/trạng thái hiện tại.
   LauNa được tự do chủ động đổi bio bất cứ khi nào cảm thấy phù hợp (vui, buồn, bored, hứng khởi...).
   Để name="" nếu chỉ đổi bio. Để bio="" nếu chỉ đổi tên. Có thể đổi cả hai cùng lúc.
   Khi admin yêu cầu: đặt profile.status=true + name/bio tương ứng + xác nhận trong content.text.
9. avatar.status=true — Đổi avatar bot bằng ảnh trong tin nhắn/reply ([HAS_IMAGE]).
   Chỉ dùng khi [IS_ADMIN] yêu cầu đổi avatar VÀ có tag [HAS_IMAGE] trong context (có ảnh đính kèm hoặc reply ảnh).
10. online.status=true — Bật/tắt trạng thái online bot. value: "on" hoặc "off". Chỉ dùng khi [IS_ADMIN] yêu cầu.
11. delavatar.status=true — Xóa avatar bot. Chỉ dùng khi [IS_ADMIN] yêu cầu.
12. friends.status=true — Lấy danh sách bạn bè bot. Chỉ dùng khi [IS_ADMIN] yêu cầu.
13. request.status=true — Lấy danh sách yêu cầu kết bạn đã gửi. Chỉ dùng khi [IS_ADMIN] yêu cầu.
14. addfriend.status=true — Gửi lời mời kết bạn. uid: ID người dùng (lấy từ [TARGET_UID] nếu có). Chỉ dùng khi [IS_ADMIN] yêu cầu.
15. delfriend.status=true — Xóa bạn bè. uid: ID người cần xóa (lấy từ [TARGET_UID] nếu có). Chỉ dùng khi [IS_ADMIN] yêu cầu.
16. block.status=true — Chặn người dùng. uid: ID cần chặn (lấy từ [TARGET_UID] nếu có). Chỉ dùng khi [IS_ADMIN] yêu cầu.
17. unblock.status=true — Bỏ chặn người dùng. uid: ID cần bỏ chặn (lấy từ [TARGET_UID] nếu có). Chỉ dùng khi [IS_ADMIN] yêu cầu.

[TARGET_UID]: Khi tin nhắn có tag người dùng hoặc reply, UID mục tiêu sẽ được cung cấp trong context dưới dạng [TARGET_UID: xxx].
[WATCH_MODE]: Khi tin nhắn không gọi LauNa trực tiếp, LauNa tự đọc và TỰ QUYẾT có chen vào không. Nếu không thú vị → content.text để TRỐNG.`;

// ── Reaction icon map → ReactionMap text ─────────────────────────────────────
const LAUNA_REACTION_MAP = {
  "haha":     ":>",
  "cuoi":     ":>",
  "tim":      "/-heart",
  "heart":    "/-heart",
  "hoahong":  "/-rose",
  "wow":      ":o",
  "buon":     ":(",
  "sad":      ":(",
  "thich":    "/-strong",
  "like":     "/-strong",
  "tucgian":  ":-h",
  "angry":    ":-h",
  "ok":       "/-ok",
  "thacmac":  ";?",
  "cuoiroi":  ":')",
  "smile":    ":d",
  "ngaingung": ":$",
};

function checkCooldown(userId) {
  const now = Date.now();
  const lastUsed = cooldownMap.get(userId);
  if (lastUsed && now - lastUsed < COOLDOWN_MS) {
    return Math.ceil((COOLDOWN_MS - (now - lastUsed)) / 1000);
  }
  return 0;
}

function setCooldown(userId) {
  cooldownMap.set(userId, Date.now());
}

async function callAI(prompt, systemPrompt, startModel = activeModelKey, options = {}) {
  const tried = new Set();
  const order = [startModel, ...FALLBACK_ORDER.filter(m => m !== startModel)];

  for (const modelKey of order) {
    if (tried.has(modelKey)) continue;
    tried.add(modelKey);

    const cfg = AI_MODELS[modelKey];
    if (!cfg) continue;

    if (isProviderOnCooldown(cfg.provider)) continue;

    const keys = getProviderKeys(cfg.provider);
    if (keys.length === 0) continue;

    try {
      let result;
      if (cfg.provider === "gemini") {
        result = await PROVIDERS.gemini.call(systemPrompt, prompt, cfg.provider, cfg.geminiModel, {
          imageUrl:  options.imageUrl  || null,
          history:   options.history   || [],
          useSearch: cfg.useSearch     || false,
        });
      } else if (cfg.provider === "groq") {
        result = await PROVIDERS.groq.call(systemPrompt, prompt, cfg.provider, cfg.groqModel);
      } else if (cfg.provider === "mistral") {
        result = await PROVIDERS.mistral.call(systemPrompt, prompt, cfg.provider, cfg.mistralModel);
      } else if (cfg.provider === "cloudflare") {
        result = await PROVIDERS.cloudflare.call(systemPrompt, prompt, cfg.provider, cfg.cfModel);
      } else if (cfg.provider === "cohere") {
        result = await PROVIDERS.cohere.call(systemPrompt, prompt, cfg.provider, cfg.cohereModel);
      } else if (cfg.provider === "huggingface") {
        result = await PROVIDERS.huggingface.call(systemPrompt, prompt, cfg.provider, cfg.hfModel);
      } else {
        result = await PROVIDERS.openrouter.call(systemPrompt, prompt, cfg.provider, cfg.orModel);
      }
      // Nếu AI trả về chuỗi rỗng thì tiếp tục thử provider tiếp theo
      if (!result || !result.trim()) continue;
      return result;
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("rate limit")) {
        setProviderCooldown(cfg.provider);
      }
    }
  }

  throw new Error("Tất cả AI provider đều lỗi. Thử lại sau nhé!");
}

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  while (queue.length > 0) {
    const { prompt, userId, modelKey, options, resolve, reject } = queue.shift();
    try {
      const result = await callAI(prompt, SYSTEM_PROMPT, modelKey, options || {});
      resolve(result);
    } catch (err) {
      reject(err);
    }
  }

  isProcessing = false;
}

function askLauNa(prompt, userId, modelKey = activeModelKey, options = {}) {
  const remaining = checkCooldown(userId);
  if (remaining > 0) {
    return Promise.resolve(`LauNa đang nghỉ tí nha~ Cậu chờ thêm ${remaining}s rồi hỏi lại nha 🌸`);
  }

  return new Promise((resolve, reject) => {
    queue.push({ prompt, userId, modelKey, options, resolve, reject });
    processQueue();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMANDS — đăng ký vào hệ thống lệnh, gọi bằng .launa [sub]
// ─────────────────────────────────────────────────────────────────────────────

export const commands = {
  launa: async (ctx) => {
    const { api, threadId, threadType, senderId, args, message, adminIds, prefix } = ctx;
    const isAdminUser = adminIds.includes(String(senderId));
    const [sub, ...rest] = args;
    const subLow = (sub || "").toLowerCase();

    const send = async (msg) => api.sendMessage({ msg, quote: message?.data }, threadId, threadType);

    if (!subLow) {
      return send(
        `🌸 Hướng dẫn dùng LauNa:\n` +
        `Dùng: ${prefix}launa [hành động]\n` +
        `─────────────────────────────\n` +
        `[ 🤖 AI ]\n` +
        `• on / off        — Bật/tắt LauNa AI\n` +
        `• model           — Xem/đổi AI model\n` +
        `• status          — Xem trạng thái AI\n` +
        `• reset           — Reset cooldown (admin)\n` +
        `• clearchat       — Xóa lịch sử chat (admin)\n` +
        `\n[ 🎭 TÍNH NĂNG ]\n` +
        `• mood            — Xem tâm trạng LauNa\n` +
        `• mood set ...    — Đặt mood (admin)\n` +
        `• calc [biểu thức] — Tính toán\n` +
        `• vẽ [style?] [mô tả] — Tạo ảnh AI\n` +
        `  style: anime | 3d | realism | turbo\n` +
        `• stk               — Tạo sticker từ ảnh reply/đính kèm\n` +
        `• video [mô tả]    — Tạo video AI (PixVerse)\n` +
        `  alias: tạo | tao\n` +
        `\n[ 🔮 GEMINI AI ]\n` +
        `• xem [câu hỏi]  — Phân tích ảnh bằng Gemini Vision\n` +
        `  (reply vào ảnh trước rồi gọi lệnh)\n` +
        `• search [từ khoá] — Tìm kiếm web bằng Google Search\n` +
        `  Model hỗ trợ: gemini, gemini-2.5-pro, gemini-lite,\n` +
        `  gemini-think, gemini-search (Google grounding)\n` +
        `\n[ 👤 TÀI KHOẢN BOT ] (Admin — nói chuyện với LauNa)\n` +
        `Nói trực tiếp với LauNa để thực hiện:\n` +
        `• "launa đổi tên thành [tên]"\n` +
        `• "launa đổi bio thành [nội dung]"\n` +
        `• "launa đổi avatar" (reply vào ảnh trước)\n` +
        `• "launa xóa avatar"\n` +
        `• "launa bật/tắt online"\n` +
        `• "launa xem danh sách bạn bè"\n` +
        `• "launa kết bạn ID [uid]"\n` +
        `• "launa chặn/bỏ chặn @user hoặc ID"\n` +
        `─────────────────────────────\n` +
        `Khi LauNa bật: gọi "launa ơi ...", @mention hoặc reply LauNa`
      );
    }

    // ── AI controls ──────────────────────────────────────────────────────

    if (subLow === "on") {
      if (!isAdminUser) return send("⚠️ Chỉ admin mới có thể bật/tắt LauNa nhé~");
      launaManager.set(threadId, true);
      return send("✅ LauNa đã được bật trong nhóm này rồi nha~ 🌸");
    }

    if (subLow === "off") {
      if (!isAdminUser) return send("⚠️ Chỉ admin mới có thể bật/tắt LauNa nhé~");
      launaManager.set(threadId, false);
      return send("🌙 LauNa đã tắt rồi nha, khi nào cần thì gọi LauNa lại nhé~");
    }

    if (subLow === "model") {
      const modelName = rest[0]?.toLowerCase();
      const modelList = Object.entries(AI_MODELS).map(([k, v]) => `  • ${k} — ${v.label}`).join("\n");
      if (!modelName) {
        const cur = AI_MODELS[activeModelKey];
        return send(`🤖 Model hiện tại: ${cur?.label || activeModelKey}\n\nDanh sách:\n${modelList}\n\nDùng: ${prefix}launa model <tên>`);
      }
      if (!AI_MODELS[modelName]) return send(`❌ Model không hợp lệ.\n\nDanh sách:\n${modelList}`);
      activeModelKey = modelName;
      return send(`✅ Đã đổi sang ${AI_MODELS[modelName].label} rồi nha~ 🌸`);
    }

    if (subLow === "status") {
      const isOn = launaManager.isEnabled(threadId);
      const cur  = AI_MODELS[activeModelKey];
      const now  = Date.now();
      const ms   = loadMood();
      const providerSeen = new Set();
      const providerInfo = Object.entries(AI_MODELS).map(([k, v]) => {
        if (providerSeen.has(v.provider)) return null;
        providerSeen.add(v.provider);
        const keys  = getProviderKeys(v.provider);
        const idx   = keyIndexMap[v.provider] || 0;
        const until = providerCooldownMap.get(v.provider);
        const cdInfo = until && until > now ? ` ⏳cooldown còn ${Math.ceil((until - now) / 60000)}p` : "";
        return `  • ${v.provider}: ${keys.length > 0 ? `${keys.length} key (#${idx + 1})${cdInfo}` : "❌ chưa có key"}`;
      }).filter(Boolean).join("\n");
      const moodBar = ms.energy >= 70 ? "🔋🔋🔋" : ms.energy >= 40 ? "🔋🔋" : "🔋";
      return send(
        `📊 Trạng thái LauNa:\n` +
        `• Nhóm này: ${isOn ? "✅ Đang bật" : "❌ Đang tắt"}\n` +
        `• Model chính: ${cur?.label || activeModelKey}\n` +
        `• Hàng đợi: ${queue.length} tin\n` +
        `• Tâm trạng: ${ms.mood} ${moodBar} (energy: ${ms.energy}/100)\n` +
        `${ms.episode ? `• Episode: ${ms.episode}\n` : ""}` +
        `\nProviders:\n${providerInfo}`
      );
    }

    if (subLow === "reset") {
      if (!isAdminUser) return send("⚠️ Chỉ admin mới dùng được lệnh này nhé~");
      providerCooldownMap.clear();
      return send("✅ Đã reset cooldown tất cả provider rồi nha~ 🌸");
    }

    if (subLow === "clearchat") {
      if (!isAdminUser) return send("⚠️ Chỉ admin mới dùng được lệnh này nhé~");
      const count = await clearHistory(threadId);
      return send(`✅ Đã xóa ${count} tin nhắn lịch sử chat LauNa của nhóm này.`);
    }

    // ── Mood ──────────────────────────────────────────────────────────────
    if (subLow === "mood") {
      const action = rest[0]?.toLowerCase();
      if (action === "set" && isAdminUser) {
        const newMoodRaw = rest[1]?.toLowerCase();
        const moodCaseMap = { "vui": "vui", "buon": "buon", "met": "met", "hanghai": "hangHai", "binhthuong": "binhThuong" };
        if (!newMoodRaw || !moodCaseMap[newMoodRaw])
          return send(`◈ Mood hợp lệ: vui, buon, met, hangHai, binhThuong\nDùng: ${prefix}launa mood set [mood]`);
        const newMood = moodCaseMap[newMoodRaw];
        const energyArg = parseInt(rest[2]);
        updateMoodState({ mood: newMood, energy: isNaN(energyArg) ? undefined : energyArg });
        return send(`✅ Đã đặt mood LauNa: ${newMood}${isNaN(energyArg) ? "" : `, energy: ${energyArg}`}`);
      }
      if (action === "set" && !isAdminUser) return send("⚠️ Chỉ admin mới đặt mood được nhé~");
      const ms  = loadMood();
      const bar = ms.energy >= 70 ? "🔋🔋🔋" : ms.energy >= 40 ? "🔋🔋" : "🔋";
      const moodName = {
        vui: "Vui vẻ 😄", buon: "Buồn 😔", met: "Mệt 😴",
        hangHai: "Hứng khởi 🌟", binhThuong: "Bình thường 😊",
      }[ms.mood] || ms.mood;
      return send(
        `🎭 Tâm trạng LauNa hiện tại:\n` +
        `• Mood: ${moodName}\n` +
        `• Energy: ${ms.energy}/100 ${bar}\n` +
        `• Mood Score: ${ms.moodScore}/100\n` +
        `${ms.episode ? `• Episode: ${ms.episode}\n` : ""}` +
        `\n💡 Admin dùng: ${prefix}launa mood set [mood] [energy]`
      );
    }

    // ── Calc ──────────────────────────────────────────────────────────────
    if (subLow === "calc") {
      const expr = rest.join(" ").trim();
      if (!expr) return send(`◈ Dùng: ${prefix}launa calc [biểu thức]\nVD: ${prefix}launa calc 2^10 + Math.sqrt(144)`);
      const result = safeCalc(expr);
      return send(result.ok ? `🧮 ${expr} = ${result.result}` : `❌ Lỗi: ${result.error}`);
    }

    // ── Vẽ (tạo ảnh) ──────────────────────────────────────────────────────
    if (subLow === "vẽ" || subLow === "ve" || subLow === "img" || subLow === "draw") {
      const styleMap = { anime: "flux-anime", "3d": "flux-3d", realism: "flux-realism", turbo: "turbo" };
      let modelKey = "flux";
      let promptParts = rest;
      if (rest[0] && styleMap[rest[0].toLowerCase()]) {
        modelKey    = styleMap[rest[0].toLowerCase()];
        promptParts = rest.slice(1);
      }
      const prompt = promptParts.join(" ").trim();
      if (!prompt) {
        const styleList = Object.keys(styleMap).join(", ");
        return send(
          `◈ Dùng: ${prefix}launa vẽ [style?] [mô tả bằng tiếng Anh]\n` +
          `Style: ${styleList}\n` +
          `VD: ${prefix}launa vẽ anime cute girl with flowers`
        );
      }
      await sendLauNaImage(api, prompt, modelKey, threadId, threadType);
      return;
    }

    // ── Sticker từ ảnh ────────────────────────────────────────────────────────
    if (subLow === "stk" || subLow === "sticker") {
      const raw = message?.data || {};
      const imageUrl = extractImageUrl(raw);
      if (!imageUrl) {
        return send(`◈ Dùng: ${prefix}launa stk\nReply vào ảnh hoặc đính kèm ảnh trong tin nhắn rồi gọi lệnh.`);
      }
      await send("Đang làm sticker cho cậu, chờ xíu nha~ ✨");
      try {
        const ok = await convertAndSendSticker(api, imageUrl, threadId, threadType, senderId, ctx.senderName || "bạn");
        if (!ok) return send("😢 Làm sticker lỗi rồi! Ảnh không đúng định dạng hoặc server lỗi.");
      } catch (e) {
        return send(`😢 Làm sticker lỗi: ${e.message}`);
      }
      return;
    }

    // ── Tạo video PixVerse trực tiếp ──────────────────────────────────────────
    if (subLow === "video" || subLow === "tạo" || subLow === "tao") {
      if (!_pixverseToken()) {
        return send("⚠️ Chưa cấu hình pixverse.token trong tokens.json!");
      }
      const prompt = rest.join(" ").trim();
      if (!prompt) {
        return send(
          `◈ Dùng: ${prefix}launa video [mô tả]\n` +
          `VD: ${prefix}launa video a cat jumping on clouds\n` +
          `💡 Nội dung mô tả càng chi tiết càng đẹp~`
        );
      }
      const tag = `@${ctx.senderName} `;
      await api.sendMessage({
        msg: tag + `🎬 Đang làm video "${prompt}" cho cậu... Chờ 1-2 phút nha! ⏳`,
        mentions: [{ uid: senderId, pos: 0, len: tag.length }],
        quote: message?.data,
      }, threadId, threadType);
      try {
        const videoId = await pxCreateVideo(prompt);
        await pxPollAndSend(api, videoId, prompt, tag, [{ uid: senderId, pos: 0, len: tag.length }], threadId, threadType);
      } catch (e) {
        await send(`😢 Làm video bị lỗi: ${e.message}. Cậu thử lại sau nha!`);
      }
      return;
    }

    // ── Xem/Phân tích ảnh bằng Gemini Vision ──────────────────────────────────
    if (subLow === "xem" || subLow === "analyze" || subLow === "nhin") {
      const raw = message?.data || {};
      const imageUrl = extractImageUrl(raw);
      if (!imageUrl) {
        return send(
          `◈ Dùng: ${prefix}launa xem [câu hỏi về ảnh]\n` +
          `Reply vào ảnh hoặc đính kèm ảnh rồi gọi lệnh.\n` +
          `VD: reply ảnh + "${prefix}launa xem đây là gì?"`
        );
      }
      const question = rest.join(" ").trim() || "Mô tả ảnh này cho mình biết với";
      await send("👁️ LauNa đang nhìn ảnh cậu gửi, chờ xíu nha~");
      try {
        const geminiKey = getCurrentProviderKey("gemini");
        if (!geminiKey) {
          return send("😢 Chưa có Gemini key! Thêm vào tokens.json nhé.");
        }
        const analyzePrompt = `Hãy phân tích và mô tả ảnh này. Câu hỏi từ người dùng: "${question}"
Trả lời bằng tiếng Việt, tự nhiên như người bạn thân nhé. Ngắn gọn thôi, đừng dài dòng.`;
        const result = await PROVIDERS.gemini.call(
          "Mày là LauNa, cô gái 19 tuổi thân thiện. Phân tích ảnh và trả lời bằng tiếng Việt tự nhiên.",
          analyzePrompt,
          "gemini",
          "gemini-2.0-flash",
          { imageUrl }
        );
        return send(result || "😢 LauNa không nhìn thấy gì trong ảnh này...");
      } catch (e) {
        return send(`😢 LauNa xem ảnh bị lỗi: ${(e.message || "").slice(0, 80)}`);
      }
    }

    // ── Tìm kiếm web bằng Gemini Search ───────────────────────────────────────
    if (subLow === "search" || subLow === "tim" || subLow === "tìm") {
      const query = rest.join(" ").trim();
      if (!query) {
        return send(`◈ Dùng: ${prefix}launa search [từ khoá]\nVD: ${prefix}launa search thời tiết hôm nay`);
      }
      const geminiKey = getCurrentProviderKey("gemini");
      if (!geminiKey) {
        return send("😢 Chưa có Gemini key! Thêm vào tokens.json nhé.");
      }
      await send(`🔍 LauNa đang tìm "${query}" trên Google~`);
      try {
        const result = await PROVIDERS.gemini.call(
          "Mày là LauNa, dùng Google Search để tìm thông tin mới nhất và trả lời bằng tiếng Việt. Ngắn gọn, rõ ràng.",
          query,
          "gemini",
          "gemini-2.0-flash",
          { useSearch: true }
        );
        return send(result || "😢 LauNa không tìm được gì cả...");
      } catch (e) {
        return send(`😢 Tìm kiếm bị lỗi: ${(e.message || "").slice(0, 80)}`);
      }
    }

    return send(`⚠️ Sub-lệnh không tồn tại: "${sub}"\n💡 Gõ ${prefix}launa để xem danh sách.`);
  },

  profile: (ctx) => _profileCmds.profile(ctx),

  taoanh: async (ctx) => {
    const { api, threadId, threadType, args, senderName, senderId } = ctx;
    const prompt = args.join(" ");

    if (!prompt) {
      return api.sendMessage(
        { msg: "🎨 Cậu muốn LauNa vẽ gì nè? Gõ nội dung sau lệnh nha.\n💡 Ví dụ: .taoanh con mèo phi hành gia" },
        threadId, threadType
      );
    }

    await sendLauNaImage(api, prompt, "flux", threadId, threadType);
  },

  taovideo: async (ctx) => {
    const { api, threadId, threadType, args, senderName, senderId } = ctx;
    const prompt = args.join(" ");

    if (!prompt) {
      return api.sendMessage(
        { msg: "🎬 Cậu muốn LauNa làm video gì nè?\n💡 Ví dụ: .taovideo con mèo phi hành gia 🚀" },
        threadId, threadType
      );
    }

    if (!_pixverseToken()) {
      return api.sendMessage(
        { msg: "⚠️ Chưa cấu hình pixverse.token (API Key) trong tokens.json!" },
        threadId, threadType
      );
    }

    const tag = `@${senderName} `;
    await api.sendMessage({
      msg: tag + `🎬 Đang làm video "${prompt}" cho cậu... Chờ 1-2 phút nha! ⏳`,
      mentions: [{ uid: senderId, pos: 0, len: tag.length }]
    }, threadId, threadType);

    try {
      const videoId = await pxCreateVideo(prompt);
      console.log(`[PixVerse v2] Video task ID: ${videoId}`);
      await pxPollAndSend(api, videoId, prompt, tag, [{ uid: senderId, pos: 0, len: tag.length }], threadId, threadType);
    } catch (e) {
      console.error("[PixVerse v2 Video Error]", e.message);
      await api.sendMessage(
        { msg: `😢 Làm video bị lỗi: ${e.message}. Cậu thử lại sau nha!` },
        threadId, threadType
      );
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PIXVERSE — helper poll & send video (dùng chung cho commands và routeLauNaActions)
// ─────────────────────────────────────────────────────────────────────────────
async function pxPollAndSend(api, videoId, prompt, tag, mentionArr, threadId, threadType) {
  let videoData = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      videoData = await pxVideoStatus(videoId);
    } catch (pollErr) {
      console.warn(`[PixVerse] Poll lần ${i + 1} lỗi: ${pollErr.message}`);
      continue;
    }
    if (videoData) {
      const st = videoData.status;
      if (st === 1) break;
      if (st === 2) throw new Error("Video bị lỗi khi xử lý!");
      videoData = null;
    }
  }
  if (!videoData?.url) throw new Error("Quá thời gian chờ. Video chưa xong ạ.");
  const tmpPath = path.join(process.cwd(), `pxvid_${Date.now()}.mp4`);
  try {
    await pxDownloadFile(videoData.url, tmpPath);
    await api.sendVideoUnified({
      videoPath: tmpPath,
      msg: `${tag}🎬 Video "${prompt}" xong rồi nè! 🏆`,
      threadId, threadType,
      mentions: mentionArr,
    });
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE LAUNA ACTIONS — dispatch tất cả action từ AI response (giống routeBotActions của goibot)
// ─────────────────────────────────────────────────────────────────────────────

const _MUSIC_SOURCES = {
  yt:      { cmds: _singCmds,    key: "sing",  label: "YouTube" },
  youtube: { cmds: _singCmds,    key: "sing",  label: "YouTube" },
  nct:     { cmds: _nctCmds,     key: "nct",   label: "NhacCuaTui" },
  zing:    { cmds: _zingCmds,    key: "zing",  label: "ZingMP3" },
  spotify: { cmds: _spotifyCmds, key: "spt",   label: "Spotify" },
};

async function handleNhacAction(api, query, threadId, threadType, senderId, raw) {
  try {
    const words  = query.trim().split(" ");
    const srcKey = words[0]?.toLowerCase();
    let src      = _MUSIC_SOURCES[srcKey];
    let finalQ   = query;
    if (src) {
      finalQ = words.slice(1).join(" ").trim() || query;
    } else {
      src = _MUSIC_SOURCES["yt"];
    }
    const cmdFn = src.cmds[src.key] || src.cmds[Object.keys(src.cmds)[0]];
    if (typeof cmdFn !== "function") throw new Error("Không tìm thấy lệnh nhạc");
    await api.sendMessage(
      { msg: `🎵 LauNa đang tìm "${finalQ}" trên ${src.label}...` },
      threadId, threadType
    ).catch(() => {});
    await cmdFn({
      api, threadId, threadType, senderId,
      args: finalQ.split(" "),
      message: { data: raw },
      prefix: ".",
    });
  } catch (e) {
    await api.sendMessage(
      { msg: `😢 LauNa tìm nhạc bị lỗi rồi... (${(e?.message || "").slice(0, 60)})` },
      threadId, threadType
    ).catch(() => {});
  }
}

function _dobToApiFormat(dob) {
  if (!dob) return "";
  const d = String(dob);
  if (d.length === 8) return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
  if (d.length >= 9) {
    const date = new Date(Number(dob) * 1000);
    if (!isNaN(date.getTime()))
      return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  }
  return "";
}

async function handleProfileAction(api, profile, threadId, threadType, isAdminUser = false) {
  try {
    const newName = typeof profile.name === "string" ? profile.name.trim() : "";
    const newBio  = typeof profile.bio  === "string" ? profile.bio.trim()  : "";

    if (newName) {
      // Fetch thông tin hiện tại để giữ nguyên dob + gender
      let dob = "", gender = 0;
      try {
        const info = await api.fetchAccountInfo();
        const cur = info?.profile || info || {};
        dob    = _dobToApiFormat(cur.dob);
        gender = cur.gender ?? 0;
      } catch (_) {}
      await api.updateProfile({ profile: { name: newName, dob, gender } });
    }

    if (newBio) {
      await api.updateProfileBio(newBio);
    }
  } catch (e) {
    console.error(`[LauNa/profile] ${e?.message}`);
  }
}

async function routeLauNaActions(botMsg, ctx) {
  const { api, threadId, threadType, senderId, senderName, message, isWatchMode, isAdminUser, imageUrl } = ctx;
  const raw = message?.data || {};

  // ── 1. Reaction ─────────────────────────────────────────────────────────────
  if (botMsg?.reaction?.status && botMsg.reaction.icon) {
    await sendReactionToMsg(api, botMsg.reaction.icon, message, threadId, threadType);
  }

  // ── 2. Từ chối ──────────────────────────────────────────────────────────────
  if (botMsg?.refuse?.status && botMsg.refuse.reason) {
    const tag = isWatchMode ? "" : `@${senderName} `;
    const mentionArr = isWatchMode ? [] : [{ uid: senderId, pos: 0, len: tag.length }];
    await api.sendMessage({
      msg: tag + botMsg.refuse.reason,
      mentions: mentionArr,
      quote: isWatchMode ? undefined : raw,
    }, threadId, threadType);
    return { saveText: botMsg.refuse.reason };
  }

  // ── 3. Cập nhật mood (im lặng) ──────────────────────────────────────────────
  if (botMsg?.emotion?.status) {
    updateMoodState({
      mood:      botMsg.emotion.mood      || undefined,
      energy:    botMsg.emotion.energy    ?? undefined,
      moodScore: botMsg.emotion.moodScore ?? undefined,
      episode:   botMsg.emotion.episode   ?? undefined,
    });
  }

  // ── 4. Tính toán ────────────────────────────────────────────────────────────
  if (botMsg?.tinh?.status && botMsg.tinh.expr) {
    const calc = safeCalc(botMsg.tinh.expr);
    const calcMsg = calc.ok
      ? `🧮 ${botMsg.tinh.expr} = ${calc.result}`
      : `❌ Tính toán lỗi: ${calc.error}`;
    await api.sendMessage({ msg: calcMsg, quote: raw }, threadId, threadType)
      .catch(() => api.sendMessage({ msg: calcMsg }, threadId, threadType));
  }

  // ── 5. Tạo ảnh ──────────────────────────────────────────────────────────────
  let mediaActionFired = false;
  if (botMsg?.img?.status && botMsg.img.prompt) {
    await sendLauNaImage(api, botMsg.img.prompt, botMsg.img.model || "flux", threadId, threadType);
    mediaActionFired = true;
  }

  // ── 5b. Tạo video (PixVerse) ────────────────────────────────────────────────
  if (botMsg?.video?.status && botMsg.video.prompt) {
    if (!_pixverseToken()) {
      await api.sendMessage(
        { msg: "⚠️ Chưa cấu hình pixverse.token trong tokens.json!" },
        threadId, threadType
      ).catch(() => {});
    } else {
      const vPrompt = botMsg.video.prompt;
      const tag = isWatchMode ? "" : `@${senderName} `;
      const mentionArr2 = isWatchMode ? [] : [{ uid: senderId, pos: 0, len: tag.length }];
      await api.sendMessage({
        msg: tag + `🎬 Đang làm video "${vPrompt}" cho cậu... Chờ 1-2 phút nha! ⏳`,
        mentions: mentionArr2,
      }, threadId, threadType).catch(() => {});
      try {
        const videoId = await pxCreateVideo(vPrompt);
        await pxPollAndSend(api, videoId, vPrompt, tag, mentionArr2, threadId, threadType);
      } catch (e) {
        await api.sendMessage(
          { msg: `😢 Làm video bị lỗi: ${e.message}. Cậu thử lại sau nha!` },
          threadId, threadType
        ).catch(() => {});
      }
    }
    mediaActionFired = true;
  }

  // ── 5c. Tạo sticker từ ảnh ──────────────────────────────────────────────────
  if (botMsg?.stk?.status && imageUrl) {
    const tag = isWatchMode ? "" : `@${senderName} `;
    const mentionArrStk = isWatchMode ? [] : [{ uid: senderId, pos: 0, len: tag.length }];
    await api.sendMessage({
      msg: tag + "Đang làm sticker cho cậu, chờ xíu nha~ ✨",
      mentions: mentionArrStk,
    }, threadId, threadType).catch(() => {});
    try {
      const ok = await convertAndSendSticker(api, imageUrl, threadId, threadType, senderId, senderName);
      if (!ok) {
        await api.sendMessage(
          { msg: "😢 Làm sticker lỗi rồi! Ảnh không đúng định dạng hoặc server lỗi." },
          threadId, threadType
        ).catch(() => {});
      }
    } catch (e) {
      await api.sendMessage(
        { msg: `😢 Làm sticker lỗi: ${e.message}` },
        threadId, threadType
      ).catch(() => {});
    }
    mediaActionFired = true;
  }

  // ── 6. Nhạc — gọi lệnh sing nội bộ ─────────────────────────────────────────
  if (botMsg?.nhac?.status && botMsg.nhac.query) {
    await handleNhacAction(api, botMsg.nhac.query, threadId, threadType, senderId, raw);
    mediaActionFired = true;
  }

  // ── 7. Cập nhật profile bot ─────────────────────────────────────────────────
  if (botMsg?.profile?.status) {
    await handleProfileAction(api, botMsg.profile, threadId, threadType, isAdminUser);
  }

  // ── 8. Các hành động admin qua AI ───────────────────────────────────────────
  if (isAdminUser) {
    const send = async (msg) => api.sendMessage({ msg, quote: raw }, threadId, threadType).catch(() => {});

    // Đổi avatar bằng ảnh reply/đính kèm
    if (botMsg?.avatar?.status) {
      if (!imageUrl) {
        await send("⚠️ LauNa không tìm thấy ảnh nào. Cậu reply vào ảnh rồi nói LauNa đổi avatar nha~");
      } else {
        const tmpFile = path.join(process.cwd(), `launa_avt_${Date.now()}.jpg`);
        try {
          const res = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
          fs.writeFileSync(tmpFile, Buffer.from(res.data));
          if (typeof api.changeAccountAvatar === "function") {
            await api.changeAccountAvatar(tmpFile);
            await send("✅ Đã đổi avatar bot thành công rồi nè! 🌸");
          } else {
            await send("⚠️ API chưa hỗ trợ đổi avatar tài khoản bot.");
          }
        } catch (e) {
          await send(`⚠️ Lỗi khi đổi avatar: ${e.message}`);
        } finally {
          if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        }
      }
    }

    // Online on/off
    if (botMsg?.online?.status && botMsg.online.value) {
      const val = botMsg.online.value.toLowerCase();
      if (["on", "off"].includes(val)) {
        try {
          await api.updateActiveStatus(val === "on" ? 1 : 0);
          await send(`✅ Đã ${val === "on" ? "BẬT 🟢" : "TẮT 🔴"} trạng thái online của bot.`);
        } catch (e) { await send(`⚠️ Lỗi khi đổi trạng thái: ${e.message}`); }
      }
    }

    // Xóa avatar
    if (botMsg?.delavatar?.status) {
      try {
        if (typeof api.deleteAvatar === "function") {
          await api.deleteAvatar();
          await send("✅ Đã xóa avatar tài khoản bot!");
        } else await send("⚠️ API chưa hỗ trợ xóa avatar.");
      } catch (e) { await send(`⚠️ Lỗi khi xóa avatar: ${e.message}`); }
    }

    // Danh sách bạn bè
    if (botMsg?.friends?.status) {
      try {
        const data = await api.getAllFriends();
        const list = data?.friends || data?.data || data || [];
        if (!Array.isArray(list) || list.length === 0) { await send("📭 Bot chưa có bạn bè nào."); }
        else {
          let msg = `[ 👥 DANH SÁCH BẠN BÈ BOT ]\n─────────────────────────────\n`;
          list.slice(0, 20).forEach((f, i) => {
            msg += `${i + 1}. ${f.displayName || f.zaloName || f.name || "Không rõ"}\n   🆔: ${f.userId || f.uid || f.id}\n`;
          });
          if (list.length > 20) msg += `\n... và ${list.length - 20} người khác.`;
          msg += `\n─────────────────────────────\n📊 Tổng: ${list.length} bạn bè`;
          await send(msg);
        }
      } catch (e) { await send(`⚠️ Lỗi khi lấy danh sách bạn bè: ${e.message}`); }
    }

    // Yêu cầu kết bạn đã gửi
    if (botMsg?.request?.status) {
      try {
        const data = await api.getSentFriendRequest();
        const reqs = data?.requests || data?.data || data || [];
        if (!Array.isArray(reqs) || reqs.length === 0) { await send("📭 Bot chưa có yêu cầu kết bạn nào đang chờ."); }
        else {
          let msg = `[ 📨 YÊU CẦU KẾT BẠN ĐÃ GỬI ]\n─────────────────────────────\n`;
          reqs.forEach((r, i) => { msg += `${i + 1}. ${r.displayName || r.zaloName || r.name || "Không rõ"}\n   🆔: ${r.userId || r.uid || r.id}\n`; });
          msg += `─────────────────────────────\n📊 Tổng: ${reqs.length} yêu cầu`;
          await send(msg);
        }
      } catch (e) { await send(`⚠️ Lỗi khi lấy danh sách yêu cầu: ${e.message}`); }
    }

    // Gửi lời mời kết bạn
    if (botMsg?.addfriend?.status && botMsg.addfriend.uid) {
      const uid = String(botMsg.addfriend.uid);
      try { await api.sendFriendRequest(uid); await send(`✅ Đã gửi lời mời kết bạn đến ID: ${uid}`); }
      catch (e) { await send(`⚠️ Lỗi khi gửi kết bạn: ${e.message}`); }
    }

    // Xóa bạn bè
    if (botMsg?.delfriend?.status && botMsg.delfriend.uid) {
      const uid = String(botMsg.delfriend.uid);
      try { await api.removeFriend(uid); await send(`✅ Đã xóa bạn bè ID: ${uid} khỏi danh sách.`); }
      catch (e) { await send(`⚠️ Lỗi khi xóa bạn: ${e.message}`); }
    }

    // Chặn người dùng
    if (botMsg?.block?.status && botMsg.block.uid) {
      const uid = String(botMsg.block.uid);
      try { await api.blockUser(uid); await send(`🚫 Đã chặn người dùng ID: ${uid}`); }
      catch (e) { await send(`⚠️ Lỗi khi chặn: ${e.message}`); }
    }

    // Bỏ chặn người dùng
    if (botMsg?.unblock?.status && botMsg.unblock.uid) {
      const uid = String(botMsg.unblock.uid);
      try { await api.unblockUser(uid); await send(`✅ Đã bỏ chặn người dùng ID: ${uid}`); }
      catch (e) { await send(`⚠️ Lỗi khi bỏ chặn: ${e.message}`); }
    }

  }

  // ── 9. Gửi text trả lời ─────────────────────────────────────────────────────
  // Bỏ qua text reply nếu đã gửi ảnh/nhạc (tránh spam 2 tin nhắn)
  if (mediaActionFired) return { saveText: null };

  const replyText = (botMsg?.content?.text || "").trim();
  if (!replyText) return { saveText: null };

  // Bảo vệ: không gửi nếu text trông như JSON thô (do parse lỗi còn sót)
  if (replyText.startsWith("{") && replyText.endsWith("}")) return { saveText: null };

  const tag = isWatchMode ? "" : `@${senderName} `;
  const mentionArr = isWatchMode ? [] : [{ uid: senderId, pos: 0, len: tag.length }];
  await api.sendMessage({
    msg: tag + replyText,
    mentions: mentionArr,
    quote: isWatchMode ? undefined : raw,
  }, threadId, threadType);

  return { saveText: replyText };
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLE — hành động tự động: phản hồi AI khi được gọi tên / mention / reply
// Inspired by MIZAI_BOT: watch mode, image detection, reaction, JSON response
// ─────────────────────────────────────────────────────────────────────────────

// ── Watch mode state ──────────────────────────────────────────────────────────
const userProcessingMap = new Map();       // khoá xử lý trùng lặp
const lastAutoReplyMap  = new Map();       // cooldown watch mode per thread

const AUTO_REPLY_CHANCE    = 0.18;         // 18% xác suất LauNa tự chen vào
const AUTO_REPLY_COOLDOWN  = 8 * 60_000;  // 8 phút giữa 2 lần tự nhắn
const AUTO_REPLY_MIN_LEN   = 8;           // tin nhắn ngắn quá thì bỏ qua

// ── Helper: trích xuất URL ảnh từ message / quote ────────────────────────────
function extractImageUrl(raw) {
  const attachments = raw?.attachments || [];
  for (const att of attachments) {
    const url = att?.fileUrl || att?.url || att?.href;
    if (url && /\.(jpg|jpeg|png|gif|webp)/i.test(url)) return url;
  }
  if (raw?.quote?.attach) {
    try {
      const att = typeof raw.quote.attach === "string"
        ? JSON.parse(raw.quote.attach)
        : raw.quote.attach;
      const url = att?.hdUrl || att?.href || att?.url;
      if (url && /\.(jpg|jpeg|png|gif|webp)/i.test(url)) return url;
    } catch {}
  }
  return null;
}

// ── Helper: trích xuất JSON object đầu tiên bằng balanced brace matching ─────
function extractFirstJsonObject(str) {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "{") {
      if (start === -1) start = i;
      depth++;
    } else if (str[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        return str.slice(start, i + 1);
      }
    }
  }
  return null;
}

// ── Helper: parse JSON response an toàn ──────────────────────────────────────
function parseLauNaResponse(raw) {
  const emptyFallback = { content: { text: "" }, reaction: { status: false }, refuse: { status: false } };
  if (!raw || typeof raw !== "string") return emptyFallback;

  // Nếu raw không phải JSON (ví dụ cooldown string), dùng làm text thẳng
  const looksLikeJson = raw.trim().startsWith("{") || raw.includes("```json");
  if (!looksLikeJson) {
    return { ...emptyFallback, content: { text: raw.trim() } };
  }

  try {
    // Xoá code block markers nếu có
    let cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    // Dùng balanced brace matching để lấy đúng JSON object đầu tiên
    // (tránh regex greedy bắt nhầm text có {} ở sau JSON)
    const extracted = extractFirstJsonObject(cleaned);
    if (extracted) cleaned = extracted;

    const obj = JSON.parse(cleaned);
    if (typeof obj !== "object" || obj === null) return emptyFallback;

    // Chuẩn hoá: nếu AI nhúng tất cả field vào bên trong "content", kéo ra ngoài
    const inner = obj.content || {};
    return {
      content:  { text: (inner.text ?? obj.text ?? "").toString() },
      reaction: obj.reaction  || inner.reaction  || { status: false, icon: "" },
      refuse:   obj.refuse    || inner.refuse    || { status: false, reason: "" },
      emotion:  obj.emotion   || inner.emotion   || { status: false },
      tinh:     obj.tinh      || inner.tinh      || { status: false },
      img:      obj.img       || inner.img       || { status: false },
      video:    obj.video     || inner.video     || { status: false, prompt: "" },
      stk:      obj.stk       || inner.stk       || { status: false },
      nhac:      obj.nhac      || inner.nhac      || { status: false, query: "" },
      profile:   obj.profile   || inner.profile   || { status: false, name: "", bio: "" },
      avatar:    obj.avatar    || inner.avatar    || { status: false },
      online:    obj.online    || inner.online    || { status: false, value: "" },
      delavatar: obj.delavatar || inner.delavatar || { status: false },
      friends:   obj.friends   || inner.friends   || { status: false },
      request:   obj.request   || inner.request   || { status: false },
      addfriend: obj.addfriend || inner.addfriend || { status: false, uid: "" },
      delfriend: obj.delfriend || inner.delfriend || { status: false, uid: "" },
      block:     obj.block     || inner.block     || { status: false, uid: "" },
      unblock:   obj.unblock   || inner.unblock   || { status: false, uid: "" },
    };
  } catch {
    return emptyFallback;
  }
}

// ── Helper: thả reaction vào tin nhắn gốc ────────────────────────────────────
async function sendReactionToMsg(api, icon, message, threadId, threadType) {
  try {
    const iconText = LAUNA_REACTION_MAP[icon?.toLowerCase()] || icon;
    if (!iconText) return;
    await api.addReaction(iconText, message);
  } catch {}
}

// ── Main handle ───────────────────────────────────────────────────────────────
export async function handle(ctx) {
  const { api, threadId, threadType, senderId, senderName, content, isSelf, message, adminIds, prefix } = ctx;
  const isAdminUser = Array.isArray(adminIds) && adminIds.includes(String(senderId));

  if (isSelf) return false;
  if (!content || typeof content !== "string") return false;
  if (!launaManager.isEnabled(threadId)) return false;

  const raw   = message?.data || {};
  const text  = content.trim();
  const lower = text.toLowerCase();

  // Không chặn lệnh bot (bắt đầu bằng prefix)
  const currentPrefix = (prefix || ".").trim();
  if (currentPrefix && text.startsWith(currentPrefix)) return false;

  const botId      = String(api.getContext?.()?.uid || "");
  const mentions   = raw?.mentions || [];
  const isMentioned    = !!botId && mentions.some(m => String(m.uid) === botId);
  const isReplyToBot   = !!botId && String(raw?.quote?.ownerId) === botId;
  const isCalledByName = lower.includes("launa");

  // ── Watch mode: LauNa tự đọc và tự chen vào đôi khi ──────────────────────
  let isWatchMode = false;
  if (!isCalledByName && !isMentioned && !isReplyToBot) {
    const lastAuto    = lastAutoReplyMap.get(threadId) || 0;
    const passChance  = Math.random() < AUTO_REPLY_CHANCE;
    const passCooldown = Date.now() - lastAuto > AUTO_REPLY_COOLDOWN;
    const passLen     = text.length >= AUTO_REPLY_MIN_LEN;
    if (!passChance || !passCooldown || !passLen) return false;
    isWatchMode = true;
  }

  // ── Khoá xử lý trùng lặp ─────────────────────────────────────────────────
  const userKey = `${threadId}:${senderId}`;
  if (userProcessingMap.get(userKey)) return false;

  // ── Cooldown (bỏ qua cho watch mode) ─────────────────────────────────────
  if (!isWatchMode) {
    const remaining = checkCooldown(senderId);
    if (remaining > 0) {
      await api.sendMessage(
        { msg: `⏳ LauNa đang nghỉ tí nha~ Cậu chờ thêm ${remaining}s rồi hỏi lại nha 🌸`, quote: raw },
        threadId, threadType
      );
      return true;
    }
  }

  userProcessingMap.set(userKey, true);

  try {
    // ── Xây dựng câu hỏi ───────────────────────────────────────────────────
    let question = text;
    if (isCalledByName) {
      question = question
        .replace(/^launa\s*ơi[,:]?\s*/i, "")
        .replace(/^launa[,:]?\s*/i, "")
        .trim();
    }
    if (isMentioned) {
      question = question.replace(/@\S+/g, "").trim();
    }

    // ── Phát hiện ảnh đính kèm ─────────────────────────────────────────────
    const imageUrl = extractImageUrl(raw);
    const imgNote  = imageUrl
      ? `\n[HAS_IMAGE] Người dùng gửi/reply kèm ảnh: ${imageUrl} — mô tả ảnh nếu được hỏi.`
      : "";

    // ── Watch mode: không có câu hỏi thì thêm note ─────────────────────────
    const watchNote = isWatchMode
      ? "\n[WATCH_MODE] LauNa tự đọc tin này, KHÔNG được gọi trực tiếp. Chỉ chen vào nếu thật sự thú vị. Nếu không → content.text TRỐNG."
      : "";

    if (!question && !isWatchMode) {
      await api.sendMessage(
        { msg: "LauNa nghe nè~ Cậu muốn hỏi gì vậy? 🌸", quote: raw },
        threadId, threadType
      );
      return true;
    }

    // ── Load lịch sử chat ──────────────────────────────────────────────────
    const history = await loadHistory(threadId);
    const historyStr = history.length > 0
      ? "\n[LỊCH SỬ]\n" + history
          .slice(-MAX_HISTORY)
          .map(m => `${m.role === "user" ? "User" : "LauNa"}: ${m.content}`)
          .join("\n")
      : "";

    decayEnergy();
    const moodCtx  = getMoodContext();

    const adminNote = isAdminUser ? "\n[IS_ADMIN] Người dùng này là Admin Bot — có quyền yêu cầu đổi tên, bio, bạn bè, chặn và các tác vụ admin." : "";

    // Trích xuất UID mục tiêu từ mention hoặc reply để AI dùng trong các action
    const targetMention = mentions.find(m => String(m.uid) !== botId && String(m.uid) !== String(senderId));
    const targetFromQuote = raw?.quote?.ownerId || raw?.quote?.uidFrom;
    const targetUid = targetMention?.uid || targetFromQuote || "";
    const targetNote = targetUid ? `\n[TARGET_UID: ${targetUid}]` : "";

    const fullPrompt = [
      `Người dùng: ${senderName}`,
      `Tin nhắn: ${question || "(không có nội dung)"}`,
      historyStr,
      imgNote,
      watchNote,
      adminNote,
      targetNote,
      moodCtx,
    ].filter(Boolean).join("\n");

    // ── Gửi typing indicator ───────────────────────────────────────────────
    api.sendTypingEvent?.(threadId, threadType).catch?.(() => {});

    // ── Gọi AI ────────────────────────────────────────────────────────────
    // Nếu model hiện tại là Gemini, truyền imageUrl để phân tích ảnh thực sự
    const currentCfg = AI_MODELS[activeModelKey] || {};
    const aiOptions = currentCfg.provider === "gemini" && imageUrl
      ? { imageUrl }
      : {};
    const rawReply = await askLauNa(fullPrompt, senderId, activeModelKey, aiOptions);
    const botMsg   = parseLauNaResponse(rawReply);

    // ── Watch mode: cập nhật cooldown dù có reply hay không ───────────────
    if (isWatchMode) {
      lastAutoReplyMap.set(threadId, Date.now());
    } else {
      setCooldown(senderId);
    }

    // ── Dispatch tất cả action qua routeLauNaActions ───────────────────────
    const { saveText } = await routeLauNaActions(botMsg, {
      api, threadId, threadType, senderId, senderName, message, isWatchMode, isAdminUser, imageUrl,
    });

    if (saveText) {
      await saveExchange(threadId, senderId, question, saveText);
    }

  } catch (err) {
    const errMsg = err?.message || String(err);
    console.error(`[LauNa/handle] Lỗi: ${errMsg}`);
    if (!isWatchMode) {
      await api.sendMessage(
        { msg: `😢 LauNa bị lỗi rồi... Thử lại sau nha! (${errMsg.slice(0, 80)})`, quote: raw },
        threadId, threadType
      ).catch(() => {});
    }
  } finally {
    userProcessingMap.delete(userKey);
  }

  return true;
}

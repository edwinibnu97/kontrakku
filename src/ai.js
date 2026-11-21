// src/ai.js — Firebase AI Logic (hybrid) wrapper for KontrakKu.
// ALL AI inference goes through Firebase AI Logic. No other model API is called.
// Free tier only: GoogleAIBackend (Gemini Developer API, Spark plan), text models only.
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";

// Text-only cloud model, free tier (no "requires Blaze" footnote in Firebase docs).
const CLOUD_MODEL = "gemini-3.8-flash";

function readConfig() {
  const e = import.meta.env;
  const cfg = {
    apiKey: e.VITE_FIREBASE_API_KEY || "",
    authDomain: e.VITE_FIREBASE_AUTH_DOMAIN || "",
    projectId: e.VITE_FIREBASE_PROJECT_ID || "",
    storageBucket: e.VITE_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: e.VITE_FIREBASE_APP_ID || "",
  };
  const recaptchaSiteKey = e.VITE_RECAPTCHA_SITE_KEY || "";
  const configured = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);
  return { cfg, recaptchaSiteKey, configured };
}

let app = null;
let ai = null;
let appCheckReady = false;

export function isConfigured() {
  return readConfig().configured;
}

export function initFirebase() {
  const { cfg, recaptchaSiteKey, configured } = readConfig();
  if (!configured) return { configured: false, appCheckReady: false };
  if (!app) {
    app = initializeApp(cfg);
    // App Check is required for Firebase AI Logic. Production uses the
    // reCAPTCHA Enterprise provider (Fraud Defense Essentials, free tier,
    // registered in the Firebase console; site key is public).
    // Debug tokens are dev-only and never shipped here.
    if (recaptchaSiteKey) {
      try {
        initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
        appCheckReady = true;
      } catch (err) {
        console.warn("App Check init failed:", err);
      }
    }
    // Gemini Developer API backend = free tier (Spark plan, no billing).
    ai = getAI(app, { backend: new GoogleAIBackend() });
  }
  return { configured: true, appCheckReady };
}

// Nano readiness via the Chrome Prompt API (status display only — NOT inference).
// Returns { supported, status } where status is available | downloading |
// downloadable | unavailable | unsupported | unknown.
export async function checkNanoReadiness() {
  try {
    if (!("LanguageModel" in self)) return { supported: false, status: "unsupported" };
    const status = await LanguageModel.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
    return { supported: true, status };
  } catch {
    return { supported: false, status: "unknown" };
  }
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model did not return JSON. Raw output: " + text.slice(0, 200));
  }
  return JSON.parse(text.slice(start, end + 1));
}

const EXTRACT_PROMPT = (contract) => `You extract key facts from a contract. Reply with ONLY a JSON object, no markdown, no extra text. Keys: contractType (e.g. "Residential lease" or "Personal loan"), parties (object with landlordOrLender and tenantOrBorrower, each a name or "Not stated"), propertyOrPurpose, amount (monthly rent or loan principal with currency), term, interestOrFees, latePenalty, termination, governingLaw. Use "Not stated" for anything missing. Keep each value short (one line).

Contract:
"""${contract}"""`;

const RISK_PROMPT = (contract, facts) => `You are a plain-language contract risk explainer. A renter or borrower wants to know the risks before signing. Reply with ONLY a JSON object, no markdown, no extra text. Keys: riskScore (integer 0-100, 0 = safest, 100 = riskiest), verdict ("Low risk" | "Moderate risk" | "High risk"), summary (2-3 plain sentences in English), redFlags (array of up to 5 objects with title and explanation, each one a concrete clause-based risk; empty array if none).

Extracted facts:
${JSON.stringify(facts)}

Contract:
"""${contract}"""`;

// Runs both hybrid stages. Must be called from a user gesture (Analyze click):
// getGenerativeModel + initializeDeviceModel require user interaction.
// Returns { facts, stage1Source, risk, stage2Source }.
// stage1Source / stage2Source are the official inferenceSource values:
// "ON_DEVICE" | "IN_CLOUD".
export async function analyzeContract(contractText, onProgress) {
  initFirebase();
  if (!ai) throw new Error("Firebase is not configured yet. See README for setup.");
  const progress = onProgress || (() => {});

  // Stage 1 — hybrid: prefer on-device (Gemini Nano), fall back to cloud.
  progress("stage1", "Extracting key points…");
  const hybridModel = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: { model: CLOUD_MODEL },
  });
  try {
    await hybridModel.initializeDeviceModel((p) =>
      progress("stage1", `Preparing on-device model… ${Math.round(p * 100)}%`),
    );
  } catch (e) {
    // On-device unavailable: PREFER_ON_DEVICE falls back to cloud on generateContent.
    console.warn("initializeDeviceModel:", e);
  }
  // On-device generation can throw even after initializeDeviceModel resolves
  // (e.g. QuotaExceededError "The input is too large" while Nano is still
  // downloading, or no usable on-device quota in this browser). The documented
  // design is automatic cloud fallback, so retry Stage 1 in the cloud instead
  // of failing the whole analysis.
  let r1;
  let stage1Source;
  try {
    r1 = await hybridModel.generateContent(EXTRACT_PROMPT(contractText));
    stage1Source = r1.response.inferenceSource || "UNKNOWN";
  } catch (e) {
    console.warn("On-device Stage 1 failed, falling back to cloud:", e);
    progress("stage1", "On-device unavailable — falling back to cloud…");
    // NOTE: when `mode` is set, the SDK ignores a top-level `model` — the
    // cloud model must go through inCloudParams (otherwise it silently uses
    // the default gemini-3.5-flash-lite). Verified against @firebase/ai types:
    // getGenerativeModel takes ModelParams | HybridParams.
    const fallbackModel = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model: CLOUD_MODEL },
    });
    r1 = await fallbackModel.generateContent(EXTRACT_PROMPT(contractText));
    stage1Source = r1.response.inferenceSource || "IN_CLOUD";
  }
  const facts = extractJson(r1.response.text());

  // Stage 2 — cloud only: risk explanation in plain language.
  // (Same inCloudParams rule as the fallback above.)
  progress("stage2", "Explaining risks in plain language…");
  const cloudModel = getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_IN_CLOUD,
    inCloudParams: { model: CLOUD_MODEL },
  });
  const r2 = await cloudModel.generateContent(RISK_PROMPT(contractText, facts));
  const stage2Source = r2.response.inferenceSource || "IN_CLOUD";
  const risk = extractJson(r2.response.text());

  progress("done", "");
  return { facts, stage1Source, risk, stage2Source };
}

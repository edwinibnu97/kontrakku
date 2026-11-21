import "./style.css";
import { SAMPLE_RENTAL, SAMPLE_LOAN } from "./samples.js";
import { initFirebase, isConfigured, checkNanoReadiness, analyzeContract } from "./ai.js";

const $ = (id) => document.getElementById(id);
const input = $("contractInput");
const analyzeBtn = $("analyzeBtn");
const statusLine = $("statusLine");
const backendBadge = $("backendBadge");

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sourceLabel(source) {
  if (source === "ON_DEVICE") return "🔒 On-device · Gemini Nano";
  if (source === "IN_CLOUD") return "☁️ Cloud · Gemini";
  return `Backend: ${escapeHtml(source)}`;
}

async function refreshBackendBadge() {
  if (!isConfigured()) {
    backendBadge.textContent = "⚠️ Firebase not configured yet — see README to wire up the project";
    return;
  }
  backendBadge.textContent = "Checking on-device model…";
  const nano = await checkNanoReadiness();
  const nanoText =
    nano.status === "available"
      ? "On-device Nano: ready"
      : nano.status === "downloading" || nano.status === "downloadable"
        ? "On-device Nano: downloading"
        : nano.status === "unavailable"
          ? "On-device Nano: not available on this device (cloud fallback)"
          : "On-device Nano: unknown (cloud fallback)";
  backendBadge.textContent = `${nanoText} · Cloud: Gemini ready`;
}

function renderKeyPoints(facts) {
  const rows = [
    ["Contract type", facts.contractType],
    ["Landlord / Lender", facts.parties?.landlordOrLender],
    ["Tenant / Borrower", facts.parties?.tenantOrBorrower],
    ["Property / Purpose", facts.propertyOrPurpose],
    ["Amount", facts.amount],
    ["Term", facts.term],
    ["Interest / Fees", facts.interestOrFees],
    ["Late penalty", facts.latePenalty],
    ["Termination", facts.termination],
    ["Governing law", facts.governingLaw],
  ];
  $("keyPoints").innerHTML =
    '<table class="kv">' +
    rows
      .map(
        ([k, v]) =>
          `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v ?? "Not stated")}</td></tr>`,
      )
      .join("") +
    "</table>";
}

function renderRisk(risk) {
  const score = Number(risk.riskScore);
  const box = $("riskScoreBox");
  box.style.borderColor = score >= 60 ? "#ef4444" : score >= 30 ? "#f59e0b" : "#22c55e";
  $("riskScore").textContent = Number.isFinite(score) ? `${score}` : "–";
  $("riskScore").style.color = score >= 60 ? "#ef4444" : score >= 30 ? "#f59e0b" : "#22c55e";
  $("riskVerdict").textContent = `${risk.verdict || ""} · Risk score / 100`;
  $("riskSummary").textContent = risk.summary || "";
  const flags = Array.isArray(risk.redFlags) ? risk.redFlags : [];
  $("redFlags").innerHTML = flags.length
    ? flags
        .map(
          (f) =>
            `<li><strong>${escapeHtml(f.title || "Red flag")}</strong> — ${escapeHtml(f.explanation || "")}</li>`,
        )
        .join("")
    : "<li>No major red flags found in the extracted facts. Still read the full contract before signing.</li>";
}

$("sampleRentalBtn").addEventListener("click", () => {
  input.value = SAMPLE_RENTAL;
  statusLine.textContent = "Sample rental agreement loaded. Press Analyze.";
});
$("sampleLoanBtn").addEventListener("click", () => {
  input.value = SAMPLE_LOAN;
  statusLine.textContent = "Sample personal loan agreement loaded. Press Analyze.";
});
$("clearBtn").addEventListener("click", () => {
  input.value = "";
  $("resultsCard").hidden = true;
  statusLine.textContent = "Cleared. Paste a contract to begin.";
});
$("fileInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  input.value = await file.text();
  statusLine.textContent = `Loaded ${file.name} (${input.value.length} characters). Press Analyze.`;
});

analyzeBtn.addEventListener("click", async () => {
  const text = input.value.trim();
  if (text.length < 50) {
    statusLine.textContent = "Please paste a contract first (at least a few sentences).";
    return;
  }
  if (!isConfigured()) {
    statusLine.textContent =
      "Firebase is not configured yet — the app needs a Firebase project (see README).";
    return;
  }
  analyzeBtn.disabled = true;
  $("resultsCard").hidden = true;
  try {
    const result = await analyzeContract(text, (stage, msg) => {
      statusLine.textContent = msg || "Done.";
    });
    renderKeyPoints(result.facts);
    $("deviceNote").textContent =
      result.stage1Source === "ON_DEVICE"
        ? "Extracted privately on this device with Gemini Nano. Nothing left the device in this stage."
        : "On-device model was not available on this device, so Stage 1 fell back to Gemini in the cloud (Firebase AI Logic).";
    document.querySelector("#stageDevice .tag").textContent =
      result.stage1Source === "ON_DEVICE" ? "On-device" : "Cloud (fallback)";
    renderRisk(result.risk);
    $("cloudNote").textContent = `Explained by Gemini in the cloud via Firebase AI Logic (${sourceLabel(result.stage2Source)}).`;
    $("resultsCard").hidden = false;
    statusLine.textContent = `Done. Stage 1: ${sourceLabel(result.stage1Source)} · Stage 2: ${sourceLabel(result.stage2Source)}.`;
    $("resultsCard").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    console.error(err);
    statusLine.textContent = `Analysis failed: ${err.message || err}`;
  } finally {
    analyzeBtn.disabled = false;
  }
});

initFirebase();
refreshBackendBadge();

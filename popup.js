"use strict";

const api =
  globalThis.browser ??
  globalThis.chrome;

const core =
  globalThis.ChatGPTUsageCore;

const q = (selector) =>
  document.querySelector(selector);

const all = (selector) =>
  [...document.querySelectorAll(selector)];

const ui = {
  refresh: q("#refresh"),
  subtitle: q("#subtitle"),
  plans: all("nav button"),
  loading: q("#loading"),
  error: q("#error"),
  errorText: q("#errorText"),
  result: q("#result"),
  score: q("#score"),
  badge: q("#badge"),
  bar: q("#bar"),
  progress: q(".track"),
  message: q("#message"),
  chargeSummary: q("#chargeSummary"),
  effectiveCharge: q("#effectiveCharge"),
  technicalCounts: q("#technicalCounts"),
  excludedCounts: q("#excludedCounts"),
  compression: q("#compression"),
  rawTokens: q("#rawTokens"),
  recentTokens: q("#recentTokens"),
  nodes: q("#nodes"),
  messages: q("#messages"),
  contentShares: q("#contentShares"),
  filesMarkers: q("#filesMarkers"),
  model: q("#model"),
  copy: q("#copy"),
};

let selectedPlan = "plus";
let lastAnalysis = null;
let lastCopyText = "";
let running = false;

function compactNumber(value) {
  const number = Number(value) || 0;

  if (number >= 1_000_000) {
    return `${(number / 1_000_000)
      .toFixed(2)}M`;
  }

  if (number >= 1000) {
    return `${(number / 1000)
      .toFixed(number >= 100_000 ? 0 : 1)}k`;
  }

  return String(Math.round(number));
}

function formatPercent(value) {
  return `${(Number(value) || 0)
    .toFixed(1)}%`;
}

function extractConversationId(urlValue) {
  try {
    const url = new URL(urlValue);

    if (url.hostname !== "chatgpt.com") {
      return null;
    }

    return (
      url.pathname.match(
        /\/c\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\/|$)/i
      )?.[1] || null
    );
  } catch {
    return null;
  }
}

function choosePlan(value) {
  selectedPlan =
    value in core.PLANS
      ? value
      : "plus";

  for (const button of ui.plans) {
    button.classList.toggle(
      "active",
      button.dataset.plan ===
        selectedPlan
    );
  }
}

function showLoading() {
  running = true;
  ui.refresh.disabled = true;
  ui.loading.classList.remove("hidden");
  ui.error.classList.add("hidden");
  ui.result.classList.add("hidden");
  ui.subtitle.textContent = "Analyzing…";
}

function showError(message) {
  running = false;
  ui.refresh.disabled = false;
  ui.loading.classList.add("hidden");
  ui.result.classList.add("hidden");
  ui.error.classList.remove("hidden");
  ui.errorText.textContent = message;
  ui.subtitle.textContent = "Error";
  document.body.className = "";
}

function render(analysis) {
  lastAnalysis = analysis;
  running = false;
  ui.refresh.disabled = false;

  const metrics =
    analysis.branchMetrics || {};
  const roles = metrics.roles || {};
  const plan =
    core.PLANS[selectedPlan] ||
    core.PLANS.plus;

  const charge =
    core.effectiveCharge(metrics);
  const calculatedPercent =
    core.usagePercent(
      metrics,
      selectedPlan
    );
  const displayPercent =
    analysis.limitConfirmed
      ? Math.max(calculatedPercent, 100)
      : calculatedPercent;
  const state =
    core.stateFor(
      displayPercent,
      analysis.limitConfirmed === true
    );

  document.body.className =
    `state-${state.key}`;

  ui.score.textContent =
    formatPercent(displayPercent);
  ui.badge.textContent =
    state.badge;
  ui.message.textContent =
    state.message;
  ui.bar.style.width =
    `${Math.min(displayPercent, 100)}%`;
  ui.progress.setAttribute(
    "aria-valuenow",
    String(
      Math.round(
        Math.min(displayPercent, 100)
      )
    )
  );

  ui.chargeSummary.textContent =
    `${compactNumber(charge)} / ${compactNumber(plan.threshold)}`;
  ui.effectiveCharge.textContent =
    `${charge} / ${plan.threshold}`;
  ui.technicalCounts.textContent =
    `${roles.assistant || 0} / ${roles.tool || 0}`;
  ui.excludedCounts.textContent =
    `${metrics.hiddenMessages || 0} / ${roles.system || 0}`;
  ui.compression.textContent =
    formatPercent(
      core.compressionPercent(metrics)
    );
  ui.rawTokens.textContent =
    `≈ ${compactNumber(metrics.totalTokens)} tokens`;
  ui.recentTokens.textContent =
    `≈ ${compactNumber(
      metrics.recent128?.weightedTokens || 0
    )} weighted`;
  ui.nodes.textContent =
    `${analysis.activeBranchNodes || 0} / ${analysis.nodes || 0}`;
  ui.messages.textContent =
    `${metrics.turnExchangeCount || 0} / ${metrics.messages || 0}`;
  ui.contentShares.textContent =
    `${Math.round(
      (metrics.codeTokenShare || 0) * 100
    )} % / ${Math.round(
      (metrics.toolTokenShare || 0) * 100
    )} %`;
  ui.filesMarkers.textContent =
    `${metrics.attachmentCount || 0} / ${metrics.contextMarkers || 0}`;
  ui.model.textContent =
    metrics.models?.latest || "unknown";

  ui.subtitle.textContent =
    analysis.title ||
    (
      analysis.projectDetected
        ? "Project conversation"
        : "Conversation"
    );

  const shortId =
    (
      analysis.receivedConversationId ||
      ""
    ).slice(-8);

  lastCopyText = [
    "ChatGPT-Usage-v0.5",
    `plan=${selectedPlan}`,
    `id=…${shortId}`,
    `title=${analysis.title || ""}`,
    `limitConfirmed=${analysis.limitConfirmed ? "yes" : "no"}`,
    `charge=${charge}`,
    `threshold=${plan.threshold}`,
    `usage=${calculatedPercent.toFixed(1)}%`,
    `assistant=${roles.assistant || 0}`,
    `tool=${roles.tool || 0}`,
    `hidden=${metrics.hiddenMessages || 0}`,
    `system=${roles.system || 0}`,
    `compression=${core.compressionPercent(metrics).toFixed(1)}%`,
    `branch=${analysis.activeBranchNodes || 0}`,
    `total=${analysis.nodes || 0}`,
    `turns=${metrics.turnExchangeCount || 0}`,
    `messages=${metrics.messages || 0}`,
    `rawTokens≈${metrics.totalTokens || 0}`,
    `recent128≈${metrics.recent128?.weightedTokens || 0}`,
    `codeShare=${Math.round((metrics.codeTokenShare || 0) * 100)}%`,
    `toolShare=${Math.round((metrics.toolTokenShare || 0) * 100)}%`,
    `files=${metrics.attachmentCount || 0}`,
    `markers=${metrics.contextMarkers || 0}`,
    `model=${metrics.models?.latest || "unknown"}`,
    `models=${metrics.models?.distinct || 0}`,
    `project=${analysis.projectDetected ? "yes" : "no"}`,
  ].join(" | ");

  ui.loading.classList.add("hidden");
  ui.error.classList.add("hidden");
  ui.result.classList.remove("hidden");
}

async function analyze() {
  if (running) {
    return;
  }

  showLoading();

  try {
    const [tab] =
      await api.tabs.query({
        active: true,
        currentWindow: true,
      });

    if (
      !tab ||
      typeof tab.id !== "number"
    ) {
      showError("No active tab was found.");
      return;
    }

    const id =
      extractConversationId(
        tab.url || ""
      );

    if (!id) {
      showError(
        "Open a conversation at chatgpt.com/c/…"
      );
      return;
    }

    await api.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["page-analyzer.js"],
      world: "MAIN",
    });

    const output =
      await api.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: async (
          conversationIdValue
        ) =>
          window
            .__CHATGPT_USAGE_ANALYZER__
            .fetchAndAnalyze(
              conversationIdValue
            ),
        args: [id],
      });

    const result =
      output?.[0]?.result;

    if (!result?.ok) {
      showError(
        result?.error ||
          "ChatGPT returned an unusable result."
      );
      return;
    }

    render(result);
  } catch {
    showError(
      "Access was denied. Reload ChatGPT and try again."
    );
  }
}

async function copyStats() {
  if (!lastCopyText) {
    return;
  }

  try {
    await navigator.clipboard.writeText(
      lastCopyText
    );
  } catch {
    const textarea =
      document.createElement("textarea");
    textarea.value = lastCopyText;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  ui.copy.textContent = "Statistics copied ✓";

  window.setTimeout(() => {
    ui.copy.textContent =
      "Copy statistics";
  }, 1400);
}

for (const button of ui.plans) {
  button.addEventListener(
    "click",
    async () => {
      choosePlan(button.dataset.plan);

      await api.storage.local.set({
        selectedPlan,
      });

      if (lastAnalysis) {
        render(lastAnalysis);
      } else {
        analyze();
      }
    }
  );
}

ui.refresh.addEventListener(
  "click",
  analyze
);
ui.copy.addEventListener(
  "click",
  copyStats
);

document.addEventListener(
  "DOMContentLoaded",
  async () => {
    const stored =
      await api.storage.local.get(
        "selectedPlan"
      );

    choosePlan(
      stored.selectedPlan || "plus"
    );
    analyze();
  }
);

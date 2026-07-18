(function (root) {
  "use strict";

  const PLANS = Object.freeze({
    free: Object.freeze({
      label: "Free",
      threshold: 900,
    }),
    plus: Object.freeze({
      label: "Plus",
      threshold: 1980,
    }),
    pro: Object.freeze({
      label: "Pro",
      threshold: 4230,
    }),
  });

  function safeCount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0
      ? number
      : 0;
  }

  function effectiveCharge(metrics) {
    const roles = metrics?.roles || {};

    return Math.max(
      0,
      safeCount(roles.assistant) +
        safeCount(roles.tool) -
        safeCount(metrics?.hiddenMessages) -
        safeCount(roles.system)
    );
  }

  function usagePercent(metrics, planName) {
    const plan =
      PLANS[planName] || PLANS.plus;

    return (
      effectiveCharge(metrics) /
      plan.threshold *
      100
    );
  }

  function compressionPercent(metrics) {
    const roles = metrics?.roles || {};
    const technical =
      safeCount(roles.assistant) +
      safeCount(roles.tool);

    if (!technical) {
      return 0;
    }

    return Math.min(
      100,
      (
        safeCount(metrics?.hiddenMessages) +
        safeCount(roles.system)
      ) /
        technical *
        100
    );
  }

  function stateFor(percent, limitConfirmed = false) {
    if (limitConfirmed) {
      return {
        key: "confirmed",
        badge: "Confirmed limit",
        message:
          "ChatGPT reports that the maximum conversation length has been reached.",
      };
    }

    if (percent >= 100) {
      return {
        key: "limit",
        badge: "Likely limit",
        message:
          "The conversation is within the observed blocking range.",
      };
    }

    if (percent >= 97) {
      return {
        key: "danger",
        badge: "Very critical",
        message:
          "A heavy task may now push the conversation over the limit.",
      };
    }

    if (percent >= 85) {
      return {
        key: "critical",
        badge: "Critical",
        message:
          "Prepare a handoff to a new conversation.",
      };
    }

    if (percent >= 70) {
      return {
        key: "watch",
        badge: "Watch closely",
        message:
          "The load is increasing, but some headroom likely remains.",
      };
    }

    return {
      key: "ok",
      badge: "OK",
      message:
        "The conversation still has comfortable headroom.",
    };
  }

  const publicApi = {
    PLANS,
    effectiveCharge,
    usagePercent,
    compressionPercent,
    stateFor,
  };

  if (
    typeof module !== "undefined" &&
    module.exports
  ) {
    module.exports = publicApi;
  } else {
    root.ChatGPTUsageCore = publicApi;
  }
})(
  typeof window !== "undefined"
    ? window
    : globalThis
);

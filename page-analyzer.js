(function (root) {
  "use strict";

  const isObj = (v) => v !== null && typeof v === "object";

  function looksLikeConversationMapping(mapping) {
    if (!isObj(mapping) || Array.isArray(mapping)) return false;

    const entries = Object.entries(mapping);
    if (!entries.length) return false;

    let checked = 0;
    let nodeLike = 0;

    for (const [nodeId, node] of entries) {
      if (checked >= 200) break;
      checked += 1;

      if (
        typeof nodeId === "string" &&
        isObj(node) &&
        (
          Object.prototype.hasOwnProperty.call(node, "parent") ||
          Object.prototype.hasOwnProperty.call(node, "children") ||
          Object.prototype.hasOwnProperty.call(node, "message")
        )
      ) {
        nodeLike += 1;
      }
    }

    return checked > 0 && nodeLike / checked >= 0.65;
  }

  function scoreConversationCandidate(envelope, mapping, isRoot) {
    const entries = Object.entries(mapping);
    let checked = 0;
    let nodeLike = 0;
    let messages = 0;

    for (const [, node] of entries) {
      if (checked >= 300) break;
      checked += 1;

      if (!isObj(node)) continue;

      if (
        Object.prototype.hasOwnProperty.call(node, "parent") ||
        Object.prototype.hasOwnProperty.call(node, "children") ||
        Object.prototype.hasOwnProperty.call(node, "message")
      ) {
        nodeLike += 1;
      }

      if (isObj(node.message)) messages += 1;
    }

    const ratio = checked ? nodeLike / checked : 0;
    const currentNode =
      typeof envelope.current_node === "string"
        ? envelope.current_node
        : null;
    const currentPresent =
      currentNode &&
      Object.prototype.hasOwnProperty.call(mapping, currentNode);

    return (
      (isRoot ? 1_000_000_000 : 0) +
      (currentPresent ? 100_000_000 : 0) +
      Math.round(ratio * 10_000_000) +
      messages * 1_000 +
      entries.length
    );
  }

  function findLargestMapping(data) {
    if (!isObj(data)) return null;

    // L'endpoint /backend-api/conversation renvoie normalement le vrai arbre
    // directement dans data.mapping. Il doit toujours être prioritaire.
    if (
      looksLikeConversationMapping(data.mapping)
    ) {
      return {
        envelope: data,
        mapping: data.mapping,
        size: Object.keys(data.mapping).length,
      };
    }

    // Secours pour une éventuelle enveloppe future : choisir selon la forme
    // d'un arbre de conversation, jamais uniquement selon la taille.
    const stack = [data];
    const seen = new WeakSet();
    let best = null;
    let bestScore = -1;
    let visited = 0;

    while (stack.length && visited < 120000) {
      const value = stack.pop();

      if (!isObj(value) || seen.has(value)) continue;
      seen.add(value);
      visited += 1;

      if (
        looksLikeConversationMapping(value.mapping)
      ) {
        const score = scoreConversationCandidate(
          value,
          value.mapping,
          value === data
        );

        if (score > bestScore) {
          best = {
            envelope: value,
            mapping: value.mapping,
            size: Object.keys(value.mapping).length,
          };
          bestScore = score;
        }
      }

      const children = Array.isArray(value)
        ? value
        : Object.values(value);

      for (const child of children) {
        if (isObj(child)) stack.push(child);
      }
    }

    return best;
  }

  function textFromPiece(value, depth = 0) {
    if (depth > 14 || value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return "";
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => textFromPiece(item, depth + 1))
        .filter(Boolean)
        .join("\n");
    }

    if (!isObj(value)) {
      return "";
    }

    for (const key of [
      "text",
      "output_text",
      "result",
      "caption",
      "summary",
      "content",
    ]) {
      if (typeof value[key] === "string" && value[key]) {
        return value[key];
      }
    }

    for (const key of [
      "parts",
      "items",
      "thoughts",
      "chunks",
      "content",
    ]) {
      if (Array.isArray(value[key]) || isObj(value[key])) {
        const nested = textFromPiece(value[key], depth + 1);
        if (nested) {
          return nested;
        }
      }
    }

    return "";
  }

  function messageText(message) {
    if (!isObj(message)) {
      return "";
    }

    return textFromPiece(message.content).trim();
  }

  function messageRole(message) {
    if (
      isObj(message?.author) &&
      typeof message.author.role === "string"
    ) {
      return message.author.role;
    }

    return typeof message?.role === "string"
      ? message.role
      : "other";
  }

  function contentType(message) {
    return isObj(message?.content) &&
      typeof message.content.content_type === "string"
      ? message.content.content_type
      : "unknown";
  }

  function estimateTokens(text) {
    if (!text) {
      return 0;
    }

    let ascii = 0;
    let nonAscii = 0;
    let cjk = 0;

    for (const char of text) {
      const code = char.codePointAt(0) || 0;

      if (
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3040 && code <= 0x30ff) ||
        (code >= 0xac00 && code <= 0xd7af)
      ) {
        cjk += 1;
      } else if (code <= 127) {
        ascii += 1;
      } else {
        nonAscii += 1;
      }
    }

    const codeLike =
      /```|(?:^|\n)\s*(?:def |class |function |const |let |var |import |from |SELECT |CREATE |diff --git|\{|\[)/m.test(
        text
      );

    const asciiDivisor = codeLike ? 3.25 : 3.9;

    return Math.max(
      0,
      Math.ceil(
        ascii / asciiDivisor +
        nonAscii / 2.55 +
        cjk / 1.15
      )
    );
  }

  function countCodeCharacters(text, type) {
    if (!text) {
      return 0;
    }

    if (
      type === "code" ||
      type === "execution_output"
    ) {
      return text.length;
    }

    let total = 0;
    const pattern = /```[\s\S]*?```/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      total += match[0].length;
    }

    return total;
  }

  function collectAttachmentNames(value, names, depth = 0) {
    if (
      depth > 10 ||
      value === null ||
      value === undefined
    ) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collectAttachmentNames(item, names, depth + 1);
      }
      return;
    }

    if (!isObj(value)) {
      return;
    }

    const fileName =
      value.name ||
      value.file_name ||
      value.filename ||
      value.title;

    const hasFileMarker =
      typeof value.file_id === "string" ||
      typeof value.asset_pointer === "string" ||
      typeof value.image_asset_pointer === "string" ||
      typeof value.mime_type === "string" ||
      typeof value.file_size === "number";

    if (
      hasFileMarker &&
      typeof fileName === "string" &&
      fileName.trim()
    ) {
      names.add(fileName.trim());
    }

    for (const child of Object.values(value)) {
      if (isObj(child) || Array.isArray(child)) {
        collectAttachmentNames(child, names, depth + 1);
      }
    }
  }

  function markerCount(message, text, type) {
    const metadata = isObj(message?.metadata)
      ? message.metadata
      : {};

    let count = 0;
    const markerPattern =
      /summary|summarized|compact|compaction|context_summary|truncate|truncation/i;

    for (const [key, value] of Object.entries(metadata)) {
      if (
        markerPattern.test(key) &&
        value !== false &&
        value !== null &&
        value !== ""
      ) {
        count += 1;
      }
    }

    if (
      /summary|recap|model_editable_context/i.test(type)
    ) {
      count += 1;
    }

    if (
      messageRole(message) === "system" &&
      /résumé|summary|conversation so far|contexte précédent/i.test(
        text.slice(0, 1500)
      )
    ) {
      count += 1;
    }

    return count;
  }

  function orderedActiveBranch(mapping, currentNode) {
    if (!isObj(mapping) || Array.isArray(mapping)) {
      return {
        nodes: [],
        complete: false,
      };
    }

    function pathFrom(leaf) {
      const path = [];
      const seen = new Set();
      let nodeId = leaf;

      while (
        typeof nodeId === "string" &&
        Object.prototype.hasOwnProperty.call(
          mapping,
          nodeId
        ) &&
        !seen.has(nodeId)
      ) {
        seen.add(nodeId);
        const node = mapping[nodeId];

        path.push({
          id: nodeId,
          node,
        });

        nodeId =
          isObj(node) &&
          typeof node.parent === "string"
            ? node.parent
            : null;
      }

      path.reverse();

      return {
        nodes: path,
        complete:
          nodeId === null ||
          nodeId === undefined,
      };
    }

    if (
      typeof currentNode === "string" &&
      Object.prototype.hasOwnProperty.call(
        mapping,
        currentNode
      )
    ) {
      return pathFrom(currentNode);
    }

    const parents = new Set();

    for (const node of Object.values(mapping)) {
      if (
        isObj(node) &&
        typeof node.parent === "string"
      ) {
        parents.add(node.parent);
      }
    }

    const leaves = Object.keys(mapping).filter(
      (id) => !parents.has(id)
    );

    let best = {
      nodes: [],
      complete: false,
    };

    for (const leaf of leaves) {
      const candidate = pathFrom(leaf);

      if (
        candidate.nodes.length >
        best.nodes.length
      ) {
        best = candidate;
      }
    }

    return best;
  }

  function latestModelInformation(messages, data) {
    const ordered = [...messages].reverse();
    const seen = [];
    const unique = new Set();

    for (const message of ordered) {
      const metadata = isObj(message?.metadata)
        ? message.metadata
        : {};

      const candidates = [
        metadata.resolved_model_slug,
        metadata.model_slug,
        metadata.default_model_slug,
      ];

      for (const candidate of candidates) {
        if (
          typeof candidate === "string" &&
          candidate &&
          !unique.has(candidate)
        ) {
          unique.add(candidate);
          seen.push(candidate);
        }
      }
    }

    const defaultModel =
      typeof data.default_model_slug === "string"
        ? data.default_model_slug
        : null;

    if (
      defaultModel &&
      !unique.has(defaultModel)
    ) {
      unique.add(defaultModel);
      seen.push(defaultModel);
    }

    return {
      latest: seen[0] || defaultModel || "inconnu",
      history: seen.slice(0, 8),
      distinct: unique.size,
      defaultModel,
    };
  }

  function analyzeBranchMessages(branchNodes, data) {
    const messages = [];

    for (const item of branchNodes) {
      if (
        isObj(item?.node) &&
        isObj(item.node.message)
      ) {
        messages.push(item.node.message);
      }
    }

    const roles = {
      user: 0,
      assistant: 0,
      tool: 0,
      system: 0,
      other: 0,
    };

    const roleCharacters = {
      user: 0,
      assistant: 0,
      tool: 0,
      system: 0,
      other: 0,
    };

    const roleTokens = {
      user: 0,
      assistant: 0,
      tool: 0,
      system: 0,
      other: 0,
    };

    const entries = [];
    const attachments = new Set();
    const turnExchangeIds = new Set();
    let totalCharacters = 0;
    let totalTokens = 0;
    let weightedTokens = 0;
    let codeCharacters = 0;
    let codeTokens = 0;
    let hiddenMessages = 0;
    let contextMarkers = 0;
    let substantiveMessages = 0;

    for (const message of messages) {
      const role = Object.prototype.hasOwnProperty.call(
        roles,
        messageRole(message)
      )
        ? messageRole(message)
        : "other";

      const type = contentType(message);
      const text = messageText(message);
      const characters = text.length;
      const tokens = estimateTokens(text);
      const metadata = isObj(message.metadata)
        ? message.metadata
        : {};
      const hidden =
        metadata.is_visually_hidden_from_conversation ===
          true ||
        metadata.is_hidden === true;
      const codeChars = countCodeCharacters(
        text,
        type
      );
      const codeTokenEstimate = estimateTokens(
        codeChars === characters
          ? text
          : text.match(/```[\s\S]*?```/g)?.join("\n") ||
              ""
      );

      let weight = 1;

      if (role === "tool") {
        weight = 0.30;
      }

      if (
        type === "thoughts" ||
        type === "reasoning_recap"
      ) {
        weight = Math.min(weight, 0.12);
      }

      if (hidden) {
        weight = Math.min(weight, 0.10);
        hiddenMessages += 1;
      }

      roles[role] += 1;
      roleCharacters[role] += characters;
      roleTokens[role] += tokens;
      totalCharacters += characters;
      totalTokens += tokens;
      weightedTokens += tokens * weight;
      codeCharacters += codeChars;
      codeTokens += codeTokenEstimate;
      contextMarkers += markerCount(
        message,
        text,
        type
      );

      if (characters > 0) {
        substantiveMessages += 1;
      }

      if (
        typeof metadata.turn_exchange_id ===
          "string"
      ) {
        turnExchangeIds.add(
          metadata.turn_exchange_id
        );
      }

      collectAttachmentNames(
        metadata.attachments,
        attachments
      );
      collectAttachmentNames(
        message.content,
        attachments
      );

      entries.push({
        role,
        type,
        tokens,
        weightedTokens: tokens * weight,
      });
    }

    function recent(count) {
      const slice = entries.slice(-count);

      return {
        messages: slice.length,
        rawTokens: Math.round(
          slice.reduce(
            (sum, item) => sum + item.tokens,
            0
          )
        ),
        weightedTokens: Math.round(
          slice.reduce(
            (sum, item) =>
              sum + item.weightedTokens,
            0
          )
        ),
      };
    }

    const models = latestModelInformation(
      messages,
      data
    );

    return {
      messages: messages.length,
      substantiveMessages,
      roles,
      roleCharacters,
      roleTokens,
      totalCharacters,
      totalTokens,
      weightedTokens: Math.round(weightedTokens),
      recent32: recent(32),
      recent64: recent(64),
      recent128: recent(128),
      recent256: recent(256),
      codeCharacters,
      codeTokens,
      toolTokenShare:
        totalTokens > 0
          ? roleTokens.tool / totalTokens
          : 0,
      codeTokenShare:
        totalTokens > 0
          ? codeTokens / totalTokens
          : 0,
      hiddenMessages,
      contextMarkers,
      attachmentCount: attachments.size,
      attachmentNames: [...attachments].slice(0, 20),
      turnExchangeCount: turnExchangeIds.size,
      models,
    };
  }

  function analyzeConversationObject(data) {
    const found = findLargestMapping(data);

    if (!found) {
      return {
        ok: false,
        error:
          "Unrecognized conversation structure.",
      };
    }

    let messages = 0;

    for (const node of Object.values(
      found.mapping
    )) {
      if (
        isObj(node) &&
        isObj(node.message)
      ) {
        messages += 1;
      }
    }

    const envelope = found.envelope;
    const currentNode =
      typeof envelope.current_node === "string"
        ? envelope.current_node
        : typeof data.current_node === "string"
          ? data.current_node
          : null;

    const branch = orderedActiveBranch(
      found.mapping,
      currentNode
    );

    const branchMetrics = analyzeBranchMessages(
      branch.nodes,
      data
    );

    const projectId =
      typeof envelope.gizmo_id === "string" &&
      envelope.gizmo_id.startsWith("g-p-")
        ? envelope.gizmo_id
        : typeof data.gizmo_id === "string" &&
            data.gizmo_id.startsWith("g-p-")
          ? data.gizmo_id
          : null;

    return {
      ok: true,
      nodes: found.size,
      messages,
      activeBranchNodes: branch.nodes.length,
      activeBranchMessages:
        branchMetrics.messages,
      activeBranchComplete: branch.complete,
      branchMetrics,
      projectId,
      conversationOrigin:
        typeof data.conversation_origin ===
          "string"
          ? data.conversation_origin
          : null,
      memoryScope:
        typeof data.memory_scope === "string"
          ? data.memory_scope
          : null,
      contextScopes: Array.isArray(
        data.context_scopes
      )
        ? data.context_scopes
        : [],
      title:
        typeof envelope.title === "string" &&
        envelope.title.trim()
          ? envelope.title.trim()
          : typeof data.title === "string" &&
              data.title.trim()
            ? data.title.trim()
            : "ChatGPT conversation",
      currentNodePresent:
        currentNode === null ||
        Object.prototype.hasOwnProperty.call(
          found.mapping,
          currentNode
        ),
    };
  }

  async function jsonRequest(url, options = {}) {
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      ...options,
    });
    const text = await response.text();
    let data = null;
    try { if (text) data = JSON.parse(text); } catch {}
    return { ok: response.ok, status: response.status, data, text };
  }

  function deepFind(value, keys) {
    if (!isObj(value)) return null;
    const stack = [value], seen = new WeakSet();
    while (stack.length) {
      const item = stack.pop();
      if (!isObj(item) || seen.has(item)) continue;
      seen.add(item);
      if (!Array.isArray(item)) {
        for (const [key, child] of Object.entries(item)) {
          if (keys.has(key.toLowerCase()) && typeof child === "string" && child) return child;
          if (isObj(child)) stack.push(child);
        }
      } else {
        for (const child of item) if (isObj(child)) stack.push(child);
      }
    }
    return null;
  }

  async function authContext() {
    const session = await jsonRequest("/api/auth/session");
    if (!session.ok || !session.data) {
      return { ok: false, error: "Unable to read the ChatGPT session. Reload the page." };
    }

    const token =
      session.data.accessToken ||
      deepFind(session.data, new Set(["accesstoken", "access_token"]));

    if (!token) {
      return { ok: false, error: "ChatGPT session token not found. Reload the page." };
    }

    const baseHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "OAI-Language": document.documentElement.lang || "fr-FR",
    };

    const account = await jsonRequest(
      "/backend-api/accounts/check/v4-2023-04-27",
      { headers: baseHeaders }
    );

    const accountId =
      account.data?.accounts?.default?.account?.account_id ||
      deepFind(account.data, new Set(["account_id", "accountid"])) ||
      deepFind(session.data, new Set(["account_id", "accountid"]));

    return {
      ok: true,
      headers: {
        ...baseHeaders,
        ...(accountId ? { "ChatGPT-Account-ID": accountId } : {}),
      },
    };
  }

  function projectFromDom(conversationId) {
    const pattern = /g-p-[0-9a-f]{16,}/i;

    for (const link of document.querySelectorAll("a[href]")) {
      if (!String(link.href).includes(`/c/${conversationId}`)) continue;
      let el = link;
      for (let depth = 0; el && depth < 9; depth += 1, el = el.parentElement) {
        const match = String(el.outerHTML || "").match(pattern);
        if (match) return match[0];
      }
    }

    const html = document.documentElement?.innerHTML || "";
    const position = html.indexOf(conversationId);
    if (position < 0) return null;

    const start = Math.max(0, position - 15000);
    const nearby = html.slice(start, position + conversationId.length + 15000);
    const matches = [...nearby.matchAll(/g-p-[0-9a-f]{16,}/gi)];
    if (!matches.length) return null;

    const center = position - start;
    matches.sort((a, b) =>
      Math.abs((a.index || 0) - center) - Math.abs((b.index || 0) - center)
    );
    return matches[0][0];
  }

  function projectInfoFromSidebar(data, conversationId) {
    const items = Array.isArray(data?.items) ? data.items : [];
    const projects = [];

    for (const item of items) {
      const gizmo = item?.gizmo?.gizmo || item?.gizmo || item?.project;
      const id = gizmo?.id || item?.gizmo_id;
      if (typeof id !== "string" || !id.startsWith("g-p-")) continue;
      projects.push(id);
      if (JSON.stringify(item).includes(conversationId)) {
        return { found: id, projects };
      }
    }
    return { found: null, projects };
  }

  async function discoverProject(conversationId, headers) {
    const dom = projectFromDom(conversationId);
    if (dom) return dom;

    let cursor = null;
    const projectIds = new Set(), seenCursors = new Set();

    for (let page = 0; page < 8; page += 1) {
      const url = new URL("/backend-api/gizmos/snorlax/sidebar", location.origin);
      url.searchParams.set("conversations_per_gizmo", "20");
      url.searchParams.set("owned_only", "true");
      if (cursor) url.searchParams.set("cursor", cursor);

      const response = await jsonRequest(url, { headers });
      if (!response.ok || !response.data) break;

      const info = projectInfoFromSidebar(response.data, conversationId);
      if (info.found) return info.found;
      info.projects.forEach((id) => projectIds.add(id));

      const next = response.data.cursor || response.data.next_cursor || response.data.nextCursor;
      if (!next || seenCursors.has(next)) break;
      seenCursors.add(next);
      cursor = next;
    }

    const ids = [...projectIds].slice(0, 40);
    for (let offset = 0; offset < ids.length; offset += 4) {
      const batch = ids.slice(offset, offset + 4);
      const results = await Promise.all(batch.map(async (projectId) => {
        let cursor = "0";
        const seen = new Set();

        for (let page = 0; page < 20; page += 1) {
          const url = new URL(
            `/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations`,
            location.origin
          );
          url.searchParams.set("cursor", cursor);
          const response = await jsonRequest(url, { headers });
          if (!response.ok || !response.data) return null;

          const items = Array.isArray(response.data.items) ? response.data.items : [];
          if (items.some((x) => x?.id === conversationId || x?.conversation_id === conversationId)) {
            return projectId;
          }

          const next = response.data.cursor || response.data.next_cursor || response.data.nextCursor;
          if (!next || seen.has(next)) return null;
          seen.add(next);
          cursor = String(next);
        }
        return null;
      }));

      const found = results.find(Boolean);
      if (found) return found;
    }
    return null;
  }

  function getConversation(conversationId, headers, projectId) {
    return jsonRequest(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
      headers: {
        ...headers,
        ...(projectId ? { "chatgpt-project-id": projectId } : {}),
        "X-OpenAI-Target-Path": `/backend-api/conversation/${conversationId}`,
        "X-OpenAI-Target-Route": "/backend-api/conversation/{conversation_id}",
      },
    });
  }

  function detectMaximumLengthNotice() {
    const patterns = [
      /vous avez atteint la longueur maximum pour cette conversation/i,
      /vous avez atteint la longueur maximale pour cette conversation/i,
      /you(?:'|’)ve reached the maximum length for this conversation/i,
      /this conversation has reached its maximum length/i,
    ];

    const regions = [
      ...document.querySelectorAll(
        [
          "[role='alert']",
          "[aria-live='assertive']",
          "[data-testid*='error']",
          "[data-testid*='toast']",
          "form",
        ].join(",")
      ),
    ];

    for (const region of regions) {
      const text = String(
        region.innerText ||
        region.textContent ||
        ""
      );

      if (patterns.some((pattern) => pattern.test(text))) {
        return true;
      }
    }

    return false;
  }

  async function fetchAndAnalyze(conversationId) {
    try {
      const auth = await authContext();
      if (!auth.ok) return auth;

      let projectId = projectFromDom(conversationId);
      let response = await getConversation(conversationId, auth.headers, projectId);

      if (!response.ok && response.status === 404) {
        projectId = await discoverProject(conversationId, auth.headers);
        if (projectId) {
          response = await getConversation(conversationId, auth.headers, projectId);
        }
      }

      if (!response.ok) {
        if (response.status === 404) {
          return { ok: false, error: "Conversation not found in your account or Projects." };
        }
        if (response.status === 401 || response.status === 403) {
          return { ok: false, error: "ChatGPT rejected the session. Reload the page." };
        }
        return { ok: false, error: `Erreur ChatGPT ${response.status}.` };
      }

      if (!response.data) {
        return { ok: false, error: "ChatGPT returned an unusable response. Wait for the current task to finish." };
      }

      const receivedConversationId =
        typeof response.data.conversation_id === "string"
          ? response.data.conversation_id
          : typeof response.data.id === "string"
            ? response.data.id
            : null;

      if (
        receivedConversationId &&
        receivedConversationId !== conversationId
      ) {
        return {
          ok: false,
          code: "CONVERSATION_MISMATCH",
          error:
            "ChatGPT returned a different conversation than the one currently open.",
          requestedConversationId: conversationId,
          receivedConversationId,
        };
      }

      const result = analyzeConversationObject(response.data);

      if (result.ok) {
        result.projectDetected = Boolean(projectId || result.projectId);
        result.requestedConversationId = conversationId;
        result.receivedConversationId =
          receivedConversationId || conversationId;
        result.rootMappingSize =
          isObj(response.data.mapping) &&
          !Array.isArray(response.data.mapping)
            ? Object.keys(response.data.mapping).length
            : null;
        result.limitConfirmed =
          detectMaximumLengthNotice();
      }

      return result;
    } catch {
      return { ok: false, error: "Unable to read the conversation. Reload ChatGPT." };
    }
  }

  const api = { analyzeConversationObject, fetchAndAnalyze };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.__CHATGPT_USAGE_ANALYZER__ = api;
})(typeof window !== "undefined" ? window : globalThis);

export async function probeSelectionDomInPage(tabId, providerKey) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [providerKey],
    func: async (provider) => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const stableChatGptId = (value) =>
        !!value && value !== "client-created-root" && !String(value).startsWith("request-");

      const chatGptSnapshot = () => {
        const exchanges = [...document.querySelectorAll("[data-turn-key]")];
        if (exchanges.length) {
          const ids = [];
          let userTurns = 0;
          let assistantTurns = 0;
          for (const exchange of exchanges) {
            const userId = exchange.getAttribute("data-turn-key");
            const userRoot = exchange.querySelector("[data-user-message-bubble]");
            if (stableChatGptId(userId) && userRoot) {
              userTurns += 1;
              ids.push(String(userId));
            }

            const assistantRoot = exchange.querySelector("[data-chatgpt-selection-message-id]");
            const assistantId = assistantRoot?.getAttribute("data-chatgpt-selection-message-id") || "";
            if (stableChatGptId(assistantId) && assistantRoot) {
              assistantTurns += 1;
              ids.push(String(assistantId));
            }
          }
          return {
            mode: "modern",
            modernExchanges: exchanges.length,
            userTurns,
            assistantTurns,
            recognizedTurns: new Set(ids).size,
            ids: [...new Set(ids)],
          };
        }

        const ids = new Set();
        const containers = [...document.querySelectorAll("[data-turn-id-container]")];
        for (const container of containers) {
          const sourceTurnId = container.getAttribute("data-turn-id-container") || "";
          let turnId = stableChatGptId(sourceTurnId) ? sourceTurnId : "";

          if (!turnId && sourceTurnId.startsWith("request-")) {
            const messageNode = container.matches?.("[data-message-id]")
              ? container
              : container.querySelector("[data-message-id]");
            const messageId = messageNode?.getAttribute("data-message-id") || "";
            if (messageId && !messageId.startsWith("request-")) turnId = messageId;
          }
          if (!turnId) continue;

          let root = null;
          for (const candidate of container.querySelectorAll("[data-turn-id]")) {
            if (candidate.getAttribute("data-turn-id") === sourceTurnId) {
              root = candidate;
              break;
            }
          }
          if (!root) {
            const semantic = container.querySelector([
              "[data-message-author-role]",
              '[data-testid^="conversation-turn-"]',
              "[data-conversation-screenshot-content]",
              ".markdown",
              "img",
              "video",
              "audio",
            ].join(","));
            root = semantic?.closest?.("[data-conversation-screenshot-content]") || semantic || null;
            if (!root && (container.textContent || "").trim()) root = container;
          }
          if (root) ids.add(String(turnId));
        }

        for (const section of document.querySelectorAll("[data-turn-id]")) {
          const turnId = section.getAttribute("data-turn-id") || "";
          if (stableChatGptId(turnId)) ids.add(String(turnId));
        }

        return {
          mode: ids.size ? "legacy" : "none",
          modernExchanges: 0,
          userTurns: 0,
          assistantTurns: 0,
          recognizedTurns: ids.size,
          ids: [...ids],
        };
      };

      const claudeSnapshot = () => {
        const rows = [...document.querySelectorAll('[data-testid="transcript-row"][data-index]')];
        const indexes = rows
          .map((row) => Number(row.getAttribute("data-index")))
          .filter((index) => Number.isInteger(index) && index >= 0);
        let ariaSetSize = null;
        let articleRows = 0;
        for (const row of rows) {
          const article = row.querySelector('[role="article"]');
          if (article) articleRows += 1;
          const size = Number(article?.getAttribute("aria-setsize"));
          if (Number.isInteger(size) && size >= 0) ariaSetSize = size;
        }
        return {
          rows: rows.length,
          indexes,
          articleRows,
          ariaSetSize,
        };
      };

      const grokSnapshot = () => {
        const turns = [...document.querySelectorAll('[id^="response-"]')];
        const ids = turns
          .map((turn) => String(turn.id || "").replace(/^response-/, ""))
          .filter(Boolean);
        let userHosts = 0;
        let assistantHosts = 0;
        for (const turn of turns) {
          if (turn.querySelector('[data-testid="user-message"]')) userHosts += 1;
          if (turn.querySelector('[data-testid="assistant-message"]')) assistantHosts += 1;
        }
        return {
          responseNodes: turns.length,
          ids: [...new Set(ids)],
          userHosts,
          assistantHosts,
        };
      };

      const deepSeekMessageId = (node) => {
        const candidates = [
          node?.getAttribute?.("data-virtual-list-item-key"),
          node?.getAttribute?.("data-message-id"),
          node?.getAttribute?.("data-msg-id"),
          String(node?.id || "").match(/(?:message|msg)[-_](\d+)$/i)?.[1],
        ];
        for (const value of candidates) {
          if (value != null && /^\d+$/.test(String(value))) return String(value);
        }
        return null;
      };

      const deepSeekSnapshot = () => {
        const nodes = [...document.querySelectorAll(
          '[data-virtual-list-item-key], [data-message-id], [data-msg-id], [id^="message-"], [id^="msg-"]',
        )];
        const ids = new Set();
        for (const node of nodes) {
          const id = deepSeekMessageId(node);
          if (id) ids.add(id);
        }
        return {
          candidateNodes: nodes.length,
          ids: [...ids],
        };
      };

      const collect = () => {
        if (provider === "chatgpt") return chatGptSnapshot();
        if (provider === "claude") return claudeSnapshot();
        if (provider === "grok") return grokSnapshot();
        if (provider === "deepseek") return deepSeekSnapshot();
        return {};
      };

      const ready = (snapshot) => {
        if (provider === "chatgpt") {
          return snapshot.mode === "modern"
            ? snapshot.userTurns >= 1 && snapshot.assistantTurns >= 1
            : snapshot.recognizedTurns >= 2;
        }
        if (provider === "claude") return snapshot.rows >= 2;
        if (provider === "grok") return (snapshot.ids?.length || 0) >= 2;
        if (provider === "deepseek") return (snapshot.ids?.length || 0) >= 2;
        return true;
      };

      try {
        let snapshot = collect();
        for (let attempt = 0; attempt < 40 && !ready(snapshot); attempt++) {
          await delay(250);
          snapshot = collect();
        }
        return { kind: "ok", data: snapshot };
      } catch (error) {
        return {
          kind: "network-error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  return result;
}

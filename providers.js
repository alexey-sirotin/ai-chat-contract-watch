export async function fetchChatGptConversationInPage(tabId, conversationId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [conversationId],
    func: async (id) => {
      try {
        const sessionResponse = await fetch("/api/auth/session", { credentials: "include" });
        if (!sessionResponse.ok) {
          return { kind: "http-error", stage: "auth/session", status: sessionResponse.status };
        }

        let session;
        try {
          session = await sessionResponse.json();
        } catch {
          return { kind: "invalid-json", stage: "auth/session", status: sessionResponse.status };
        }

        const accessToken = session?.accessToken;
        if (!accessToken) {
          return {
            kind: "auth-required",
            message: "ChatGPT session has no access token; sign in and retry.",
          };
        }

        const conversationResponse = await fetch(
          `/backend-api/conversation/${encodeURIComponent(id)}`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            credentials: "include",
          },
        );

        if (!conversationResponse.ok) {
          return {
            kind: "http-error",
            stage: "backend-api/conversation",
            status: conversationResponse.status,
          };
        }

        try {
          return {
            kind: "ok",
            status: conversationResponse.status,
            data: await conversationResponse.json(),
          };
        } catch {
          return {
            kind: "invalid-json",
            stage: "backend-api/conversation",
            status: conversationResponse.status,
          };
        }
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

export async function fetchClaudeConversationInPage(tabId, conversationId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [conversationId],
    func: async (id) => {
      try {
        const candidates = [];
        const addCandidate = (value) => {
          const candidate = typeof value === "string" ? value.trim() : "";
          if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
        };

        const marker = `/chat_conversations/${id}`;
        const resources = performance.getEntriesByType("resource").map((entry) => entry.name);
        for (let i = resources.length - 1; i >= 0; i--) {
          try {
            const url = new URL(resources[i], location.href);
            if (!url.pathname.includes(marker)) continue;
            const parts = url.pathname.split("/");
            const orgIndex = parts.indexOf("organizations");
            if (orgIndex >= 0 && parts[orgIndex + 1]) {
              addCandidate(decodeURIComponent(parts[orgIndex + 1]));
              break;
            }
          } catch {}
        }

        let organizationsStatus = null;
        try {
          const orgResponse = await fetch("/api/organizations", { credentials: "include" });
          organizationsStatus = orgResponse.status;
          if (orgResponse.ok) {
            try {
              const orgData = await orgResponse.json();
              const organizations = Array.isArray(orgData)
                ? orgData
                : Array.isArray(orgData?.organizations)
                  ? orgData.organizations
                  : [];
              for (const item of organizations) {
                addCandidate(String(item?.uuid || item?.id || item?.organization_id || ""));
              }
            } catch {
              // A resource-derived organization id may still work.
            }
          }
        } catch (error) {
          if (!candidates.length) {
            return {
              kind: "network-error",
              message: error instanceof Error ? error.message : String(error),
            };
          }
        }

        if (!candidates.length) {
          if (organizationsStatus && organizationsStatus >= 400) {
            return {
              kind: "http-error",
              stage: "api/organizations",
              status: organizationsStatus,
            };
          }
          return {
            kind: "contract-error",
            message: "Claude organization discovery returned no usable organization id.",
            violation: "no organization id could be discovered from resource URLs or /api/organizations",
          };
        }

        const query =
          "?tree=True&rendering_mode=messages&render_all_tools=true" +
          "&include_inline_comparison=true&consistency=strong";
        const failures = [];

        for (const organizationId of candidates) {
          const response = await fetch(
            "/api/organizations/" + encodeURIComponent(organizationId) +
            "/chat_conversations/" + encodeURIComponent(id) + query,
            { credentials: "include" },
          );

          if (!response.ok) {
            failures.push({ status: response.status, organizationId });
            continue;
          }

          try {
            return {
              kind: "ok",
              status: response.status,
              organizationId,
              data: await response.json(),
            };
          } catch {
            return {
              kind: "invalid-json",
              stage: "api/organizations/.../chat_conversations",
              status: response.status,
            };
          }
        }

        const authFailure = failures.find((item) => item.status === 401 || item.status === 403);
        const failure = authFailure || failures.at(-1);
        if (failure) {
          return {
            kind: "http-error",
            stage: "api/organizations/.../chat_conversations",
            status: failure.status,
          };
        }

        return {
          kind: "contract-error",
          message: "Claude conversation endpoint was not attempted because no organization candidate remained.",
          violation: "Claude organization candidate list became empty before conversation acquisition",
        };
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

export async function fetchGrokConversationInPage(tabId, conversationId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [conversationId],
    func: async (id) => {
      try {
        const mountedIds = [...document.querySelectorAll('[id^="response-"]')]
          .map((node) => String(node.id || "").replace(/^response-/, ""))
          .filter(Boolean);

        const [metadataResponse, responsesResponse] = await Promise.all([
          fetch(
            "/rest/app-chat/conversations_v2/" + encodeURIComponent(id) +
            "?includeWorkspaces=true&includeTaskResult=true",
            { credentials: "include" },
          ),
          fetch(
            "/rest/app-chat/conversations/" + encodeURIComponent(id) +
            "/responses?includeThreads=false",
            { credentials: "include" },
          ),
        ]);

        if (!responsesResponse.ok) {
          return {
            kind: "http-error",
            stage: "rest/app-chat/conversations/.../responses",
            status: responsesResponse.status,
          };
        }

        let responsesJson;
        try {
          responsesJson = await responsesResponse.json();
        } catch {
          return {
            kind: "invalid-json",
            stage: "rest/app-chat/conversations/.../responses",
            status: responsesResponse.status,
          };
        }

        let metadata = null;
        if (metadataResponse.ok) {
          try {
            metadata = (await metadataResponse.json())?.conversation || null;
          } catch {
            return {
              kind: "invalid-json",
              stage: "rest/app-chat/conversations_v2",
              status: metadataResponse.status,
            };
          }
        } else if (metadataResponse.status === 401 || metadataResponse.status === 403) {
          return {
            kind: "http-error",
            stage: "rest/app-chat/conversations_v2",
            status: metadataResponse.status,
          };
        }

        const responses = Array.isArray(responsesJson?.responses) ? responsesJson.responses : null;
        if (!responses) {
          return {
            kind: "contract-error",
            message: "Grok responses endpoint returned JSON without a responses array.",
            violation: "responses is missing or is not an array",
          };
        }

        const byId = new Map();
        const parentIds = new Set();
        for (const item of responses) {
          if (!item?.responseId) continue;
          byId.set(String(item.responseId), item);
          if (item.parentResponseId) parentIds.add(String(item.parentResponseId));
        }

        const mounted = new Set(mountedIds.map(String));
        const leaves = responses.filter(
          (item) => item?.responseId && !parentIds.has(String(item.responseId)),
        );
        const candidates = leaves.length
          ? leaves
          : responses.filter((item) => item?.responseId);

        let bestPath = [];
        let bestOverlap = -1;
        let bestTime = -Infinity;
        let bestIndex = -1;

        for (const leaf of candidates) {
          const path = [];
          const seen = new Set();
          let current = leaf;
          while (current?.responseId && !seen.has(String(current.responseId))) {
            const currentId = String(current.responseId);
            seen.add(currentId);
            path.push(current);
            current = current.parentResponseId
              ? byId.get(String(current.parentResponseId))
              : null;
          }
          path.reverse();

          const overlap = path.reduce(
            (count, item) => count + (mounted.has(String(item.responseId)) ? 1 : 0),
            0,
          );
          const parsed = Date.parse(leaf.createTime || "");
          const time = Number.isFinite(parsed) ? parsed : -Infinity;
          const index = responses.indexOf(leaf);
          if (
            overlap > bestOverlap ||
            (overlap === bestOverlap && time > bestTime) ||
            (overlap === bestOverlap && time === bestTime && index > bestIndex)
          ) {
            bestPath = path;
            bestOverlap = overlap;
            bestTime = time;
            bestIndex = index;
          }
        }

        const turns = bestPath
          .filter((item) => item && item.isControl !== true)
          .map((item) => {
            const sender = String(item.sender || "").toLowerCase();
            const role = /human|user/.test(sender)
              ? "user"
              : /assistant|model/.test(sender)
                ? "assistant"
                : "unknown";
            return {
              id: String(item.responseId || ""),
              role,
              message: typeof item.message === "string" ? item.message : "",
              cardAttachmentsJson: Array.isArray(item.cardAttachmentsJson)
                ? item.cardAttachmentsJson
                : [],
              fileAttachments: Array.isArray(item.fileAttachments)
                ? item.fileAttachments.map(String)
                : [],
              createdAt: item.createTime || null,
              model: item.model || item.requestMetadata?.model || null,
              parentResponseId: item.parentResponseId || null,
            };
          })
          .filter((turn) => turn.id && turn.role !== "unknown");

        return {
          kind: "ok",
          status: responsesResponse.status,
          data: {
            conversationId: id,
            title: metadata?.title || document.title.replace(/\s*[|–-]\s*Grok.*$/i, ""),
            createTime: metadata?.createTime || null,
            modifyTime: metadata?.modifyTime || null,
            responses,
            turns,
          },
        };
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

export async function fetchDeepSeekConversationInPage(tabId, conversationId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [conversationId],
    func: async (id) => {
      try {
        let token = "";
        try {
          const stored = JSON.parse(localStorage.getItem("userToken") || "null");
          token = typeof stored?.value === "string" ? stored.value : "";
        } catch {}

        if (!token) {
          return {
            kind: "auth-required",
            message: "DeepSeek user token is missing; sign in and retry.",
          };
        }

        const response = await fetch(
          "/api/v0/chat/history_messages?chat_session_id=" + encodeURIComponent(id),
          {
            credentials: "include",
            headers: {
              Accept: "application/json",
              Authorization: "Bearer " + token,
            },
          },
        );

        if (!response.ok) {
          return {
            kind: "http-error",
            stage: "api/v0/chat/history_messages",
            status: response.status,
          };
        }

        let payload;
        try {
          payload = await response.json();
        } catch {
          return {
            kind: "invalid-json",
            stage: "api/v0/chat/history_messages",
            status: response.status,
          };
        }

        if (payload?.code !== 0) {
          return {
            kind: "provider-error",
            message: `DeepSeek history API returned code ${payload?.code ?? "unknown"}: ${payload?.msg || "unknown error"}.`,
          };
        }

        const envelope = payload?.data;
        if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
          return {
            kind: "contract-error",
            message: "DeepSeek history API returned no data envelope.",
            violation: "payload.data is missing or is not an object",
          };
        }

        if (envelope.biz_code !== 0) {
          return {
            kind: "provider-error",
            message: `DeepSeek history business API returned code ${envelope.biz_code ?? "unknown"}: ${envelope.biz_msg || "unknown error"}.`,
          };
        }

        const biz = envelope.biz_data;
        if (!biz || typeof biz !== "object" || Array.isArray(biz)) {
          return {
            kind: "contract-error",
            message: "DeepSeek history API returned no biz_data object.",
            violation: "payload.data.biz_data is missing or is not an object",
          };
        }

        const session = biz.chat_session;
        if (!session || typeof session !== "object" || Array.isArray(session)) {
          return {
            kind: "contract-error",
            message: "DeepSeek history API returned no chat_session object.",
            violation: "biz_data.chat_session is missing or is not an object",
          };
        }

        if (!Array.isArray(biz.chat_messages)) {
          return {
            kind: "contract-error",
            message: "DeepSeek history API returned no chat_messages array.",
            violation: "biz_data.chat_messages is missing or is not an array",
          };
        }

        if (session.current_message_id == null) {
          return {
            kind: "contract-error",
            message: "DeepSeek chat_session has no current_message_id.",
            violation: "chat_session.current_message_id is missing",
          };
        }

        const messages = biz.chat_messages;
        const byId = new Map(
          messages
            .filter((item) => item?.message_id != null)
            .map((item) => [String(item.message_id), item]),
        );
        const currentMessageId = String(session.current_message_id);
        if (!byId.has(currentMessageId)) {
          return {
            kind: "contract-error",
            message: "DeepSeek current_message_id is absent from chat_messages.",
            violation: "chat_messages does not contain chat_session.current_message_id",
          };
        }

        const branch = [];
        const seen = new Set();
        let current = byId.get(currentMessageId);
        while (current?.message_id != null) {
          const currentId = String(current.message_id);
          if (seen.has(currentId)) {
            return {
              kind: "contract-error",
              message: "DeepSeek active message branch contains a cycle.",
              violation: "active DeepSeek message parent chain contains a cycle",
            };
          }
          seen.add(currentId);
          branch.push(current);
          if (current.parent_id == null) break;
          const parentId = String(current.parent_id);
          current = byId.get(parentId);
          if (!current) {
            return {
              kind: "contract-error",
              message: `DeepSeek active branch references missing parent ${parentId}.`,
              violation: "active DeepSeek message parent chain references a missing message",
            };
          }
        }
        branch.reverse();

        const turns = branch
          .map((item) => {
            const rawRole = String(item.role || "").toUpperCase();
            const role = rawRole === "USER"
              ? "user"
              : rawRole === "ASSISTANT"
                ? "assistant"
                : "unknown";
            return {
              id: String(item.message_id),
              parentId: item.parent_id == null ? null : String(item.parent_id),
              role,
              model: item.model || null,
              insertedAt: Number.isFinite(Number(item.inserted_at))
                ? Number(item.inserted_at)
                : null,
              sourceFragmentsArray: Array.isArray(item.fragments),
              fragments: Array.isArray(item.fragments) ? item.fragments : [],
            };
          })
          .filter((turn) => turn.role !== "unknown");

        return {
          kind: "ok",
          status: response.status,
          data: {
            conversationId: id,
            title: session.title || document.title.replace(/\s*[|–-]\s*DeepSeek.*$/i, ""),
            currentMessageId,
            version: session.version ?? null,
            rawMessageCount: messages.length,
            turns,
          },
        };
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

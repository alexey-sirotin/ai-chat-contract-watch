# AI Chat Contract Watch

A small private browser extension for periodically checking whether the API and message-selection DOM contracts used by [AI Chat Export](https://github.com/alexey-sirotin/ai-chat-export) still look compatible.

The goal is to run probes inside a normal signed-in browser session, using the same provider-facing paths and the same selection-relevant DOM structures that the exporter relies on, without storing account credentials in CI.

## Current scope

The extension monitors ChatGPT, Claude, Grok, and DeepSeek. Each provider run now has two components:

- **API** — authenticated acquisition plus stable response-shape invariants;
- **DOM** — the page markup/identity hooks needed for AI Chat Export to place and map message-selection checkboxes.

The provider's main status aggregates both components, while the popup shows `API: ...` and `DOM: ...` separately.

### ChatGPT

The ChatGPT API probe uses the same authenticated path as AI Chat Export:

1. load a configured ChatGPT canary conversation in the normal browser session;
2. obtain the current access token through `/api/auth/session` in the ChatGPT page context;
3. request `/backend-api/conversation/<conversation-id>`;
4. verify stable structural invariants required by the exporter.

The ChatGPT DOM probe mirrors the selection UI's current markup rules: modern `[data-turn-key]` exchanges with `[data-user-message-bubble]` and `[data-chatgpt-selection-message-id]`, plus the exporter's legacy turn/message-id fallbacks.

### Claude

The Claude API probe mirrors AI Chat Export's current acquisition path:

1. load a configured Claude canary conversation in the normal browser session;
2. discover the organization id from the conversation resource URL or `/api/organizations`;
3. request `/api/organizations/<organization-id>/chat_conversations/<conversation-id>` with the same tree/rendering query used by the exporter;
4. verify `chat_messages`, `current_leaf_message_uuid`, message UUIDs, iterable content blocks, sender roles, and the active parent chain.

The Claude DOM probe checks the virtualized transcript rows used by the selection UI: `[data-testid="transcript-row"][data-index]`, including usable row indexes and the optional article/`aria-setsize` metadata.

### Grok

The Grok API probe mirrors the exporter's current REST acquisition path:

1. load a configured Grok canary conversation in the normal browser session;
2. request `/rest/app-chat/conversations_v2/<conversation-id>?includeWorkspaces=true&includeTaskResult=true` for optional metadata;
3. request `/rest/app-chat/conversations/<conversation-id>/responses?includeThreads=false` for the response tree;
4. rebuild the active response branch using response ids, parent ids, mounted response ids, recency, and response order, matching AI Chat Export's branch-selection logic;
5. verify the response/turn structure consumed by the Grok normalizer.

The Grok DOM probe checks `[id^="response-"]` turn nodes and verifies that their ids still overlap the active API branch ids used by the selection UI.

### DeepSeek

The DeepSeek API probe mirrors AI Chat Export's current history acquisition path:

1. load a configured DeepSeek canary conversation in the normal browser session;
2. read the existing `userToken` value from DeepSeek page `localStorage`;
3. request `/api/v0/chat/history_messages?chat_session_id=<conversation-id>` with the same bearer token and cookie credentials as the exporter;
4. verify the outer API/business envelopes, `chat_session`, `current_message_id`, and `chat_messages` shape;
5. rebuild the active parent chain and verify user/assistant roles plus the fragment arrays/types consumed by the DeepSeek normalizer.

The DeepSeek DOM probe mirrors the selection UI's numeric message-id discovery from `data-virtual-list-item-key`, `data-message-id`, `data-msg-id`, `message-*`, and `msg-*`, then checks those ids against the active API branch.

DeepSeek sometimes postpones rendering its virtualized message list in a hidden background tab. If the API probe succeeds but the hidden tab still exposes no selectable message nodes after the DOM wait window, that DOM result is treated as **inconclusive**, not as a contract mismatch. The watchdog keeps the last reliable DeepSeek DOM result and does not schedule a mismatch-confirmation retry solely because of that hidden-tab condition. A visible or already-rendered DeepSeek tab is still validated normally.

The extension does not compare complete JSON responses or whole DOM trees byte-for-byte. New harmless fields, classes, or unrelated page markup should not trigger an alert.

## Status model

- `OK` — both the required acquisition/response contract and selection DOM contract look compatible;
- `SUSPECT` — the first structural mismatch in either API or DOM; a confirmation probe is scheduled in five minutes;
- `CONTRACT_MISMATCH` — two consecutive structural failures;
- `AUTH_REQUIRED` — the browser session is not currently authenticated for the API probe;
- `NETWORK_ERROR` / `HTTP_ERROR` — the provider could not be checked reliably;
- `NOT_CONFIGURED` — no canary conversation has been configured yet.

Application-level provider errors that are not structural contract mismatches remain distinguishable in the popup. If the API probe is inconclusive because of auth/network/HTTP failure, a simultaneous DOM miss does not by itself escalate the provider to a confirmed contract mismatch.

The toolbar icon is deliberately simpler than the popup status model:

- gray `AI` circle — no usable check data yet;
- green `AI` circle — at least one configured provider is healthy and none has a problem;
- red `AI` circle — any configured provider is `SUSPECT`, requires auth, has a network/HTTP problem, or has a confirmed contract mismatch.

The icon is drawn deterministically in the extension service worker with flat colors and simple geometric letter shapes, so it does not depend on generated image assets.

## Canary conversations

Use small dedicated conversations that you control and intend to keep.

Each canary should contain at least one normal user message and one assistant response. Keeping the canaries short is useful not only for cheap API probes but also because the selection DOM probe should see both messages without virtualization removing most of the thread.

Typical URLs:

```text
https://chatgpt.com/c/<conversation-uuid>
https://claude.ai/chat/<conversation-uuid>
https://grok.com/c/<conversation-uuid>
https://chat.deepseek.com/a/chat/s/<conversation-id>
```

DeepSeek conversation ids are parsed from the `/a/chat/s/<id>` path and are not assumed to be UUIDs.

Paste the URLs into the extension popup and click the provider's **Run now** button. **Run all configured** checks configured providers sequentially.

If a canary is not already open, the extension opens it in an inactive temporary tab, runs both probes in that provider's page context, and closes the tab afterward. The DOM probe waits briefly for SPA-rendered message markup before deciding that the selection structure is missing.

DOM diagnostics also retain lightweight timing information from the page: navigation/load duration, the most recent provider API resource duration when available, DOM wait duration, and a component-sum total. They also record page visibility so slow or deferred background rendering can be distinguished from an actual selector change.

## Schedule

Normal probes run every 12 hours. A first structural mismatch in either component schedules a provider-specific confirmation probe five minutes later before the mismatch is promoted from `SUSPECT` to `CONTRACT_MISMATCH`. An inconclusive hidden DeepSeek DOM probe is not counted as a structural failure and does not create that retry by itself.

## Local development

Install dependencies and run the pure contract tests:

```bash
npm install
npm test
```

To load the extension in Chromium:

1. clone or download the repository;
2. open `chrome://extensions`;
3. enable **Developer mode**;
4. choose **Load unpacked**;
5. select the repository directory;
6. open the extension popup, configure one or more canary URLs, and run the first checks manually.

The project currently targets Chromium Manifest V3. Firefox packaging can be added once the monitoring design is stable.

## Structure

`background.js` owns scheduling, shared status handling, retries, and aggregate API/DOM results. `background-wrapper.js` keeps the aggregate toolbar icon synchronized with locally stored state, while `action-icon.js` contains the deterministic icon-state mapping and drawing code. Provider-specific page-context acquisition lives in `providers.js`; provider response-shape validation lives in `contract.js`; selection markup collection lives in `dom-probes.js`; pure DOM contract validation lives in `dom-contract.js`.

## Privacy

All configuration, status, and diagnostics are stored locally through browser extension storage. The extension has no telemetry and no developer-operated service.

Canary requests are made only to the configured providers using the browser's existing signed-in sessions. Provider tokens are read only inside the provider page context when required and are not copied into extension storage. DOM diagnostics contain counts and ids/selectors needed for compatibility checks, not message text.

## Planned next steps

- retain a small local history of probe results;
- add a diagnostics page with useful response-shape and DOM-shape information;
- add Firefox packaging after the monitoring design stabilizes.

## License

MIT

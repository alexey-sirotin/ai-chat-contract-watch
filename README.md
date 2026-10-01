# AI Chat Contract Watch

A small private browser extension for periodically checking whether the server contracts used by [AI Chat Export](https://github.com/alexey-sirotin/ai-chat-export) still look compatible.

The goal is to run probes inside a normal signed-in browser session, using the same provider-facing paths that the exporter relies on, without storing account credentials in CI.

## Current scope

The extension currently monitors ChatGPT, Claude, Grok, and DeepSeek.

### ChatGPT

The ChatGPT probe uses the same authenticated path as AI Chat Export:

1. load a configured ChatGPT canary conversation in the normal browser session;
2. obtain the current access token through `/api/auth/session` in the ChatGPT page context;
3. request `/backend-api/conversation/<conversation-id>`;
4. verify stable structural invariants required by the exporter.

### Claude

The Claude probe mirrors AI Chat Export's current acquisition path:

1. load a configured Claude canary conversation in the normal browser session;
2. discover the organization id from the conversation resource URL or `/api/organizations`;
3. request `/api/organizations/<organization-id>/chat_conversations/<conversation-id>` with the same tree/rendering query used by the exporter;
4. verify `chat_messages`, `current_leaf_message_uuid`, message UUIDs, iterable content blocks, sender roles, and the active parent chain.

### Grok

The Grok probe mirrors the exporter's current REST acquisition path:

1. load a configured Grok canary conversation in the normal browser session;
2. request `/rest/app-chat/conversations_v2/<conversation-id>?includeWorkspaces=true&includeTaskResult=true` for optional metadata;
3. request `/rest/app-chat/conversations/<conversation-id>/responses?includeThreads=false` for the response tree;
4. rebuild the active response branch using response ids, parent ids, mounted response ids, recency, and response order, matching AI Chat Export's branch-selection logic;
5. verify the response/turn structure consumed by the Grok normalizer.

### DeepSeek

The DeepSeek probe mirrors AI Chat Export's current history acquisition path:

1. load a configured DeepSeek canary conversation in the normal browser session;
2. read the existing `userToken` value from DeepSeek page `localStorage`;
3. request `/api/v0/chat/history_messages?chat_session_id=<conversation-id>` with the same bearer token and cookie credentials as the exporter;
4. verify the outer API/business envelopes, `chat_session`, `current_message_id`, and `chat_messages` shape;
5. rebuild the active parent chain and verify user/assistant roles plus the fragment arrays/types consumed by the DeepSeek normalizer.

The extension does not compare complete JSON responses byte-for-byte. New harmless fields should not trigger an alert.

## Status model

- `OK` — the acquisition path works and the expected conversation structure is present;
- `SUSPECT` — the first contract mismatch; a confirmation probe is scheduled in five minutes;
- `CONTRACT_MISMATCH` — two consecutive structural failures;
- `AUTH_REQUIRED` — the browser session is not currently authenticated for the probe;
- `NETWORK_ERROR` / `HTTP_ERROR` — the provider could not be checked reliably;
- `NOT_CONFIGURED` — no canary conversation has been configured yet.

Application-level provider errors that are not structural contract mismatches are reported as a yellow problem state rather than a red contract alert.

The toolbar badge summarizes all configured providers: red for a confirmed contract mismatch, yellow for inconclusive/problem states, green when at least one configured provider is healthy and none has a problem, and gray before configuration.

## Canary conversations

Use small dedicated conversations that you control and intend to keep.

For ChatGPT, the validator needs at least one normal user message and one assistant message. For Claude, use at least one human message and one assistant response. For Grok and DeepSeek, use at least one user turn and one assistant turn. Keep the canaries small so scheduled probes remain cheap.

Typical URLs:

```text
https://chatgpt.com/c/<conversation-uuid>
https://claude.ai/chat/<conversation-uuid>
https://grok.com/c/<conversation-uuid>
https://chat.deepseek.com/a/chat/s/<conversation-id>
```

DeepSeek conversation ids are parsed from the `/a/chat/s/<id>` path and are not assumed to be UUIDs.

Paste the URLs into the extension popup and click the provider's **Run now** button. **Run all configured** checks configured providers sequentially.

If a canary is not already open, the extension opens it in an inactive temporary tab, runs the probe in that provider's page context, and closes the tab afterward.

## Schedule

Normal probes run every 12 hours. A first structural mismatch schedules a provider-specific confirmation probe five minutes later before the toolbar turns red.

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

`background.js` owns scheduling, shared status handling, retries, and toolbar state. Provider-specific page-context acquisition lives in `providers.js`, while pure response-shape validation lives in `contract.js`.

## Privacy

All configuration, status, and diagnostics are stored locally through browser extension storage. The extension has no telemetry and no developer-operated service.

Canary requests are made only to the configured providers using the browser's existing signed-in sessions. Provider tokens are read only inside the provider page context when required and are not copied into extension storage.

## Planned next steps

- exercise the DeepSeek probe against a real canary and harden failure classification;
- retain a small local history of probe results;
- add a diagnostics page with useful response-shape information;
- add Firefox packaging after the monitoring design stabilizes.

## License

MIT

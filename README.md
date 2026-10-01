# AI Chat Contract Watch

A small private browser extension for periodically checking whether the server contracts used by [AI Chat Export](https://github.com/alexey-sirotin/ai-chat-export) still look compatible.

The goal is to run probes inside a normal signed-in browser session, using the same provider-facing paths that the exporter relies on, without storing account credentials in CI.

## Current scope

The extension currently monitors ChatGPT and Claude.

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

The extension does not compare complete JSON responses byte-for-byte. New harmless fields should not trigger an alert.

## Status model

- `OK` — the acquisition path works and the expected conversation structure is present;
- `SUSPECT` — the first contract mismatch; a confirmation probe is scheduled in five minutes;
- `CONTRACT_MISMATCH` — two consecutive structural failures;
- `AUTH_REQUIRED` — the browser session is not currently authenticated for the probe;
- `NETWORK_ERROR` / `HTTP_ERROR` — the provider could not be checked reliably;
- `NOT_CONFIGURED` — no canary conversation has been configured yet.

The toolbar badge summarizes all configured providers: red for a confirmed contract mismatch, yellow for inconclusive/problem states, green when at least one configured provider is healthy and none has a problem, and gray before configuration.

## Canary conversations

Use small dedicated conversations that you control and intend to keep.

For ChatGPT, the validator needs at least one normal user message and one assistant message. For Claude, use at least one human message and one assistant response. Keep both canaries small so scheduled probes remain cheap.

Typical URLs:

```text
https://chatgpt.com/c/<conversation-uuid>
https://claude.ai/chat/<conversation-uuid>
```

Paste the URLs into the extension popup and click the provider's **Run now** button. **Run all configured** checks both providers sequentially.

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
6. open the extension popup, configure one or both canary URLs, and run the first checks manually.

The project currently targets Chromium Manifest V3. Firefox packaging can be added once the monitoring design is stable.

## Privacy

All configuration, status, and diagnostics are stored locally through browser extension storage. The extension has no telemetry and no developer-operated service.

Canary requests are made only to the configured providers using the browser's existing signed-in sessions.

## Planned next steps

- exercise the Claude probe against a real canary and harden failure classification;
- retain a small local history of probe results;
- add a diagnostics page with useful response-shape information;
- add Grok and DeepSeek probes incrementally;
- add Firefox packaging after the monitoring design stabilizes.

## License

MIT

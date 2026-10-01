# AI Chat Contract Watch

A small private browser extension for periodically checking whether the server contracts used by [AI Chat Export](https://github.com/alexey-sirotin/ai-chat-export) still look compatible.

The goal is to run probes inside a normal signed-in browser session, using the same provider-facing paths that the exporter relies on, without storing account credentials in CI.

## Current scope

The first implementation monitors ChatGPT only.

It checks the same authenticated path used by AI Chat Export:

1. load a configured ChatGPT canary conversation in the normal browser session;
2. obtain the current access token through `/api/auth/session` in the ChatGPT page context;
3. request `/backend-api/conversation/<conversation-id>`;
4. verify stable structural invariants required by the exporter.

The extension does not compare the complete JSON response byte-for-byte. New harmless fields should not trigger an alert.

## Status model

- `OK` — the acquisition path works and the expected conversation structure is present;
- `SUSPECT` — the first contract mismatch; a confirmation probe is scheduled in five minutes;
- `CONTRACT_MISMATCH` — two consecutive structural failures;
- `AUTH_REQUIRED` — the browser session is not currently authenticated for the probe;
- `NETWORK_ERROR` / `HTTP_ERROR` — the provider could not be checked reliably;
- `NOT_CONFIGURED` — no canary conversation has been configured yet.

The toolbar badge is green for `OK`, red for a confirmed contract mismatch, yellow for inconclusive/problem states, and gray before configuration.

## Canary conversation

Use a small dedicated ChatGPT conversation that you control and intend to keep.

For the current validator it only needs at least one normal user message and one assistant message. Keep the conversation small so scheduled probes remain cheap.

Paste its normal conversation URL, for example:

```text
https://chatgpt.com/c/<conversation-uuid>
```

into the extension popup and click **Run now**.

If that conversation is not already open, the extension opens it in an inactive temporary tab, runs the probe in the ChatGPT page context, and closes the tab afterward.

## Schedule

A normal probe runs every 12 hours. A first structural mismatch schedules one confirmation probe five minutes later before the toolbar turns red.

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
6. open the extension popup, configure the canary URL, and run the first check manually.

The project currently targets Chromium Manifest V3. Firefox packaging can be added once the probe behavior is proven.

## Privacy

All configuration, status, and diagnostics are stored locally through browser extension storage. The extension has no telemetry and no developer-operated service.

The canary request is made only to ChatGPT using the browser's existing signed-in session.

## Planned next steps

- exercise the ChatGPT probe against a real canary and harden failure classification;
- retain a small local history of probe results;
- add a diagnostics page with useful response-shape information;
- add Claude, Grok, and DeepSeek probes incrementally;
- add Firefox packaging after the monitoring design stabilizes.

## License

MIT

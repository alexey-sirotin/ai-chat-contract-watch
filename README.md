# AI Chat Contract Watch

A small private browser extension for periodically checking whether the server contracts used by [AI Chat Export](https://github.com/alexey-sirotin/ai-chat-export) still look compatible.

The goal is to run probes inside a normal signed-in browser session, using the same provider-facing paths that the exporter relies on, without storing account credentials in CI.

## Planned behavior

- periodic background checks plus a manual **Run now** action
- toolbar badge for overall health
- per-provider states: `OK`, `AUTH_REQUIRED`, `NETWORK_ERROR`, `CONTRACT_MISMATCH`, `NOT_CONFIGURED`
- local-only history and diagnostic snapshots
- no telemetry and no remote service controlled by this project
- provider canaries added incrementally, starting with ChatGPT

## Design principle

A canary should test the real acquisition path and stable invariants, not compare complete provider JSON responses byte-for-byte. Provider responses may gain harmless fields; a failure should mean that the data needed by AI Chat Export can no longer be acquired or recognized.

## Development status

Initial implementation in progress. ChatGPT is the first provider target.

## License

MIT

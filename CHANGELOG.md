# Changelog

## 0.3.1 — Unreleased

- Add a bilingual Plugin Manager switch for Discussion. It defaults off, applies live, rejects calls while disabled, and cancels active Discussion work when turned off.
- Remove the duplicate `/memory-*` slash commands and the DSH `commands` service dependency. Historical operations remain discoverable Agent tools, and Plugin Manager remains the configuration surface.
- Document the Host boundary explicitly: Pi can select participants inside `recall_memory`, while DSH rc.5 has no mid-tool selection API and therefore uses `recall_memory` followed by `discuss_memory`.
- Add `discuss_memory` for sequential consultation with one to three user-confirmed historical DSH participants.
- Use the initiating main Agent's provider and model for every participant.
- Isolate each participant with a complete consultant prompt, no tools, and no optional runtime context.
- Keep selected source sessions unchanged. DSH stores each consultation in a separate excluded subagent session.
- Keep `fetch_session` independently available for exact source verification. Discussion never calls it automatically or uses it as fallback.
- Add strict Discussion input and output schemas, explicit evidence truncation, bilingual Plugin Manager labels and documentation, unit coverage, and native Host registration checks.
- Retain the unreleased 0.2.4 changes: redacted invocation-time configuration snapshots and version-free help/status output.

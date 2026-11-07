# Build workflow

Before implementing, read `docs/PLAN.md` for approved behavior, `GLOSSARY.md` for vocabulary, and `docs/BUILD.md` for task ownership, sequencing, and acceptance gates.

For branding, audio import, or decoder packaging changes, also read `docs/AUDIO-IMPORT.md` for the active follow-up scope and compatibility requirements.

For transport shortcuts, handle-row layout, or range double-click selection, read `docs/UX-PASS.md` before editing.

The user requires Frontier to orchestrate and multiple GPT-6.1 Terra subagents to implement. The orchestrator plans, dispatches, reviews, runs checks, and tracks progress; it must delegate all application code, tests, configuration, and integration fixes rather than writing them itself.

Use `general` subagents with model `openrouter/openai/gpt-6.1-terra`. This exact model was discovered in the model catalog. If unavailable, ask the user before substituting another model. Use background agents for independent tasks and wait for completion notifications rather than polling.

Give each agent explicit writable paths. Shared files have one owner at a time. Route changes outside ownership through the orchestrator. Every handoff reports files changed, checks run and their results, unresolved issues, and integration instructions.

# RallyPoint — Agent Working Rules

RallyPoint helps people create, share, and join gatherings. Read the relevant parts of [PRD.md](PRD.md) before changing behavior.

## Authority

- `PRD.md` owns requirements, decision status, and technical direction. Proposals remain proposals until accepted by the owner.
- This file owns execution rules; [README.md](README.md) owns orientation and setup.
- The Linear project linked in the README owns approved tasks, work status, and dependencies. Issue execution reports own validation evidence: artifact/version, environment, date, checks, results, and gaps. The authorized request's execution report owns standalone setup evidence.

## Boundaries

Preserve unrelated work and inspect workspace/branch state before edits. Make the smallest sufficient change. Follow accepted PRD scope; keep the event model activity-agnostic. Never trade participation integrity or private-event permissions for UI convenience. Keep secrets out of chat, documents, logs, and commits; use supported secret-entry flows.

Make routine reversible choices within authorization. The owner controls consequential scope, architecture, spending, and acceptance decisions. Respect existing authorization and prepare concrete work before final approval. Task approval does not authorize implementation; setup does not authorize unrelated tasks or production deployment.

## Planning and execution

For new planning: discuss one outcome → record accepted decisions → draft tasks with scope, acceptance, dependencies, and verification → obtain authorization before creating reviewed tasks. Reuse settled decisions; task creation does not authorize implementation.

Use the confirmed repository and Linear team/project linked in the README. Verify access when needed, reconcile existing issues before retrying creation, and record actual blocking relationships. Do not create duplicate GitHub issues or local task-status mirrors. Creating a task never marks its outcome implemented or complete.

For execution: read targeted context → inspect actual blockers/state → implement authorized scope → validate affected behavior → self-review → report evidence and material gaps. Use grounded setup commands from the README; none exist for the application yet.

Check observable behavior and important invariants, especially concurrency, retries, authorization, and reconnection. Exercise changed interfaces in the actual runtime, including relevant accessibility and failure states. Add focused tests where risk warrants them. For documents, check consistency, references, and placeholders. Report passed, failed, blocked, and untested checks honestly; document review is not runtime verification. Missing required evidence prevents a completion claim; review readiness, acceptance, integration, and release are distinct.

<!-- postman-cli:installation:start -->
Postman CLI is installed on this device, and can be used for API Engineering work.
<!-- postman-cli:installation:end -->

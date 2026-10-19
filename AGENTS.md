<!-- agent-kit:start -->
## Development workflow (gyukit)

All planning lives in Markdown under `docs/`; each document has `status` in its frontmatter.
Settings and project commands: `docs/workflow.md`.

**Full flow** — new product or significant feature:
1. **analyst** → `docs/PRD.md` (requirements `FR-x`, `NFR-x`) — gate: user sets `status: approved`
2. **architect** → `docs/architecture.md` + `docs/adr/` — gate: user approves
3. **planner** → `docs/epics/E01-*.md`, `docs/stories/E01-S01-*.md` (self-contained, test-first tasks)
4. **coder** → one story at a time, tests first → `status: review`
5. **reviewer** → `done` or `changes-requested`

**Quick path** — small bugfix/tweak: use the `quick-change` skill (planner → coder → reviewer, no PRD).
**Autonomous** — "work until X": use the `autopilot` skill; it stops on goal or after repeated iterations without progress, and writes a report in `docs/reports/`.

Rules for every role:
- Respect the gates; never approve a document on the user's behalf.
- Never weaken or skip tests to make them pass.
- Reference requirement IDs (`FR-x`) in stories and commit messages.
- If subagents are available, delegate each step to the agent with that name; otherwise follow the role description in the skill/agent of the same name.

## Project memory
Durable knowledge lives in versioned Markdown, not in chat history:
- `docs/decisions/` — one file per architectural decision (context, decision, consequences).
- `docs/conventions.md` — coding conventions and gotchas discovered while working.
Read the relevant files before starting a task; update them when you learn something future sessions need.

## Context hygiene
- Read only the files and line ranges you need; prefer search over reading whole directories.
- Do not paste large command outputs back; summarize them.
- Load skills on demand instead of front-loading instructions.
<!-- agent-kit:end -->

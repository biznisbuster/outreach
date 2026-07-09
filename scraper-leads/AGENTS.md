# AGENTS.md — instructions for any AI/coding agent working on this project

## Project identity

A Python + Playwright scraper. Query = `(category, city)`. Output = deduped list of local businesses (Google Maps primarily, planplus.rs secondarily) for one-off cold outreach. Personal use; stealth-aware.

Author target: Arch Linux + `uv` for dependency management. `podman` available but not required.

## ⚠️ FIRST: resume protocol (do this before anything else)

If you are a fresh session, **read these files in order** before doing any work:

1. `.agent_output/state/current.json` — exact phase/task pointer, last checkpoint description
2. `.agent_output/plans/current.md` — full plan with sub-tasks. Update its `<!-- HANDOFF -->` block on session exit.
3. `.agent_output/state/history/CHANGELOG.md` — append-only log of every change. **Read the last 10–20 entries to understand recent context.**
4. Top-level `README.md` (when it exists) and any files in `src/maps_cold_calling/`.

Resume exactly from where `current.json` says. Do not start over, do not re-plan, do not redo completed sub-tasks.

## Required logging behavior (every session)

After EVERY meaningful change (not every keystroke — meaningful = a sub-task completing, a new file, a non-trivial edit), append an entry to `.agent_output/state/history/CHANGELOG.md`:

```
## YYYY-MM-DD — short summary

- What changed
- Files touched
- Why (one line)
```

When you advance the phase/task pointer, also update:

- `.agent_output/state/current.json` (`phase`, `task`, `status`, `last_update`, `checkpoint`, `last_completed`, `next_task`)
- `.agent_output/plans/current.md` — flip the task's `[ ]` → `[x]` and update the `<!-- HANDOFF -->` block at the bottom

If you mark a task complete, **log it before** moving to the next one. Do not skip this step — context loss without CHANGELOG is unrecoverable.

## Project conventions

- **Layout**: `src/maps_cold_calling/` (PEP 517/518), `src/` first
- **Async throughout**: all scraping/IO is `async`; cancellation must close browser cleanly
- **Type hints**: yes, everywhere (Python ≥ 3.11 syntax)
- **Logging**: stdlib `logging`; configurable via `--verbose/--quiet`; per-phase messages
- **No captcha solving** — detection only, log + skip
- **No deletions** of any files (blocked at harness level too). Edit in place. Archive plans to `.agent_output/plans/archive/` if you must.
- **No destructive git**: no `git reset --hard`, no `git push --force`. Commits are welcome; merging isn't assumed.
- **Don't touch** `.env`, `*.pem`, `*.key`, or any system files
- **Stay in project root**: no `cd ..`, no `~/`, no `/etc/`

## Stealth tiers (CLI flags)

- `--stealth off` — no evasions (debugging only)
- `--stealth lite` (default) — `playwright-stealth` plugin + locale/tz match + UA rotation + randomized delays
- `--stealth standard` — lite + char-by-char typing + scroll-jitter
- `--stealth aggressive` — standard + per-request proxy rotation + viewport randomization

## Anti-patterns to avoid

- Edit-and-pray: don't make several changes without running a smoke. After every logical change, re-run the smoke (`scripts/smoke_browser.py` or `python -m maps_cold_calling --dry-run ...`).
- Drifting from the plan: if you need to make a change not in the current sub-task, note it in `current.json` `open_questions` and continue.
- Hard-coded paths: anything that needs an output location must respect `--output`.
- Forgetting concurrency hazards: Playwright is single-tab at a time per `page`; use a new context per task if running with proxies.

## When finishing a session

1. Mark the current sub-task `[x]` in `current.md`
2. Append a session-end entry to `CHANGELOG.md` ("Session ended — left off after X")
3. Update `current.json` `next_task` to the next sub-task
4. Update the `<!-- HANDOFF -->` block in `current.md`
5. Ensure no orphan processes (kill any Playwright Chromium that's still alive)

## Quick reference

```
# Resume context
cat .agent_output/state/current.json
tail -30 .agent_output/state/history/CHANGELOG.md

# Run scraper
uv run python -m maps_cold_calling \
  --category "frizerski salon" --city "Kruševac" --country RS

# Smoke browser
uv run python scripts/smoke_browser.py
```

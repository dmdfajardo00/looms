# CLAUDE.md

> **This is a thin wrapper. Read [AGENTS.md](./AGENTS.md) first** for Looms-fork orientation, load-bearing patches, file map, deploy workflow, and mempalace pointers.

This is the **Looms** repo — a private fork of [CapSoftware/Cap](https://github.com/CapSoftware/Cap) deployed at https://looms.dmdfajardo.pro. AGENTS.md is the canonical agent doc. CLAUDE.md exists so Claude Code finds something at the conventional path and routes you there.

## Why two files

- `AGENTS.md` — Looms-fork-specific. Tells an AI agent what this repo IS, what's been customized, where the load-bearing patches live, and how to deploy. **Read this first, every time.**
- `CLAUDE.md` (this file) — pointer + the most load-bearing code-style rules inlined so you don't accidentally violate them while reading AGENTS.md.

The dense upstream Cap convention reference lives at https://github.com/CapSoftware/Cap/blob/main/CLAUDE.md — those rules still apply unchanged in this fork.

## Bare-minimum rules (won't pass CI if you violate any of these)

- **Tabs, not spaces.** Double quotes in JS/TS. Biome-enforced.
- **No comments by default.** Only add one when capturing non-obvious context (a bug fix's why, a non-obvious invariant, a workaround for an upstream issue). Never narrate code, restate types, or write TODOs.
- **Never edit generated files**: `**/tauri.ts`, `**/queries.ts`, `apps/desktop/src-tauri/gen/**`, `packages/ui-solid/src/auto-imports.d.ts`, Drizzle migrations under `packages/database/migrations/`.
- **Never start dev servers** (`pnpm dev`, `pnpm dev:web`, `pnpm dev:desktop`, Docker). Assume they're running.
- **Never commit without explicit user permission.** And **never** add `Co-Authored-By`, `Signed-off-by`, or Claude/Anthropic attribution to commit messages.
- **Post-edit gates** before declaring a task done: `pnpm format && pnpm lint` (TS/JS/JSON/CSS/MD); add `pnpm typecheck` for type changes; `cargo fmt --all && cargo clippy -p <crate> --all-targets -- -D warnings` for Rust.

For everything else — architecture, file map, deploy procedure, mempalace links, don't-touch zones, AGPL credit, where bugs live — **go to AGENTS.md**.

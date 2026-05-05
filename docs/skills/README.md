# Skills for the keyurgolani.name portfolio platform

This directory ships [agentskills.io](https://agentskills.io)-format skills bundled with the portfolio platform. Each skill is a self-contained directory with a `SKILL.md` plus optional references, scripts, and assets, designed to be discovered by an agent harness (Claude Code, VS Code Copilot, Cursor, Codex, Goose, etc.) and used as authoritative guidance for a specific job.

## What's here

- [`portfolio-author/`](./portfolio-author/SKILL.md) — Build the `portfolio.yml` file from any source the user has — resume, LinkedIn, GitHub, or a conversation — with the right sections, ordering, tone, and quality bar.
- [`variant-developer/`](./variant-developer/SKILL.md) — Build a new visual variant package, design-contract first, with section coverage, kit utility usage, and an optional browser-based visual companion.

## Discovery wiring

Each agent harness expects skills in a different place. Pick the row that matches your harness and run the wiring command from the repo root.

| Agent | Expected path | Wiring command |
| --- | --- | --- |
| Claude Code (project) | `.claude/skills/<name>` | `ln -s "$(pwd)/docs/skills/<name>" .claude/skills/<name>` |
| Claude Code (user-global) | `~/.claude/skills/<name>` | `ln -s "$(pwd)/docs/skills/<name>" ~/.claude/skills/<name>` |
| VS Code Copilot | `.agents/skills/<name>` | `ln -s "$(pwd)/docs/skills/<name>" .agents/skills/<name>` |
| Cursor | (no discovery dir) | Paste the `SKILL.md` path into the system prompt or project instructions. |
| Codex | (no discovery dir) | Paste the `SKILL.md` path into the system prompt or project instructions. |
| Goose | (no discovery dir) | Paste the `SKILL.md` path into the system prompt or project instructions. |
| Anything else | — | Open `docs/skills/<name>/SKILL.md` and paste its contents into the agent's system instructions. |

Replace `<name>` with `portfolio-author` or `variant-developer`.

## Quick install

Run the bundled installer to symlink both skills into whichever discovery directories already exist on your machine. It is idempotent and skips any directory that doesn't exist or any link that's already in place.

```bash
bash docs/skills/install.sh
```

The script links both `portfolio-author` and `variant-developer` into:

- `<repo>/.claude/skills/` (if it exists)
- `<repo>/.agents/skills/` (if it exists)
- `~/.claude/skills/` (if it exists)

Nothing else is touched. Remove a stale symlink manually if you want the installer to recreate it.

## Validate before commit

If you edit anything under `docs/skills/`, run:

```bash
pnpm check:skills
```

This verifies SKILL.md frontmatter (name pattern, description length, parent-dir match), checks that `section-kinds.md` hasn't drifted between the two skills, that `kit-catalog.md` covers every export from `@portfolio/kit`, and that `schema.md` mentions every kind in `ALL_SECTION_KINDS`.

There's no active CI in this repo yet. When CI returns, hook `pnpm check:skills` into the same job as `pnpm typecheck`.

## Spec

Design rationale, scope, and the long-form contract for both skills live in the spec:

- [`../superpowers/specs/2026-05-03-portfolio-and-variant-skills-design.md`](../superpowers/specs/2026-05-03-portfolio-and-variant-skills-design.md)

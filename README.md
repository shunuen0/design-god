# Design God

A sharp, opinionated UI design partner — packaged as agent skills for Claude Code and Cursor.

Critiques screenshots, audits design systems, reviews PRs for design regressions, checks cross-component consistency, engineers animations and micro-interactions, and rewrites copy. All grounded in your actual codebase.

## Install

### Claude Code

```bash
git clone https://github.com/shunuen0/design-god.git ~/.claude/skills/design-god
```

### Cursor

```bash
git clone https://github.com/shunuen0/design-god.git ~/.cursor/skills/design-god
```

Then invoke with `/design-god` in chat.

## Skills

| Skill | What it does |
|---|---|
| **critique** | Visual critique of a screenshot or component — hierarchy, spacing, contrast, conversion |
| **audit** | Systematic design audit of a full page, flow, or design system |
| **tokens** | Extract and validate design tokens from a codebase, flag inconsistencies |
| **review** | PR review focused on design regressions |
| **consistency** | Cross-component consistency check and change impact analysis |
| **design_engineering** | Animation, transitions, micro-interactions, and UI polish |
| **rewrite** | Copy and microcopy alternatives |

The root orchestrator routes your request to the right skill automatically. You can also ask direct design questions without triggering a specific skill.

## How it works

1. You invoke `/design-god` and describe what you need
2. The orchestrator picks the right sub-skill
3. The skill reads your codebase — stylesheets, components, design tokens — and grounds its feedback in your actual code
4. Output is numbered so you can say "implement 1, 4, and 7" to execute changes fast

## Examples

```
/design-god critique this login page
/design-god audit the design system in this project
/design-god review this PR for design issues
/design-god check if all the cards are consistent
/design-god I'm changing Button height from 36px to 40px, what will break?
/design-god review the animations in this component
/design-god rewrite the empty state copy
```

## Update

```bash
cd ~/.claude/skills/design-god && git pull
# or
cd ~/.cursor/skills/design-god && git pull
```

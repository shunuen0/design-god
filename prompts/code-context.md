# Design God — Code Context Rules

When you have access to the user's codebase (which you always do as a Claude Code skill):

- Inspect referenced code before making implementation claims.
- Treat declared code values as the source of truth for spacing, typography, tokens, colors, and component structure.
- Do not recommend changing a value to something the referenced code already uses.
- If the provided files are insufficient to confirm a detail, say that directly instead of guessing.
- Prefer citing the relevant file path when grounding a critique.
- Do not critique code structure, variable naming, or implementation patterns — only use the code to ground design observations.

## Finding Design Context

Before responding, look for these files to understand the project's design system:

1. **Global stylesheets**: `global.css`, `src/styles.css`, `src/global.css`, `app/globals.css`, `styles/globals.css`
2. **Tailwind config**: `tailwind.config.js`, `tailwind.config.ts`
3. **Design tokens**: files containing CSS custom properties (`--*`), theme definitions, or token exports
4. **Component library**: `src/components/ui/`, `components/`, or similar directories

Use what you find to ground your critique in the project's actual design values.

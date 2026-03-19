# Design Copilot V1

A minimal multimodal chat app for UI critique and copy rewrites, powered by the Claude Code SDK.

## What it does

- Chat-based critique and rewrite flow
- Multi-turn conversation within the current session
- Text-only, image-only, or text-plus-image prompts
- Screenshot upload and clipboard paste support
- Structured assistant responses with top fixes, issues, and grouped rewrites

## Local setup

1. Copy `.env.example` to `.env`
2. Add your `ANTHROPIC_API_KEY`
3. Install dependencies with `npm install`
4. Start both apps with `npm run dev`

Client: `http://localhost:5173`

Server: `http://localhost:8787`

## Notes

- The backend uses the latest user image as the visual input for the Claude call.
- Session state is kept in the browser only, which matches the V1 scope.
- Judgment tracing is available on the server when `JUDGMENT_API_KEY` and `JUDGMENT_ORG_ID` are set and the `design-god` project exists in Judgment.
- Traces are grouped under a long-lived `run_session` span per chat session, with each `designGodRun` turn nested beneath it. Sessions close on "new chat" or after `DESIGN_GOD_SESSION_TIMEOUT_MS` of inactivity.

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
- There is no logging, tracing, persistence, or external design-tool integration in this version.

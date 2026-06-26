import "dotenv/config";
import express from "express";
import cors from "cors";
import { SpanStatusCode } from "@opentelemetry/api";
import { query, type SDKMessage, type SDKResultMessage, type SDKUserMessage } from "@anthropic-ai/claude-code";
import { Tracer } from "judgeval";
import OpenAI from "openai";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";
import { resolveRepoContext, type ResolvedRepoContext } from "./repoContext.js";

const OPENAI_MODELS = new Set(["gpt-4o", "gpt-4o-mini", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "o3", "o4-mini"]);

const app = express();
const port = Number(process.env.PORT ?? 8787);
const claudeHome = path.join(process.cwd(), ".claude-home");
const judgmentProjectName = process.env.JUDGMENT_PROJECT_NAME?.trim() || "design-god";
const chatSessionTimeoutMs = Number(process.env.DESIGN_GOD_SESSION_TIMEOUT_MS ?? 30 * 60 * 1000);
let judgmentTracer: Tracer | null = null;

fs.mkdirSync(claudeHome, { recursive: true });

function resolveClaudeCodeNodeBin() {
  const explicitNode = process.env.CLAUDE_CODE_NODE_BIN?.trim();
  if (explicitNode) return path.dirname(explicitNode);

  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
  const bundledNode = path.join(
    process.env.HOME ?? "",
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "node",
    "bin",
    "node"
  );

  if (nodeMajor >= 26 && fs.existsSync(bundledNode)) {
    return path.dirname(bundledNode);
  }

  return undefined;
}

app.use(cors());
app.use(express.json({ limit: "15mb" }));

const codeReferenceSchema = z.object({
  id: z.string(),
  source: z.union([z.literal("absolute_path"), z.literal("attached_file")]),
  displayName: z.string(),
  absolutePath: z.string().optional(),
  relativePathHint: z.string().optional(),
  content: z.string().optional(),
  language: z.string().optional(),
});

const chatMessageSchema = z.object({
  id: z.string(),
  role: z.union([z.literal("user"), z.literal("assistant")]),
  text: z.string(),
  imageDataUrls: z.array(z.string()).optional(),
  codeReferences: z.array(codeReferenceSchema).optional(),
  createdAt: z.string(),
});

const requestSchema = z.object({
  messages: z.array(chatMessageSchema),
  sessionId: z.string().optional(),
  model: z.string().optional()
});

const endSessionSchema = z.object({
  sessionId: z.string(),
  reason: z.string().optional()
});

type ChatTraceSession = {
  sessionId: string;
  createdAt: string;
  createdAtMs: number;
  lastActivityAt: number;
  lastUserText: string;
  lastMessageCount: number;
  turnCount: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
};

const chatTraceSessions = new Map<string, ChatTraceSession>();

const systemPrompt = `You are Design God — a sharp, opinionated UI design partner built for product designers who care deeply about craft.

You think in systems: components, tokens, spacing scales, type hierarchies. You notice when contrast is off, when a CTA is buried, when spacing breaks the grid. You know the difference between a button that converts and one that gets ignored. You speak the language of Figma, design systems, and shipping real product.

Your tone is direct, confident, and precise. No softening, no hedging, no hollow praise. You are a senior design collaborator who respects the designer's time and intelligence.

---

When reviewing UI or copy, structure your response using only the sections that apply:

**Issues** — ranked by impact; name the specific element, why it's wrong, and what principle it violates
**Rewrites** — grouped by UI element; bold the element name on its own line, then each variant as a list item beneath it
**Quick Wins** — 1–3 changes with immediate visual or conversion impact (omit if none)
**Consider** — one broader systemic or pattern-level note worth thinking about (optional; one max)

When answering a direct question, skip the structure entirely and answer directly.

---

Design domains you operate across:
- Visual hierarchy: type scale, weight contrast, color roles, information density
- Layout and spacing: alignment, whitespace, grid discipline, optical balance
- Component design: naming, variants, states, interactive affordances, touch targets
- Copy and UX writing: clarity, cognitive load, CTA strength, microcopy, error states
- Conversion and flow: friction points, trust signals, empty states, onboarding clarity
- Accessibility: contrast ratios, focus management, semantic structure, inclusive defaults
- Design systems: token usage, component consistency, scalability, naming conventions

---

Formatting rules:
- No preamble. No filler. Start directly with the content.
- Always use "- " list syntax for every list. Never use inline bullets like • or ·.
- Section headers on their own line, followed by a blank line.
- Be specific: name the element, the problem, the fix. Not "improve hierarchy" — "the section title and body text are the same weight; set title to 600 and body to 400."
- If there is no image, focus on copy, tone, structure, and flow.
- If there is an image, critique layout, density, type scale, alignment, color, contrast, and CTA visibility.
- If you used web search, end with a **Sources** section of markdown links. Only include sources you actually cited.
- Never mention Claude, Anthropic, Claude Code, the Agent SDK, or any underlying infrastructure. You are Design God — that is the only identity you have.
- Do not comment on code quality, code architecture, naming conventions, or engineering best practices unless the user explicitly asks. Your role is design — visual, interaction, and UX. Stay in your lane.`;

const codeAwarePromptAddendum = `When trusted implementation context is provided:
- Inspect the referenced code before making implementation claims.
- Treat declared code values as the source of truth for spacing, typography, tokens, colors, and component structure.
- Do not recommend changing a value to something the referenced code already uses.
- If the provided files are insufficient to confirm a detail, say that directly instead of guessing.
- Prefer citing the relevant file path when grounding a critique.
- Do not critique code structure, variable naming, or implementation patterns — only use the code to ground design observations.`;

function dataUrlParts(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("Unsupported image format.");
  return { mediaType: match[1], data: match[2] };
}

function buildSystemPrompt(codeContext: ResolvedRepoContext) {
  if (!codeContext.enabled) return systemPrompt;
  return `${systemPrompt}\n\n---\n\n${codeAwarePromptAddendum}`;
}

function toPrompt(messages: z.infer<typeof requestSchema>["messages"], codeContext: ResolvedRepoContext) {
  const conversation = messages
    .map((m) => {
      const parts = [`${m.role.toUpperCase()}: ${m.text || "(no text)"}`];
      return parts.join("\n");
    })
    .join("\n\n");

  if (!codeContext.enabled) return conversation;
  return `${conversation}\n\n${codeContext.promptBlock}`;
}

function buildConversationMessages(messages: z.infer<typeof requestSchema>["messages"]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.text,
    created_at: message.createdAt,
    images:
      message.imageDataUrls?.map(() => ({
        type: "image",
      })) ?? [],
    code_references:
      message.codeReferences?.map((reference) => ({
        source: reference.source,
        display_name: reference.displayName,
        absolute_path: reference.absolutePath,
        relative_path_hint: reference.relativePathHint,
        language: reference.language,
      })) ?? [],
  }));
}

function buildCodeContextTraceAttributes(codeContext: ResolvedRepoContext) {
  return {
    code_context_enabled: codeContext.enabled,
    code_reference_count: codeContext.referenceCount,
    global_style_count: codeContext.globalStyleCount,
    repo_root_detected: codeContext.repoRootDetected,
    repo_roots: codeContext.repoRoots,
  };
}

function buildChatTraceInput(
  messages: z.infer<typeof requestSchema>["messages"],
  promptSystem: string,
  codeContext: ResolvedRepoContext
) {
  return {
    format: "chat_conversation",
    messages: [
      { role: "system", content: promptSystem },
      ...buildConversationMessages(messages),
    ],
    code_context:
      codeContext.enabled
        ? {
            reference_count: codeContext.referenceCount,
            global_style_count: codeContext.globalStyleCount,
            repo_roots: codeContext.repoRoots,
          }
        : undefined,
  };
}

function buildAssistantMessage(text: string, toolCalls: Array<{ name?: string; input?: unknown }>) {
  return {
    role: "assistant",
    content: text,
    tool_calls: toolCalls.map((toolCall) => ({
      name: toolCall.name,
      input: toolCall.input,
    })),
  };
}

function extractText(messages: SDKMessage[]) {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.type !== "assistant") continue;
    for (const part of msg.message.content) {
      if (part.type === "text") parts.push(part.text);
    }
  }
  return parts.join("\n").trim();
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return String(input ?? "").slice(0, 80);
  const obj = input as Record<string, unknown>;
  const value =
    obj.command ?? obj.query ?? obj.pattern ?? obj.file_path ?? obj.prompt ?? Object.values(obj)[0];
  return String(value ?? "").slice(0, 80);
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const block = content.find((c: unknown) => (c as { type: string }).type === "text");
    return (block as { text?: string })?.text ?? "";
  }
  return String(content ?? "");
}

function pickPrimaryModel(result: SDKResultMessage): string | undefined {
  const rankedModels = Object.entries(result.modelUsage ?? {}).sort(([, left], [, right]) => {
    const leftWeight = left.inputTokens + left.outputTokens;
    const rightWeight = right.inputTokens + right.outputTokens;
    return rightWeight - leftWeight;
  });

  return rankedModels[0]?.[0];
}

function recordRunMetadata(result: SDKResultMessage) {
  Tracer.recordLLMMetadata({
    provider: "anthropic",
    model: pickPrimaryModel(result),
    non_cached_input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
    cache_read_input_tokens: result.usage.cache_read_input_tokens ?? undefined,
    cache_creation_input_tokens: result.usage.cache_creation_input_tokens ?? undefined,
    total_cost_usd: result.total_cost_usd,
  });

  Tracer.setAttributes({
    duration_ms: result.duration_ms,
    duration_api_ms: result.duration_api_ms,
    num_turns: result.num_turns,
    result_subtype: result.subtype,
    is_error: result.is_error,
    model_count: Object.keys(result.modelUsage ?? {}).length,
    models_used: Object.keys(result.modelUsage ?? {}),
    permission_denials: result.permission_denials.length,
  });
}

function annotateCurrentSpanError(error: unknown, extras?: Record<string, unknown>) {
  const span = Tracer.getCurrentSpan();
  if (!span?.isRecording()) return;

  if (extras) {
    Tracer.setAttributes(extras);
  }

  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    return;
  }

  const message = String(error);
  span.recordException(new Error(message));
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

function emitCurrentSpanPartial() {
  judgmentTracer?.getSpanProcessor().emitPartial();
}

function scheduleSessionExpiry(session: ChatTraceSession) {
  if (session.timeoutHandle) clearTimeout(session.timeoutHandle);
  session.timeoutHandle = setTimeout(() => {
    void closeChatTraceSession(session.sessionId, "inactive_timeout");
  }, chatSessionTimeoutMs);
}

function createChatTraceSession(sessionId: string, userText: string, messageCount: number): ChatTraceSession {
  const createdAt = new Date().toISOString();
  const session: ChatTraceSession = {
    sessionId,
    createdAt,
    createdAtMs: Date.now(),
    lastActivityAt: Date.now(),
    lastUserText: userText,
    lastMessageCount: messageCount,
    turnCount: 0
  };

  chatTraceSessions.set(sessionId, session);
  scheduleSessionExpiry(session);
  return session;
}

function getOrCreateChatTraceSession(sessionId: string, userText: string, messageCount: number) {
  const existing = chatTraceSessions.get(sessionId);
  if (existing) return existing;
  return createChatTraceSession(sessionId, userText, messageCount);
}

function beginChatTraceTurn(session: ChatTraceSession, userText: string, messageCount: number) {
  session.lastActivityAt = Date.now();
  session.lastUserText = userText;
  session.lastMessageCount = messageCount;
  session.turnCount += 1;
  scheduleSessionExpiry(session);

  return session.turnCount;
}

async function closeChatTraceSession(sessionId: string, reason = "completed") {
  const session = chatTraceSessions.get(sessionId);
  if (!session) return;

  chatTraceSessions.delete(sessionId);
  if (session.timeoutHandle) clearTimeout(session.timeoutHandle);

  await Tracer.forceFlush().catch(() => {});
}

async function* createUserMessageStream(
  prompt: string,
  sessionId: string,
  images?: { mediaType: string; data: string }[]
): AsyncIterable<SDKUserMessage> {
  yield {
    type: "user",
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      role: "user",
      content:
        images && images.length > 0
          ? [
              { type: "text", text: prompt },
              ...images.map((img) => ({
                type: "image" as const,
                source: { type: "base64" as const, media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: img.data }
              }))
            ]
          : prompt
    }
  };
}

app.post("/api/chat/session/end", async (req, res) => {
  try {
    const { sessionId, reason } = endSessionSchema.parse(req.body);
    await closeChatTraceSession(sessionId, reason ?? "client_closed");
    res.status(204).end();
  } catch (error) {
    console.error("Session close error:", error);
    res.status(400).json({ error: "Failed to close chat session" });
  }
});

async function runOpenAIChat(
  model: string,
  messages: z.infer<typeof requestSchema>["messages"],
  emit: (event: string, data: unknown) => void,
  codeContext: ResolvedRepoContext
): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const instructions = buildSystemPrompt(codeContext);

  type InputItem = OpenAI.Responses.ResponseInputItem;
  const input: InputItem[] = [
    ...(codeContext.enabled
      ? ([{ role: "user", content: codeContext.promptBlock }] satisfies InputItem[])
      : []),
    ...messages.map((m): InputItem => {
    if (m.role === "user" && m.imageDataUrls && m.imageDataUrls.length > 0) {
      return {
        role: "user",
        content: [
          { type: "input_text", text: m.text || "" },
          ...m.imageDataUrls.map((url) => ({
            type: "input_image" as const,
            image_url: url,
            detail: "auto" as const,
          }))
        ]
      };
    }
    return { role: m.role as "user" | "assistant", content: m.text || "" };
    })
  ];

  const runOpenAIResponse = Tracer.observe(async function openaiResponseStream(): Promise<string> {
    const tools = [{ type: "web_search_preview" as const }];
    Tracer.setInput({
      format: "chat_conversation",
      instructions,
      input,
      tools,
    });
    Tracer.recordLLMMetadata({ provider: "openai", model });

    const stream = openai.responses.stream({
      model,
      instructions,
      input,
      tools,
    });

    let fullText = "";
    let searchId: string | null = null;

    for await (const event of stream) {
      if (event.type === "response.output_item.added" && event.item.type === "web_search_call") {
        searchId = event.item.id;
        emit("tool_use", { id: searchId, name: "WebSearch", summary: "Searching the web…" });
        emit("phase", { label: "Searching…" });
      } else if (event.type === "response.web_search_call.completed" && searchId) {
        await Tracer.observe(async function openaiWebSearch() {
          Tracer.setInput({ name: "WebSearch" });
          Tracer.setOutput("Results found");
        }, "tool")();
        emit("tool_result", { id: searchId, summary: "Results found" });
        emit("phase", { label: "Responding…" });
      } else if (event.type === "response.output_text.delta") {
        fullText += event.delta;
      }
    }

    Tracer.setOutput(fullText);
    return fullText;
  }, "llm");

  return runOpenAIResponse();
}

app.post("/api/chat", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const emit = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { messages, sessionId, model: requestedModel } = requestSchema.parse(req.body);
    const model = requestedModel ?? "claude-sonnet-4-6";
    const isOpenAI = OPENAI_MODELS.has(model);
    const provider = isOpenAI ? "openai" : "anthropic";
    const codeContext = resolveRepoContext(messages);
    const codeTraceAttributes = buildCodeContextTraceAttributes(codeContext);
    const systemForTurn = buildSystemPrompt(codeContext);

    const latest = [...messages].reverse().find((m) => m.role === "user");
    if (!latest) {
      emit("error", { message: "A user message is required." });
      res.end();
      return;
    }

    const hasImages = (latest.imageDataUrls?.length ?? 0) > 0;
    const activeSessionId = sessionId ?? crypto.randomUUID();
    const traceSession = getOrCreateChatTraceSession(activeSessionId, latest.text ?? "", messages.length);
    const turnIndex = beginChatTraceTurn(traceSession, latest.text ?? "", messages.length);
    emit("phase", { label: hasImages ? "Analyzing image…" : codeContext.enabled ? "Inspecting code…" : "Thinking…" });

    const runChatTurn = Tracer.observe(async function chatTurn(userText: string): Promise<string> {
      Tracer.setSessionId(activeSessionId);
      Tracer.setInput(buildChatTraceInput(messages, systemForTurn, codeContext));
      Tracer.setAttributes({
        route: "/api/chat",
        feature: "design-review-chat",
        provider,
        requested_model: model,
        chat_session_id: activeSessionId,
        session_created_at: traceSession.createdAt,
        session_status: "active",
        turn_index: turnIndex,
        has_images: hasImages,
        message_count: messages.length,
        conversation_message_count: messages.length + 1,
        ...codeTraceAttributes,
      });
      emitCurrentSpanPartial();

      if (isOpenAI && !process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not set.");
      }
      if (!isOpenAI && !process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not set.");
      }

      if (isOpenAI) {
        const openaiText = await runOpenAIChat(model, messages, emit, codeContext);
        Tracer.setOutput({
          format: "chat_conversation",
          message: { role: "assistant", content: openaiText },
        });
        emitCurrentSpanPartial();
        return openaiText;
      }

      const prompt = toPrompt(messages, codeContext);
      const images = latest.imageDataUrls?.map(dataUrlParts) ?? [];
      const runQuery = Tracer.observe(async function designGodAgentRun(userText: string): Promise<string> {
        Tracer.setInput({
          user_text: userText,
          prompt,
          has_images: hasImages,
          allowed_tools: ["Skill", "WebSearch"],
        });
        Tracer.setAttributes({
          provider,
          requested_model: model,
          chat_session_id: activeSessionId,
          turn_index: turnIndex,
        });

        const sdkMessages: SDKMessage[] = [];
        let claudeCodeStderr = "";
        const claudeCodeNodeBin = resolveClaudeCodeNodeBin();

        // Track pending tool calls so we can pair them with their results
        const pendingTools = new Map<string, { name: string; input: unknown }>();

        try {
          for await (const message of query({
            prompt: images.length > 0 ? createUserMessageStream(prompt, activeSessionId, images) : prompt,
            options: {
              model,
              customSystemPrompt: systemForTurn,
              allowedTools: ["Skill", "WebSearch"],
              env: {
                ...process.env,
                HOME: claudeHome,
                ...(claudeCodeNodeBin
                  ? { PATH: `${claudeCodeNodeBin}:${process.env.PATH ?? ""}` }
                  : {}),
              },
              stderr: (data) => {
                claudeCodeStderr += data;
              },
            }
          })) {
            sdkMessages.push(message);

            if (message.type === "assistant") {
              type Block = { type: string; id?: string; name?: string; input?: unknown; text?: string };
              const blocks = message.message.content as Block[];
              const textContent = blocks.filter(b => b.type === "text").map(b => b.text ?? "").join("");
              const toolUseBlocks = blocks.filter(b => b.type === "tool_use");

              // One LLM span per assistant turn — explicitly set input/output for clarity
              await Tracer.observe(async function llmTurn() {
                const inputPayload = {
                  format: "chat_conversation",
                  system: systemForTurn,
                  messages: buildConversationMessages(messages),
                  tools: ["Skill", "WebSearch"],
                  code_context:
                    codeContext.enabled
                      ? {
                          reference_count: codeContext.referenceCount,
                          global_style_count: codeContext.globalStyleCount,
                          repo_roots: codeContext.repoRoots,
                        }
                      : undefined,
                };
                const outputPayload = {
                  format: "chat_conversation",
                  message: buildAssistantMessage(textContent, toolUseBlocks),
                };

                Tracer.setInput(inputPayload);
                Tracer.setOutput(outputPayload);
                return outputPayload;
              }, "llm")();

              for (const block of blocks) {
                if (block.type === "tool_use") {
                  pendingTools.set(block.id!, { name: block.name!, input: block.input });
                  emit("tool_use", { id: block.id, name: block.name, summary: summarizeInput(block.input) });
                } else if (block.type === "text" && block.text?.trim()) {
                  emit("phase", { label: "Responding…" });
                }
              }
            } else if (message.type === "user") {
              type ResultBlock = { type: string; tool_use_id?: string; content?: unknown };
              for (const block of message.message.content as ResultBlock[]) {
                if (block.type === "tool_result") {
                  const tool = pendingTools.get(block.tool_use_id!);
                  const result = extractToolResultText(block.content);
                  if (tool) {
                    // One tool span per tool call — name+input → result
                    await Tracer.observe(async function toolCall() {
                      Tracer.setInput({ name: tool.name, input: tool.input });
                      Tracer.setOutput(result);
                    }, "tool")();
                    pendingTools.delete(block.tool_use_id!);
                  }
                  emit("tool_result", { id: block.tool_use_id, summary: result.slice(0, 80) });
                }
              }
            }
          }
        } catch (error) {
          if (claudeCodeStderr.trim() && error instanceof Error) {
            const terminalResult = [...sdkMessages].reverse().find(
              (m): m is SDKResultMessage => m.type === "result"
            );
            const detail = terminalResult?.is_error && "result" in terminalResult
              ? terminalResult.result
              : claudeCodeStderr.trim().split("\n").at(-1);
            error.message = detail ? `${error.message}: ${detail}` : error.message;
          }
          throw error;
        }

        const terminalResult = [...sdkMessages].reverse().find(
          (m): m is SDKResultMessage => m.type === "result"
        );

        if (terminalResult) {
          recordRunMetadata(terminalResult);
        }

        if (terminalResult && (terminalResult.subtype !== "success" || terminalResult.is_error)) {
          const agentError = new Error(`Design God run failed with result subtype "${terminalResult.subtype}".`);
          annotateCurrentSpanError(agentError, {
            permission_denials_detail: terminalResult.permission_denials,
          });
          throw agentError;
        }

        const resultMsg = terminalResult?.subtype === "success" ? terminalResult : undefined;
        const finalText = (resultMsg?.result ?? extractText(sdkMessages)).trim();

        Tracer.setOutput(finalText);
        return finalText;
      }, "function");

      const claudeText = await runQuery(latest.text ?? "");
      Tracer.setOutput({
        format: "chat_conversation",
        message: { role: "assistant", content: claudeText },
      });
      emitCurrentSpanPartial();
      return claudeText;
    }, "function");

    const text = await runChatTurn(latest.text ?? "");
    emit("done", { text, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  } catch (error) {
    annotateCurrentSpanError(error, {
      route: "/api/chat",
    });
    emit("error", { message: error instanceof Error ? error.message : "Unknown error" });
    console.error(error);
  }

  res.end();
});

function parseMeta(html: string, baseUrl: string) {
  function getOg(property: string) {
    const re1 = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*?)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*?)["'][^>]+property=["']${property}["']`, "i");
    return (html.match(re1) ?? html.match(re2))?.[1];
  }
  function getMeta(name: string) {
    const re1 = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*?)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*?)["'][^>]+name=["']${name}["']`, "i");
    return (html.match(re1) ?? html.match(re2))?.[1];
  }
  function resolve(url: string) {
    try { return new URL(url, baseUrl).href; } catch { return url; }
  }
  const iconMatch =
    html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i) ??
    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*icon[^"']*["']/i);
  const ogImage = getOg("og:image");
  return {
    title: getOg("og:title") ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim(),
    description: getOg("og:description") ?? getMeta("description"),
    image: ogImage ? resolve(ogImage) : undefined,
    favicon: iconMatch ? resolve(iconMatch[1]) : `${new URL(baseUrl).origin}/favicon.ico`
  };
}

app.get("/api/skills", (_req, res) => {
  const skillDirs = [
    { base: path.join(process.env.HOME ?? "", ".claude", "skills"), source: "global" },
    { base: path.join(process.cwd(), ".claude-home", ".claude", "skills"), source: "local" },
  ];

  const skills: { id: string; name: string; description: string; source: string; preview: string }[] = [];

  for (const { base, source } of skillDirs) {
    if (!fs.existsSync(base)) continue;
    const entries = fs.readdirSync(base, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(base, entry.name, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;
      const raw = fs.readFileSync(skillFile, "utf-8");

      const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      let name = entry.name;
      let description = "";
      let body = raw;
      if (fmMatch) {
        const fm = fmMatch[1];
        body = fmMatch[2];
        const nameMatch = fm.match(/^name:\s*(.+)$/m);
        const descMatch = fm.match(/^description:\s*(.+)$/m);
        if (nameMatch) name = nameMatch[1].trim();
        if (descMatch) description = descMatch[1].trim();
      }

      const preview = body.split("\n").find(l => l.trim().length > 0)?.trim() ?? "";
      skills.push({ id: entry.name, name, description, source, preview });
    }
  }

  res.json(skills);
});

app.post("/api/preview", async (req, res) => {
  try {
    const { url } = z.object({ url: z.string().url() }).parse(req.body);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      },
      signal: AbortSignal.timeout(8000),
      redirect: "follow"
    });
    const html = await response.text();
    res.json(parseMeta(html, url));
  } catch (error) {
    console.error("Preview fetch error:", error);
    res.status(500).json({ error: "Failed to fetch preview" });
  }
});

const distPath = path.resolve(import.meta.dirname ?? ".", "..", "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

(async () => {
  const judgmentApiKey = process.env.JUDGMENT_API_KEY?.trim();
  const judgmentOrgId = process.env.JUDGMENT_ORG_ID?.trim();
  const judgmentApiUrl = process.env.JUDGMENT_API_URL?.trim();

  // Graceful init — server starts even if Judgment credentials are missing or init falls back to no-op mode
  if (!judgmentApiKey) {
    console.log("[tracing] JUDGMENT_API_KEY not set — tracing disabled");
  } else if (!judgmentOrgId) {
    console.log("[tracing] JUDGMENT_ORG_ID not set — tracing disabled");
  } else {
    try {
      const tracer = await Tracer.init({
        projectName: judgmentProjectName,
        apiKey: judgmentApiKey,
        organizationId: judgmentOrgId,
        apiUrl: judgmentApiUrl || undefined,
        environment: process.env.NODE_ENV ?? "development",
        resourceAttributes: {
          "service.version": process.env.npm_package_version ?? "0.1.0",
        }
      });
      judgmentTracer = tracer;

      if (tracer.projectId) {
        console.log(
          `[tracing] Judgment tracing enabled for project "${tracer.projectName}" (${tracer.projectId}) at ${tracer.apiUrl}`
        );
      } else {
        console.warn(
          `[tracing] Judgment tracer initialized in no-op mode. Check project "${judgmentProjectName}" exists and credentials are valid.`
        );
      }
    } catch (err) {
      console.warn("[tracing] Judgment init failed — tracing disabled:", err instanceof Error ? err.message : err);
    }
  }

  // Flush buffered spans before the process exits so no traces are lost
  const shutdown = async () => {
    await Promise.all(
      Array.from(chatTraceSessions.keys()).map((sessionId) => closeChatTraceSession(sessionId, "process_exit"))
    ).catch(() => {});
    await Tracer.forceFlush().catch(() => {});
    await Tracer.shutdown().catch(() => {});
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  app.listen(port, () => {
    console.log(`Design God server listening on http://localhost:${port}`);
  });
})();

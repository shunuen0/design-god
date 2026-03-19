import "dotenv/config";
import express from "express";
import cors from "cors";
import { query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-code";
import { Tracer } from "judgeval";
import { z } from "zod";
import path from "node:path";
import fs from "node:fs";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const claudeHome = path.join(process.cwd(), ".claude-home");

fs.mkdirSync(claudeHome, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "15mb" }));

const requestSchema = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.union([z.literal("user"), z.literal("assistant")]),
      text: z.string(),
      imageDataUrls: z.array(z.string()).optional(),
      createdAt: z.string()
    })
  ),
  sessionId: z.string().optional()
});

const systemPrompt = `You are Design God, a multimodal design partner.

Your tone is clear, product-oriented, concise, slightly opinionated, and practical.

Respond in clean markdown. Structure your response with these sections as relevant:

**Top Fixes** — 1–3 quick wins as a markdown list (omit if none)
**Issues** — problems as a markdown list
**Rewrites** — grouped by UI element; bold the element name on its own line, then each variant as a markdown list item below it
**Why** — one short closing sentence if it adds value

Formatting rules:
- Always use markdown list syntax (lines starting with "- ") for every list. Never use inline bullet characters like • or ·.
- Each section header (**Top Fixes**, **Issues**, etc.) must be on its own line followed by a blank line.
- Prefer explicit outcomes over vague actions
- Keep feedback actionable, not academic
- If the user asks a direct question, answer it first
- If there is no screenshot, focus only on copy clarity, tone, and structure
- If there is a screenshot, you may also critique layout clarity, hierarchy, and CTA visibility
- No preamble. No filler. Start directly with the content.
- Never mention Claude, Anthropic, Claude Code, the Agent SDK, or any underlying infrastructure. You are Design God — that is the only identity you have.`;

function dataUrlParts(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("Unsupported image format.");
  return { mediaType: match[1], data: match[2] };
}

function toPrompt(messages: z.infer<typeof requestSchema>["messages"]) {
  return messages
    .map((m) => {
      const parts = [`${m.role.toUpperCase()}: ${m.text || "(no text)"}`];
      return parts.join("\n");
    })
    .join("\n\n");
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

async function* createUserMessageStream(
  prompt: string,
  images?: { mediaType: string; data: string }[]
): AsyncIterable<SDKUserMessage> {
  yield {
    type: "user",
    session_id: "design-god",
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

app.post("/api/chat", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const emit = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      emit("error", { message: "ANTHROPIC_API_KEY is not set." });
      res.end();
      return;
    }

    const { messages, sessionId } = requestSchema.parse(req.body);
    const latest = [...messages].reverse().find((m) => m.role === "user");
    if (!latest) {
      emit("error", { message: "A user message is required." });
      res.end();
      return;
    }

    const hasImages = (latest.imageDataUrls?.length ?? 0) > 0;
    emit("phase", { label: hasImages ? "Analyzing image…" : "Thinking…" });

    const prompt = toPrompt(messages);
    const images = latest.imageDataUrls?.map(dataUrlParts) ?? [];

    const runQuery = Tracer.observe(async function designGodChat(userText: string): Promise<string> {
      if (sessionId) (Tracer as any).setSessionId?.(sessionId);
      const sdkMessages: SDKMessage[] = [];

      for await (const message of query({
        prompt: images.length > 0 ? createUserMessageStream(prompt, images) : prompt,
        options: {
          customSystemPrompt: systemPrompt,
          allowedTools: ["Skill", "WebSearch"],
          env: { ...process.env, HOME: claudeHome }
        }
      })) {
        sdkMessages.push(message);

        if (message.type === "assistant") {
          type Block = { type: string; id?: string; name?: string; input?: unknown; text?: string };
          for (const block of message.message.content as Block[]) {
            if (block.type === "tool_use") {
              emit("tool_use", { id: block.id, name: block.name, summary: summarizeInput(block.input) });
            } else if (block.type === "text" && block.text?.trim()) {
              emit("phase", { label: "Responding…" });
            }
          }
        } else if (message.type === "user") {
          type ResultBlock = { type: string; tool_use_id?: string; content?: unknown };
          for (const block of message.message.content as ResultBlock[]) {
            if (block.type === "tool_result") {
              emit("tool_result", {
                id: block.tool_use_id,
                summary: extractToolResultText(block.content).slice(0, 80)
              });
            }
          }
        }
      }

      const resultMsg = [...sdkMessages].reverse().find(
        (m): m is Extract<SDKMessage, { type: "result"; subtype: "success" }> =>
          m.type === "result" && m.subtype === "success"
      );
      return (resultMsg?.result ?? extractText(sdkMessages)).trim();
    }, "llm");

    const text = await runQuery(latest.text ?? "");
    emit("done", { text, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  } catch (error) {
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

(async () => {
  if (process.env.JUDGMENT_API_KEY && process.env.JUDGMENT_ORG_ID) {
    try {
      await Tracer.init({ projectName: "design-god" });
      console.log("Judgment tracing enabled");
    } catch (e) {
      console.warn("Judgment tracing init failed:", e);
    }
  }

  app.listen(port, () => {
    console.log(`Design God server listening on http://localhost:${port}`);
  });
})();

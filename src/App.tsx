import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, ArrowUp, Square, Search, FileText, Terminal, Globe, Zap, Images, X, Check, Copy, Code2 } from "lucide-react";
import { Streamdown } from "streamdown";
import { buildCodingPrompt, hydrateAssistantResponses } from "./assistantResponse";
import { ATTACHMENT_ACCEPT, dedupeCodeReferences, extractAbsolutePathReferences, fileToCodeReference, isCodeLikeFile, isImageFile } from "./codeReferences";
import { HistoryPanel } from "./HistoryPanel";
import { Sidebar } from "./Sidebar";
import { SkillsPanel } from "./SkillsPanel";
import { buildChatThread, getChatThread, listChatThreads, saveChatThread, summarizeChatThread } from "./chatHistory";
import { useTheme } from "./useTheme";
import type { ChatMessage, ChatThreadSummary, CodeReference, GalleryItem, Recommendation, ToolCallItem } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787/api/chat";
const PREVIEW_URL = API_URL.replace(/\/api\/chat$/, "/api/preview");
const END_SESSION_URL = API_URL.replace(/\/api\/chat$/, "/api/chat/session/end");

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.readAsDataURL(file);
  });
}

const GLYPHS = "アカサタナハマヤラワイキシチニヒミリンウクスツヌフムユルヲエケセテネヘメレオコソトノホモヨロ0123456789*#@$%&";

function ScrambleTitle({ idle, hover }: { idle: string; hover: string }) {
  const [display, setDisplay] = useState(idle.split(""));
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef(idle);

  function scrambleTo(target: string) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    targetRef.current = target;
    const source = display;
    const maxLen = Math.max(source.length, target.length);
    const startTime = performance.now();
    const duration = 320;
    const stagger = 28;

    function tick(now: number) {
      if (targetRef.current !== target) return;
      const elapsed = now - startTime;
      const chars = Array.from({ length: maxLen }, (_, i) => {
        const charDeadline = i * stagger + duration * 0.4;
        if (elapsed >= charDeadline + duration * 0.3) {
          return target[i] ?? "";
        }
        if (elapsed < i * stagger) {
          return source[i] ?? target[i] ?? "";
        }
        return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      });
      setDisplay(chars);
      if (elapsed < maxLen * stagger + duration) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target.split(""));
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }

  return (
    <span
      className="app-title scramble"
      onMouseEnter={() => scrambleTo(hover)}
      onMouseLeave={() => scrambleTo(idle)}
    >
      {display.join("")}
    </span>
  );
}

function UserBubble({ text }: { text: string }) {
  const ref = useRef<HTMLElement>(null);
  const [multiLine, setMultiLine] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const lineHeight = parseFloat(getComputedStyle(ref.current).lineHeight);
    setMultiLine(ref.current.scrollHeight > lineHeight * 1.5);
  }, [text]);

  return (
    <article ref={ref} className={`user-bubble${multiLine ? " multiline" : ""}`}>
      <p className="message-text">{text}</p>
    </article>
  );
}

function CodeReferenceList({
  references,
  onRemove,
  compact = false,
}: {
  references: CodeReference[];
  onRemove?: (referenceId: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`code-reference-list${compact ? " compact" : ""}`}>
      {references.map((reference) => {
        const pathLabel = reference.relativePathHint || reference.absolutePath || reference.displayName;
        const sourceLabel = reference.source === "absolute_path" ? "Absolute path" : "Attached file";

        return (
          <div key={reference.id} className="code-reference-chip">
            <div className="code-reference-chip-copy">
              <span className="code-reference-chip-icon" aria-hidden="true">
                <Code2 size={13} strokeWidth={1.85} />
              </span>
              <span className="code-reference-chip-text">
                <span className="code-reference-chip-name">{reference.displayName}</span>
                <span className="code-reference-chip-meta">{sourceLabel} · {pathLabel}</span>
              </span>
            </div>
            {onRemove ? (
              <button
                type="button"
                className="code-reference-chip-remove"
                onClick={() => onRemove(reference.id)}
                aria-label={`Remove ${reference.displayName}`}
              >
                <X size={11} strokeWidth={2.4} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function toolIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("read") || n.includes("file")) return <FileText size={13} />;
  if (n.includes("bash") || n.includes("shell")) return <Terminal size={13} />;
  if (n.includes("web") || n.includes("fetch")) return <Globe size={13} />;
  if (n.includes("search") || n.includes("grep") || n.includes("glob")) return <Search size={13} />;
  return <Zap size={13} />;
}

function ThinkingIndicator({ phase, toolCalls }: { phase: string; toolCalls: ToolCallItem[] }) {
  return (
    <div className="thinking-indicator">
      <p className="streaming-phase">{phase}</p>
      {toolCalls.length > 0 && (
        <ul className="tool-call-list">
          {toolCalls.map((tc) => (
            <li key={tc.id} className="tool-call-item">
              <span className="tool-call-icon">{toolIcon(tc.name)}</span>
              <span className={`tool-call-name${tc.result ? "" : " pending"}`}>{tc.name}</span>
              {tc.result && <span className="tool-call-result">"{tc.result}"</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssistantMessageCard({ message, sourceMessage }: { message: ChatMessage; sourceMessage?: ChatMessage }) {
  const recommendations = message.response?.recommendations ?? [];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [editedPrompt, setEditedPrompt] = useState("");

  const selectedRecommendations = useMemo(
    () => recommendations.filter((recommendation) => selectedIds.includes(recommendation.id)),
    [recommendations, selectedIds]
  );

  const implementationPrompt = useMemo(() => {
    if (selectedRecommendations.length === 0) return "";
    return buildCodingPrompt({
      selectedRecommendations,
      sourceMessage,
      assistantText: message.text,
    });
  }, [message.text, selectedRecommendations, sourceMessage]);

  useEffect(() => {
    setEditedPrompt(implementationPrompt);
  }, [implementationPrompt]);

  function toggleRecommendation(recommendation: Recommendation) {
    setSelectedIds((current) =>
      current.includes(recommendation.id)
        ? current.filter((id) => id !== recommendation.id)
        : [...current, recommendation.id]
    );
    setCopyState("idle");
  }

  async function copyPrompt() {
    if (!editedPrompt) return;

    try {
      await navigator.clipboard.writeText(editedPrompt);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <article className="message-card assistant">
      <Streamdown linkSafety={{ enabled: false }}>{message.text}</Streamdown>
      {recommendations.length > 0 && (
        <section className="implementation-bridge">
          <div className="implementation-bridge-header">
            <div className="implementation-bridge-copy">
              <span className="implementation-bridge-title">Send selected fixes to your coding agent</span>
              <span className="implementation-bridge-subtitle">Select the recommendations you actually want implemented.</span>
            </div>
            <span className="implementation-bridge-count">
              {selectedRecommendations.length}/{recommendations.length}
            </span>
          </div>

          <div className="recommendation-list">
            {recommendations.map((recommendation, index) => {
              const active = selectedIds.includes(recommendation.id);

              return (
                <button
                  key={recommendation.id}
                  type="button"
                  className={`recommendation-chip${active ? " active" : ""}`}
                  style={{ animationDelay: `${index * 36}ms` }}
                  onClick={() => toggleRecommendation(recommendation)}
                  aria-pressed={active}
                >
                  <div className="recommendation-chip-main">
                    <span className={`recommendation-checkbox${active ? " checked" : ""}`} aria-hidden="true">
                      {active ? "✓" : ""}
                    </span>
                    <span className="recommendation-text">{recommendation.text}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {implementationPrompt && (
            <div className="implementation-prompt-card">
              <div className="implementation-prompt-header">
                <span className="implementation-prompt-title">Implementation Prompt</span>
                <button type="button" className={`implementation-copy-btn${copyState === "copied" ? " copied" : ""}`} onClick={copyPrompt} aria-label="Copy prompt">
                  <span className="copy-btn-content">
                    <Copy size={13} strokeWidth={2} />
                  </span>
                  <span className="copy-btn-check">
                    <Check size={13} strokeWidth={2.5} />
                  </span>
                </button>
              </div>
              <textarea
                className="implementation-prompt-preview"
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                spellCheck={false}
              />
            </div>
          )}
        </section>
      )}
    </article>
  );
}

function MessageCard({ message, sourceMessage }: { message: ChatMessage; sourceMessage?: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="message-card user">
        {message.imageDataUrls && message.imageDataUrls.length > 0 ? (
          <div className="message-images">
            {message.imageDataUrls.map((url, i) => (
              <img key={i} className="message-image" src={url} alt={`Uploaded UI ${i + 1}`} />
            ))}
          </div>
        ) : null}
        {message.codeReferences && message.codeReferences.length > 0 ? (
          <CodeReferenceList references={message.codeReferences} compact />
        ) : null}
        {message.text ? <UserBubble text={message.text} /> : null}
      </div>
    );
  }

  return <AssistantMessageCard message={message} sourceMessage={sourceMessage} />;
}

function GalleryCard({ item, onRemove }: { item: GalleryItem; onRemove: (id: string) => void }) {
  if (item.type === "image") {
    return (
      <div className="gallery-card image-card">
        <img src={item.src} alt={item.name} />
        <button
          className="gallery-card-remove"
          onClick={() => onRemove(item.id)}
          aria-label="Remove"
        >
          <X size={11} strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  let domain = item.url;
  try { domain = new URL(item.url).hostname.replace(/^www\./, ""); } catch {}

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="gallery-card link-card"
    >
      {item.image && <img className="link-card-image" src={item.image} alt="" />}
      <div className="link-card-body">
        <div className="link-card-domain">
          {item.favicon && <img src={item.favicon} className="link-card-favicon" alt="" />}
          <span>{domain}</span>
        </div>
        {item.title && <p className="link-card-title">{item.title}</p>}
        {item.description && <p className="link-card-desc">{item.description}</p>}
      </div>
      <button
        className="gallery-card-remove"
        onClick={(e) => { e.preventDefault(); onRemove(item.id); }}
        aria-label="Remove"
      >
        <X size={11} strokeWidth={2.5} />
      </button>
    </a>
  );
}

function GalleryPanel({
  items,
  onAdd,
  onRemove,
  onClose,
}: {
  items: GalleryItem[];
  onAdd: (item: GalleryItem) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const galleryFileRef = useRef<HTMLInputElement>(null);

  async function addUrl() {
    const raw = urlInput.trim();
    if (!raw) return;
    setFetching(true);
    try {
      const res = await fetch(PREVIEW_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raw })
      });
      const data = res.ok ? await res.json() : {};
      onAdd({
        id: crypto.randomUUID(),
        type: "link",
        url: raw,
        title: data.title,
        description: data.description,
        image: data.image,
        favicon: data.favicon,
        addedAt: new Date().toISOString()
      });
      setUrlInput("");
    } catch {
      onAdd({ id: crypto.randomUUID(), type: "link", url: raw, addedAt: new Date().toISOString() });
      setUrlInput("");
    } finally {
      setFetching(false);
    }
  }

  async function handleDropFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    for (const file of images) {
      const src = await fileToDataUrl(file);
      onAdd({ id: crypto.randomUUID(), type: "image", src, name: file.name, addedAt: new Date().toISOString() });
    }
  }

  return (
    <>
      <div className="gallery-backdrop" onClick={onClose} />
      <aside
        className={`gallery-panel${isDragOver ? " drag-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
        onDrop={async (e) => {
          e.preventDefault();
          setIsDragOver(false);
          await handleDropFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="gallery-panel-header">
          <span className="gallery-panel-title">Gallery</span>
          <button className="gallery-close-btn" onClick={onClose} aria-label="Close gallery">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="gallery-add-row">
          <input
            className="gallery-url-input"
            placeholder="Paste a URL…"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addUrl()}
          />
          <button
            className="gallery-add-btn"
            onClick={addUrl}
            disabled={!urlInput.trim() || fetching}
          >
            {fetching ? "…" : "Add"}
          </button>
        </div>

        <div className="gallery-grid">
          {items.length === 0 ? (
            <div className="gallery-empty">
              <p>Drop images or paste links above</p>
            </div>
          ) : (
            items.map((item) => <GalleryCard key={item.id} item={item} onRemove={onRemove} />)
          )}
        </div>

        <input
          ref={galleryFileRef}
          hidden
          type="file"
          accept="image/*"
          multiple
          onChange={async (e) => {
            await handleDropFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </aside>
    </>
  );
}

const MODELS = [
  { id: "claude-sonnet-4-6",   label: "Sonnet 4.6",    provider: "claude" },
  { id: "claude-opus-4-5",     label: "Opus 4.5",      provider: "claude" },
  { id: "gpt-5.4",             label: "GPT-5.4",        provider: "openai" },
  { id: "gpt-5.4-mini",        label: "GPT-5.4 mini",   provider: "openai" },
  { id: "gpt-5.4-nano",        label: "GPT-5.4 nano",   provider: "openai" },
  { id: "gpt-4o",              label: "GPT-4o",         provider: "openai" },
] as const;

function ModelPicker({ model, onChange }: { model: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = MODELS.find((m) => m.id === model) ?? MODELS[0];

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <div className="model-picker" ref={ref}>
      <button
        type="button"
        className="model-picker-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch model"
      >
        <span className="model-picker-provider">{current.provider === "openai" ? "OpenAI" : "Claude"}</span>
        <span className="model-picker-label">{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="model-menu" role="menu">
          {(["claude", "openai"] as const).map((provider) => (
            <div key={provider} className="model-menu-group">
              {MODELS.filter((m) => m.provider === provider).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="menuitem"
                  className={`model-menu-item${m.id === model ? " active" : ""}`}
                  onClick={() => { onChange(m.id); setOpen(false); }}
                >
                  {m.label}
                  {m.id === model && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [imageDataUrls, setImageDataUrls] = useState<string[]>([]);
  const [imageNames, setImageNames] = useState<string[]>([]);
  const [attachedCodeReferences, setAttachedCodeReferences] = useState<CodeReference[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [streamingPhase, setStreamingPhase] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [toolCalls, setToolCalls] = useState<ToolCallItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>(() => {
    try { return JSON.parse(localStorage.getItem("design-god-gallery") ?? "[]"); } catch { return []; }
  });
  const [historyThreads, setHistoryThreads] = useState<ChatThreadSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string>(() => crypto.randomUUID());
  const [activeChatCreatedAt, setActiveChatCreatedAt] = useState(() => new Date().toISOString());
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [model, setModel] = useState<string>(() => localStorage.getItem("design-god-model") ?? "claude-sonnet-4-6");
  function changeModel(id: string) { setModel(id); localStorage.setItem("design-god-model", id); }
  const { theme, toggle: toggleTheme } = useTheme();

  const activePanel = showHistory ? "history" : showSkills ? "skills" : showGallery ? "gallery" : null;

  useEffect(() => {
    localStorage.setItem("design-god-gallery", JSON.stringify(galleryItems));
  }, [galleryItems]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateHistory() {
      try {
        const threads = await listChatThreads();
        if (cancelled) return;

        setHistoryThreads(threads);

        if (threads.length > 0) {
          const latestThread = await getChatThread(threads[0].id);
          if (!latestThread || cancelled) return;

          setActiveChatId(latestThread.id);
          setActiveChatCreatedAt(latestThread.createdAt);
          setSessionId(latestThread.sessionId);
          setMessages(hydrateAssistantResponses(latestThread.messages));
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    void hydrateHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (historyLoading || messages.length === 0) return;

    const updatedAt = new Date().toISOString();
    const thread = buildChatThread({
      id: activeChatId,
      sessionId,
      createdAt: activeChatCreatedAt,
      messages,
    }, updatedAt);

    void saveChatThread(thread)
      .then((savedThread) => {
        const summary = summarizeChatThread(savedThread);
        setHistoryThreads((current) =>
          [summary, ...current.filter((item) => item.id !== summary.id)].sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt)
          )
        );
      })
      .catch(() => {});
  }, [activeChatCreatedAt, activeChatId, historyLoading, messages, sessionId]);

  const canSend = useMemo(
    () => draft.trim().length > 0 || imageDataUrls.length > 0 || attachedCodeReferences.length > 0,
    [attachedCodeReferences.length, draft, imageDataUrls.length]
  );

  function endChatSession(sessionId: string, reason: string) {
    void fetch(END_SESSION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, reason }),
      keepalive: true
    }).catch(() => {});
  }

  function resetTransientState() {
    setDraft("");
    setImageDataUrls([]);
    setImageNames([]);
    setAttachedCodeReferences([]);
    setStreamingPhase(null);
    setStreamingText("");
    setToolCalls([]);
    setIsSending(false);
    if (textareaRef.current) textareaRef.current.style.height = "";
    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }
  }

  async function handleFile(file: File) {
    if (isImageFile(file)) {
      const dataUrl = await fileToDataUrl(file);
      setImageDataUrls((prev) => [...prev, dataUrl]);
      setImageNames((prev) => [...prev, file.name]);
      return;
    }

    if (isCodeLikeFile(file)) {
      const codeReference = await fileToCodeReference(file);
      setAttachedCodeReferences((prev) => dedupeCodeReferences([...prev, codeReference]));
      return;
    }

    throw new Error(`Unsupported attachment type: ${file.name}`);
  }

  function removeImage(index: number) {
    setImageDataUrls((prev) => prev.filter((_, i) => i !== index));
    setImageNames((prev) => prev.filter((_, i) => i !== index));
  }

  function removeCodeReference(referenceId: string) {
    setAttachedCodeReferences((prev) => prev.filter((reference) => reference.id !== referenceId));
  }

  function addGalleryItem(item: GalleryItem) {
    setGalleryItems((prev) => [item, ...prev]);
  }

  function removeGalleryItem(id: string) {
    setGalleryItems((prev) => prev.filter((i) => i.id !== id));
  }

  function startNewChat() {
    endChatSession(sessionId, "new_chat");
    resetTransientState();
    setMessages([]);
    setShowHistory(false);
    setShowGallery(false);
    setShowSkills(false);
    setActiveChatId(crypto.randomUUID());
    setActiveChatCreatedAt(new Date().toISOString());
    setSessionId(crypto.randomUUID());
  }

  async function openChatThread(threadId: string) {
    const thread = await getChatThread(threadId);
    if (!thread) return;

    endChatSession(sessionId, "history_switch");
    resetTransientState();
    setMessages(hydrateAssistantResponses(thread.messages));
    setActiveChatId(thread.id);
    setActiveChatCreatedAt(thread.createdAt);
    setSessionId(thread.sessionId);
    setShowHistory(false);
    setShowGallery(false);
    setShowSkills(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || isSending) return;

    const codeReferences = dedupeCodeReferences([
      ...attachedCodeReferences,
      ...extractAbsolutePathReferences(draft),
    ]);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: draft.trim(),
      imageDataUrls: imageDataUrls.length > 0 ? [...imageDataUrls] : undefined,
      codeReferences: codeReferences.length > 0 ? codeReferences : undefined,
      createdAt: new Date().toISOString()
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "";
    setImageDataUrls([]);
    setImageNames([]);
    setAttachedCodeReferences([]);
    setIsSending(true);
    setStreamingText("");
    setStreamingPhase("Thinking…");
    setToolCalls([]);
    if (animationRef.current) clearInterval(animationRef.current);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, sessionId, model }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) throw new Error(`Request failed with ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const eventText of events) {
          const lines = eventText.split("\n");
          let eventType = "";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            if (line.startsWith("data: ")) dataLine = line.slice(6);
          }
          if (!eventType || !dataLine) continue;

          const data = JSON.parse(dataLine);

          if (eventType === "phase") {
            setStreamingPhase(data.label);
          } else if (eventType === "tool_use") {
            setToolCalls((prev) => [...prev, { id: data.id, name: data.name, summary: data.summary }]);
          } else if (eventType === "tool_result") {
            setToolCalls((prev) =>
              prev.map((tc) => tc.id === data.id ? { ...tc, result: data.summary } : tc)
            );
          } else if (eventType === "done") {
            const fullText: string = data.text;
            setStreamingPhase(null);
            setToolCalls([]);
            let charIndex = 0;
            animationRef.current = setInterval(() => {
              charIndex += 5;
              setStreamingText(fullText.slice(0, charIndex));
              if (charIndex >= fullText.length) {
                clearInterval(animationRef.current!);
                animationRef.current = null;
                setMessages((current) => [
                  ...current,
                  {
                    id: data.id,
                    role: "assistant",
                    text: fullText,
                    createdAt: data.createdAt,
                    response: hydrateAssistantResponses([
                      { id: data.id, role: "assistant", text: fullText, createdAt: data.createdAt }
                    ])[0].response
                  }
                ]);
                setStreamingText("");
              }
            }, 16);
          } else if (eventType === "error") {
            throw new Error(data.message);
          }
        }
      }
    } catch (error) {
      if (animationRef.current) { clearInterval(animationRef.current); animationRef.current = null; }
      setStreamingText("");
      setStreamingPhase(null);
      setToolCalls([]);
      if (error instanceof Error && error.name === "AbortError") {
        // user stopped — discard silently
      } else {
        const failure: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Something went wrong: ${error instanceof Error ? error.message : "Unknown error"}`,
          createdAt: new Date().toISOString()
        };
        setMessages((current) => [...current, failure]);
      }
    } finally {
      abortControllerRef.current = null;
      setIsSending(false);
    }
  }

  const isEmpty = messages.length === 0 && !streamingPhase;

  const composerForm = (
    <form
      className="composer"
      onSubmit={handleSubmit}
      onPaste={async (event) => {
        const imageFiles = Array.from(event.clipboardData.items)
          .filter((item) => item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .filter((f): f is File => f !== null);
        if (imageFiles.length > 0) {
          event.preventDefault();
          await Promise.all(imageFiles.map(handleFile));
        }
      }}
    >
      <div className="composer-box">
        {imageDataUrls.length > 0 && (
          <div className="image-preview-row">
            {imageDataUrls.map((url, i) => (
              <div key={i} className="image-preview-thumb">
                <img src={url} alt={imageNames[i] ?? "Pasted image"} />
                <button
                  type="button"
                  className="image-preview-remove"
                  onClick={() => removeImage(i)}
                  aria-label="Remove image"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {attachedCodeReferences.length > 0 && (
          <div className="composer-code-reference-block">
            <div className="composer-code-reference-header">
              <span className="composer-code-reference-title">Code context</span>
              <span className="composer-code-reference-subtitle">These files will be treated as trusted implementation context.</span>
            </div>
            <CodeReferenceList references={attachedCodeReferences} onRemove={removeCodeReference} />
          </div>
        )}
        <textarea
          ref={textareaRef}
          placeholder="Ask anything, or paste absolute file paths"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSubmit(event as unknown as FormEvent);
            }
          }}
          rows={1}
        />
        <div className="composer-toolbar">
          <button
            type="button"
            className="attach-button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach image or code"
          >
            <Paperclip size={16} strokeWidth={1.75} />
          </button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            onChange={async (event) => {
              const files = Array.from(event.target.files ?? []);
              await Promise.all(files.map(handleFile));
              event.target.value = "";
            }}
          />
          <ModelPicker model={model} onChange={changeModel} />
          <div style={{ flex: 1 }} />
          {isSending ? (
            <button
              type="button"
              className="send-button stop-button"
              onClick={() => abortControllerRef.current?.abort()}
              aria-label="Stop"
            >
              <Square size={12} fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button className="send-button" type="submit" disabled={!canSend}>
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </form>
  );

  const sidebar = (
    <Sidebar
      activePanel={activePanel}
      theme={theme}
      onNewChat={startNewChat}
      onToggleHistory={() => { setShowHistory(v => !v); setShowGallery(false); setShowSkills(false); }}
      onToggleGallery={() => { setShowGallery(v => !v); setShowHistory(false); setShowSkills(false); }}
      onToggleSkills={() => { setShowSkills(v => !v); setShowHistory(false); setShowGallery(false); }}
      onToggleTheme={toggleTheme}
    />
  );

  const panels = (
    <>
      {showHistory && (
        <HistoryPanel
          threads={historyThreads}
          activeChatId={activeChatId}
          loading={historyLoading}
          onClose={() => setShowHistory(false)}
          onSelect={(threadId) => { void openChatThread(threadId); }}
        />
      )}
      {showGallery && (
        <GalleryPanel
          items={galleryItems}
          onAdd={addGalleryItem}
          onRemove={removeGalleryItem}
          onClose={() => setShowGallery(false)}
        />
      )}
      {showSkills && (
        <SkillsPanel onClose={() => setShowSkills(false)} />
      )}
    </>
  );

  if (isEmpty) {
    return (
      <div className="app-root">
        {sidebar}
        <div className="app-shell empty">
          <div className="empty-center">
            <h1 className="empty-heading">Ask Design God anything</h1>
            {composerForm}
          </div>
        </div>
        {panels}
      </div>
    );
  }

  return (
    <div className="app-root">
      {sidebar}
      <div className="app-shell">
        <div className="thread">
          {messages.map((message, index) => (
            <MessageCard
              key={message.id}
              message={message}
              sourceMessage={message.role === "assistant" ? [...messages.slice(0, index)].reverse().find((entry) => entry.role === "user") : undefined}
            />
          ))}
          {streamingPhase && !streamingText && (
            <ThinkingIndicator phase={streamingPhase} toolCalls={toolCalls} />
          )}
          {streamingText && (
            <article className="message-card assistant">
              <Streamdown mode="streaming" animated caret="block" linkSafety={{ enabled: false }}>
                {streamingText}
              </Streamdown>
            </article>
          )}
        </div>
        {composerForm}
      </div>
      {panels}
    </div>
  );
}

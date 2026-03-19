import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Plus, ArrowUp, Search, FileText, Terminal, Globe, Zap, Images, X } from "lucide-react";
import { Streamdown } from "streamdown";
import type { ChatMessage, GalleryItem, ToolCallItem } from "./types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787/api/chat";
const PREVIEW_URL = API_URL.replace(/\/api\/chat$/, "/api/preview");

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
              <span className="tool-call-name">{tc.name}</span>
              {tc.result && <span className="tool-call-result">"{tc.result}"</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageCard({ message }: { message: ChatMessage }) {
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
        {message.text ? <UserBubble text={message.text} /> : null}
      </div>
    );
  }

  return (
    <article className="message-card assistant">
      <Streamdown>{message.text}</Streamdown>
    </article>
  );
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

export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [imageDataUrls, setImageDataUrls] = useState<string[]>([]);
  const [imageNames, setImageNames] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [expandedClass, setExpandedClass] = useState(false);
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [streamingPhase, setStreamingPhase] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [toolCalls, setToolCalls] = useState<ToolCallItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const animationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>(() => {
    try { return JSON.parse(localStorage.getItem("design-god-gallery") ?? "[]"); } catch { return []; }
  });
  const [showGallery, setShowGallery] = useState(false);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    localStorage.setItem("design-god-gallery", JSON.stringify(galleryItems));
  }, [galleryItems]);

  const canSend = useMemo(() => draft.trim().length > 0 || imageDataUrls.length > 0, [draft, imageDataUrls]);

  function applyMultiLine(value: boolean) {
    clearTimeout(collapseTimerRef.current);
    if (value) {
      setIsMultiLine(true);
      setExpandedClass(true);
    } else {
      setIsMultiLine(false);
      // Delay removing the expanded class so buttons can fade out first
      collapseTimerRef.current = setTimeout(() => setExpandedClass(false), 180);
    }
  }

  async function handleFile(file: File) {
    const dataUrl = await fileToDataUrl(file);
    setImageDataUrls((prev) => [...prev, dataUrl]);
    setImageNames((prev) => [...prev, file.name]);
  }

  function removeImage(index: number) {
    setImageDataUrls((prev) => prev.filter((_, i) => i !== index));
    setImageNames((prev) => prev.filter((_, i) => i !== index));
  }

  function addGalleryItem(item: GalleryItem) {
    setGalleryItems((prev) => [item, ...prev]);
  }

  function removeGalleryItem(id: string) {
    setGalleryItems((prev) => prev.filter((i) => i.id !== id));
  }

  function startNewChat() {
    setMessages([]);
    setDraft("");
    setImageDataUrls([]);
    setImageNames([]);
    setStreamingPhase(null);
    setStreamingText("");
    setToolCalls([]);
    setSessionId(crypto.randomUUID());
    if (animationRef.current) { clearInterval(animationRef.current); animationRef.current = null; }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSend || isSending) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: draft.trim(),
      imageDataUrls: imageDataUrls.length > 0 ? [...imageDataUrls] : undefined,
      createdAt: new Date().toISOString()
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    applyMultiLine(false);
    if (textareaRef.current) textareaRef.current.style.height = "32px";
    setImageDataUrls([]);
    setImageNames([]);
    setIsSending(true);
    setStreamingText("");
    setStreamingPhase("Thinking…");
    setToolCalls([]);
    if (animationRef.current) clearInterval(animationRef.current);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, sessionId })
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
                  { id: data.id, role: "assistant", text: fullText, createdAt: data.createdAt }
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
      const failure: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: `Something went wrong: ${error instanceof Error ? error.message : "Unknown error"}`,
        createdAt: new Date().toISOString()
      };
      setMessages((current) => [...current, failure]);
    } finally {
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
      <div className={`composer-box${imageDataUrls.length > 0 || expandedClass ? " expanded" : ""}${expandedClass && !isMultiLine && imageDataUrls.length === 0 ? " collapsing" : ""}`}>
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
        <div className="composer-input-row">
          <button
            type="button"
            className="attach-button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
          >
            <Plus size={20} strokeWidth={1.75} />
          </button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept="image/*"
            multiple
            onChange={async (event) => {
              const files = Array.from(event.target.files ?? []);
              await Promise.all(files.map(handleFile));
              event.target.value = "";
            }}
          />
          <textarea
            ref={textareaRef}
            placeholder="Ask anything"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              const el = event.target;
              const prev = el.offsetHeight;
              el.style.height = "auto";
              const next = el.scrollHeight;
              el.style.height = `${prev}px`;
              void el.offsetHeight; // force reflow so transition fires
              el.style.height = `${next}px`;
              const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
              applyMultiLine(next > lineHeight * 1.5);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSubmit(event as unknown as FormEvent);
              }
            }}
            rows={1}
          />
          <button className="send-button" type="submit" disabled={!canSend || isSending}>
            {isSending ? "…" : <ArrowUp size={16} strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </form>
  );

  const header = (
    <header className="app-header">
      <img src="/src/god.png" alt="Design God" className="app-logo" role="button" tabIndex={0} onClick={startNewChat} onKeyDown={(e) => e.key === "Enter" && startNewChat()} />
      <div className="header-actions">
        <button
          type="button"
          className="gallery-toggle-button"
          onClick={() => setShowGallery((v) => !v)}
          title="Gallery"
        >
          <Images size={18} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="new-chat-button"
          onClick={startNewChat}
          title="New chat"
        >
          <Plus size={18} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );

  const galleryPanel = showGallery && (
    <GalleryPanel
      items={galleryItems}
      onAdd={addGalleryItem}
      onRemove={removeGalleryItem}
      onClose={() => setShowGallery(false)}
    />
  );

  if (isEmpty) {
    return (
      <div className="app-shell empty">
        {header}
        <div className="empty-center">
          <h1 className="empty-heading">Ask Design God anything</h1>
          {composerForm}
        </div>
        {galleryPanel}
      </div>
    );
  }

  return (
    <div className="app-shell">
      {header}
      <div className="thread">
        {messages.map((message) => (
          <MessageCard key={message.id} message={message} />
        ))}
        {streamingPhase && !streamingText && (
          <ThinkingIndicator phase={streamingPhase} toolCalls={toolCalls} />
        )}
        {streamingText && (
          <article className="message-card assistant">
            <Streamdown mode="streaming" animated caret="block">
              {streamingText}
            </Streamdown>
          </article>
        )}
      </div>
      {composerForm}
      {galleryPanel}
    </div>
  );
}

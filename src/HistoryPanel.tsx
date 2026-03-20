import { Clock3, MessageSquareText, X } from "lucide-react";
import type { ChatThreadSummary } from "./types";

function formatTimestamp(value: string) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function HistoryPanel({
  threads,
  activeChatId,
  loading,
  onClose,
  onSelect,
}: {
  threads: ChatThreadSummary[];
  activeChatId: string | null;
  loading: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      <div className="history-backdrop" onClick={onClose} />
      <aside className="history-panel" aria-label="Chat history">
        <div className="history-panel-header">
          <div className="history-panel-heading">
            <span className="history-panel-title">Previous Chats</span>
            <span className="history-panel-subtitle">Saved locally on this browser</span>
          </div>
          <button className="history-close-btn" onClick={onClose} aria-label="Close history">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="history-list">
          {loading ? (
            <div className="history-empty">Loading chat history…</div>
          ) : threads.length === 0 ? (
            <div className="history-empty">No saved chats yet</div>
          ) : (
            threads.map((thread, index) => (
              <button
                key={thread.id}
                className={`history-item${activeChatId === thread.id ? " active" : ""}`}
                style={{ animationDelay: `${index * 36}ms` }}
                onClick={() => onSelect(thread.id)}
              >
                <div className="history-item-top">
                  <span className="history-item-title">{thread.title}</span>
                  <span className="history-item-time">{formatTimestamp(thread.updatedAt)}</span>
                </div>
                <p className="history-item-preview">{thread.preview}</p>
                <div className="history-item-meta">
                  <span className="history-item-pill">
                    <MessageSquareText size={12} strokeWidth={1.9} />
                    {thread.messageCount}
                  </span>
                  <span className="history-item-pill">
                    <Clock3 size={12} strokeWidth={1.9} />
                    {new Intl.DateTimeFormat(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(thread.updatedAt))}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>
    </>
  );
}

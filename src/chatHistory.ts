import type { ChatMessage, ChatThread, ChatThreadSummary } from "./types";

const DB_NAME = "design-god-chat-history";
const DB_VERSION = 1;
const THREADS_STORE = "threads";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(THREADS_STORE)) {
        const store = database.createObjectStore(THREADS_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open chat history database."));
  });

  return dbPromise;
}

function summarizeMessages(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.text.trim().length > 0);
  const latestMessage = [...messages].reverse().find((message) => message.text.trim().length > 0);

  return {
    title: firstUserMessage?.text.trim().slice(0, 72) || "Untitled chat",
    preview: latestMessage?.text.trim().replace(/\s+/g, " ").slice(0, 140) || "No messages yet",
  };
}

export function buildChatThread(thread: Omit<ChatThread, "title" | "updatedAt">, updatedAt = new Date().toISOString()): ChatThread {
  const { title } = summarizeMessages(thread.messages);
  return {
    ...thread,
    title,
    updatedAt,
  };
}

export function summarizeChatThread(thread: ChatThread): ChatThreadSummary {
  const { title, preview } = summarizeMessages(thread.messages);
  return {
    id: thread.id,
    sessionId: thread.sessionId,
    title: thread.title || title,
    preview,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length,
  };
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void
): Promise<T> {
  const database = await openDatabase();

  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(THREADS_STORE, mode);
    const store = transaction.objectStore(THREADS_STORE);

    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    action(store, resolve, reject);
  });
}

export async function listChatThreads(): Promise<ChatThreadSummary[]> {
  const records = await withStore<ChatThread[]>("readonly", (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as ChatThread[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error("Failed to list chats."));
  });

  return records
    .map(summarizeChatThread)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getChatThread(id: string): Promise<ChatThread | undefined> {
  return await withStore<ChatThread | undefined>("readonly", (store, resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result as ChatThread | undefined);
    request.onerror = () => reject(request.error ?? new Error("Failed to load chat."));
  });
}

export async function saveChatThread(thread: ChatThread): Promise<ChatThread> {
  return await withStore<ChatThread>("readwrite", (store, resolve, reject) => {
    const normalizedThread = buildChatThread({
      id: thread.id,
      sessionId: thread.sessionId,
      createdAt: thread.createdAt,
      messages: thread.messages,
    }, thread.updatedAt);

    const request = store.put(normalizedThread);
    request.onsuccess = () => resolve(normalizedThread);
    request.onerror = () => reject(request.error ?? new Error("Failed to save chat."));
  });
}

export async function deleteChatThread(id: string): Promise<void> {
  await withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Failed to delete chat."));
  });
}

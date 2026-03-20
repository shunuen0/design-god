export type Role = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: Role;
  text: string;
  imageDataUrls?: string[];
  createdAt: string;
  response?: AgentResponse;
};

export type RewriteGroup = {
  element: string;
  variants: string[];
};

export type AgentResponse = {
  top_fixes: string[];
  issues: string[];
  rewrites: RewriteGroup[];
  answer?: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
};

export type ToolCallItem = {
  id: string;
  name: string;
  summary: string;
  result?: string;
};

export type GalleryItem =
  | { id: string; type: "image"; src: string; name: string; addedAt: string }
  | { id: string; type: "link"; url: string; title?: string; description?: string; image?: string; favicon?: string; addedAt: string };

export type StreamingState = {
  phase: string;
  toolCalls: ToolCallItem[];
};

export type ChatThread = {
  id: string;
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type ChatThreadSummary = {
  id: string;
  sessionId: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

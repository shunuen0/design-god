export type Role = "user" | "assistant";

export type CodeReferenceSource = "absolute_path" | "attached_file";

export type CodeReference = {
  id: string;
  source: CodeReferenceSource;
  displayName: string;
  absolutePath?: string;
  relativePathHint?: string;
  content?: string;
  language?: string;
};

export type ChatMessage = {
  id: string;
  role: Role;
  text: string;
  imageDataUrls?: string[];
  codeReferences?: CodeReference[];
  createdAt: string;
  response?: AgentResponse;
};

export type RecommendationSection = "issues" | "quick_wins";

export type Recommendation = {
  id: string;
  section: RecommendationSection;
  text: string;
};

export type RewriteGroup = {
  element: string;
  variants: string[];
};

export type AgentResponse = {
  quick_wins: string[];
  issues: string[];
  rewrites: RewriteGroup[];
  answer?: string;
  recommendations: Recommendation[];
};

export type ChatRequest = {
  messages: ChatMessage[];
  sessionId?: string;
  model?: string;
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

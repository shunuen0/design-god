import type { AgentResponse, ChatMessage, Recommendation, RecommendationSection } from "./types";

const SECTION_PATTERN = /^(?:\*\*|#{1,6}\s*)(Issues|Quick Wins|Top Fixes)(?:\*\*)?\s*$/i;
const BULLET_PATTERN = /^-\s+(.*)$/;

function normalizeSection(raw: string): RecommendationSection {
  return raw.toLowerCase() === "issues" ? "issues" : "quick_wins";
}

function finalizeBullet(
  section: RecommendationSection | null,
  bullet: string | null,
  buckets: Record<RecommendationSection, string[]>
) {
  if (!section || !bullet) return;
  const normalized = bullet.replace(/\s+/g, " ").trim();
  if (!normalized) return;
  buckets[section].push(normalized);
}

function makeRecommendations(issues: string[], quickWins: string[]): Recommendation[] {
  return [
    ...issues.map((text, index) => ({ id: `issue-${index + 1}`, section: "issues" as const, text })),
    ...quickWins.map((text, index) => ({ id: `quick-win-${index + 1}`, section: "quick_wins" as const, text })),
  ];
}

export function parseAssistantResponse(text: string): AgentResponse | undefined {
  const lines = text.split(/\r?\n/);
  const buckets: Record<RecommendationSection, string[]> = {
    issues: [],
    quick_wins: [],
  };

  let currentSection: RecommendationSection | null = null;
  let currentBullet: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const sectionMatch = trimmed.match(SECTION_PATTERN);
    if (sectionMatch) {
      finalizeBullet(currentSection, currentBullet, buckets);
      currentSection = normalizeSection(sectionMatch[1]);
      currentBullet = null;
      continue;
    }

    if (!currentSection) continue;

    const bulletMatch = trimmed.match(BULLET_PATTERN);
    if (bulletMatch) {
      finalizeBullet(currentSection, currentBullet, buckets);
      currentBullet = bulletMatch[1];
      continue;
    }

    if (!trimmed) continue;

    if (currentBullet) {
      currentBullet = `${currentBullet} ${trimmed}`;
    }
  }

  finalizeBullet(currentSection, currentBullet, buckets);

  const recommendations = makeRecommendations(buckets.issues, buckets.quick_wins);
  if (recommendations.length === 0) return undefined;

  return {
    quick_wins: buckets.quick_wins,
    issues: buckets.issues,
    rewrites: [],
    recommendations,
  };
}

export function hydrateAssistantResponses(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || message.response) return message;
    const parsed = parseAssistantResponse(message.text);
    return parsed ? { ...message, response: parsed } : message;
  });
}

export function buildCodingPrompt(args: {
  selectedRecommendations: Recommendation[];
  sourceMessage?: ChatMessage;
  assistantText: string;
}): string {
  return [
    "## Implement the following changes:",
    "",
    ...args.selectedRecommendations.map((recommendation) => `- ${recommendation.text}`),
  ].join("\n");
}

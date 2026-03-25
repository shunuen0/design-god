export type SkillLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Emotion =
  | "ecstatic"
  | "enthusiastic"
  | "neutral"
  | "anxious"
  | "frustrated"
  | "angry"
  | "hostile"
  | "defeated";

export type QuestionType =
  | "how_to"
  | "critique"
  | "comparison"
  | "diagnosis"
  | "validation"
  | "best_practice"
  | "stakeholder"
  | "tradeoff"
  | "copy_review"
  | "roast";

export type Domain =
  | "saas"
  | "mobile"
  | "ecommerce"
  | "portfolio"
  | "internal_tool"
  | "landing_page"
  | "design_system"
  | "social"
  | "fintech"
  | "healthcare";

export type SimProfile = {
  id: string;
  skill_level: SkillLevel;
  emotion: Emotion;
  emotion_intensity: number; // 0.0 - 1.0
  domain: Domain;
  question_type: QuestionType;
  context: string; // backstory motivating the emotion
};

export type ConversationTurn = {
  turn: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  duration_ms?: number;
};

export type SimulationTrace = {
  profile: SimProfile;
  session_id: string;
  turns: ConversationTurn[];
  started_at: string;
  ended_at: string;
  duration_ms: number;
  total_turns: number;
  terminated_by: "satisfaction" | "max_turns" | "error";
};

export type SimulationConfig = {
  batch_size: number;
  max_turns: number;
  server_url: string;
  profiles: "all" | string[];
};

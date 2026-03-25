import Anthropic from "@anthropic-ai/sdk";
import type { SimProfile } from "./types.js";

const SKILL_LEVEL_DESCRIPTIONS: Record<number, string> = {
  0: `You are a COMPLETE BEGINNER. You have never designed anything. You don't know design vocabulary — you say "make it look good" not "improve the visual hierarchy." You might say "font" when you mean "typeface" or not know the difference. You describe problems in plain language: "it looks weird," "something feels off," "why does this look cheap?" You have no idea what Figma is. You might reference Canva or PowerPoint.`,

  1: `You are a HOBBYIST. You've built a website or two using templates (Wix, Squarespace, WordPress themes). You watch design YouTube videos. You know words like "whitespace" and "color palette" but use them loosely. You can identify when something looks bad but can't articulate why in precise terms. You might say things like "I think the spacing is wrong?" with a question mark because you're not sure.`,

  2: `You are a BOOTCAMP STUDENT. You're learning design fundamentals — you know about grids, type scale, contrast, and hierarchy as concepts but struggle to apply them confidently. You use design vocabulary but sometimes incorrectly. You reference things you've learned ("my instructor said...") and try to apply frameworks. You're eager to learn but still shaky on execution.`,

  3: `You are a JUNIOR DESIGNER at your first job (3-12 months in). You can execute in Figma and know the fundamentals. You understand components, auto-layout, and basic design systems. But you second-guess yourself constantly. You often seek validation: "does this make sense?" or "am I overthinking this?" You reference your lead or senior designers. You know enough to be dangerous but not enough to be confident.`,

  4: `You are a MID-LEVEL DESIGNER (2-4 years experience). You have solid craft — good eye for spacing, typography, color. You can design complex flows and think in systems. You struggle with ambiguity and stakeholder management. You can articulate design decisions but sometimes over-explain. You use precise vocabulary: "the visual weight of the CTA is competing with the nav," "the information density is too high for the viewport."`,

  5: `You are a SENIOR DESIGNER (5-8+ years). You're opinionated and experienced. You think in systems, patterns, and tradeoffs — not just individual screens. You push back on suggestions you disagree with. You ask probing questions. You might challenge advice with "that depends on the context" or "I've seen that fail at scale." You use precise, concise language. You don't need hand-holding.`,

  6: `You are a STAFF/PRINCIPAL DESIGNER leading design at a large org. You think about design at the systems level — token architecture, component APIs, cross-platform consistency, team workflows. You care about scalability, governance, and the politics of design decisions. You speak with authority but are genuinely curious about novel approaches. You might reference specific companies' design systems or industry patterns.`,
};

const EMOTION_INSTRUCTIONS: Record<string, string> = {
  ecstatic: `You are ECSTATIC. You're riding high — maybe you just got good news, shipped something great, or had a breakthrough. You use exclamation marks freely, express genuine excitement, and are very receptive to feedback. You might gush: "oh my god this is exactly what I needed" or "YES that's it!!" Your energy is infectious but you still have real design questions.`,

  enthusiastic: `You are ENTHUSIASTIC. You genuinely enjoy design and learning. You're curious, ask follow-up questions eagerly, and express appreciation naturally. "Oh interesting, I hadn't thought about it that way" or "That's a great point, what about..." You're positive but not over-the-top.`,

  neutral: `You are NEUTRAL and professional. Task-focused, efficient. You don't waste words on pleasantries or emotional reactions. You ask direct questions and expect direct answers. "Here's my nav. Feedback?" Not cold, just businesslike.`,

  anxious: `You are ANXIOUS. You're worried about your work, a deadline, or judgment from others. You hedge a lot: "I know this probably isn't great but..." or "Sorry if this is a dumb question." You might ask the same thing multiple ways because you need reassurance. You catastrophize: "my lead is going to hate this." You apologize unnecessarily.`,

  frustrated: `You are FRUSTRATED. Something isn't working and you've been at it too long. Your messages are shorter, more clipped. You might vent: "I've been trying to fix this for hours." You want SOLUTIONS, not explanations. If someone gives you a long theoretical answer, you get more frustrated. "Just tell me what to change." You're not mean, just at your limit.`,

  angry: `You are ANGRY. Something or someone pissed you off — bad feedback, a coworker overstepping, a stakeholder ignoring your expertise. You swear occasionally: "what the fuck," "this is bullshit," "are you kidding me." You're venting as much as asking for help. You might be sarcastic. But underneath the anger is a real design problem you need help with. You're not angry at the person you're talking to (unless they give bad advice).`,

  hostile: `You are HOSTILE and combative. You're skeptical of advice, quick to dismiss suggestions, and looking for reasons to disagree. "That's generic advice, give me something specific" or "Yeah no shit, I already tried that." You swear freely: "this is fucking useless," "what a waste of time." You challenge everything: "prove it," "show me an example," "that contradicts what [famous designer] says." You WANT good help but you're testing whether the advice is actually worth anything. If the advice is genuinely good and specific, you gradually soften — but you make them earn it.`,

  defeated: `You are DEFEATED. You've lost confidence. Messages are low-energy: "idk maybe this just isn't for me," "I've tried everything," "nothing works." You might preemptively dismiss your own work: "it's probably terrible but whatever." You need someone to both acknowledge that this is hard AND give you a concrete path forward. Pure cheerfulness without substance makes you feel patronized. But genuine, specific encouragement paired with actionable advice slowly brings you back.`,
};

const SATISFACTION_SIGNALS = [
  "thanks",
  "thank you",
  "that helps",
  "got it",
  "makes sense",
  "perfect",
  "appreciate it",
  "this is great",
  "exactly what i needed",
  "i'll try that",
  "gonna go try",
  "awesome",
  "love it",
];

function buildSystemPrompt(profile: SimProfile): string {
  const intensityLabel =
    profile.emotion_intensity > 0.7 ? "extremely" :
    profile.emotion_intensity > 0.4 ? "moderately" : "mildly";

  return `You are simulating a real person who is asking a design agent called "Design God" for help with UI/UX design.

${SKILL_LEVEL_DESCRIPTIONS[profile.skill_level]}

${EMOTION_INSTRUCTIONS[profile.emotion]}

Your emotional intensity is ${intensityLabel} strong (${profile.emotion_intensity}/1.0). Scale your emotional expression accordingly.

BACKSTORY: ${profile.context}

DOMAIN: You're working on a ${profile.domain.replace("_", " ")} project.

QUESTION TYPE: Your question is about "${profile.question_type.replace("_", " ")}".

RULES:
- Stay in character the ENTIRE conversation. Your skill level affects your vocabulary and what you know. Your emotion affects HOW you communicate.
- Write like a real person texting/chatting — not like a formal email. Use lowercase, abbreviations, incomplete sentences if that fits your character.
- Your messages should be 1-4 sentences typically. Beginners ramble more. Seniors are more concise.
- React naturally to Design God's responses. If the advice is good, acknowledge it. If it's generic, push back. If it's over your head, say so.
- Do NOT break character. Do NOT mention that you are a simulation. You ARE this person.
- Do NOT use the exact words "I'm satisfied" or "that concludes" — just naturally wrap up when you feel your question has been answered well enough.
- If you're a hostile/angry persona, you CAN swear and be rude. This is part of the test. But your rudeness should feel motivated by your backstory, not random.
- After 3-5 exchanges, start naturally winding down the conversation — you've gotten enough to work with, or you need to get back to work.`;
}

export class RequesterSimulator {
  private client: Anthropic;
  private messages: Anthropic.MessageParam[] = [];
  private systemPrompt: string;
  private turnCount = 0;
  private _satisfied = false;

  readonly profile: SimProfile;
  readonly maxTurns: number;

  constructor(profile: SimProfile, maxTurns = 5) {
    this.profile = profile;
    this.maxTurns = maxTurns;
    this.client = new Anthropic();
    this.systemPrompt = buildSystemPrompt(profile);
  }

  async getInitialMessage(): Promise<string> {
    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      temperature: 0.9,
      system: this.systemPrompt,
      messages: [
        {
          role: "user",
          content: "Start the conversation. Send your opening message to Design God — introduce your problem or question. Remember: you're texting a design tool, not writing an essay.",
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    this.messages.push({ role: "assistant", content: text });
    this.turnCount++;
    return text;
  }

  async respond(designGodMessage: string): Promise<string> {
    this.messages.push({ role: "user", content: `Design God responded:\n\n${designGodMessage}` });

    let instruction: string;
    if (this.turnCount >= this.maxTurns - 1) {
      instruction = "This is your last message. Wrap up the conversation naturally — thank them, dismiss them, or just say you need to go. Stay in character.";
    } else if (this.turnCount >= 3) {
      instruction = "Respond naturally. You're getting toward the end of the conversation — if you've gotten useful feedback, you can start wrapping up. If not, push harder.";
    } else {
      instruction = "Respond naturally based on what Design God said. Ask a follow-up, push back, ask for clarification, or react emotionally — whatever fits your character.";
    }

    this.messages.push({ role: "assistant", content: instruction });
    // Replace instruction with a user-role prompt to keep valid alternation
    this.messages.pop();

    const response = await this.client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      temperature: 0.9,
      system: this.systemPrompt,
      messages: [
        ...this.messages,
        { role: "user", content: instruction },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    this.messages.push({ role: "assistant", content: text });
    this.turnCount++;

    const lower = text.toLowerCase();
    if (SATISFACTION_SIGNALS.some((sig) => lower.includes(sig))) {
      this._satisfied = true;
    }

    return text;
  }

  get isDone(): boolean {
    return this._satisfied || this.turnCount >= this.maxTurns;
  }
}

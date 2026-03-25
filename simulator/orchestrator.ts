import { RequesterSimulator } from "./simulator.js";
import type { SimProfile, ConversationTurn, SimulationTrace } from "./types.js";

type SSEDoneEvent = { text: string; id: string; createdAt: string };

async function sendToDesignGod(
  serverUrl: string,
  sessionId: string,
  messages: Array<{ id: string; role: "user" | "assistant"; text: string; createdAt: string }>
): Promise<string> {
  const response = await fetch(`${serverUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      sessionId,
      model: "claude-haiku-4-5-20251001",
    }),
  });

  if (!response.ok) {
    throw new Error(`Design God server returned ${response.status}: ${response.statusText}`);
  }

  const body = response.body;
  if (!body) throw new Error("No response body from server");

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let resultText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith("data: ") && eventType) {
        try {
          const data = JSON.parse(line.slice(6));
          if (eventType === "done") {
            resultText = (data as SSEDoneEvent).text;
          } else if (eventType === "error") {
            throw new Error(`Design God error: ${data.message}`);
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue; // malformed JSON chunk, skip
          throw e;
        }
        eventType = "";
      } else if (line === "") {
        eventType = "";
      }
    }
  }

  if (!resultText) {
    throw new Error("No 'done' event received from Design God server");
  }

  return resultText;
}

async function closeSession(serverUrl: string, sessionId: string): Promise<void> {
  try {
    await fetch(`${serverUrl}/api/chat/session/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, reason: "simulation_completed" }),
    });
  } catch {
    // Non-critical — session will timeout on its own
  }
}

export async function runSimulation(
  profile: SimProfile,
  serverUrl: string,
  maxTurns: number
): Promise<SimulationTrace> {
  const simulator = new RequesterSimulator(profile, maxTurns);
  const sessionId = `sim-${profile.id}-${Date.now()}`;
  const turns: ConversationTurn[] = [];
  const chatMessages: Array<{ id: string; role: "user" | "assistant"; text: string; createdAt: string }> = [];
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  let terminatedBy: SimulationTrace["terminated_by"] = "max_turns";

  try {
    // Turn 1: Simulator generates opening message
    const openingMessage = await simulator.getInitialMessage();
    const openingTs = new Date().toISOString();

    turns.push({ turn: 1, role: "user", content: openingMessage, timestamp: openingTs });
    chatMessages.push({
      id: crypto.randomUUID(),
      role: "user",
      text: openingMessage,
      createdAt: openingTs,
    });

    console.log(`  [${profile.id}] User: ${openingMessage.slice(0, 80)}...`);

    let turnNum = 1;

    while (!simulator.isDone) {
      // Design God responds
      const dgStart = Date.now();
      const designGodResponse = await sendToDesignGod(serverUrl, sessionId, chatMessages);
      const dgDuration = Date.now() - dgStart;
      const dgTs = new Date().toISOString();

      turnNum++;
      turns.push({
        turn: turnNum,
        role: "assistant",
        content: designGodResponse,
        timestamp: dgTs,
        duration_ms: dgDuration,
      });
      chatMessages.push({
        id: crypto.randomUUID(),
        role: "assistant",
        text: designGodResponse,
        createdAt: dgTs,
      });

      console.log(`  [${profile.id}] Design God: ${designGodResponse.slice(0, 80)}...`);

      if (simulator.isDone) break;

      // Simulator reacts
      const userResponse = await simulator.respond(designGodResponse);
      const userTs = new Date().toISOString();

      turnNum++;
      turns.push({ turn: turnNum, role: "user", content: userResponse, timestamp: userTs });
      chatMessages.push({
        id: crypto.randomUUID(),
        role: "user",
        text: userResponse,
        createdAt: userTs,
      });

      console.log(`  [${profile.id}] User: ${userResponse.slice(0, 80)}...`);
    }

    terminatedBy = simulator.isDone && turnNum < maxTurns * 2 ? "satisfaction" : "max_turns";
  } catch (error) {
    terminatedBy = "error";
    turns.push({
      turn: turns.length + 1,
      role: "assistant",
      content: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date().toISOString(),
    });
    console.error(`  [${profile.id}] Error: ${error instanceof Error ? error.message : error}`);
  }

  await closeSession(serverUrl, sessionId);

  return {
    profile,
    session_id: sessionId,
    turns,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    duration_ms: Date.now() - startMs,
    total_turns: turns.length,
    terminated_by: terminatedBy,
  };
}

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSimulation } from "./orchestrator.js";
import type { SimProfile, SimulationTrace } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  batchSize: 12,
  maxTurns: 5,
  serverUrl: process.env.SIMULATOR_SERVER_URL ?? "http://localhost:8787",
};

function parseArgs(): { profiles: "all" | string[]; batchSize: number; maxTurns: number } {
  const args = process.argv.slice(2);
  let profiles: "all" | string[] = "all";
  let batchSize = CONFIG.batchSize;
  let maxTurns = CONFIG.maxTurns;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--profiles" && args[i + 1]) {
      profiles = args[i + 1].split(",");
      i++;
    } else if (args[i] === "--batch" && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--turns" && args[i + 1]) {
      maxTurns = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { profiles, batchSize, maxTurns };
}

async function runBatch(
  profiles: SimProfile[],
  batchSize: number,
  maxTurns: number,
  serverUrl: string
): Promise<SimulationTrace[]> {
  const results: SimulationTrace[] = [];

  for (let i = 0; i < profiles.length; i += batchSize) {
    const batch = profiles.slice(i, i + batchSize);
    console.log(`\n--- Batch ${Math.floor(i / batchSize) + 1} (${batch.length} simulations) ---\n`);

    const batchResults = await Promise.all(
      batch.map((profile) => runSimulation(profile, serverUrl, maxTurns))
    );

    results.push(...batchResults);
  }

  return results;
}

function printSummary(traces: SimulationTrace[]) {
  console.log("\n\n========================================");
  console.log("         SIMULATION SUMMARY");
  console.log("========================================\n");

  const totalDuration = traces.reduce((sum, t) => sum + t.duration_ms, 0);
  const avgTurns = traces.reduce((sum, t) => sum + t.total_turns, 0) / traces.length;
  const byTermination = {
    satisfaction: traces.filter((t) => t.terminated_by === "satisfaction").length,
    max_turns: traces.filter((t) => t.terminated_by === "max_turns").length,
    error: traces.filter((t) => t.terminated_by === "error").length,
  };

  console.log(`Total simulations: ${traces.length}`);
  console.log(`Total duration:    ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`Avg turns/sim:     ${avgTurns.toFixed(1)}`);
  console.log(`Terminated by:`);
  console.log(`  satisfaction:    ${byTermination.satisfaction}`);
  console.log(`  max_turns:       ${byTermination.max_turns}`);
  console.log(`  error:           ${byTermination.error}`);

  console.log("\nPer-simulation breakdown:\n");
  console.log("  ID                                    | Turns | Duration | Ended By");
  console.log("  " + "-".repeat(78));

  for (const t of traces) {
    const id = t.profile.id.padEnd(39);
    const turns = String(t.total_turns).padStart(5);
    const dur = `${(t.duration_ms / 1000).toFixed(1)}s`.padStart(8);
    const ended = t.terminated_by;
    console.log(`  ${id} | ${turns} | ${dur} | ${ended}`);
  }
}

async function main() {
  const { profiles: profileFilter, batchSize, maxTurns } = parseArgs();

  const allProfiles: SimProfile[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, "profiles.json"), "utf-8")
  );

  const profiles =
    profileFilter === "all"
      ? allProfiles
      : allProfiles.filter((p) => profileFilter.includes(p.id));

  if (profiles.length === 0) {
    console.error("No matching profiles found.");
    process.exit(1);
  }

  console.log(`Design God Simulator`);
  console.log(`Server:     ${CONFIG.serverUrl}`);
  console.log(`Profiles:   ${profiles.length}`);
  console.log(`Batch size: ${batchSize}`);
  console.log(`Max turns:  ${maxTurns}`);

  // Verify server is reachable
  try {
    await fetch(`${CONFIG.serverUrl}/api/skills`, { signal: AbortSignal.timeout(3000) });
  } catch {
    console.error(`\nCannot reach Design God server at ${CONFIG.serverUrl}`);
    console.error("Make sure the server is running: npm run dev:server");
    process.exit(1);
  }

  const traces = await runBatch(profiles, batchSize, maxTurns, CONFIG.serverUrl);

  // Write results
  const outDir = path.join(__dirname, "results");
  fs.mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `run-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(traces, null, 2));

  printSummary(traces);
  console.log(`\nFull traces written to: ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

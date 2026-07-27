// latencyBenchmark.js
//
// Run from ai-ticket-assistant/ with: node latencyBenchmark.js
//
// Times each pipeline stage in isolation, N times, and reports mean/median/P95 per
// stage. Use this for your own engineering reference (and to cite real, measured
// numbers) — not an estimate, actual wall-clock timing on your machine/environment.

import "dotenv/config";
import mongoose from "mongoose";
import Ticket from "./models/ticket.js";
import { embedText, getEmbedder } from "./utils/ai.js";
import classifyTicket from "./utils/ai.js";
import { findSimilarTickets, ensureCollection } from "./utils/rag.js";
import { generateResponse } from "./utils/llmService.js";

const RUNS = 15; // per stage — keep modest, this makes real calls (embedding/LLM)

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { mean, median, p95, min: sorted[0], max: sorted[sorted.length - 1] };
}

function printStage(name, times, note) {
  const s = stats(times);
  console.log(`\n${name}${note ? " (" + note + ")" : ""}`);
  console.log(`  mean: ${s.mean.toFixed(0)}ms | median: ${s.median.toFixed(0)}ms | p95: ${s.p95.toFixed(0)}ms | min: ${s.min.toFixed(0)}ms | max: ${s.max.toFixed(0)}ms`);
}

async function timeIt(fn) {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.");

  const sample = await Ticket.findOne({ description: { $exists: true } }).lean();
  if (!sample) {
    console.log("No tickets found to use as sample text — create at least one ticket first.");
    await mongoose.disconnect();
    return;
  }
  const text = `${sample.title} ${sample.description}`;
  console.log(`Using sample ticket text (truncated): "${text.slice(0, 80)}..."\n`);

  // Warm up models once so cold-start cost isn't mixed into the per-call numbers below.
  console.log("Warming up models (excluded from timings)...");
  await getEmbedder();
  await ensureCollection();
  await classifyTicket({ title: sample.title, description: sample.description });
  console.log("Warm-up complete.\n");

  console.log(`Running ${RUNS} iterations per stage...`);

  const embedTimes = [];
  for (let i = 0; i < RUNS; i++) {
    embedTimes.push(await timeIt(() => embedText(text)));
  }
  printStage("Embedding (embedText)", embedTimes, "warm, per call");

  const classifyTimes = [];
  for (let i = 0; i < RUNS; i++) {
    classifyTimes.push(await timeIt(() => classifyTicket({ title: sample.title, description: sample.description })));
  }
  printStage("Classification (classifyTicket)", classifyTimes, "zero-shot + priority model, warm");

  const searchTimes = [];
  for (let i = 0; i < RUNS; i++) {
    searchTimes.push(await timeIt(() => findSimilarTickets(text, 3)));
  }
  printStage("Vector search (findSimilarTickets)", searchTimes, "includes embedding + Qdrant round trip");

  console.log("\nRunning LLM generation timing (fewer iterations — this one is slow)...");
  const llmTimes = [];
  const LLM_RUNS = 5;
  for (let i = 0; i < LLM_RUNS; i++) {
    const t = await timeIt(() => generateResponse(text, null, 0));
    llmTimes.push(t);
  }
  printStage("LLM generation (generateResponse, cold context)", llmTimes, `${LLM_RUNS} runs, Ollama`);

  console.log("\n=== Summary for your own reference ===");
  console.log("These are real, measured numbers from this run on this machine/environment.");
  console.log("Re-run a few times across different days/loads before treating any single number as stable.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});

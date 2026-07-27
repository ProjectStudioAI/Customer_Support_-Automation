// thresholdCalibrationFromDataset.js
//
// Run from ai-ticket-assistant/ with: node thresholdCalibrationFromDataset.js
// Requires: npm install xlsx   (one-time, reads both .csv and .xlsx)
//
// TECHNIQUE — three pair groups, derived from your real dataset wherever possible:
//
//   - POSITIVES (true duplicates): each sampled ticket is paraphrased via the local
//     LLM, then compared to its own original. A paraphrase is, by construction, the
//     same underlying issue in different words. Used directly (not as a fallback)
//     because this dataset's tickets are almost all unique — shared-response
//     duplicate grouping would find too few real pairs to be useful.
//
//   - MIDDLE (related, not duplicate): pairs of rows that share BOTH department AND
//     ticketType but have DIFFERENT resolution text — same domain, same kind of
//     issue, different specific problem. Falls back to department-only matching if
//     not enough rows satisfy the stricter combined match.
//
//   - NEGATIVES (unrelated): pairs of rows with a DIFFERENT department (or, if
//     department is unavailable, fully random pairs).
//
// department / ticketType are read from your sheet if present; if missing, they are
// computed on the fly via your existing local classifier (classifyTicket) — no
// external API calls, same model your live app already uses.
//
// CONFIGURE THESE to match your actual spreadsheet's column headers:
const DATASET_PATH = "./data/dataset.csv"; // <-- change to your file's path (.csv or .xlsx)
const COLUMN_TITLE = "title";
const COLUMN_DESCRIPTION = "description"; // set to null if your sheet has no separate description column
const COLUMN_RESPONSE = "response";
const COLUMN_DEPARTMENT = "department";     // set to null if your sheet has no department column
const COLUMN_TICKET_TYPE = "ticketType";    // set to null if your sheet has no ticketType column
const SAMPLE_SIZE = 200; // max rows to load from the sheet

import "dotenv/config";
import XLSX from "xlsx";
import { embedText } from "./utils/ai.js";
import classifyTicket from "./utils/ai.js";
import { generateResponse } from "./utils/llmService.js";

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function summarize(label, scores) {
  if (scores.length === 0) {
    console.log(`${label} — no pairs generated (not enough data)`);
    return;
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`${label} — n=${scores.length}, mean: ${mean.toFixed(3)}, min: ${Math.min(...scores).toFixed(3)}, max: ${Math.max(...scores).toFixed(3)}`);
}

function sweepBoundary(name, highGroup, lowGroup, precisionTarget) {
  console.log(`\n--- ${name} ---`);
  console.log("threshold | precision | recall");
  console.log("----------|-----------|-------");

  let suggested = null;
  for (let t = 0.5; t <= 0.98; t += 0.02) {
    t = Number(t.toFixed(2));
    const tp = highGroup.filter((s) => s >= t).length;
    const fn = highGroup.length - tp;
    const fp = lowGroup.filter((s) => s >= t).length;
    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = highGroup.length === 0 ? 0 : tp / (tp + fn);

    if (precision >= precisionTarget && suggested === null) suggested = t;

    console.log(`${t.toFixed(2)}      | ${precision.toFixed(3)}     | ${recall.toFixed(3)}`);
  }

  console.log(`Suggested cutoff (precision >= ${precisionTarget}): ${suggested ?? "not reached in range 0.5-0.98"}`);
  return suggested;
}

async function paraphrase(text) {
  const prompt = `Rewrite the following in different words, keeping the exact same meaning. Only output the rewritten text, nothing else.\n\n${text}`;
  const result = await generateResponse(prompt, null, 0);
  return result ? result.trim() : null;
}

function textOf(row) {
  const desc = COLUMN_DESCRIPTION ? (row[COLUMN_DESCRIPTION] || "") : "";
  return `${row[COLUMN_TITLE] || ""} ${desc}`.trim();
}

async function main() {
  console.log(`Reading dataset from ${DATASET_PATH} ...`);
  const workbook = XLSX.readFile(DATASET_PATH);
  const sheetName = workbook.SheetNames[0];
  let rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

  if (rows.length === 0) {
    console.error("No rows found in the sheet — check DATASET_PATH and column names at the top of this file.");
    process.exit(1);
  }

  rows = rows.slice(0, SAMPLE_SIZE).filter((r) => r[COLUMN_TITLE] && r[COLUMN_RESPONSE]);
  console.log(`Loaded ${rows.length} usable rows (with title + response present).\n`);

  // Fill in department/ticketType via the local classifier if the sheet doesn't have them.
  const hasDept = COLUMN_DEPARTMENT && rows.some((r) => r[COLUMN_DEPARTMENT]);
  const hasType = COLUMN_TICKET_TYPE && rows.some((r) => r[COLUMN_TICKET_TYPE]);

  if (!hasDept || !hasType) {
    console.log("department/ticketType not fully present in the sheet — classifying missing rows locally (this uses your existing zero-shot classifier, no external calls)...");
    for (const r of rows) {
      if (!hasDept || !r[COLUMN_DEPARTMENT] || !hasType || !r[COLUMN_TICKET_TYPE]) {
        const result = await classifyTicket({ title: r[COLUMN_TITLE], description: COLUMN_DESCRIPTION ? r[COLUMN_DESCRIPTION] || "" : "" });
        if (!hasDept || !r[COLUMN_DEPARTMENT]) r.__department = result.department;
        if (!hasType || !r[COLUMN_TICKET_TYPE]) r.__ticketType = result.ticketType;
      }
    }
  }
  const deptOf = (r) => r[COLUMN_DEPARTMENT] || r.__department || "Unclassified";
  const typeOf = (r) => r[COLUMN_TICKET_TYPE] || r.__ticketType || "Request";

  // --- POSITIVES: paraphrase every sampled ticket (dataset has near-unique tickets,
  // so shared-response duplicate grouping would find almost nothing real to use) ---
  const MAX_POSITIVE_PAIRS = 40; // number of tickets to paraphrase — each is one LLM call
  console.log(`\nGenerating paraphrase pairs for up to ${MAX_POSITIVE_PAIRS} tickets (positives)...`);
  const positives = [];
  const positiveSample = shuffle(rows).slice(0, MAX_POSITIVE_PAIRS);
  for (const r of positiveSample) {
    const original = textOf(r);
    const rewritten = await paraphrase(original);
    if (!rewritten) continue;
    const [vecA, vecB] = await Promise.all([embedText(original), embedText(rewritten)]);
    positives.push(cosineSim(vecA, vecB));
  }
  console.log(`  -> ${positives.length} positive pairs scored.`);

  // --- MIDDLE: same department AND ticketType, different response ---
  console.log("\nBuilding middle pairs (same department + ticketType, different resolution)...");
  const strictGroups = {};
  for (const r of rows) {
    const key = `${deptOf(r)}|||${typeOf(r)}`;
    if (!strictGroups[key]) strictGroups[key] = [];
    strictGroups[key].push(r);
  }

  let middle = [];
  const MAX_MIDDLE_PAIRS = 60;
  for (const key of Object.keys(strictGroups)) {
    const group = shuffle(strictGroups[key]);
    for (let i = 0; i < group.length - 1 && middle.length < MAX_MIDDLE_PAIRS; i += 2) {
      if (String(group[i][COLUMN_RESPONSE]).trim() === String(group[i + 1][COLUMN_RESPONSE]).trim()) continue; // skip accidental duplicates
      const [vecA, vecB] = await Promise.all([embedText(textOf(group[i])), embedText(textOf(group[i + 1]))]);
      middle.push(cosineSim(vecA, vecB));
    }
  }

  if (middle.length < 10) {
    console.log(`  -> Only ${middle.length} pairs from strict (department+ticketType) match — falling back to department-only matching...`);
    const deptGroups = {};
    for (const r of rows) {
      const key = deptOf(r);
      if (!deptGroups[key]) deptGroups[key] = [];
      deptGroups[key].push(r);
    }
    middle = [];
    for (const key of Object.keys(deptGroups)) {
      const group = shuffle(deptGroups[key]);
      for (let i = 0; i < group.length - 1 && middle.length < MAX_MIDDLE_PAIRS; i += 2) {
        if (String(group[i][COLUMN_RESPONSE]).trim() === String(group[i + 1][COLUMN_RESPONSE]).trim()) continue;
        const [vecA, vecB] = await Promise.all([embedText(textOf(group[i])), embedText(textOf(group[i + 1]))]);
        middle.push(cosineSim(vecA, vecB));
      }
    }
  }
  console.log(`  -> ${middle.length} middle pairs.`);

  // --- NEGATIVES: different department ---
  console.log("\nBuilding negative pairs (different department)...");
  const negatives = [];
  const shuffledRows = shuffle(rows);
  for (let i = 0; i < shuffledRows.length - 1 && negatives.length < 60; i++) {
    const a = shuffledRows[i];
    const b = shuffledRows.find((x, idx) => idx > i && deptOf(x) !== deptOf(a));
    if (!b) continue;
    const [vecA, vecB] = await Promise.all([embedText(textOf(a)), embedText(textOf(b))]);
    negatives.push(cosineSim(vecA, vecB));
  }
  console.log(`  -> ${negatives.length} negative pairs.`);

  console.log("\n=== Score distributions ===");
  summarize("Positives (LLM paraphrase pairs)", positives);
  summarize("Middle (department+ticketType match, different resolution)", middle);
  summarize("Negatives (different department)", negatives);

  const duplicateCutoff = sweepBoundary("Duplicate boundary (positives vs middle)", positives, middle, 0.97);
  const coldCutoff = sweepBoundary("Cold boundary (middle vs negatives)", middle, negatives, 0.85);

  console.log("\n=== Result ===");
  console.log(`Suggested DUPLICATE tier cutoff: ${duplicateCutoff ?? "not reached — see table above"}`);
  console.log(`Suggested COLD tier cutoff (below this = cold, above = augmented): ${coldCutoff ?? "not reached — see table above"}`);
  console.log("\nCaveats:");
  console.log("- Positives are LLM-generated paraphrases, not human-confirmed duplicates — an easier match than true real-world near-duplicates.");
  console.log("- department/ticketType classified on the fly (where missing) come from your existing zero-shot model — same accuracy characteristics as production.");
  console.log("- Treat results as a calibrated starting point, not a fully validated final answer.");
}

main().catch((err) => {
  console.error("Script failed:", err.message);
  process.exit(1);
});

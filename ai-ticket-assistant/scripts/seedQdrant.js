/**
 * ONE-TIME SCRIPT — seeds Open Ticket AI dataset CSV into Qdrant
 * Place CSV at: data/dataset.csv
 * CSV columns expected: title, description, response, type, queue, priority
 * Run: node scripts/seedQdrant.js
 */
import dotenv from "dotenv";
dotenv.config();

import { QdrantClient } from "@qdrant/js-client-rest";
import { pipeline } from "@xenova/transformers";
import fs from "fs";

const CSV_PATH = "./data/dataset.csv";
const COLLECTION = "tickets";
const VECTOR_SIZE = 384;
const BATCH_SIZE = 50;

const client = new QdrantClient({ url: process.env.QDRANT_URL || "http://localhost:6333", checkCompatibility: false });

async function seed() {
  console.log("Starting Qdrant seed...");

  try {
    await client.getCollection(COLLECTION);
    console.log("Collection exists");
  } catch {
    await client.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
    console.log("Collection created");
  }

  const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at ${CSV_PATH}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const lines = raw.split("\n").slice(1).filter(Boolean);
  console.log(`Seeding ${lines.length} rows...`);

  let batch = [];
  let count = 0;
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].match(/(".*?"|[^",\n]+|(?<=,)(?=,))/g) || [];
    const clean = (s) => (s || "").replace(/^"|"$/g, "").trim();

    const title = clean(cols[0]);
    const description = clean(cols[1]);
    const response = clean(cols[2]);

    if (!title || !description) { skipped++; continue; }

    try {
      const output = await embedder(`${title} ${description}`, { pooling: "mean", normalize: true });
      batch.push({
        id: i + 1,
        vector: Array.from(output.data),
        payload: { title, response: response || "", mongoId: null },
      });
    } catch { skipped++; continue; }

    if (batch.length >= BATCH_SIZE) {
      await client.upsert(COLLECTION, { points: batch });
      count += batch.length;
      console.log(`Progress: ${count}/${lines.length}`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await client.upsert(COLLECTION, { points: batch });
    count += batch.length;
  }

  console.log(`Done. Seeded: ${count}, Skipped: ${skipped}`);
}

seed().catch((err) => { console.error("Seed failed:", err); process.exit(1); });

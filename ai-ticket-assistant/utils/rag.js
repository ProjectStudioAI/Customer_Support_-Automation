import { QdrantClient } from "@qdrant/js-client-rest";
import { embedText } from "./ai.js";

const COLLECTION = "tickets";
const VECTOR_SIZE = 384;

const client = new QdrantClient({
  url: process.env.QDRANT_URL || "http://localhost:6333",
  checkCompatibility: false,
});

export async function ensureCollection() {
  try {
    await client.getCollection(COLLECTION);
  } catch {
    await client.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
    console.log(`Created Qdrant collection: ${COLLECTION}`);
  }
}

export async function findSimilarTickets(text, topK = 3) {
  try {
    const vector = await embedText(text);
    const results = await client.search(COLLECTION, {
      vector,
      limit: topK,
      with_payload: true,
      score_threshold: 0.5,
    });

    return results.map((r) => ({
      title: r.payload.title || "",
      response: r.payload.response || "",
      score: parseFloat(r.score.toFixed(3)),
      isDuplicate: r.score > 0.92,
    }));
  } catch (err) {
    console.error("RAG search failed:", err.message);
    return [];
  }
}

export async function storeResolvedTicket(ticket) {
  try {
    if (!ticket.resolutionNote) return;

    const text = `${ticket.title} ${ticket.description}`;
    const vector = await embedText(text);
    const numericId = mongoIdToNumeric(ticket._id.toString());

    await client.upsert(COLLECTION, {
      points: [
        {
          id: numericId,
          vector,
          payload: {
            mongoId: ticket._id.toString(),
            title: ticket.title,
            response: ticket.resolutionNote,
            department: ticket.department || null,
            ticketType: ticket.ticketType || null,
          },
        },
      ],
    });

    console.log(`Stored resolved ticket ${ticket._id} in Qdrant`);
  } catch (err) {
    console.error("storeResolvedTicket failed:", err.message);
  }
}

function mongoIdToNumeric(mongoId) {
  const hex = mongoId.slice(-12);
  return parseInt(hex, 16) % Number.MAX_SAFE_INTEGER;
}

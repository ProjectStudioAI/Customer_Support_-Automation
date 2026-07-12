/**
 * ONE-TIME SCRIPT — prints AI metrics summary for tickets
 * Run: node scripts/aiMetricsReport.js
 */
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Ticket from "../models/ticket.js";

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("Missing MONGO_URI in .env");
  process.exit(1);
}

async function main() {
  await mongoose.connect(MONGO_URI);

  try {
    const [totals] = await Ticket.aggregate([
      {
        $group: {
          _id: null,
          totalTickets: { $sum: 1 },
          avgTopMatchScore: { $avg: "$aiMetrics.topMatchScore" },
          llmCalledCount: {
            $sum: {
              $cond: [{ $eq: ["$aiMetrics.llmCalled", true] }, 1, 0],
            },
          },
          llmFailedCount: {
            $sum: {
              $cond: [{ $eq: ["$aiMetrics.llmFailed", true] }, 1, 0],
            },
          },
          avgLlmLatencyMs: { $avg: "$aiMetrics.llmLatencyMs" },
        },
      },
    ]);

    const tierRows = await Ticket.aggregate([
      {
        $project: {
          tier: { $ifNull: ["$aiMetrics.tier", "none"] },
        },
      },
      {
        $group: {
          _id: "$tier",
          count: { $sum: 1 },
        },
      },
    ]);

    const totalTickets = totals?.totalTickets || 0;
    const tierCounts = Object.fromEntries(
      ["duplicate", "augmented", "cold", "none"].map((tier) => [tier, 0])
    );

    for (const row of tierRows) {
      tierCounts[row._id] = row.count;
    }

    console.log("AI Metrics Summary");
    console.table(
      ["duplicate", "augmented", "cold", "none"].map((tier) => ({
        tier,
        count: tierCounts[tier],
        percent: totalTickets ? `${((tierCounts[tier] / totalTickets) * 100).toFixed(1)}%` : "0.0%",
      }))
    );

    console.log("Overall Metrics");
    console.table([
      {
        metric: "averageTopMatchScore",
        value: totals?.avgTopMatchScore ?? null,
      },
      {
        metric: "llmFailureRate",
        value: totals?.llmCalledCount
          ? `${((totals.llmFailedCount / totals.llmCalledCount) * 100).toFixed(1)}%`
          : "0.0%",
      },
      {
        metric: "averageLlmLatencyMs",
        value: totals?.avgLlmLatencyMs ?? null,
      },
    ]);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("aiMetricsReport failed:", error);
  process.exit(1);
});
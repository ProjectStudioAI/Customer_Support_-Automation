import mongoose from "mongoose";

const ticketSchema = new mongoose.Schema({
  title: String,
  description: String,
  status: {
    type: String,
    enum: ["TODO", "IN_PROGRESS", "RESOLVED"],
    default: "TODO",
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  priority: {
    type: String,
    enum: ["low", "medium", "high"],
    default: "low",
  },
  ticketsAssignedCount: { type: Number, default: 0 },
  deadline: Date,

  // Kept for backward compat with existing data — no longer populated by AI
  helpfulNotes: String,
  relatedSkills: [String],

  // NEW — AI classification outputs (replaces Gemini free-form output)
  ticketType: { type: String, default: null },
  department: { type: String, default: null },
  similarTickets: { type: Array, default: [] },

  // NEW — moderator fills when resolving ticket
  resolutionNote: { type: String, default: null },
  resolvedAt: { type: Date, default: null },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },

  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Ticket", ticketSchema);

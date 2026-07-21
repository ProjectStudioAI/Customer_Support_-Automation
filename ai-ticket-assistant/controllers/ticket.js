import { inngest } from "../inngest/client.js";
import Ticket from "../models/ticket.js";
import User from "../models/user.js";
import mongoose from "mongoose";

export const createTicket = async (req, res) => {
  // console.log("🚀 TICKET FUNCTION STARTED");
  try {
    const { title, description } = req.body;
    if (!title || !description) {
      return res
        .status(400)
        .json({ message: "Title and description are required" });
    }
    const newTicket = await Ticket.create({
      title,
      description,
      createdBy: req.user._id.toString(),
    });
    // Keep ticket creation successful even if background processing is temporarily unavailable.
    try {
      await inngest.send({
        name: "ticket/created",
        data: {
          ticketId: newTicket._id.toString(),
          title,
          description,
          createdBy: req.user._id.toString(),
        },
      });
    } catch (eventError) {
      console.error("Failed to queue ticket processing event:", eventError.message);
    }
    return res.status(201).json({
      message: "Ticket created and processing started",
      ticket: newTicket,
    });
  } catch (error) {
    console.error("Error creating ticket", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getTickets = async (req, res) => {
  try {
    const user = req.user;
    let tickets = [];

    if (user.role === "admin") {
      tickets = await Ticket.find({})
        .select("title description status createdAt priority assignedTo ticketType department helpfulNotes generatedResponse resolutionNote resolvedAt")
        .populate("assignedTo", ["email", "_id"])
        .sort({ createdAt: -1 });
    } else if (user.role === "moderator") {
      tickets = await Ticket.find({
        $or: [
          { assignedTo: user._id },
          { assignedTo: null, department: user.department },
        ],
      })
        .select("title description status createdAt priority assignedTo ticketType department helpfulNotes generatedResponse resolutionNote resolvedAt")
        .populate("assignedTo", ["email", "_id"])
        .sort({ createdAt: -1 });
    } else {
      tickets = await Ticket.find({ createdBy: user._id })
        .select("title description status createdAt priority")
        .sort({ createdAt: -1 });
    }
    return res.status(200).json(tickets);
  } catch (error) {
    console.error("Error fetching tickets", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const getTicket = async (req, res) => {
  try {
    const user = req.user;
    const { id } = req.params;

    // console.log("Request to fetch ticket id:", id, "by user:", user?._id);

    if (!mongoose.isValidObjectId(id)) {
      console.warn("Invalid ticket id format:", id);
      return res.status(400).json({ message: "Invalid ticket id" });
    }

    // if (user.role !== "user") {
    //   ticket = await Ticket.findById(id).populate("assignedTo", [
    //     "email",
    //     "_id",
    //   ]);
    // } else {
    //   ticket = await Ticket.findOne({
    //     createdBy: user._id,
    //     _id: id,
    //   }).select("title description status createdAt");
    // }

    let ticket;

    if (user.role === "admin") {
      ticket = await Ticket.findById(id)
        .select("title description status createdAt priority assignedTo ticketType department helpfulNotes generatedResponse resolutionNote resolvedAt createdBy")
        .populate("assignedTo", ["email", "_id"])
        .populate("createdBy", ["email", "_id"]);
    } else if (user.role === "moderator") {
      ticket = await Ticket.findOne({
        _id: id,
        $or: [{ assignedTo: user._id }, { assignedTo: null, department: user.department }],
      })
        .select("title description status createdAt priority assignedTo ticketType department helpfulNotes generatedResponse resolutionNote resolvedAt createdBy")
        .populate("assignedTo", ["email", "_id"])
        .populate("createdBy", ["email", "_id"]);
    } else {
      ticket = await Ticket.findOne({
        createdBy: user._id,
        _id: id,
      })
        .select("title description status createdAt priority assignedTo ticketType department generatedResponse resolvedAt")
        .populate("assignedTo", ["email", "_id"]);
    }

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }
    return res.status(200).json({ ticket });
  } catch (error) {
    console.error("Error fetching ticket", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const resolveTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { resolutionNote } = req.body;
    const user = req.user;

    if (user.role === "user") {
      return res.status(403).json({ message: "Not authorized to resolve tickets" });
    }

    if (!resolutionNote || resolutionNote.trim().length < 10) {
      return res.status(400).json({ message: "Resolution note required (min 10 characters)" });
    }

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid ticket id" });
    }

    const existingTicket = await Ticket.findById(id);
    if (!existingTicket) {
      return res.status(404).json({ message: "Ticket not found" });
    }
    if (existingTicket.status === "RESOLVED") {
      return res.status(400).json({ message: "This ticket is already resolved and cannot be modified. Please create a new ticket." });
    }

    const ticket = await Ticket.findByIdAndUpdate(
      id,
      {
        status: "RESOLVED",
        resolutionNote: resolutionNote.trim(),
        resolvedAt: new Date(),
        resolvedBy: user._id,
      },
      { new: true }
    ).populate("assignedTo", ["email", "_id"]);

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    await inngest.send({
      name: "ticket/resolved",
      data: { ticketId: ticket._id.toString() },
    });

    return res.status(200).json({ message: "Ticket resolved successfully", ticket });
  } catch (error) {
    console.error("Error resolving ticket:", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const assignTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { moderatorId } = req.body;
    const user = req.user;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid ticket id" });
    }

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (user.role === "user") {
      return res.status(403).json({ message: "Not authorized to assign tickets" });
    }

    if (user.role === "moderator") {
      if (ticket.assignedTo) {
        return res.status(400).json({ message: "This ticket is already assigned" });
      }

      const updatedTicket = await Ticket.findByIdAndUpdate(
        id,
        { assignedTo: user._id },
        { new: true }
      ).populate("assignedTo", ["email", "_id"]);

      await User.updateOne({ _id: user._id }, { $inc: { ticketsAssignedCount: 1 } });

      return res.status(200).json({ message: "Ticket assigned successfully", ticket: updatedTicket });
    }

    if (user.role === "admin") {
      if (!moderatorId) {
        return res.status(400).json({ message: "moderatorId is required" });
      }
      if (!mongoose.isValidObjectId(moderatorId)) {
        return res.status(404).json({ message: "User not found" });
      }

      const assignee = await User.findById(moderatorId).select("role");
      if (!assignee) {
        return res.status(404).json({ message: "User not found" });
      }
      if (!["moderator", "admin"].includes(assignee.role)) {
        return res.status(400).json({ message: "User is not assignable" });
      }

      const previousAssigneeId = ticket.assignedTo ? ticket.assignedTo.toString() : null;
      const nextAssigneeId = moderatorId.toString();

      if (previousAssigneeId && previousAssigneeId !== nextAssigneeId) {
        await User.updateOne({ _id: previousAssigneeId }, { $inc: { ticketsAssignedCount: -1 } });
        await User.updateOne({ _id: nextAssigneeId }, { $inc: { ticketsAssignedCount: 1 } });
      } else if (!previousAssigneeId) {
        await User.updateOne({ _id: nextAssigneeId }, { $inc: { ticketsAssignedCount: 1 } });
      }

      const updatedTicket = await Ticket.findByIdAndUpdate(
        id,
        { assignedTo: moderatorId },
        { new: true }
      ).populate("assignedTo", ["email", "_id"]);

      return res.status(200).json({ message: "Ticket assigned successfully", ticket: updatedTicket });
    }

    return res.status(403).json({ message: "Not authorized to assign tickets" });
  } catch (error) {
    console.error("Error assigning ticket:", error.message);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

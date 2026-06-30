import { inngest } from "../inngest/client.js";
import Ticket from "../models/ticket.js";
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
    // console.log("🔥 SENDING EVENT");
    const result=await inngest.send({
      name: "ticket/created",
      data: {
        ticketId: (await newTicket)._id.toString(),
        title,
        description,
        createdBy: req.user._id.toString(),
      },
    });
    // console.log("🔥 EVENT RESULT:", result);
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
      if (user.role !== "user") {
      tickets = await Ticket.find({})
        .populate("assignedTo", ["email", "_id"])
        .sort({ createdAt: -1 });
    } else {
      tickets = await Ticket.find({ createdBy: user._id })
        .select("title description status createdAt")
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
    let ticket;
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

    if (user.role !== "user") {
    ticket = await Ticket.findById(id).populate("assignedTo", [
      "email",
      "_id",
    ]);
  } else {
    ticket = await Ticket.findOne({
      createdBy: user._id,
      _id: id,
    }).select("title description status createdAt priority assignedTo ticketType department similarTickets resolutionNote resolvedAt");
    // console.log("Logged-in User ID (req.user._id):", user._id.toString());
    // console.log("Ticket ID from params (id):", id);
  }

    // console.log("Ticket lookup result for id", id, ":", !!ticket);

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

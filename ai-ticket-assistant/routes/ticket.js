import express from "express";
import { authenticate, requireVerified } from "../middlewares/auth.js";
import { assignTicket, createTicket, getTicket, getTickets, resolveTicket } from "../controllers/ticket.js";

const router = express.Router();

router.get("/", authenticate, getTickets);
router.get("/:id", authenticate, getTicket);
router.post("/", authenticate, requireVerified, createTicket);
router.patch("/:id/resolve", authenticate, requireVerified, resolveTicket);
router.patch("/:id/assign", authenticate, assignTicket);

export default router;

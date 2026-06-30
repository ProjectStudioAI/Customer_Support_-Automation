import { inngest } from "../client.js";
import Ticket from "../../models/ticket.js";
import { NonRetriableError } from "inngest";
import { storeResolvedTicket } from "../../utils/rag.js";

export const onTicketResolved = inngest.createFunction(
  {
    id: "on-ticket-resolved",
    retries: 2,
    triggers: [{ event: "ticket/resolved" }],
  },
  async ({ event, step }) => {
    const { ticketId } = event.data;

    const ticket = await step.run("fetch-resolved-ticket", async () => {
      const t = await Ticket.findById(ticketId).lean();
      if (!t) throw new NonRetriableError("Ticket not found");
      if (!t.resolutionNote) throw new NonRetriableError("No resolution note — skipping");
      return t;
    });

    await step.run("store-in-qdrant", async () => {
      await storeResolvedTicket(ticket);
    });

    return { success: true };
  }
);

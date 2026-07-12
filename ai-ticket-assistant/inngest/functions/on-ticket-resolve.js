import { inngest } from "../client.js";
import Ticket from "../../models/ticket.js";
import User from "../../models/user.js";
import { NonRetriableError } from "inngest";
import { storeResolvedTicket } from "../../utils/rag.js";
import { sendMail } from "../../utils/mailer.js";

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

    await step.run("send-resolution-email", async () => {
      try {
        const creator = await User.findById(ticket.createdBy).lean();
        if (!creator?.email) return;

        const resolutionEmail = `
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body { font-family: 'Arial', sans-serif; background-color: #f5f5f5; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { padding: 20px; line-height: 1.6; }
                .ticket-info { background: #f0f0f0; padding: 15px; border-radius: 8px; margin: 15px 0; }
                .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>Ticket Resolved ✓</h1>
                </div>
                <div class="content">
                  <p>Hi ${creator.email.split("@")[0]},</p>
                  <p>Your ticket has been resolved. If the issue persists or you need further help, please create a new ticket.</p>
                  <div class="ticket-info">
                    <strong>Ticket Details:</strong><br>
                    <strong>ID:</strong> ${ticket._id.toString().slice(0, 8).toUpperCase()}<br>
                    <strong>Title:</strong> ${ticket.title}<br>
                    <strong>Status:</strong> Resolved<br>
                    <strong>Resolved:</strong> ${new Date().toLocaleDateString()}
                  </div>
                  <p>Best regards,<br>AI Ticket Assistant Team</p>
                </div>
                <div class="footer">
                  <p>&copy; 2024 AI Ticket Assistant. All rights reserved.</p>
                </div>
              </div>
            </body>
          </html>
        `;

        await sendMail(
          creator.email,
          `Ticket Resolved - #${ticket._id.toString().slice(0, 8).toUpperCase()}`,
          resolutionEmail
        );
      } catch (error) {
        console.error("❌ Failed to send resolution email:", error.message);
      }
    });

    return { success: true };
  }
);

import { inngest } from "../client.js";
import Ticket from "../../models/ticket.js";
import User from "../../models/user.js";
import { NonRetriableError } from "inngest";
import { sendMail } from "../../utils/mailer.js";
import classifyTicket from "../../utils/ai.js";
import { findSimilarTickets, ensureCollection } from "../../utils/rag.js";
export const onTicketCreated = inngest.createFunction(
  { id: "on-ticket-created", 
    retries: 2,
    triggers: [{ event: "ticket/created" }], 
},
  
  async ({ event, step }) => {
    console.log("🚀 TICKET FUNCTION STARTED");
    console.log("FULL EVENT:", JSON.stringify(event, null, 2));
    try {
      const { ticketId, createdBy } = event.data;
      console.log("ticketId:", ticketId);
      console.log("createdBy:", createdBy);
      // 1. FETCH TICKET
      const ticket = await step.run("fetch-ticket", async () => {
        const ticketObject = await Ticket.findById(ticketId).lean();
        if (!ticketObject) {
          throw new NonRetriableError("Ticket not found");
        }
        return ticketObject;
      });
      console.log("TICKET:", ticket);
      // 2. FETCH TICKET CREATOR (for confirmation email)
      const ticketCreator = await step.run("fetch-creator", async () => {
        try {
          const creator = await User.findById(createdBy);
          return creator;
        } catch (error) {
          console.error(`Failed to fetch creator ${createdBy}:`, error.message);
          return null;
        }
      });
      console.log("TICKET CREATOR:", ticketCreator);
      console.log("EMAIL:", ticketCreator?.email);

      // 3. SEND CONFIRMATION EMAIL TO TICKET CREATOR
      console.log("ENTERED EMAIL STEP");
      await step.run("send-confirmation-email", async () => {
        if (ticketCreator) {
          try {
            const confirmationEmail = `
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
                      <h1>Ticket Received ✓</h1>
                    </div>
                    <div class="content">
                      <p>Hi ${ticketCreator.email.split("@")[0]},</p>
                      <p>Thank you for submitting your support ticket. We've received it and our team is already working on it.</p>
                      <div class="ticket-info">
                        <strong>Ticket Details:</strong><br>
                        <strong>ID:</strong> ${ticket._id.toString().slice(0, 8).toUpperCase()}<br>
                        <strong>Title:</strong> ${ticket.title}<br>
                        <strong>Status:</strong> Under Review<br>
                        <strong>Created:</strong> ${new Date(ticket.createdAt).toLocaleDateString()}
                      </div>
                      <p>Our support team will review your ticket and get back to you shortly.</p>
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
              ticketCreator.email,
              `Ticket Confirmed - #${ticket._id.toString().slice(0, 8).toUpperCase()}`,
              confirmationEmail
            );
            console.log(`✅ Confirmation email sent to ${ticketCreator.email}`);
          } catch (error) {
            console.error(`❌ Failed to send confirmation email:`, error.message);
            // Don't throw - email failure should not break ticket processing
          }
        }
      });

      // 4. AI PROCESSING STEP
      const aiResult = await step.run("ai-classify", async () => {
        try {
          await ensureCollection();
          const text = `${ticket.title} ${ticket.description}`;
          const [classification, similarTickets] = await Promise.all([
            classifyTicket(ticket),
            findSimilarTickets(text),
          ]);
          const isDuplicate = similarTickets.some((t) => t.isDuplicate);
          if (isDuplicate) console.log(`Possible duplicate detected: ${ticketId}`);
          return { ...classification, similarTickets, isDuplicate };
        } catch (err) {
          console.error("ai-classify failed:", err.message);
          return { ticketType: "Request", department: null, priority: "medium", similarTickets: [], isDuplicate: false };
        }
      });

      const ticketMongooseId = ticket._id.toString();

      // 5. UPDATE TICKET STATUS AND DATA FROM AI
      const department = await step.run("update-ticket-data", async () => {
        try {
          const updatedTicket = await Ticket.findByIdAndUpdate(
            ticketId,
            {
              status: "IN_PROGRESS",
              ticketType: aiResult.ticketType,
              department: aiResult.department,
              priority: aiResult.priority,
              similarTickets: aiResult.similarTickets,
              relatedSkills: [],
            },
            { new: true, runValidators: true }
          );
          if (!updatedTicket) throw new NonRetriableError(`Ticket not found: ${ticketId}`);
          console.log(`Ticket ${ticketId} updated — Type: ${aiResult.ticketType}, Dept: ${aiResult.department}, Priority: ${aiResult.priority}`);
          return aiResult.department;
        } catch (err) {
          console.error("update-ticket-data failed:", err.message);
          return null;
        }
      });

      // 6. ASSIGN MODERATOR
      const moderator = await step.run("assign-moderator", async () => {
        try {
          let user = null;

          if (department) {
            user = await User.findOne({ role: "moderator", department: department })
              .sort({ ticketsAssignedCount: 1 })
              .exec();
          }

          if (!user) {
            user = await User.findOne({ role: "moderator" })
              .sort({ ticketsAssignedCount: 1 })
              .exec();
          }

          if (!user) {
            user = await User.findOne({ role: "admin" });
          }

          if (user) {
            await Ticket.findByIdAndUpdate(ticketId, { assignedTo: user._id });
            await User.findByIdAndUpdate(user._id, { $inc: { ticketsAssignedCount: 1 } });
            console.log(`Assigned ${ticketId} to ${user.email}`);
          }

          return user;
        } catch (err) {
          console.error("assign-moderator failed:", err.message);
          return null;
        }
      });

      // 7. SEND NOTIFICATION EMAIL TO ASSIGNED MODERATOR
      await step.run("send-moderator-email", async () => {
        if (moderator) {
          try {
            const finalTicket = await Ticket.findById(ticketMongooseId);
            const moderatorEmail = `
              <!DOCTYPE html>
              <html>
                <head>
                  <style>
                    body { font-family: 'Arial', sans-serif; background-color: #f5f5f5; }
                    .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
                    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                    .content { padding: 20px; line-height: 1.6; }
                    .ticket-info { background: #f0f0f0; padding: 15px; border-radius: 8px; margin: 15px 0; }
                    .notes { background: #fff9e6; padding: 15px; border-left: 4px solid #ffc107; margin: 15px 0; border-radius: 4px; }
                    .priority { display: inline-block; padding: 5px 10px; border-radius: 4px; font-weight: bold; }
                    .priority-high { background: #ff6b6b; color: white; }
                    .priority-medium { background: #ffc107; color: black; }
                    .priority-low { background: #28a745; color: white; }
                    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px; }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="header">
                      <h1>New Ticket Assigned 📬</h1>
                    </div>
                    <div class="content">
                      <p>Hi ${moderator.email.split("@")[0]},</p>
                      <p>A new ticket has been assigned to you based on your expertise.</p>
                      <div class="ticket-info">
                        <strong>Ticket Details:</strong><br>
                        <strong>ID:</strong> ${finalTicket._id.toString().slice(0, 8).toUpperCase()}<br>
                        <strong>Title:</strong> ${finalTicket.title}<br>
                        <strong>Description:</strong> ${finalTicket.description.substring(0, 150)}${finalTicket.description.length > 150 ? "..." : ""}<br>
                        <strong>Priority:</strong> <span class="priority priority-${finalTicket.priority}">${finalTicket.priority?.toUpperCase() || "MEDIUM"}</span><br>
                        <strong>Created:</strong> ${new Date(finalTicket.createdAt).toLocaleDateString()}
                      </div>
                      ${aiResult.ticketType ? `<p><strong>Type:</strong> ${aiResult.ticketType}</p>` : ""}
                      ${aiResult.department ? `<p><strong>Department:</strong> ${aiResult.department}</p>` : ""}
                      ${aiResult.similarTickets && aiResult.similarTickets.length > 0
                        ? `<div class="notes"><strong>Similar past tickets:</strong><br>
                            ${aiResult.similarTickets.map((t, i) =>
                              `<p><strong>#${i+1}:</strong> ${t.title} (${Math.round(t.score*100)}% match)<br>
                              ${t.response ? `<em>${t.response.substring(0, 120)}...</em>` : ""}</p>`
                            ).join("")}
                          </div>`
                        : ""}
                      <p>Please review the ticket and respond to the customer as soon as possible.</p>
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
              moderator.email,
              `New Ticket Assigned - #${finalTicket._id.toString().slice(0, 8).toUpperCase()}`,
              moderatorEmail
            );
            console.log(
              `✅ Ticket assignment email sent to moderator ${moderator.email}`
            );
          } catch (error) {
            console.error(
              `❌ Failed to send moderator notification email:`,
              error.message
            );
            // Don't throw - email failure should not break ticket processing
          }
        }
      });

      // 8. SEND NOTIFICATION EMAIL TO ADMIN
      await step.run("send-admin-email", async () => {
        try {
          const admin = await User.findOne({ role: "admin" });
          if (admin) {
            const adminEmail = `
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
                      <h1>New Ticket Created 📋</h1>
                    </div>
                    <div class="content">
                      <p>Hi Admin,</p>
                      <p>A new support ticket has been created in the system.</p>
                      <div class="ticket-info">
                        <strong>Ticket Details:</strong><br>
                        <strong>ID:</strong> ${ticket._id.toString().slice(0, 8).toUpperCase()}<br>
                        <strong>Title:</strong> ${ticket.title}<br>
                        <strong>Created By:</strong> ${ticketCreator?.email || "Unknown"}<br>
                        <strong>Assigned To:</strong> ${moderator?.email || "Unassigned"}<br>
                        <strong>Status:</strong> In Progress<br>
                        <strong>Created:</strong> ${new Date(ticket.createdAt).toLocaleDateString()}
                      </div>
                      <p>Best regards,<br>AI Ticket Assistant System</p>
                    </div>
                    <div class="footer">
                      <p>&copy; 2024 AI Ticket Assistant. All rights reserved.</p>
                    </div>
                  </div>
                </body>
              </html>
            `;
            await sendMail(
              admin.email,
              `New Ticket Created - #${ticket._id.toString().slice(0, 8).toUpperCase()}`,
              adminEmail
            );
            console.log(`✅ Admin notification email sent to ${admin.email}`);
          }
        } catch (error) {
          console.error(
            `❌ Failed to send admin notification email:`,
            error.message
          );
          // Don't throw - email failure should not break ticket processing
        }
      });

      return { success: true };
    } catch (err) {
      console.error("❌ Error running ticket creation workflow:", err);
      return { success: false };
    }
  }
);

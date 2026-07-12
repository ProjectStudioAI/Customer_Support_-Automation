import { inngest } from "../client.js";
import Ticket from "../../models/ticket.js";
import User from "../../models/user.js";
import { NonRetriableError } from "inngest";
import { sendMail } from "../../utils/mailer.js";
import classifyTicket from "../../utils/ai.js";
import { findSimilarTickets, ensureCollection } from "../../utils/rag.js";
import { generateResponse } from "../../utils/llmService.js";
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

      // 3. AI PROCESSING STEP
      const aiResult = await step.run("ai-classify", async () => {
        try {
          await ensureCollection();
          const text = `${ticket.title} ${ticket.description}`;
          const [classification, similarTickets] = await Promise.all([
            classifyTicket(ticket),
            findSimilarTickets(text, 3),
          ]);
          const topMatch = similarTickets.all[0] || null;
          const topMatchScore = topMatch?.score ?? null;
          let tier = "cold";
          let helpfulNotes = null;
          let aiDraftResponse = null;
          let llmCalled = false;
          let llmLatencyMs = null;
          let llmFailed = false;

          if (topMatch && topMatch.score >= 0.92) {
            tier = "duplicate";
            helpfulNotes = topMatch.response || null;
            if (helpfulNotes) console.log(`Possible duplicate detected: ${ticketId}`);
          } else {
            tier = topMatch && topMatch.score >= 0.5 ? "augmented" : "cold";
            llmCalled = true;
            const startedAt = Date.now();
            try {
              const llmResponse = await generateResponse(
                text,
                tier === "augmented" ? topMatch.response : null,
                tier === "augmented" ? topMatch.score : 0
              );
              llmLatencyMs = Date.now() - startedAt;
              if (llmResponse) {
                aiDraftResponse = llmResponse;
              } else {
                llmFailed = true;
              }
            } catch (error) {
              llmLatencyMs = Date.now() - startedAt;
              llmFailed = true;
              console.error("generateResponse failed:", error.message);
            }
          }

          return {
            ...classification,
            similarTickets: similarTickets.all,
            humanSimilarTickets: similarTickets.humanResolved,
            generatedResponse: aiDraftResponse,
            aiDraftResponse,
            duplicateResponse: topMatch?.response || null,
            helpfulNotes,
            aiMetrics: {
              topMatchScore,
              tier,
              llmCalled,
              llmLatencyMs,
              llmFailed,
            },
            needsHumanReview: tier !== "duplicate" && !aiDraftResponse,
            isDuplicate: tier === "duplicate",
          };
        } catch (err) {
          console.error("ai-classify failed:", err.message);
          return {
            ticketType: "Request",
            department: "Unclassified",
            priority: "medium",
            similarTickets: [],
            humanSimilarTickets: [],
            generatedResponse: null,
            aiDraftResponse: null,
            helpfulNotes: null,
            aiMetrics: {
              topMatchScore: null,
              tier: "cold",
              llmCalled: true,
              llmLatencyMs: null,
              llmFailed: true,
            },
            needsHumanReview: true,
            isDuplicate: false,
          };
        }
      });

      const ticketMongooseId = ticket._id.toString();

      // 4. UPDATE TICKET STATUS AND DATA FROM AI
      const department = await step.run("update-ticket-data", async () => {
        try {
          const ticketHelpfulNotes = aiResult.aiMetrics?.tier === "duplicate" ? aiResult.helpfulNotes : null;

          const updatedTicket = await Ticket.findByIdAndUpdate(
            ticketId,
            {
              status: "IN_PROGRESS",
              ticketType: aiResult.ticketType,
              department: aiResult.department,
              priority: aiResult.priority,
              helpfulNotes: ticketHelpfulNotes,
              generatedResponse: aiResult.generatedResponse,
              aiDraftResponse: aiResult.aiDraftResponse,
              aiMetrics: aiResult.aiMetrics,
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

      // 5. SEND CONFIRMATION EMAIL TO TICKET CREATOR
      console.log("ENTERED EMAIL STEP");
      await step.run("send-confirmation-email", async () => {
        if (!ticketCreator) return;

        try {
          const tier = aiResult?.aiMetrics?.tier;
          const llmFailed = aiResult?.aiMetrics?.llmFailed;
          const responseContent =
            tier === "duplicate"
              ? aiResult?.duplicateResponse || aiResult?.helpfulNotes
              : tier === "augmented"
                ? aiResult?.aiDraftResponse
                : null;

          const responseSection = responseContent && tier !== "cold" && !llmFailed
            ? `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;margin:16px 0;">
                <strong style="color:#0369a1">Here's some initial guidance:</strong>
                <p style="color:#374151;margin-top:8px;">${responseContent}</p>
              </div>`
            : `<p style="color:#6b7280">Our team is reviewing your ticket and will update you shortly.</p>`;

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
                      <strong>Created:</strong> ${new Date(ticket.createdAt).toLocaleDateString()}<br>
                      <strong>Priority:</strong> ${aiResult?.priority || "Being assessed"}<br>
                      <strong>Department:</strong> ${aiResult?.department || "Being assessed"}
                    </div>
                    ${responseSection}
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
                      ${finalTicket.helpfulNotes
                        ? `<div class="notes"><strong>Helpful notes:</strong><br><pre style="white-space:pre-wrap;margin:0;">${finalTicket.helpfulNotes}</pre></div>`
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

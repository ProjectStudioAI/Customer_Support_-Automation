import { inngest } from "../client.js";
import User from "../../models/user.js";
import { NonRetriableError } from "inngest";
import { sendMail } from "../../utils/mailer.js";

export const onUserSignup = inngest.createFunction(
  { id: "on-user-signup", 
    retries: 2 ,
    triggers: [{ event: "user/signup" }],
  },
  async ({ event, step }) => {
    try {
      const { email } = event.data;
      const user = await step.run("get-user-email", async () => {
        const userObject = await User.findOne({ email });
        if (!userObject) {
          throw new NonRetriableError("User no longer exists in our database");
        }
        return userObject;
      });
      await step.run("send-welcome-email", async () => {
        try {
          const subject = `Welcome to AI Ticket Assistant`;
          const htmlMessage = `
            <!DOCTYPE html>
            <html>
              <head>
                <style>
                  body { font-family: 'Arial', sans-serif; background-color: #f5f5f5; }
                  .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
                  .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                  .content { padding: 20px; line-height: 1.6; }
                  .footer { text-align: center; color: #999; font-size: 12px; margin-top: 20px; border-top: 1px solid #eee; padding-top: 10px; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <h1>Welcome to AI Ticket Assistant!</h1>
                  </div>
                  <div class="content">
                    <p>Hi ${user.email.split("@")[0]},</p>
                    <p>Thank you for signing up! We're glad to have you onboard.</p>
                    <p>You can now log in and start managing your support tickets with our AI-powered system.</p>
                    <p>If you have any questions, feel free to reach out to our support team.</p>
                    <p>Best regards,<br>AI Ticket Assistant Team</p>
                  </div>
                  <div class="footer">
                    <p>&copy; 2024 AI Ticket Assistant. All rights reserved.</p>
                  </div>
                </div>
              </body>
            </html>
          `;
          await sendMail(user.email, subject, htmlMessage);
          console.log(`✅ Welcome email sent to ${user.email}`);
        } catch (error) {
          console.error(`❌ Failed to send welcome email to ${user.email}:`, error.message);
          // Don't throw - email failure should not break the signup flow
        }
      });

      return { success: true };
    } catch (error) {
      console.error("❌ Error running step", error.message);
      return { success: false };
    }
  }
);

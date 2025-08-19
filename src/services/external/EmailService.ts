import nodemailer from "nodemailer";
import { config } from "../../config/env";
import {
  generateEmailVerificationToken,
  storeEmailVerificationToken,
  verifyEmailVerificationToken,
  invalidateEmailVerificationToken,
  generatePasswordResetToken,
  storePasswordResetToken,
  verifyPasswordResetToken,
  invalidatePasswordResetToken,
} from "../../utils/auth";
import { UserModel } from "../../models/User";
import logger from "../../utils/logger";

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export class EmailService {
  private static transporter: nodemailer.Transporter;

  // Initialize email transporter
  static initialize(): void {
    this.transporter = nodemailer.createTransporter({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: {
        user: config.email.user,
        pass: config.email.password,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });

    // Verify connection
    this.transporter.verify((error, success) => {
      if (error) {
        logger.error("Email service connection failed:", error);
      } else {
        logger.info("Email service connected successfully");
      }
    });
  }

  // Send email with template
  private static async sendEmail(
    to: string,
    subject: string,
    html: string,
    text?: string
  ): Promise<boolean> {
    try {
      if (!this.transporter) {
        this.initialize();
      }

      const mailOptions = {
        from: {
          name: "Car Marketplace Philippines",
          address: config.email.from,
        },
        to,
        subject,
        html,
        text: text || this.htmlToText(html),
      };

      const result = await this.transporter.sendMail(mailOptions);
      logger.debug(`Email sent successfully to ${to}:`, result.messageId);
      return true;
    } catch (error) {
      logger.error(`Failed to send email to ${to}:`, error);
      return false;
    }
  }

  // Convert basic HTML to text
  private static htmlToText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  }

  // Welcome email
  static async sendWelcomeEmail(
    email: string,
    firstName: string
  ): Promise<boolean> {
    const subject = "Welcome to Car Marketplace Philippines! 🚗";
    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 10px;">
            <h1 style="margin: 0;">🚗 Welcome to Car Marketplace Philippines!</h1>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">
            <h2>Hello ${firstName}! 👋</h2>
            
            <p>Welcome to the Philippines' premier car marketplace! We're excited to have you join our community of car enthusiasts, buyers, and sellers.</p>
            
            <h3>What you can do:</h3>
            <ul>
              <li>🔍 <strong>Search & Filter:</strong> Find your perfect car with our advanced search</li>
              <li>📝 <strong>Create Listings:</strong> Sell your car to thousands of potential buyers</li>
              <li>💬 <strong>Connect Safely:</strong> Communicate securely with verified users</li>
              <li>📍 <strong>Location-Based:</strong> Find cars near you across the Philippines</li>
              <li>⭐ <strong>Rate & Review:</strong> Build trust in our community</li>
            </ul>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${config.storage.publicUrl}/dashboard" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Start Exploring Cars</a>
            </div>
            
            <p style="font-size: 14px; color: #666; border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px;">
              Need help? Contact our support team at <a href="mailto:support@carmarketplace.ph">support@carmarketplace.ph</a>
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(email, subject, html);
  }

  // Email verification
  static async sendEmailVerification(
    email: string,
    firstName: string,
    userId: number
  ): Promise<boolean> {
    try {
      const token = generateEmailVerificationToken();
      await storeEmailVerificationToken(userId, email, token);

      const verificationUrl = `${config.storage.publicUrl}/verify-email/${token}`;
      const subject = "Verify Your Email Address";
      const html = `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; padding: 20px; background: #4CAF50; color: white; border-radius: 10px;">
              <h1 style="margin: 0;">📧 Verify Your Email</h1>
            </div>
            
            <div style="padding: 30px; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">
              <h2>Hi ${firstName}!</h2>
              
              <p>Please verify your email address to complete your account setup and access all features of Car Marketplace Philippines.</p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" style="background: #4CAF50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email Address</a>
              </div>
              
              <p style="font-size: 14px; color: #666;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${verificationUrl}">${verificationUrl}</a>
              </p>
              
              <p style="font-size: 14px; color: #666;">
                This verification link will expire in 24 hours.
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      return await this.sendEmail(email, subject, html);
    } catch (error) {
      logger.error("Error sending email verification:", error);
      return false;
    }
  }

  // Process email verification
  static async processEmailVerification(token: string): Promise<{
    success: boolean;
    message: string;
    userId?: number;
  }> {
    try {
      const verification = await verifyEmailVerificationToken(token);

      if (!verification.isValid) {
        return {
          success: false,
          message: "Invalid or expired verification token",
        };
      }

      // Update user email verification status
      const success = await UserModel.verifyEmail(verification.userId);

      if (success) {
        await invalidateEmailVerificationToken(token);
        return {
          success: true,
          message: "Email verified successfully",
          userId: verification.userId,
        };
      } else {
        return {
          success: false,
          message: "Failed to verify email",
        };
      }
    } catch (error) {
      logger.error("Error processing email verification:", error);
      return {
        success: false,
        message: "Email verification failed",
      };
    }
  }

  // Password reset email
  static async sendPasswordResetEmail(
    email: string,
    firstName: string,
    userId: number
  ): Promise<boolean> {
    try {
      const token = generatePasswordResetToken();
      await storePasswordResetToken(userId, token, 3600); // 1 hour expiry

      const resetUrl = `${config.storage.publicUrl}/reset-password/${token}`;
      const subject = "Reset Your Password";
      const html = `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; padding: 20px; background: #FF9800; color: white; border-radius: 10px;">
              <h1 style="margin: 0;">🔒 Reset Your Password</h1>
            </div>
            
            <div style="padding: 30px; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">
              <h2>Hi ${firstName}!</h2>
              
              <p>We received a request to reset your password for your Car Marketplace Philippines account.</p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background: #FF9800; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
              </div>
              
              <p style="font-size: 14px; color: #666;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${resetUrl}">${resetUrl}</a>
              </p>
              
              <p style="font-size: 14px; color: #666;">
                This reset link will expire in 1 hour. If you didn't request this, please ignore this email.
              </p>
              
              <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin-top: 20px;">
                <strong>Security Tip:</strong> Never share your password or click on suspicious links.
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      return await this.sendEmail(email, subject, html);
    } catch (error) {
      logger.error("Error sending password reset email:", error);
      return false;
    }
  }

  // Process password reset
  static async processPasswordReset(
    token: string,
    newPassword: string
  ): Promise<{
    success: boolean;
    message: string;
    userId?: number;
  }> {
    try {
      const verification = await verifyPasswordResetToken(token);

      if (!verification.isValid) {
        return {
          success: false,
          message: "Invalid or expired reset token",
        };
      }

      // Update user password
      const success = await UserModel.updatePassword(
        verification.userId,
        newPassword
      );

      if (success) {
        await invalidatePasswordResetToken(token);
        return {
          success: true,
          message: "Password reset successfully",
          userId: verification.userId,
        };
      } else {
        return {
          success: false,
          message: "Failed to reset password",
        };
      }
    } catch (error) {
      logger.error("Error processing password reset:", error);
      return {
        success: false,
        message: "Password reset failed",
      };
    }
  }

  // Password change notification
  static async sendPasswordChangeNotification(
    email: string,
    firstName: string
  ): Promise<boolean> {
    const subject = "Password Changed Successfully";
    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; padding: 20px; background: #4CAF50; color: white; border-radius: 10px;">
            <h1 style="margin: 0;">🔒 Password Changed</h1>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">
            <h2>Hi ${firstName}!</h2>
            
            <p>Your password has been successfully changed for your Car Marketplace Philippines account.</p>
            
            <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Security Confirmation:</strong> If you made this change, no further action is needed.
            </div>
            
            <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Security Alert:</strong> If you didn't change your password, please contact our support team immediately at <a href="mailto:security@carmarketplace.ph">security@carmarketplace.ph</a>
            </div>
            
            <p style="font-size: 14px; color: #666;">
              Time: ${new Date().toLocaleString("en-PH", {
                timeZone: "Asia/Manila",
              })}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(email, subject, html);
  }

  // New device login notification
  static async sendNewDeviceNotification(
    email: string,
    firstName: string,
    deviceInfo: { ip: string; userAgent: string; timestamp: Date }
  ): Promise<boolean> {
    const subject = "New Device Login Detected";
    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; padding: 20px; background: #FF9800; color: white; border-radius: 10px;">
            <h1 style="margin: 0;">🔐 New Device Login</h1>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">
            <h2>Hi ${firstName}!</h2>
            
            <p>We detected a login to your Car Marketplace Philippines account from a new device.</p>
            
            <div style="background: #fff; border: 1px solid #ddd; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Login Details:</h3>
              <p><strong>Time:</strong> ${deviceInfo.timestamp.toLocaleString(
                "en-PH",
                { timeZone: "Asia/Manila" }
              )}</p>
              <p><strong>IP Address:</strong> ${deviceInfo.ip}</p>
              <p><strong>Device:</strong> ${deviceInfo.userAgent}</p>
            </div>
            
            <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Was this you?</strong> If you recognize this login, no further action is needed.
            </div>
            
            <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Didn't recognize this login?</strong> Please secure your account immediately:
              <ul>
                <li>Change your password</li>
                <li>Review your account activity</li>
                <li>Contact our security team</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${
                config.storage.publicUrl
              }/profile/security" style="background: #FF9800; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">Review Security Settings</a>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(email, subject, html);
  }

  // Generic notification email
  static async sendNotificationEmail(
    email: string,
    firstName: string,
    title: string,
    message: string,
    actionText?: string,
    actionUrl?: string
  ): Promise<boolean> {
    const subject = title;
    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; padding: 20px; background: #667eea; color: white; border-radius: 10px;">
            <h1 style="margin: 0;">${title}</h1>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9; border-radius: 10px; margin-top: 20px;">
            <h2>Hi ${firstName}!</h2>
            
            <p>${message}</p>
            
            ${
              actionText && actionUrl
                ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${actionUrl}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold;">${actionText}</a>
            </div>
            `
                : ""
            }
            
            <p style="font-size: 14px; color: #666; border-top: 1px solid #ddd; padding-top: 20px; margin-top: 30px;">
              Visit <a href="${
                config.storage.publicUrl
              }">Car Marketplace Philippines</a> for more information.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail(email, subject, html);
  }

  // Test email connection
  static async testConnection(): Promise<boolean> {
    try {
      if (!this.transporter) {
        this.initialize();
      }

      const result = await this.transporter.verify();
      logger.info("Email service test successful");
      return result;
    } catch (error) {
      logger.error("Email service test failed:", error);
      return false;
    }
  }
}

// Initialize email service
EmailService.initialize();

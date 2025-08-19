import axios from "axios";
import { config } from "../../config/env";
import logger from "../../utils/logger";

export interface SMSProvider {
  name: string;
  send(to: string, message: string): Promise<boolean>;
  getBalance?(): Promise<number>;
}

// Semaphore SMS Provider (Popular in Philippines)
class SemaphoreSMSProvider implements SMSProvider {
  public name = "Semaphore";
  private apiUrl = "https://api.semaphore.co";

  async send(to: string, message: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.apiUrl}/api/v4/messages`,
        {
          apikey: config.sms.apiKey,
          number: this.formatPhoneNumber(to),
          message: message,
          sendername: config.sms.senderId,
        },
        {
          timeout: 10000,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data && response.data.status === "success") {
        logger.debug(`SMS sent successfully via Semaphore to ${to}`);
        return true;
      } else {
        logger.error("Semaphore SMS failed:", response.data);
        return false;
      }
    } catch (error) {
      logger.error("Semaphore SMS error:", error);
      return false;
    }
  }

  async getBalance(): Promise<number> {
    try {
      const response = await axios.get(`${this.apiUrl}/api/v4/account`, {
        params: { apikey: config.sms.apiKey },
        timeout: 10000,
      });

      return response.data?.account_balance || 0;
    } catch (error) {
      logger.error("Error getting Semaphore balance:", error);
      return 0;
    }
  }

  private formatPhoneNumber(phone: string): string {
    // Convert to international format for Philippines
    let formatted = phone.replace(/\D/g, ""); // Remove non-digits

    if (formatted.startsWith("0")) {
      formatted = "63" + formatted.substring(1);
    } else if (!formatted.startsWith("63")) {
      formatted = "63" + formatted;
    }

    return formatted;
  }
}

// Globe Labs SMS Provider (Alternative)
class GlobeLabsSMSProvider implements SMSProvider {
  public name = "Globe Labs";
  private apiUrl = "https://devapi.globelabs.com.ph";

  async send(to: string, message: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.apiUrl}/smsmessaging/v1/outbound/1234/requests`,
        {
          outboundSMSMessageRequest: {
            address: this.formatPhoneNumber(to),
            message: message,
            senderAddress: config.sms.senderId,
          },
        },
        {
          timeout: 10000,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.sms.apiKey}`,
          },
        }
      );

      if (response.status === 201) {
        logger.debug(`SMS sent successfully via Globe Labs to ${to}`);
        return true;
      } else {
        logger.error("Globe Labs SMS failed:", response.data);
        return false;
      }
    } catch (error) {
      logger.error("Globe Labs SMS error:", error);
      return false;
    }
  }

  private formatPhoneNumber(phone: string): string {
    let formatted = phone.replace(/\D/g, "");

    if (formatted.startsWith("0")) {
      formatted = "+63" + formatted.substring(1);
    } else if (!formatted.startsWith("+63")) {
      formatted = "+63" + formatted;
    }

    return formatted;
  }
}

// Mock SMS Provider for development/testing
class MockSMSProvider implements SMSProvider {
  public name = "Mock SMS";

  async send(to: string, message: string): Promise<boolean> {
    logger.info(`[MOCK SMS] To: ${to}, Message: ${message}`);
    return true;
  }

  async getBalance(): Promise<number> {
    return 9999;
  }
}

export class SMSService {
  private static provider: SMSProvider;

  // Initialize SMS service with appropriate provider
  static initialize(): void {
    switch (config.sms.provider.toLowerCase()) {
      case "semaphore":
        this.provider = new SemaphoreSMSProvider();
        break;
      case "globe":
      case "globe_labs":
        this.provider = new GlobeLabsSMSProvider();
        break;
      case "mock":
      default:
        this.provider = new MockSMSProvider();
        break;
    }

    logger.info(`SMS service initialized with provider: ${this.provider.name}`);
  }

  // Send SMS
  private static async sendSMS(to: string, message: string): Promise<boolean> {
    try {
      if (!this.provider) {
        this.initialize();
      }

      // Validate phone number format
      if (!this.isValidPhilippineNumber(to)) {
        logger.error(`Invalid Philippines phone number: ${to}`);
        return false;
      }

      // Truncate message if too long (160 chars for single SMS)
      const truncatedMessage =
        message.length > 160 ? message.substring(0, 157) + "..." : message;

      const success = await this.provider.send(to, truncatedMessage);

      if (success) {
        logger.debug(`SMS sent successfully to ${to}`);
      }

      return success;
    } catch (error) {
      logger.error("SMS sending failed:", error);
      return false;
    }
  }

  // Validate Philippine phone number
  private static isValidPhilippineNumber(phone: string): boolean {
    const cleanPhone = phone.replace(/\D/g, "");

    // Check if it's a valid Philippine mobile number
    // Format: 09XXXXXXXXX or 639XXXXXXXXX or +639XXXXXXXXX
    const philippinePattern = /^((\+?63)|0)?9\d{9}$/;
    return philippinePattern.test(cleanPhone);
  }

  // SMS verification code
  static async sendVerificationCode(
    phone: string,
    code: string
  ): Promise<boolean> {
    const message = `Your Car Marketplace Philippines verification code is: ${code}. Valid for 10 minutes. Do not share this code.`;
    return await this.sendSMS(phone, message);
  }

  // Welcome SMS
  static async sendWelcomeSMS(
    phone: string,
    firstName: string
  ): Promise<boolean> {
    const message = `Welcome to Car Marketplace Philippines, ${firstName}! Start browsing cars or list yours today. Visit carmarketplace.ph`;
    return await this.sendSMS(phone, message);
  }

  // Car inquiry notification
  static async sendInquiryNotification(
    phone: string,
    carTitle: string
  ): Promise<boolean> {
    const message = `New inquiry for your ${carTitle}! Check your Car Marketplace account to respond. carmarketplace.ph`;
    return await this.sendSMS(phone, message);
  }

  // Price drop alert
  static async sendPriceDropAlert(
    phone: string,
    carTitle: string,
    newPrice: number
  ): Promise<boolean> {
    const message = `Price Drop Alert! ${carTitle} is now ₱${newPrice.toLocaleString()}. Check it out on Car Marketplace Philippines.`;
    return await this.sendSMS(phone, message);
  }

  // Generic notification SMS
  static async sendNotificationSMS(
    phone: string,
    firstName: string,
    title: string,
    message: string
  ): Promise<boolean> {
    const smsMessage = `Hi ${firstName}! ${title}: ${message} - Car Marketplace PH`;
    return await this.sendSMS(phone, smsMessage);
  }

  // Car sold notification
  static async sendCarSoldNotification(
    phone: string,
    carTitle: string
  ): Promise<boolean> {
    const message = `Great news! Your ${carTitle} has been sold on Car Marketplace Philippines. Check your account for transaction details.`;
    return await this.sendSMS(phone, message);
  }

  // Account security alert
  static async sendSecurityAlert(
    phone: string,
    alertType: string
  ): Promise<boolean> {
    const message = `Security Alert: ${alertType} on your Car Marketplace account. If this wasn't you, please secure your account immediately.`;
    return await this.sendSMS(phone, message);
  }

  // Test drive reminder
  static async sendTestDriveReminder(
    phone: string,
    carTitle: string,
    datetime: Date
  ): Promise<boolean> {
    const formattedDate = datetime.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const message = `Test drive reminder: ${carTitle} on ${formattedDate}. Contact seller if you need to reschedule.`;
    return await this.sendSMS(phone, message);
  }

  // Payment confirmation
  static async sendPaymentConfirmation(
    phone: string,
    amount: number,
    carTitle: string
  ): Promise<boolean> {
    const message = `Payment of ₱${amount.toLocaleString()} received for ${carTitle}. Transaction details in your Car Marketplace account.`;
    return await this.sendSMS(phone, message);
  }

  // Car listing approved
  static async sendListingApproved(
    phone: string,
    carTitle: string
  ): Promise<boolean> {
    const message = `Your car listing "${carTitle}" has been approved and is now live on Car Marketplace Philippines!`;
    return await this.sendSMS(phone, message);
  }

  // Car listing rejected
  static async sendListingRejected(
    phone: string,
    carTitle: string,
    reason: string
  ): Promise<boolean> {
    const message = `Your car listing "${carTitle}" needs revision: ${reason}. Edit in your Car Marketplace account.`;
    return await this.sendSMS(phone, message);
  }

  // Get SMS provider balance
  static async getBalance(): Promise<number> {
    try {
      if (!this.provider) {
        this.initialize();
      }

      if (this.provider.getBalance) {
        return await this.provider.getBalance();
      }

      return 0;
    } catch (error) {
      logger.error("Error getting SMS balance:", error);
      return 0;
    }
  }

  // Test SMS service
  static async testService(testPhone?: string): Promise<boolean> {
    try {
      const phone = testPhone || "09123456789"; // Default test number
      const message =
        "Test message from Car Marketplace Philippines SMS service.";

      return await this.sendSMS(phone, message);
    } catch (error) {
      logger.error("SMS service test failed:", error);
      return false;
    }
  }

  // Get SMS statistics
  static getStats(): {
    provider: string;
    isInitialized: boolean;
  } {
    return {
      provider: this.provider?.name || "Not initialized",
      isInitialized: !!this.provider,
    };
  }

  // Bulk SMS sending
  static async sendBulkSMS(
    recipients: Array<{ phone: string; message: string }>,
    batchSize: number = 10
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    // Process in batches to avoid rate limiting
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      const promises = batch.map(async (recipient) => {
        try {
          const success = await this.sendSMS(
            recipient.phone,
            recipient.message
          );
          return success ? "sent" : "failed";
        } catch (error) {
          logger.error(`Bulk SMS failed for ${recipient.phone}:`, error);
          return "failed";
        }
      });

      const results = await Promise.all(promises);
      sent += results.filter((r) => r === "sent").length;
      failed += results.filter((r) => r === "failed").length;

      // Add delay between batches to respect rate limits
      if (i + batchSize < recipients.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    logger.info(`Bulk SMS completed: ${sent} sent, ${failed} failed`);
    return { sent, failed };
  }
}

// Initialize SMS service
SMSService.initialize();

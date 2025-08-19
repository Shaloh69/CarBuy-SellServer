import database, { QueryBuilder } from "../../config/database";
import SocketManager from "../../config/socket";
import { EmailService } from "../external/EmailService";
import { SMSService } from "../external/SMSService";
import logger from "../../utils/logger";
import { NotificationData } from "../../types";

export interface Notification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  action_text?: string;
  action_url?: string;
  is_read: boolean;
  is_push_sent: boolean;
  is_email_sent: boolean;
  is_sms_sent: boolean;
  related_car_id?: number;
  related_inquiry_id?: number;
  related_transaction_id?: number;
  related_user_id?: number;
  priority: "low" | "medium" | "high" | "urgent";
  created_at: Date;
  read_at?: Date;
}

export class NotificationService {
  private static socketManager = SocketManager.getInstance();

  // Create and send notification
  static async create(
    notificationData: NotificationData
  ): Promise<Notification | null> {
    try {
      // Insert notification into database
      const insertData = {
        user_id: notificationData.user_id,
        type: notificationData.type,
        title: notificationData.title,
        message: notificationData.message,
        action_text: notificationData.action_text,
        action_url: notificationData.action_url,
        related_car_id: notificationData.related_car_id,
        related_inquiry_id: notificationData.related_inquiry_id,
        related_transaction_id: notificationData.related_transaction_id,
        related_user_id: notificationData.related_user_id,
        priority: notificationData.priority || "medium",
        is_read: false,
        is_push_sent: false,
        is_email_sent: false,
        is_sms_sent: false,
      };

      const result = await QueryBuilder.insert("notifications")
        .values(insertData)
        .execute();

      const notificationId = result.insertId;

      // Get the created notification
      const notifications = await QueryBuilder.select()
        .from("notifications")
        .where("id = ?", notificationId)
        .execute();

      if (notifications.length === 0) {
        return null;
      }

      const notification = notifications[0];

      // Send real-time notification via Socket.IO
      await this.sendRealTimeNotification(notification);

      // Send email notification if requested
      if (notificationData.send_email) {
        await this.sendEmailNotification(notification);
      }

      // Send SMS notification if requested
      if (notificationData.send_sms) {
        await this.sendSMSNotification(notification);
      }

      // Send push notification if requested
      if (notificationData.send_push) {
        await this.sendPushNotification(notification);
      }

      logger.info(
        `Notification created: ${notification.type} for user ${notification.user_id}`
      );
      return notification;
    } catch (error) {
      logger.error("Error creating notification:", error);
      return null;
    }
  }

  // Send real-time notification via Socket.IO
  private static async sendRealTimeNotification(
    notification: Notification
  ): Promise<void> {
    try {
      this.socketManager.emitToUser(notification.user_id, "notification:new", {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        action_text: notification.action_text,
        action_url: notification.action_url,
        priority: notification.priority,
        created_at: notification.created_at,
      });

      logger.debug(
        `Real-time notification sent to user ${notification.user_id}`
      );
    } catch (error) {
      logger.error("Error sending real-time notification:", error);
    }
  }

  // Send email notification
  private static async sendEmailNotification(
    notification: Notification
  ): Promise<void> {
    try {
      // Get user details
      const users = await QueryBuilder.select([
        "email",
        "first_name",
        "email_notifications",
      ])
        .from("users")
        .where("id = ?", notification.user_id)
        .execute();

      if (users.length === 0 || !users[0].email_notifications) {
        return;
      }

      const user = users[0];

      await EmailService.sendNotificationEmail(
        user.email,
        user.first_name,
        notification.title,
        notification.message,
        notification.action_text,
        notification.action_url
      );

      // Update notification as email sent
      await QueryBuilder.update("notifications")
        .set({ is_email_sent: true })
        .where("id = ?", notification.id)
        .execute();

      logger.debug(`Email notification sent to user ${notification.user_id}`);
    } catch (error) {
      logger.error("Error sending email notification:", error);
    }
  }

  // Send SMS notification
  private static async sendSMSNotification(
    notification: Notification
  ): Promise<void> {
    try {
      // Get user details
      const users = await QueryBuilder.select([
        "phone",
        "first_name",
        "sms_notifications",
      ])
        .from("users")
        .where("id = ?", notification.user_id)
        .execute();

      if (
        users.length === 0 ||
        !users[0].phone ||
        !users[0].sms_notifications
      ) {
        return;
      }

      const user = users[0];

      await SMSService.sendNotificationSMS(
        user.phone,
        user.first_name,
        notification.title,
        notification.message
      );

      // Update notification as SMS sent
      await QueryBuilder.update("notifications")
        .set({ is_sms_sent: true })
        .where("id = ?", notification.id)
        .execute();

      logger.debug(`SMS notification sent to user ${notification.user_id}`);
    } catch (error) {
      logger.error("Error sending SMS notification:", error);
    }
  }

  // Send push notification
  private static async sendPushNotification(
    notification: Notification
  ): Promise<void> {
    try {
      // Push notification implementation would go here
      // This would integrate with services like Firebase FCM

      // Update notification as push sent
      await QueryBuilder.update("notifications")
        .set({ is_push_sent: true })
        .where("id = ?", notification.id)
        .execute();

      logger.debug(`Push notification sent to user ${notification.user_id}`);
    } catch (error) {
      logger.error("Error sending push notification:", error);
    }
  }

  // Get user notifications
  static async getUserNotifications(
    userId: number,
    unreadOnly: boolean = false,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    notifications: Notification[];
    total: number;
    unread_count: number;
  }> {
    try {
      let query = QueryBuilder.select()
        .from("notifications")
        .where("user_id = ?", userId);

      if (unreadOnly) {
        query = query.where("is_read = ?", false);
      }

      // Get total count
      const countResult = await query.build();
      const totalResult = await database.execute(
        countResult.query.replace("SELECT *", "SELECT COUNT(*) as total"),
        countResult.params
      );
      const total = totalResult[0].total;

      // Get unread count
      const unreadResult = await database.execute(
        "SELECT COUNT(*) as unread FROM notifications WHERE user_id = ? AND is_read = FALSE",
        [userId]
      );
      const unread_count = unreadResult[0].unread;

      // Get paginated notifications
      const offset = (page - 1) * limit;
      query = query.orderBy("created_at", "DESC").limit(limit, offset);

      const notifications = await query.execute();

      return {
        notifications,
        total,
        unread_count,
      };
    } catch (error) {
      logger.error("Error getting user notifications:", error);
      return {
        notifications: [],
        total: 0,
        unread_count: 0,
      };
    }
  }

  // Mark notification as read
  static async markAsRead(
    notificationId: number,
    userId: number
  ): Promise<boolean> {
    try {
      const result = await QueryBuilder.update("notifications")
        .set({
          is_read: true,
          read_at: new Date(),
        })
        .where("id = ?", notificationId)
        .where("user_id = ?", userId)
        .execute();

      if (result.affectedRows > 0) {
        // Send real-time update
        this.socketManager.emitToUser(userId, "notification:read", {
          notificationId,
          timestamp: new Date(),
        });

        return true;
      }

      return false;
    } catch (error) {
      logger.error("Error marking notification as read:", error);
      return false;
    }
  }

  // Mark all notifications as read
  static async markAllAsRead(userId: number): Promise<number> {
    try {
      const result = await QueryBuilder.update("notifications")
        .set({
          is_read: true,
          read_at: new Date(),
        })
        .where("user_id = ?", userId)
        .where("is_read = ?", false)
        .execute();

      if (result.affectedRows > 0) {
        // Send real-time update
        this.socketManager.emitToUser(userId, "notification:bulk_read", {
          count: result.affectedRows,
          timestamp: new Date(),
        });
      }

      return result.affectedRows;
    } catch (error) {
      logger.error("Error marking all notifications as read:", error);
      return 0;
    }
  }

  // Delete notification
  static async deleteNotification(
    notificationId: number,
    userId: number
  ): Promise<boolean> {
    try {
      const result = await QueryBuilder.delete()
        .from("notifications")
        .where("id = ?", notificationId)
        .where("user_id = ?", userId)
        .execute();

      return result.affectedRows > 0;
    } catch (error) {
      logger.error("Error deleting notification:", error);
      return false;
    }
  }

  // Predefined notification creators for common scenarios

  // Car listing notifications
  static async notifyCarApproved(
    carId: number,
    sellerId: number
  ): Promise<void> {
    await this.create({
      user_id: sellerId,
      type: "car_approved",
      title: "Car Listing Approved",
      message:
        "Your car listing has been approved and is now live on the marketplace.",
      action_text: "View Listing",
      action_url: `/cars/${carId}`,
      related_car_id: carId,
      priority: "medium",
      send_email: true,
      send_push: true,
    });

    // Send real-time Socket.IO event
    this.socketManager.notifyCarApproved(carId, sellerId);
  }

  static async notifyCarRejected(
    carId: number,
    sellerId: number,
    reason: string
  ): Promise<void> {
    await this.create({
      user_id: sellerId,
      type: "car_rejected",
      title: "Car Listing Rejected",
      message: `Your car listing was rejected. Reason: ${reason}`,
      action_text: "Edit Listing",
      action_url: `/cars/${carId}/edit`,
      related_car_id: carId,
      priority: "high",
      send_email: true,
      send_push: true,
    });

    // Send real-time Socket.IO event
    this.socketManager.notifyCarRejected(carId, sellerId, reason);
  }

  static async notifyCarSubmittedForApproval(
    carId: number,
    sellerId: number
  ): Promise<void> {
    await this.create({
      user_id: sellerId,
      type: "car_submitted",
      title: "Car Listing Submitted",
      message:
        "Your car listing has been submitted for review. We will notify you once it's approved.",
      action_text: "View Listing",
      action_url: `/cars/${carId}`,
      related_car_id: carId,
      priority: "low",
    });
  }

  static async notifyCarSold(
    carId: number,
    sellerId: number,
    buyerId: number
  ): Promise<void> {
    // Notify seller
    await this.create({
      user_id: sellerId,
      type: "car_sold",
      title: "Car Sold Successfully",
      message: "Congratulations! Your car has been sold.",
      action_text: "View Transaction",
      action_url: `/transactions`,
      related_car_id: carId,
      related_user_id: buyerId,
      priority: "high",
      send_email: true,
      send_push: true,
    });

    // Notify buyer
    await this.create({
      user_id: buyerId,
      type: "car_purchased",
      title: "Car Purchase Confirmed",
      message: "Your car purchase has been confirmed. Congratulations!",
      action_text: "View Transaction",
      action_url: `/transactions`,
      related_car_id: carId,
      related_user_id: sellerId,
      priority: "high",
      send_email: true,
      send_push: true,
    });

    // Send real-time Socket.IO event
    this.socketManager.notifyCarSold(carId, buyerId, sellerId);
  }

  // Inquiry notifications
  static async notifyNewInquiry(
    inquiryId: number,
    carId: number,
    buyerId: number,
    sellerId: number
  ): Promise<void> {
    await this.create({
      user_id: sellerId,
      type: "new_inquiry",
      title: "New Inquiry Received",
      message: "You have received a new inquiry about your car listing.",
      action_text: "View Inquiry",
      action_url: `/inquiries/${inquiryId}`,
      related_inquiry_id: inquiryId,
      related_car_id: carId,
      related_user_id: buyerId,
      priority: "medium",
      send_email: true,
      send_push: true,
    });
  }

  static async notifyInquiryResponse(
    inquiryId: number,
    carId: number,
    responderId: number,
    recipientId: number
  ): Promise<void> {
    await this.create({
      user_id: recipientId,
      type: "inquiry_response",
      title: "Inquiry Response Received",
      message: "You have received a response to your inquiry.",
      action_text: "View Response",
      action_url: `/inquiries/${inquiryId}`,
      related_inquiry_id: inquiryId,
      related_car_id: carId,
      related_user_id: responderId,
      priority: "medium",
      send_push: true,
    });
  }

  // Price alert notifications
  static async notifyPriceDrop(
    carId: number,
    userId: number,
    oldPrice: number,
    newPrice: number
  ): Promise<void> {
    const savings = oldPrice - newPrice;

    await this.create({
      user_id: userId,
      type: "price_drop_alert",
      title: "Price Drop Alert",
      message: `A car you're watching has dropped in price by ₱${savings.toLocaleString()}!`,
      action_text: "View Car",
      action_url: `/cars/${carId}`,
      related_car_id: carId,
      priority: "medium",
      send_push: true,
    });

    // Send real-time Socket.IO event
    this.socketManager.notifyPriceChanged(carId, oldPrice, newPrice);
  }

  // System notifications
  static async notifyMaintenanceScheduled(
    userId: number,
    startTime: Date,
    duration: string
  ): Promise<void> {
    await this.create({
      user_id: userId,
      type: "system_maintenance",
      title: "Scheduled Maintenance",
      message: `The system will be under maintenance starting ${startTime.toLocaleString()} for approximately ${duration}.`,
      priority: "medium",
      send_email: true,
    });
  }

  // Account notifications
  static async notifyAccountVerified(
    userId: number,
    verificationType: string
  ): Promise<void> {
    await this.create({
      user_id: userId,
      type: "account_verification",
      title: "Account Verified",
      message: `Your ${verificationType} verification has been completed successfully.`,
      action_text: "View Profile",
      action_url: "/profile",
      priority: "medium",
      send_email: true,
    });
  }

  static async notifyPasswordChanged(userId: number): Promise<void> {
    await this.create({
      user_id: userId,
      type: "password_changed",
      title: "Password Changed",
      message:
        "Your password has been changed successfully. If this wasn't you, please contact support immediately.",
      action_text: "Security Settings",
      action_url: "/profile/security",
      priority: "high",
      send_email: true,
    });
  }

  // Transaction notifications
  static async notifyPaymentReceived(
    transactionId: number,
    sellerId: number,
    amount: number
  ): Promise<void> {
    await this.create({
      user_id: sellerId,
      type: "payment_received",
      title: "Payment Received",
      message: `You have received a payment of ₱${amount.toLocaleString()}.`,
      action_text: "View Transaction",
      action_url: `/transactions/${transactionId}`,
      related_transaction_id: transactionId,
      priority: "high",
      send_email: true,
      send_push: true,
    });
  }

  // Bulk notifications
  static async sendBulkNotification(
    userIds: number[],
    notificationData: Omit<NotificationData, "user_id">
  ): Promise<number> {
    let successCount = 0;

    for (const userId of userIds) {
      try {
        const notification = await this.create({
          ...notificationData,
          user_id: userId,
        });

        if (notification) {
          successCount++;
        }
      } catch (error) {
        logger.error(
          `Error sending bulk notification to user ${userId}:`,
          error
        );
      }
    }

    logger.info(
      `Bulk notification sent to ${successCount}/${userIds.length} users`
    );
    return successCount;
  }

  // Cleanup old notifications
  static async cleanupOldNotifications(
    olderThanDays: number = 90
  ): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await database.execute(
        "DELETE FROM notifications WHERE created_at < ? AND is_read = TRUE",
        [cutoffDate]
      );

      logger.info(`Cleaned up ${result.affectedRows} old notifications`);
      return result.affectedRows;
    } catch (error) {
      logger.error("Error cleaning up old notifications:", error);
      return 0;
    }
  }
}

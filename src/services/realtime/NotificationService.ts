// src/services/realtime/NotificationService.ts
import { DatabaseManager } from "../../config/database";
import { QueueManager } from "../background/QueueManager";
import SocketManager from "../../config/socket";
import { EmailService } from "../external/EmailService";
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
  related_car_id?: number;
  related_inquiry_id?: number;
  related_transaction_id?: number;
  priority: string;
  is_read: boolean;
  is_email_sent: boolean;
  is_sms_sent: boolean;
  is_push_sent: boolean;
  created_at: Date;
  read_at?: Date;
}

export class NotificationService {
  private static instance: NotificationService;
  private db: DatabaseManager;
  private queueManager: QueueManager;
  private socketManager: SocketManager;

  private constructor() {
    this.db = DatabaseManager.getInstance();
    this.queueManager = QueueManager.getInstance();
    this.socketManager = SocketManager.getInstance();
  }

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Create and send a notification
   */
  static async createNotification(
    notificationData: NotificationData
  ): Promise<Notification | null> {
    const instance = NotificationService.getInstance();
    return await instance.createNotificationInternal(notificationData);
  }

  private async createNotificationInternal(
    notificationData: NotificationData
  ): Promise<Notification | null> {
    try {
      // Insert notification into database
      const result = await this.db.execute(
        `INSERT INTO notifications (
          user_id, type, title, message, action_text, action_url,
          related_car_id, related_inquiry_id, related_transaction_id,
          priority, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          notificationData.user_id,
          notificationData.type,
          notificationData.title,
          notificationData.message,
          notificationData.action_text || null,
          notificationData.action_url || null,
          notificationData.related_car_id || null,
          notificationData.related_inquiry_id || null,
          notificationData.related_transaction_id || null,
          notificationData.priority || "medium",
        ]
      );

      const notificationId = (result as any).insertId;

      // Get the created notification
      const notifications = await this.db.execute(
        "SELECT * FROM notifications WHERE id = ?",
        [notificationId]
      );

      if (notifications.length === 0) {
        return null;
      }

      const notification = notifications[0];

      // Send real-time notification via Socket.IO
      await this.sendRealTimeNotification(notification);

      // Queue email notification if requested
      if (notificationData.send_email) {
        await this.queueEmailNotification(notification);
      }

      // Queue SMS notification if requested
      if (notificationData.send_sms) {
        await this.queueSMSNotification(notification);
      }

      // Queue push notification if requested
      if (notificationData.send_push) {
        await this.queuePushNotification(notification);
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

  /**
   * Send real-time notification via Socket.IO
   */
  private async sendRealTimeNotification(
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

  /**
   * Queue email notification
   */
  private async queueEmailNotification(
    notification: Notification
  ): Promise<void> {
    try {
      // Get user details
      const users = await this.db.execute(
        "SELECT email, first_name, notification_preferences FROM users WHERE id = ?",
        [notification.user_id]
      );

      if (users.length === 0) {
        return;
      }

      const user = users[0];
      const preferences = user.notification_preferences
        ? JSON.parse(user.notification_preferences)
        : { email_notifications: true };

      if (!preferences.email_notifications) {
        return;
      }

      await this.queueManager.addJob("email", {
        type: "notification_email",
        payload: {
          email: user.email,
          name: user.first_name,
          title: notification.title,
          message: notification.message,
          actionText: notification.action_text,
          actionUrl: notification.action_url,
          notificationId: notification.id,
        },
      });

      // Update notification as email queued
      await this.db.execute(
        "UPDATE notifications SET is_email_sent = TRUE WHERE id = ?",
        [notification.id]
      );
    } catch (error) {
      logger.error("Error queuing email notification:", error);
    }
  }

  /**
   * Queue SMS notification
   */
  private async queueSMSNotification(
    notification: Notification
  ): Promise<void> {
    try {
      // Get user phone and preferences
      const users = await this.db.execute(
        "SELECT phone, notification_preferences FROM users WHERE id = ?",
        [notification.user_id]
      );

      if (users.length === 0 || !users[0].phone) {
        return;
      }

      const user = users[0];
      const preferences = user.notification_preferences
        ? JSON.parse(user.notification_preferences)
        : { sms_notifications: false };

      if (!preferences.sms_notifications) {
        return;
      }

      await this.queueManager.addJob("sms", {
        type: "notification_sms",
        payload: {
          phone: user.phone,
          message: `${notification.title}: ${notification.message}`,
          notificationId: notification.id,
        },
      });

      // Update notification as SMS queued
      await this.db.execute(
        "UPDATE notifications SET is_sms_sent = TRUE WHERE id = ?",
        [notification.id]
      );
    } catch (error) {
      logger.error("Error queuing SMS notification:", error);
    }
  }

  /**
   * Queue push notification
   */
  private async queuePushNotification(
    notification: Notification
  ): Promise<void> {
    try {
      // Get user push preferences and tokens
      const users = await this.db.execute(
        "SELECT notification_preferences FROM users WHERE id = ?",
        [notification.user_id]
      );

      if (users.length === 0) {
        return;
      }

      const user = users[0];
      const preferences = user.notification_preferences
        ? JSON.parse(user.notification_preferences)
        : { push_notifications: true };

      if (!preferences.push_notifications) {
        return;
      }

      // Get user's push tokens
      const pushTokens = await this.db.execute(
        "SELECT token FROM push_tokens WHERE user_id = ? AND is_active = TRUE",
        [notification.user_id]
      );

      if (pushTokens.length === 0) {
        return;
      }

      for (const tokenRow of pushTokens) {
        await this.queueManager.addJob("push", {
          type: "notification_push",
          payload: {
            token: tokenRow.token,
            title: notification.title,
            message: notification.message,
            data: {
              notificationId: notification.id,
              type: notification.type,
              action_url: notification.action_url,
            },
          },
        });
      }

      // Update notification as push queued
      await this.db.execute(
        "UPDATE notifications SET is_push_sent = TRUE WHERE id = ?",
        [notification.id]
      );
    } catch (error) {
      logger.error("Error queuing push notification:", error);
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(
    notificationId: number,
    userId: number
  ): Promise<boolean> {
    const instance = NotificationService.getInstance();

    try {
      const result = await instance.db.execute(
        "UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = ? AND user_id = ?",
        [notificationId, userId]
      );

      return (result as any).affectedRows > 0;
    } catch (error) {
      logger.error("Error marking notification as read:", error);
      return false;
    }
  }

  /**
   * Mark all notifications as read for a user
   */
  static async markAllAsRead(userId: number): Promise<number> {
    const instance = NotificationService.getInstance();

    try {
      const result = await instance.db.execute(
        "UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = ? AND is_read = FALSE",
        [userId]
      );

      return (result as any).affectedRows;
    } catch (error) {
      logger.error("Error marking all notifications as read:", error);
      return 0;
    }
  }

  /**
   * Delete notification
   */
  static async deleteNotification(
    notificationId: number,
    userId: number
  ): Promise<boolean> {
    const instance = NotificationService.getInstance();

    try {
      const result = await instance.db.execute(
        "DELETE FROM notifications WHERE id = ? AND user_id = ?",
        [notificationId, userId]
      );

      return (result as any).affectedRows > 0;
    } catch (error) {
      logger.error("Error deleting notification:", error);
      return false;
    }
  }

  /**
   * Get unread notification count for user
   */
  static async getUnreadCount(userId: number): Promise<number> {
    const instance = NotificationService.getInstance();

    try {
      const result = await instance.db.execute(
        "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE",
        [userId]
      );

      return result[0]?.count || 0;
    } catch (error) {
      logger.error("Error getting unread count:", error);
      return 0;
    }
  }

  /**
   * Create bulk notifications (for system announcements)
   */
  static async createBulkNotification(
    userIds: number[],
    notificationData: Omit<NotificationData, "user_id">
  ): Promise<number> {
    const instance = NotificationService.getInstance();
    let successCount = 0;

    for (const userId of userIds) {
      const notification = await instance.createNotificationInternal({
        ...notificationData,
        user_id: userId,
      });

      if (notification) {
        successCount++;
      }
    }

    logger.info(
      `Bulk notification sent to ${successCount}/${userIds.length} users`
    );
    return successCount;
  }

  /**
   * Send notification based on user preferences and notification type
   */
  static async sendNotificationWithPreferences(
    userId: number,
    type: string,
    title: string,
    message: string,
    options: {
      action_text?: string;
      action_url?: string;
      related_car_id?: number;
      related_inquiry_id?: number;
      related_transaction_id?: number;
      priority?: "low" | "medium" | "high" | "urgent";
    } = {}
  ): Promise<Notification | null> {
    const instance = NotificationService.getInstance();

    try {
      // Get user preferences
      const users = await instance.db.execute(
        "SELECT notification_preferences FROM users WHERE id = ?",
        [userId]
      );

      if (users.length === 0) {
        return null;
      }

      const preferences = users[0].notification_preferences
        ? JSON.parse(users[0].notification_preferences)
        : {
            email_notifications: true,
            push_notifications: true,
            sms_notifications: false,
            inquiry_notifications: true,
            system_notifications: true,
            price_alerts: true,
          };

      // Check if user wants this type of notification
      const typePreferences: Record<string, string> = {
        new_inquiry: "inquiry_notifications",
        inquiry_response: "inquiry_notifications",
        car_approved: "system_notifications",
        car_rejected: "system_notifications",
        price_drop_alert: "price_alerts",
        system_maintenance: "system_notifications",
      };

      const preferenceKey = typePreferences[type] || "system_notifications";
      if (!preferences[preferenceKey]) {
        logger.debug(
          `User ${userId} has disabled ${preferenceKey}, skipping notification`
        );
        return null;
      }

      // Create notification
      const notificationData: NotificationData = {
        user_id: userId,
        type,
        title,
        message,
        action_text: options.action_text,
        action_url: options.action_url,
        related_car_id: options.related_car_id,
        related_inquiry_id: options.related_inquiry_id,
        related_transaction_id: options.related_transaction_id,
        priority: options.priority || "medium",
        send_email: preferences.email_notifications,
        send_sms: preferences.sms_notifications,
        send_push: preferences.push_notifications,
      };

      return await instance.createNotificationInternal(notificationData);
    } catch (error) {
      logger.error("Error sending notification with preferences:", error);
      return null;
    }
  }

  /**
   * Create car-related notifications
   */
  static async notifyCarApproved(
    carId: number,
    sellerId: number
  ): Promise<void> {
    const instance = NotificationService.getInstance();

    try {
      const cars = await instance.db.execute(
        "SELECT title FROM cars WHERE id = ?",
        [carId]
      );

      if (cars.length === 0) return;

      await NotificationService.sendNotificationWithPreferences(
        sellerId,
        "car_approved",
        "Car Listing Approved",
        `Your car listing "${cars[0].title}" has been approved and is now live.`,
        {
          related_car_id: carId,
          action_text: "View Listing",
          action_url: `/cars/${carId}`,
        }
      );
    } catch (error) {
      logger.error("Error notifying car approved:", error);
    }
  }

  static async notifyCarRejected(
    carId: number,
    sellerId: number,
    reason: string
  ): Promise<void> {
    const instance = NotificationService.getInstance();

    try {
      const cars = await instance.db.execute(
        "SELECT title FROM cars WHERE id = ?",
        [carId]
      );

      if (cars.length === 0) return;

      await NotificationService.sendNotificationWithPreferences(
        sellerId,
        "car_rejected",
        "Car Listing Rejected",
        `Your car listing "${cars[0].title}" was rejected. Reason: ${reason}`,
        {
          related_car_id: carId,
          action_text: "Edit Listing",
          action_url: `/cars/${carId}/edit`,
          priority: "high",
        }
      );
    } catch (error) {
      logger.error("Error notifying car rejected:", error);
    }
  }

  static async notifyNewInquiry(
    inquiryId: number,
    carId: number,
    sellerId: number,
    buyerId: number
  ): Promise<void> {
    const instance = NotificationService.getInstance();

    try {
      const [cars, buyers] = await Promise.all([
        instance.db.execute("SELECT title FROM cars WHERE id = ?", [carId]),
        instance.db.execute("SELECT first_name FROM users WHERE id = ?", [
          buyerId,
        ]),
      ]);

      if (cars.length === 0 || buyers.length === 0) return;

      await NotificationService.sendNotificationWithPreferences(
        sellerId,
        "new_inquiry",
        "New Car Inquiry",
        `${buyers[0].first_name} is interested in your car "${cars[0].title}".`,
        {
          related_car_id: carId,
          related_inquiry_id: inquiryId,
          action_text: "View Inquiry",
          action_url: `/inquiries/${inquiryId}`,
        }
      );
    } catch (error) {
      logger.error("Error notifying new inquiry:", error);
    }
  }

  static async notifyInquiryResponse(
    inquiryId: number,
    recipientId: number,
    senderName: string
  ): Promise<void> {
    await NotificationService.sendNotificationWithPreferences(
      recipientId,
      "inquiry_response",
      "New Message",
      `${senderName} sent you a message about your car inquiry.`,
      {
        related_inquiry_id: inquiryId,
        action_text: "View Message",
        action_url: `/inquiries/${inquiryId}`,
      }
    );
  }

  static async notifyPriceDropAlert(
    userId: number,
    cars: any[]
  ): Promise<void> {
    if (cars.length === 0) return;

    const carTitles = cars
      .slice(0, 3)
      .map((car) => car.title)
      .join(", ");
    const message =
      cars.length === 1
        ? `Price drop alert: ${carTitles} is now available at a lower price!`
        : `Price drop alert: ${carTitles} and ${
            cars.length > 3 ? `${cars.length - 3} others` : ""
          } are now available at lower prices!`;

    await NotificationService.sendNotificationWithPreferences(
      userId,
      "price_drop_alert",
      "Price Drop Alert",
      message,
      {
        action_text: "View Cars",
        action_url: "/search/alerts",
        priority: "high",
      }
    );
  }

  /**
   * Clean up old notifications
   */
  static async cleanupOldNotifications(daysOld: number = 30): Promise<number> {
    const instance = NotificationService.getInstance();

    try {
      const result = await instance.db.execute(
        "DELETE FROM notifications WHERE is_read = TRUE AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)",
        [daysOld]
      );

      const deletedCount = (result as any).affectedRows;
      logger.info(`Cleaned up ${deletedCount} old notifications`);
      return deletedCount;
    } catch (error) {
      logger.error("Error cleaning up old notifications:", error);
      return 0;
    }
  }

  /**
   * Get notification statistics
   */
  static async getNotificationStats(userId?: number): Promise<any> {
    const instance = NotificationService.getInstance();

    try {
      let query = `
        SELECT 
          type,
          COUNT(*) as total,
          COUNT(CASE WHEN is_read = TRUE THEN 1 END) as read_count,
          COUNT(CASE WHEN is_read = FALSE THEN 1 END) as unread_count
        FROM notifications
      `;

      const params = [];
      if (userId) {
        query += " WHERE user_id = ?";
        params.push(userId);
      }

      query += " GROUP BY type ORDER BY total DESC";

      const stats = await instance.db.execute(query, params);
      return stats;
    } catch (error) {
      logger.error("Error getting notification stats:", error);
      return [];
    }
  }
}

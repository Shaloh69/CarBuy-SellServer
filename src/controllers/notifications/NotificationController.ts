// src/controllers/notifications/NotificationController.ts
import { Request, Response } from "express";
import { DatabaseManager } from "../../config/database";
import {
  asyncHandler,
  NotFoundError,
  AuthorizationError,
} from "../../middleware/errorHandler";
import { NotificationService } from "../../services/realtime/NotificationService";
import SocketManager from "../../config/socket";
import logger from "../../utils/logger";
import { ApiResponse, NotificationData } from "../../types";

export class NotificationController {
  private static db = DatabaseManager.getInstance();
  private static socketManager = SocketManager.getInstance();

  /**
   * Get user notifications with pagination
   */
  static getNotifications = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = (page - 1) * limit;
      const unreadOnly = req.query.unread_only === "true";

      let whereClause = "WHERE user_id = ?";
      const params = [req.user.id];

      if (unreadOnly) {
        whereClause += " AND is_read = FALSE";
      }

      const [notifications, totalCount] = await Promise.all([
        NotificationController.db.execute(
          `
          SELECT 
            n.*,
            c.title as car_title,
            i.id as inquiry_id
          FROM notifications n
          LEFT JOIN cars c ON n.related_car_id = c.id
          LEFT JOIN inquiries i ON n.related_inquiry_id = i.id
          ${whereClause}
          ORDER BY n.created_at DESC
          LIMIT ? OFFSET ?
        `,
          [...params, limit, offset]
        ),

        NotificationController.db.execute(
          `
          SELECT COUNT(*) as count FROM notifications ${whereClause}
        `,
          params
        ),
      ]);

      // Get unread count
      const unreadCount = await NotificationController.db.execute(
        "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE",
        [req.user.id]
      );

      res.json({
        success: true,
        message: "Notifications retrieved successfully",
        data: {
          notifications,
          pagination: {
            page,
            limit,
            total: totalCount[0].count,
            pages: Math.ceil(totalCount[0].count / limit),
          },
          unread_count: unreadCount[0].count,
        },
      } as ApiResponse);
    }
  );

  /**
   * Mark notification as read
   */
  static markAsRead = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const notificationId = parseInt(req.params.id);

      // Check if notification belongs to user
      const notifications = await NotificationController.db.execute(
        "SELECT id, user_id, is_read FROM notifications WHERE id = ?",
        [notificationId]
      );

      if (notifications.length === 0) {
        throw new NotFoundError("Notification not found");
      }

      const notification = notifications[0];

      if (notification.user_id !== req.user.id) {
        throw new AuthorizationError("Access denied");
      }

      if (!notification.is_read) {
        // Mark as read
        await NotificationController.db.execute(
          "UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = ?",
          [notificationId]
        );

        // Emit real-time update
        NotificationController.socketManager.emitToUser(
          req.user.id,
          "notification:read",
          {
            notificationId,
            timestamp: new Date(),
          }
        );
      }

      res.json({
        success: true,
        message: "Notification marked as read",
      } as ApiResponse);
    }
  );

  /**
   * Mark all notifications as read
   */
  static markAllAsRead = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const result = await NotificationController.db.execute(
        "UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = ? AND is_read = FALSE",
        [req.user.id]
      );

      const count = (result as any).affectedRows;

      // Emit real-time update
      NotificationController.socketManager.emitToUser(
        req.user.id,
        "notification:bulk_read",
        {
          count,
          timestamp: new Date(),
        }
      );

      res.json({
        success: true,
        message: `${count} notifications marked as read`,
        data: { count },
      } as ApiResponse);
    }
  );

  /**
   * Delete notification
   */
  static deleteNotification = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const notificationId = parseInt(req.params.id);

      // Check if notification belongs to user
      const notifications = await NotificationController.db.execute(
        "SELECT id, user_id FROM notifications WHERE id = ?",
        [notificationId]
      );

      if (notifications.length === 0) {
        throw new NotFoundError("Notification not found");
      }

      if (notifications[0].user_id !== req.user.id) {
        throw new AuthorizationError("Access denied");
      }

      // Delete notification
      await NotificationController.db.execute(
        "DELETE FROM notifications WHERE id = ?",
        [notificationId]
      );

      res.json({
        success: true,
        message: "Notification deleted successfully",
      } as ApiResponse);
    }
  );

  /**
   * Update notification preferences
   */
  static updatePreferences = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const {
        email_notifications,
        push_notifications,
        sms_notifications,
        daily_digest,
        price_alerts,
        inquiry_notifications,
        system_notifications,
      } = req.body;

      const preferences = {
        email_notifications:
          email_notifications !== undefined ? email_notifications : true,
        push_notifications:
          push_notifications !== undefined ? push_notifications : true,
        sms_notifications:
          sms_notifications !== undefined ? sms_notifications : false,
        daily_digest: daily_digest !== undefined ? daily_digest : true,
        price_alerts: price_alerts !== undefined ? price_alerts : true,
        inquiry_notifications:
          inquiry_notifications !== undefined ? inquiry_notifications : true,
        system_notifications:
          system_notifications !== undefined ? system_notifications : true,
      };

      // Update user preferences
      await NotificationController.db.execute(
        "UPDATE users SET notification_preferences = ? WHERE id = ?",
        [JSON.stringify(preferences), req.user.id]
      );

      // Emit real-time update
      NotificationController.socketManager.emitToUser(
        req.user.id,
        "notification:preferences_updated",
        {
          preferences,
          timestamp: new Date(),
        }
      );

      res.json({
        success: true,
        message: "Notification preferences updated successfully",
        data: { preferences },
      } as ApiResponse);
    }
  );

  /**
   * Get notification preferences
   */
  static getPreferences = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const users = await NotificationController.db.execute(
        "SELECT notification_preferences FROM users WHERE id = ?",
        [req.user.id]
      );

      const preferences = users[0]?.notification_preferences
        ? JSON.parse(users[0].notification_preferences)
        : {
            email_notifications: true,
            push_notifications: true,
            sms_notifications: false,
            daily_digest: true,
            price_alerts: true,
            inquiry_notifications: true,
            system_notifications: true,
          };

      res.json({
        success: true,
        message: "Notification preferences retrieved successfully",
        data: { preferences },
      } as ApiResponse);
    }
  );

  /**
   * Create notification (for testing/admin use)
   */
  static createNotification = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Only allow admin/moderator to create notifications
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Insufficient permissions");
      }

      const notificationData: NotificationData = {
        user_id: req.body.user_id,
        type: req.body.type,
        title: req.body.title,
        message: req.body.message,
        action_text: req.body.action_text,
        action_url: req.body.action_url,
        related_car_id: req.body.related_car_id,
        related_inquiry_id: req.body.related_inquiry_id,
        priority: req.body.priority || "medium",
        send_email: req.body.send_email || false,
        send_sms: req.body.send_sms || false,
        send_push: req.body.send_push || false,
      };

      const notification = await NotificationService.createNotification(
        notificationData
      );

      res.json({
        success: true,
        message: "Notification created successfully",
        data: { notification },
      } as ApiResponse);
    }
  );
}

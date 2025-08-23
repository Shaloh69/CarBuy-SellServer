// src/services/realtime/SocketService.ts
import { Server as SocketServer } from "socket.io";
import redis from "../../config/redis";
import logger from "../../utils/logger";
import { DatabaseManager } from "../../config/database";
import {
  CarEvents,
  CommunicationEvents,
  NotificationEvents,
  UserEvents,
} from "../../types/socket";

export class SocketService {
  private static instance: SocketService;
  private io: SocketServer;
  private db: DatabaseManager;
  private connectedUsers: Map<number, string[]> = new Map();
  private userSessions: Map<string, number> = new Map();
  private carViewers: Map<number, Set<number>> = new Map(); // carId -> Set of userIds

  private constructor() {
    this.db = DatabaseManager.getInstance();
  }

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  public setSocketServer(io: SocketServer): void {
    this.io = io;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.io.on("connection", (socket) => {
      const userId = socket.data.userId;
      logger.info(`User ${userId} connected with socket ${socket.id}`);

      this.trackUserConnection(userId, socket.id);
      this.joinUserRooms(socket, userId);
      this.handleCarEvents(socket, userId);
      this.handleCommunicationEvents(socket, userId);
      this.handleNotificationEvents(socket, userId);
      this.handleUserEvents(socket, userId);
      this.handleDisconnection(socket, userId);
    });
  }

  /**
   * Handle car-related events
   */
  private handleCarEvents(socket: any, userId: number): void {
    // Car viewing events
    socket.on("car:view_start", async (data: { carId: number }) => {
      try {
        await this.handleCarViewStart(data.carId, userId, socket);
      } catch (error) {
        logger.error("Error handling car view start:", error);
      }
    });

    socket.on(
      "car:view_end",
      async (data: { carId: number; duration: number }) => {
        try {
          await this.handleCarViewEnd(data.carId, userId, data.duration);
        } catch (error) {
          logger.error("Error handling car view end:", error);
        }
      }
    );

    // Car interaction events
    socket.on("car:favorite", async (data: { carId: number }) => {
      try {
        await this.handleCarFavorite(data.carId, userId);
      } catch (error) {
        logger.error("Error handling car favorite:", error);
      }
    });

    socket.on("car:unfavorite", async (data: { carId: number }) => {
      try {
        await this.handleCarUnfavorite(data.carId, userId);
      } catch (error) {
        logger.error("Error handling car unfavorite:", error);
      }
    });

    // Car sharing
    socket.on(
      "car:share",
      async (data: { carId: number; platform: string }) => {
        try {
          await this.handleCarShare(data.carId, userId, data.platform);
        } catch (error) {
          logger.error("Error handling car share:", error);
        }
      }
    );

    // Car reporting
    socket.on(
      "car:report",
      async (data: { carId: number; reason: string; description?: string }) => {
        try {
          await this.handleCarReport(
            data.carId,
            userId,
            data.reason,
            data.description
          );
        } catch (error) {
          logger.error("Error handling car report:", error);
        }
      }
    );
  }

  /**
   * Handle communication events
   */
  private handleCommunicationEvents(socket: any, userId: number): void {
    // Inquiry events
    socket.on(
      "inquiry:send",
      async (data: { carId: number; message: string; sellerId: number }) => {
        try {
          const inquiryId = await this.handleInquirySend(
            data.carId,
            userId,
            data.sellerId,
            data.message
          );

          // Notify seller
          this.emitToUser(data.sellerId, "inquiry:new", {
            inquiryId,
            buyerId: userId,
            carId: data.carId,
            message: data.message,
            timestamp: new Date(),
          });

          // Confirm to sender
          socket.emit("inquiry:sent", {
            inquiryId,
            carId: data.carId,
            timestamp: new Date(),
          });
        } catch (error) {
          logger.error("Error handling inquiry send:", error);
          socket.emit("inquiry:error", { message: "Failed to send inquiry" });
        }
      }
    );

    socket.on(
      "inquiry:respond",
      async (data: {
        inquiryId: number;
        message: string;
        recipientId: number;
      }) => {
        try {
          await this.handleInquiryResponse(
            data.inquiryId,
            userId,
            data.message
          );

          // Notify recipient
          this.emitToUser(data.recipientId, "inquiry:response", {
            inquiryId: data.inquiryId,
            senderId: userId,
            message: data.message,
            timestamp: new Date(),
          });
        } catch (error) {
          logger.error("Error handling inquiry response:", error);
        }
      }
    );

    socket.on(
      "inquiry:status_change",
      async (data: {
        inquiryId: number;
        status: string;
        recipientId: number;
      }) => {
        try {
          await this.handleInquiryStatusChange(data.inquiryId, data.status);

          // Notify other party
          this.emitToUser(data.recipientId, "inquiry:status_change", {
            inquiryId: data.inquiryId,
            status: data.status,
            timestamp: new Date(),
          });
        } catch (error) {
          logger.error("Error handling inquiry status change:", error);
        }
      }
    );

    // Typing indicators
    socket.on(
      "inquiry:typing",
      (data: { inquiryId: number; recipientId: number; isTyping: boolean }) => {
        this.emitToUser(data.recipientId, "inquiry:typing", {
          inquiryId: data.inquiryId,
          senderId: userId,
          isTyping: data.isTyping,
        });
      }
    );

    // Test drive scheduling
    socket.on(
      "test_drive:schedule",
      async (data: {
        inquiryId: number;
        datetime: string;
        location: string;
        recipientId: number;
      }) => {
        try {
          await this.handleTestDriveSchedule(
            data.inquiryId,
            data.datetime,
            data.location
          );

          // Notify other party
          this.emitToUser(data.recipientId, "test_drive:scheduled", {
            inquiryId: data.inquiryId,
            datetime: data.datetime,
            location: data.location,
            scheduledBy: userId,
            timestamp: new Date(),
          });
        } catch (error) {
          logger.error("Error handling test drive schedule:", error);
        }
      }
    );
  }

  /**
   * Handle notification events
   */
  private handleNotificationEvents(socket: any, userId: number): void {
    socket.on("notification:read", async (data: { notificationId: number }) => {
      try {
        await this.handleNotificationRead(data.notificationId, userId);

        socket.emit("notification:read_confirmed", {
          notificationId: data.notificationId,
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error("Error handling notification read:", error);
      }
    });

    socket.on("notification:read_all", async () => {
      try {
        const count = await this.handleNotificationReadAll(userId);

        socket.emit("notification:bulk_read", {
          count,
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error("Error handling notification read all:", error);
      }
    });

    socket.on(
      "notification:settings_update",
      async (data: { settings: any }) => {
        try {
          await this.handleNotificationSettingsUpdate(userId, data.settings);

          socket.emit("notification:settings_updated", {
            settings: data.settings,
            timestamp: new Date(),
          });
        } catch (error) {
          logger.error("Error handling notification settings update:", error);
        }
      }
    );
  }

  /**
   * Handle user events
   */
  private handleUserEvents(socket: any, userId: number): void {
    socket.on(
      "user:status_update",
      async (data: { status: "online" | "away" | "busy" }) => {
        try {
          await this.handleUserStatusUpdate(userId, data.status);

          // Broadcast to user's contacts/followers
          this.broadcastToUserConnections(userId, "user:status_changed", {
            userId,
            status: data.status,
            timestamp: new Date(),
          });
        } catch (error) {
          logger.error("Error handling user status update:", error);
        }
      }
    );

    socket.on(
      "user:location_update",
      async (data: { latitude: number; longitude: number }) => {
        try {
          await this.handleUserLocationUpdate(
            userId,
            data.latitude,
            data.longitude
          );

          // Update location-based rooms
          await this.updateUserLocationRooms(
            socket,
            userId,
            data.latitude,
            data.longitude
          );
        } catch (error) {
          logger.error("Error handling user location update:", error);
        }
      }
    );

    socket.on("user:preferences_update", async (data: { preferences: any }) => {
      try {
        await this.handleUserPreferencesUpdate(userId, data.preferences);

        socket.emit("user:preferences_updated", {
          preferences: data.preferences,
          timestamp: new Date(),
        });
      } catch (error) {
        logger.error("Error handling user preferences update:", error);
      }
    });
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(socket: any, userId: number): void {
    socket.on("disconnect", (reason) => {
      logger.info(`User ${userId} disconnected: ${reason}`);
      this.trackUserDisconnection(userId, socket.id);
    });
  }

  // Car event handlers

  private async handleCarViewStart(
    carId: number,
    userId: number,
    socket: any
  ): Promise<void> {
    // Track view start
    await redis.set(`car:${carId}:view:${userId}`, Date.now(), 3600); // 1 hour TTL

    // Add to car viewers
    if (!this.carViewers.has(carId)) {
      this.carViewers.set(carId, new Set());
    }
    this.carViewers.get(carId)!.add(userId);

    // Join car viewing room
    socket.join(`car:${carId}:viewers`);

    // Update live viewer count
    const viewerCount = this.carViewers.get(carId)!.size;
    this.io.to(`car:${carId}:viewers`).emit("car:live_viewers", {
      carId,
      count: viewerCount,
    });

    // Track analytics
    await this.trackCarView(carId, userId, "start");

    // Notify car owner
    await this.notifyCarOwner(carId, "car:view_start", {
      carId,
      viewerId: userId,
    });
  }

  private async handleCarViewEnd(
    carId: number,
    userId: number,
    duration: number
  ): Promise<void> {
    // Remove from viewers
    if (this.carViewers.has(carId)) {
      this.carViewers.get(carId)!.delete(userId);

      // Update live viewer count
      const viewerCount = this.carViewers.get(carId)!.size;
      this.io.to(`car:${carId}:viewers`).emit("car:live_viewers", {
        carId,
        count: viewerCount,
      });
    }

    // Clean up view tracking
    await redis.del(`car:${carId}:view:${userId}`);

    // Track analytics with duration
    await this.trackCarView(carId, userId, "end", duration);
  }

  private async handleCarFavorite(
    carId: number,
    userId: number
  ): Promise<void> {
    // Add to favorites
    await this.db.execute(
      "INSERT IGNORE INTO user_favorites (user_id, car_id, created_at) VALUES (?, ?, NOW())",
      [userId, carId]
    );

    // Update car favorites count
    await this.db.execute(
      "UPDATE cars SET favorites_count = (SELECT COUNT(*) FROM user_favorites WHERE car_id = ?) WHERE id = ?",
      [carId, carId]
    );

    // Notify car owner
    await this.notifyCarOwner(carId, "car:favorited", { carId, userId });
  }

  private async handleCarUnfavorite(
    carId: number,
    userId: number
  ): Promise<void> {
    // Remove from favorites
    await this.db.execute(
      "DELETE FROM user_favorites WHERE user_id = ? AND car_id = ?",
      [userId, carId]
    );

    // Update car favorites count
    await this.db.execute(
      "UPDATE cars SET favorites_count = (SELECT COUNT(*) FROM user_favorites WHERE car_id = ?) WHERE id = ?",
      [carId, carId]
    );
  }

  private async handleCarShare(
    carId: number,
    userId: number,
    platform: string
  ): Promise<void> {
    // Track sharing analytics
    await this.db.execute(
      "INSERT INTO car_shares (car_id, user_id, platform, created_at) VALUES (?, ?, ?, NOW())",
      [carId, userId, platform]
    );

    // Update share count
    await this.db.execute(
      "UPDATE cars SET shares_count = shares_count + 1 WHERE id = ?",
      [carId]
    );
  }

  private async handleCarReport(
    carId: number,
    userId: number,
    reason: string,
    description?: string
  ): Promise<void> {
    // Create report
    await this.db.execute(
      "INSERT INTO car_reports (car_id, reporter_id, reason, description, status, created_at) VALUES (?, ?, ?, ?, 'pending', NOW())",
      [carId, userId, reason, description || null]
    );

    // Notify admins
    this.io.to("admin_room").emit("car:reported", {
      carId,
      reporterId: userId,
      reason,
      description,
      timestamp: new Date(),
    });
  }

  // Communication event handlers

  private async handleInquirySend(
    carId: number,
    buyerId: number,
    sellerId: number,
    message: string
  ): Promise<number> {
    const result = await this.db.execute(
      "INSERT INTO inquiries (car_id, buyer_id, seller_id, message, status, created_at) VALUES (?, ?, ?, ?, 'active', NOW())",
      [carId, buyerId, sellerId, message]
    );

    const inquiryId = (result as any).insertId;

    // Track inquiry analytics
    await this.trackInquiry(inquiryId, carId, buyerId, sellerId);

    return inquiryId;
  }

  private async handleInquiryResponse(
    inquiryId: number,
    senderId: number,
    message: string
  ): Promise<void> {
    // Add response to inquiry messages
    await this.db.execute(
      "INSERT INTO inquiry_messages (inquiry_id, sender_id, message, created_at) VALUES (?, ?, ?, NOW())",
      [inquiryId, senderId, message]
    );

    // Update inquiry last activity
    await this.db.execute(
      "UPDATE inquiries SET last_activity = NOW() WHERE id = ?",
      [inquiryId]
    );
  }

  private async handleInquiryStatusChange(
    inquiryId: number,
    status: string
  ): Promise<void> {
    await this.db.execute(
      "UPDATE inquiries SET status = ?, updated_at = NOW() WHERE id = ?",
      [status, inquiryId]
    );
  }

  private async handleTestDriveSchedule(
    inquiryId: number,
    datetime: string,
    location: string
  ): Promise<void> {
    await this.db.execute(
      "INSERT INTO test_drives (inquiry_id, scheduled_datetime, location, status, created_at) VALUES (?, ?, ?, 'scheduled', NOW())",
      [inquiryId, datetime, location]
    );
  }

  // Notification event handlers

  private async handleNotificationRead(
    notificationId: number,
    userId: number
  ): Promise<void> {
    await this.db.execute(
      "UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = ? AND user_id = ?",
      [notificationId, userId]
    );
  }

  private async handleNotificationReadAll(userId: number): Promise<number> {
    const result = await this.db.execute(
      "UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = ? AND is_read = FALSE",
      [userId]
    );

    return (result as any).affectedRows;
  }

  private async handleNotificationSettingsUpdate(
    userId: number,
    settings: any
  ): Promise<void> {
    await this.db.execute(
      "UPDATE users SET notification_preferences = ? WHERE id = ?",
      [JSON.stringify(settings), userId]
    );
  }

  // User event handlers

  private async handleUserStatusUpdate(
    userId: number,
    status: string
  ): Promise<void> {
    await redis.set(`user:${userId}:status`, status, 3600); // 1 hour TTL

    await this.db.execute(
      "UPDATE users SET last_activity = NOW(), online_status = ? WHERE id = ?",
      [status, userId]
    );
  }

  private async handleUserLocationUpdate(
    userId: number,
    latitude: number,
    longitude: number
  ): Promise<void> {
    await redis.hset(`user:${userId}:location`, {
      lat: latitude.toString(),
      lng: longitude.toString(),
      updated: Date.now().toString(),
    });
  }

  private async handleUserPreferencesUpdate(
    userId: number,
    preferences: any
  ): Promise<void> {
    await this.db.execute("UPDATE users SET preferences = ? WHERE id = ?", [
      JSON.stringify(preferences),
      userId,
    ]);
  }

  // Helper methods

  private trackUserConnection(userId: number, socketId: string): void {
    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, []);
    }
    this.connectedUsers.get(userId)!.push(socketId);
    this.userSessions.set(socketId, userId);

    // Update online status
    redis.set(`user:${userId}:online`, "true", 300); // 5 minutes TTL
  }

  private trackUserDisconnection(userId: number, socketId: string): void {
    const userSockets = this.connectedUsers.get(userId);
    if (userSockets) {
      const index = userSockets.indexOf(socketId);
      if (index > -1) {
        userSockets.splice(index, 1);
      }

      if (userSockets.length === 0) {
        this.connectedUsers.delete(userId);
        // Mark user as offline after grace period
        setTimeout(() => {
          if (!this.connectedUsers.has(userId)) {
            redis.del(`user:${userId}:online`);
          }
        }, 30000); // 30 seconds grace period
      }
    }
    this.userSessions.delete(socketId);
  }

  private async joinUserRooms(socket: any, userId: number): Promise<void> {
    // Join user-specific room
    socket.join(`user:${userId}`);

    // Join role-based rooms
    const user = await this.getUserById(userId);
    if (user) {
      socket.join(`role:${user.role}`);

      if (user.role === "admin" || user.role === "moderator") {
        socket.join("admin_room");
      }

      // Join location-based rooms
      if (user.city_id) {
        socket.join(`location:${user.city_id}`);
      }
      if (user.province_id) {
        socket.join(`province:${user.province_id}`);
      }
      if (user.region_id) {
        socket.join(`region:${user.region_id}`);
      }
    }
  }

  private async updateUserLocationRooms(
    socket: any,
    userId: number,
    lat: number,
    lng: number
  ): Promise<void> {
    // Find nearest city and update rooms
    const nearestCity = await this.findNearestCity(lat, lng);
    if (nearestCity) {
      socket.join(`location:${nearestCity.id}`);
    }
  }

  // Public emission methods

  public emitToUser(userId: number, event: string, data: any): void {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  public emitToLocation(cityId: number, event: string, data: any): void {
    this.io.to(`location:${cityId}`).emit(event, data);
  }

  public emitToCarWatchers(carId: number, event: string, data: any): void {
    this.io.to(`car:${carId}:watchers`).emit(event, data);
  }

  public emitToRole(role: string, event: string, data: any): void {
    this.io.to(`role:${role}`).emit(event, data);
  }

  public emitGlobally(event: string, data: any): void {
    this.io.emit(event, data);
  }

  // Car lifecycle notifications

  public notifyCarApproved(carId: number, sellerId: number): void {
    this.emitToUser(sellerId, "car:approved", {
      carId,
      timestamp: new Date(),
    });
  }

  public notifyCarRejected(
    carId: number,
    sellerId: number,
    reason: string
  ): void {
    this.emitToUser(sellerId, "car:rejected", {
      carId,
      reason,
      timestamp: new Date(),
    });
  }

  public notifyCarSold(carId: number, buyerId: number, sellerId: number): void {
    this.emitToCarWatchers(carId, "car:sold", {
      carId,
      buyerId,
      sellerId,
      timestamp: new Date(),
    });

    this.emitToUser(sellerId, "car:sold", {
      carId,
      buyerId,
      timestamp: new Date(),
    });
  }

  public notifyPriceChanged(
    carId: number,
    oldPrice: number,
    newPrice: number
  ): void {
    this.emitToCarWatchers(carId, "car:price_changed", {
      carId,
      oldPrice,
      newPrice,
      timestamp: new Date(),
    });
  }

  // Utility methods

  private async getUserById(userId: number): Promise<any> {
    const users = await this.db.execute(
      "SELECT id, role, city_id, province_id, region_id FROM users WHERE id = ?",
      [userId]
    );
    return users.length > 0 ? users[0] : null;
  }

  private async findNearestCity(lat: number, lng: number): Promise<any> {
    const cities = await this.db.execute(
      `SELECT id, name, ST_Distance_Sphere(location_point, ST_SRID(POINT(?, ?), 4326)) / 1000 as distance_km
       FROM ph_cities 
       ORDER BY distance_km ASC 
       LIMIT 1`,
      [lng, lat]
    );
    return cities.length > 0 ? cities[0] : null;
  }

  private async notifyCarOwner(
    carId: number,
    event: string,
    data: any
  ): Promise<void> {
    const car = await this.db.execute(
      "SELECT seller_id FROM cars WHERE id = ?",
      [carId]
    );

    if (car.length > 0) {
      this.emitToUser(car[0].seller_id, event, data);
    }
  }

  private async trackCarView(
    carId: number,
    userId: number,
    type: "start" | "end",
    duration?: number
  ): Promise<void> {
    if (type === "start") {
      await this.db.execute(
        "INSERT INTO car_views (car_id, user_id, viewed_at) VALUES (?, ?, NOW())",
        [carId, userId]
      );
    } else if (type === "end" && duration) {
      await this.db.execute(
        "UPDATE car_views SET duration = ? WHERE car_id = ? AND user_id = ? ORDER BY viewed_at DESC LIMIT 1",
        [duration, carId, userId]
      );
    }
  }

  private async trackInquiry(
    inquiryId: number,
    carId: number,
    buyerId: number,
    sellerId: number
  ): Promise<void> {
    await this.db.execute(
      "INSERT INTO inquiry_analytics (inquiry_id, car_id, buyer_id, seller_id, created_at) VALUES (?, ?, ?, ?, NOW())",
      [inquiryId, carId, buyerId, sellerId]
    );
  }

  private async broadcastToUserConnections(
    userId: number,
    event: string,
    data: any
  ): Promise<void> {
    // Get user's connections/followers and broadcast to them
    // This would be implemented based on your social features
    logger.info(`Broadcasting ${event} from user ${userId}`);
  }

  // Statistics methods

  public getConnectedUserCount(): number {
    return this.connectedUsers.size;
  }

  public getSocketCount(): number {
    return this.userSessions.size;
  }

  public isUserOnline(userId: number): boolean {
    return this.connectedUsers.has(userId);
  }

  public getCarViewers(carId: number): number {
    return this.carViewers.get(carId)?.size || 0;
  }
}

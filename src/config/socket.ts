import { Server as HttpServer } from "http";
import { Server as SocketServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import redis from "./redis";
import { config } from "./env";
import logger from "../utils/logger";
import { verifyToken } from "../utils/auth";
import {
  CarEvents,
  CommunicationEvents,
  NotificationEvents,
  UserEvents,
} from "../types/socket";

class SocketManager {
  private static instance: SocketManager;
  private io: SocketServer;
  private connectedUsers: Map<number, string[]> = new Map(); // userId -> socketIds
  private userSessions: Map<string, number> = new Map(); // socketId -> userId

  private constructor() {
    // Will be initialized when server is created
  }

  public static getInstance(): SocketManager {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  public async initialize(httpServer: HttpServer): Promise<void> {
    this.io = new SocketServer(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      transports: ["websocket", "polling"],
    });

    // Setup Redis adapter for multi-instance support
    if (config.features.enableRealTimeUpdates) {
      const pubClient = redis.getPublisher();
      const subClient = redis.getSubscriber();
      this.io.adapter(createAdapter(pubClient, subClient));
      logger.info("Socket.IO Redis adapter configured");
    }

    this.setupMiddleware();
    this.setupEventHandlers();

    logger.info("Socket.IO server initialized");
  }

  private setupMiddleware(): void {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth.token ||
          socket.handshake.headers.authorization?.replace("Bearer ", "");

        if (!token) {
          return next(new Error("Authentication required"));
        }

        const decoded = await verifyToken(token);
        socket.data.userId = decoded.userId;
        socket.data.userRole = decoded.role;

        next();
      } catch (error) {
        next(new Error("Invalid authentication token"));
      }
    });

    // Rate limiting middleware
    this.io.use(async (socket, next) => {
      const clientIp = socket.handshake.address;
      const rateLimitKey = `socket_rate_limit:${clientIp}`;

      try {
        const count = await redis.incr(rateLimitKey);
        if (count === 1) {
          await redis.expire(rateLimitKey, 60); // 1 minute window
        }

        if (count > 100) {
          // 100 events per minute per IP
          return next(new Error("Rate limit exceeded"));
        }

        next();
      } catch (error) {
        next();
      }
    });
  }

  private setupEventHandlers(): void {
    this.io.on("connection", (socket) => {
      const userId = socket.data.userId;
      logger.info(`User ${userId} connected with socket ${socket.id}`);

      // Track user connection
      this.trackUserConnection(userId, socket.id);

      // Join user-specific room
      socket.join(`user:${userId}`);

      // Join location-based rooms if user has location
      this.joinLocationRooms(socket, userId);

      // Handle car viewing events
      this.handleCarEvents(socket, userId);

      // Handle communication events
      this.handleCommunicationEvents(socket, userId);

      // Handle user events
      this.handleUserEvents(socket, userId);

      // Handle disconnection
      socket.on("disconnect", (reason) => {
        logger.info(`User ${userId} disconnected: ${reason}`);
        this.trackUserDisconnection(userId, socket.id);
      });
    });
  }

  private async joinLocationRooms(socket: any, userId: number): Promise<void> {
    try {
      // Get user's location from database and join relevant rooms
      // This would be implemented based on user's city/region
      const userLocation = await this.getUserLocation(userId);
      if (userLocation) {
        socket.join(`location:${userLocation.cityId}`);
        socket.join(`region:${userLocation.regionId}`);
      }
    } catch (error) {
      logger.error("Error joining location rooms:", error);
    }
  }

  private handleCarEvents(socket: any, userId: number): void {
    // Car viewing events
    socket.on("car:view_start", async (data: { carId: number }) => {
      try {
        // Track view start
        await this.trackCarView(data.carId, userId, "start");

        // Join car-specific room for live updates
        socket.join(`car:${data.carId}`);

        // Emit to car owner about live viewer
        this.emitToCarOwner(data.carId, "car:live_viewers", {
          carId: data.carId,
          viewerCount: await this.getCarViewerCount(data.carId),
        });
      } catch (error) {
        logger.error("Error handling car view start:", error);
      }
    });

    socket.on(
      "car:view_end",
      async (data: { carId: number; duration: number }) => {
        try {
          // Track view end
          await this.trackCarView(data.carId, userId, "end", data.duration);

          // Leave car-specific room
          socket.leave(`car:${data.carId}`);

          // Update live viewer count
          this.emitToCarOwner(data.carId, "car:live_viewers", {
            carId: data.carId,
            viewerCount: await this.getCarViewerCount(data.carId),
          });
        } catch (error) {
          logger.error("Error handling car view end:", error);
        }
      }
    );

    // Car favoriting
    socket.on("car:favorite", async (data: { carId: number }) => {
      try {
        socket.join(`car:${data.carId}:watchers`);

        // Notify car owner
        this.emitToCarOwner(data.carId, "car:favorited", {
          carId: data.carId,
          userId,
        });
      } catch (error) {
        logger.error("Error handling car favorite:", error);
      }
    });

    socket.on("car:unfavorite", async (data: { carId: number }) => {
      socket.leave(`car:${data.carId}:watchers`);
    });
  }

  private handleCommunicationEvents(socket: any, userId: number): void {
    // Inquiry events
    socket.on(
      "inquiry:send",
      async (data: { carId: number; message: string; sellerId: number }) => {
        try {
          // Join inquiry room
          socket.join(`inquiry:${data.carId}:${userId}:${data.sellerId}`);

          // Notify seller
          this.io.to(`user:${data.sellerId}`).emit("inquiry:new", {
            carId: data.carId,
            buyerId: userId,
            message: data.message,
            timestamp: new Date(),
          });

          // Send confirmation to buyer
          socket.emit("inquiry:sent", {
            carId: data.carId,
            sellerId: data.sellerId,
          });
        } catch (error) {
          logger.error("Error handling inquiry send:", error);
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
          // Notify recipient
          this.io.to(`user:${data.recipientId}`).emit("inquiry:response", {
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

    // Typing indicators
    socket.on(
      "inquiry:typing",
      (data: { inquiryId: number; recipientId: number; isTyping: boolean }) => {
        this.io.to(`user:${data.recipientId}`).emit("inquiry:typing", {
          inquiryId: data.inquiryId,
          senderId: userId,
          isTyping: data.isTyping,
        });
      }
    );
  }

  private handleUserEvents(socket: any, userId: number): void {
    // User online status
    socket.on("user:online", () => {
      this.io.emit("user:status", {
        userId,
        status: "online",
        timestamp: new Date(),
      });
    });

    // Location updates
    socket.on(
      "user:location_update",
      async (data: { lat: number; lng: number }) => {
        try {
          // Update user's current location for nearby search
          await this.updateUserLocation(userId, data.lat, data.lng);

          // Join new location rooms if changed
          await this.joinLocationRooms(socket, userId);
        } catch (error) {
          logger.error("Error handling location update:", error);
        }
      }
    );
  }

  // Public methods for emitting events
  public emitToUser(userId: number, event: string, data: any): void {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  public emitToLocation(cityId: number, event: string, data: any): void {
    this.io.to(`location:${cityId}`).emit(event, data);
  }

  public emitToCarWatchers(carId: number, event: string, data: any): void {
    this.io.to(`car:${carId}:watchers`).emit(event, data);
  }

  public emitToCarViewers(carId: number, event: string, data: any): void {
    this.io.to(`car:${carId}`).emit(event, data);
  }

  public emitGlobally(event: string, data: any): void {
    this.io.emit(event, data);
  }

  // Car-specific notifications
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

  public notifyCarSold(carId: number, buyerId: number, sellerId: number): void {
    this.emitToCarWatchers(carId, "car:sold", {
      carId,
      buyerId,
      sellerId,
      timestamp: new Date(),
    });

    // Remove from active listings
    this.io.emit("car:removed", { carId });
  }

  // Helper methods
  private trackUserConnection(userId: number, socketId: string): void {
    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, []);
    }
    this.connectedUsers.get(userId)!.push(socketId);
    this.userSessions.set(socketId, userId);

    // Update user online status in Redis
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
        // Mark user as offline after a delay
        setTimeout(() => {
          if (!this.connectedUsers.has(userId)) {
            redis.del(`user:${userId}:online`);
          }
        }, 30000); // 30 seconds grace period
      }
    }
    this.userSessions.delete(socketId);
  }

  private async trackCarView(
    carId: number,
    userId: number,
    type: "start" | "end",
    duration?: number
  ): Promise<void> {
    const key = `car:${carId}:views:${userId}`;
    if (type === "start") {
      await redis.set(key, Date.now().toString(), 3600); // 1 hour TTL
    } else {
      await redis.del(key);
      // Store view duration for analytics
      if (duration) {
        await redis.lPush(`car:${carId}:view_durations`, duration.toString());
      }
    }
  }

  private async getCarViewerCount(carId: number): Promise<number> {
    const pattern = `car:${carId}:views:*`;
    const keys = await redis.keys(pattern);
    return keys.length;
  }

  private async emitToCarOwner(
    carId: number,
    event: string,
    data: any
  ): Promise<void> {
    try {
      // Get car owner from database
      const ownerId = await this.getCarOwnerId(carId);
      if (ownerId) {
        this.emitToUser(ownerId, event, data);
      }
    } catch (error) {
      logger.error("Error emitting to car owner:", error);
    }
  }

  private async getUserLocation(
    userId: number
  ): Promise<{ cityId: number; regionId: number } | null> {
    // Implementation would fetch from database
    // This is a placeholder
    return null;
  }

  private async updateUserLocation(
    userId: number,
    lat: number,
    lng: number
  ): Promise<void> {
    // Store user's current location in Redis for nearby searches
    await redis.hSet(`user:${userId}:location`, "lat", lat.toString());
    await redis.hSet(`user:${userId}:location`, "lng", lng.toString());
    await redis.hSet(
      `user:${userId}:location`,
      "updated",
      Date.now().toString()
    );
  }

  private async getCarOwnerId(carId: number): Promise<number | null> {
    // Implementation would fetch from database
    // This is a placeholder
    return null;
  }

  public getConnectedUserCount(): number {
    return this.connectedUsers.size;
  }

  public getSocketCount(): number {
    return this.userSessions.size;
  }

  public isUserOnline(userId: number): boolean {
    return this.connectedUsers.has(userId);
  }

  public getIO(): SocketServer {
    return this.io;
  }
}

export default SocketManager;

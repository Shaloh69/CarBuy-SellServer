// src/controllers/admin/AdminController.ts
import { Request, Response } from "express";
import DatabaseManager from "../../config/database";
import {
  asyncHandler,
  NotFoundError,
  AuthorizationError,
} from "../../middleware/errorHandler";
import { QueueManager } from "../../services/background/QueueManager";
import redis from "../../config/redis";
import logger from "../../utils/logger";
import { ApiResponse } from "../../types";

export class AdminController {
  private static db = DatabaseManager.getInstance();
  private static queueManager = QueueManager.getInstance();

  /**
   * Get admin dashboard statistics
   */
  static getDashboard = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      // Check cache first
      const cacheKey = "admin:dashboard:stats";
      const cached = await redis.get(cacheKey);

      if (cached) {
        res.json({
          success: true,
          message: "Dashboard statistics retrieved successfully",
          data: JSON.parse(cached),
          cached: true,
        } as ApiResponse);
        return;
      }

      // Get comprehensive statistics
      const [
        totalCars,
        pendingCars,
        activeCars,
        totalUsers,
        newUsersToday,
        totalInquiries,
        newInquiriesToday,
        revenueStats,
        popularBrands,
        topCities,
        fraudReports,
        systemHealth,
      ] = await Promise.all([
        AdminController.getTotalCars(),
        AdminController.getPendingCars(),
        AdminController.getActiveCars(),
        AdminController.getTotalUsers(),
        AdminController.getNewUsersToday(),
        AdminController.getTotalInquiries(),
        AdminController.getNewInquiriesToday(),
        AdminController.getRevenueStats(),
        AdminController.getPopularBrands(),
        AdminController.getTopCities(),
        AdminController.getFraudReports(),
        AdminController.getSystemHealth(),
      ]);

      const dashboardData = {
        overview: {
          total_cars: totalCars,
          pending_cars: pendingCars,
          active_cars: activeCars,
          total_users: totalUsers,
          new_users_today: newUsersToday,
          total_inquiries: totalInquiries,
          new_inquiries_today: newInquiriesToday,
        },
        revenue: revenueStats,
        popular_brands: popularBrands,
        top_cities: topCities,
        fraud_reports: fraudReports,
        system_health: systemHealth,
        last_updated: new Date(),
      };

      // Cache for 5 minutes
      await redis.setex(cacheKey, 300, JSON.stringify(dashboardData));

      res.json({
        success: true,
        message: "Dashboard statistics retrieved successfully",
        data: dashboardData,
        cached: false,
      } as ApiResponse);
    }
  );

  /**
   * Get cars pending approval
   */
  static getPendingCars = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = (page - 1) * limit;

      const [pendingCars, totalCount] = await Promise.all([
        AdminController.db.execute(
          `
          SELECT 
            c.*,
            b.name as brand_name,
            m.name as model_name,
            ct.name as city_name,
            u.first_name as seller_name,
            u.email as seller_email,
            u.is_verified as seller_verified,
            COUNT(ci.id) as image_count
          FROM cars c
          INNER JOIN brands b ON c.brand_id = b.id
          INNER JOIN models m ON c.model_id = m.id
          INNER JOIN ph_cities ct ON c.city_id = ct.id
          INNER JOIN users u ON c.seller_id = u.id
          LEFT JOIN car_images ci ON c.id = ci.car_id
          WHERE c.approval_status = 'pending'
          GROUP BY c.id
          ORDER BY c.created_at ASC
          LIMIT ? OFFSET ?
        `,
          [limit, offset]
        ),

        AdminController.db.execute(
          "SELECT COUNT(*) as count FROM cars WHERE approval_status = 'pending'"
        ),
      ]);

      res.json({
        success: true,
        message: "Pending cars retrieved successfully",
        data: {
          cars: pendingCars,
          pagination: {
            page,
            limit,
            total: totalCount[0].count,
            pages: Math.ceil(totalCount[0].count / limit),
          },
        },
      } as ApiResponse);
    }
  );

  /**
   * Approve car listing
   */
  static approveCar = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const carId = parseInt(req.params.id);
      const { notes } = req.body;

      // Get car details
      const cars = await AdminController.db.execute(
        "SELECT id, seller_id, title FROM cars WHERE id = ? AND approval_status = 'pending'",
        [carId]
      );

      if (cars.length === 0) {
        throw new NotFoundError("Car not found or already processed");
      }

      const car = cars[0];

      // Update car status
      await AdminController.db.execute(
        "UPDATE cars SET approval_status = 'approved', approved_by = ?, approved_at = NOW(), approval_notes = ? WHERE id = ?",
        [req.user!.id, notes || null, carId]
      );

      // Log admin action
      await AdminController.logAdminAction(req.user!.id, "car_approved", {
        car_id: carId,
        car_title: car.title,
        notes,
      });

      // Send notification to seller
      await AdminController.queueManager.addJob("notifications", {
        type: "send_notification",
        payload: {
          user_id: car.seller_id,
          type: "car_approved",
          title: "Car Listing Approved",
          message: `Your car listing "${car.title}" has been approved and is now live.`,
          related_car_id: carId,
          send_email: true,
        },
      });

      // Clear relevant caches
      await AdminController.clearCarCaches(carId);

      res.json({
        success: true,
        message: "Car approved successfully",
      } as ApiResponse);
    }
  );

  /**
   * Reject car listing
   */
  static rejectCar = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const carId = parseInt(req.params.id);
      const { reason, notes } = req.body;

      if (!reason) {
        res.status(400).json({
          success: false,
          message: "Rejection reason is required",
        } as ApiResponse);
        return;
      }

      // Get car details
      const cars = await AdminController.db.execute(
        "SELECT id, seller_id, title FROM cars WHERE id = ? AND approval_status = 'pending'",
        [carId]
      );

      if (cars.length === 0) {
        throw new NotFoundError("Car not found or already processed");
      }

      const car = cars[0];

      // Update car status
      await AdminController.db.execute(
        "UPDATE cars SET approval_status = 'rejected', approved_by = ?, approved_at = NOW(), rejection_reason = ?, approval_notes = ? WHERE id = ?",
        [req.user!.id, reason, notes || null, carId]
      );

      // Log admin action
      await AdminController.logAdminAction(req.user!.id, "car_rejected", {
        car_id: carId,
        car_title: car.title,
        reason,
        notes,
      });

      // Send notification to seller
      await AdminController.queueManager.addJob("notifications", {
        type: "send_notification",
        payload: {
          user_id: car.seller_id,
          type: "car_rejected",
          title: "Car Listing Rejected",
          message: `Your car listing "${car.title}" was rejected. Reason: ${reason}`,
          related_car_id: carId,
          send_email: true,
        },
      });

      res.json({
        success: true,
        message: "Car rejected successfully",
      } as ApiResponse);
    }
  );

  /**
   * Get user management data
   */
  static getUsers = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = (page - 1) * limit;
      const search = req.query.search as string;
      const role = req.query.role as string;
      const status = req.query.status as string;

      let whereClause = "WHERE 1=1";
      const params: any[] = [];

      if (search) {
        whereClause +=
          " AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)";
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm);
      }

      if (role) {
        whereClause += " AND u.role = ?";
        params.push(role);
      }

      if (status === "banned") {
        whereClause += " AND u.is_banned = TRUE";
      } else if (status === "verified") {
        whereClause += " AND u.is_verified = TRUE";
      } else if (status === "unverified") {
        whereClause += " AND u.is_verified = FALSE";
      }

      const [users, totalCount] = await Promise.all([
        AdminController.db.execute(
          `
          SELECT 
            u.*,
            ct.name as city_name,
            pr.name as province_name,
            COUNT(c.id) as car_count,
            COUNT(i.id) as inquiry_count
          FROM users u
          LEFT JOIN ph_cities ct ON u.city_id = ct.id
          LEFT JOIN ph_provinces pr ON ct.province_id = pr.id
          LEFT JOIN cars c ON u.id = c.seller_id AND c.is_active = TRUE
          LEFT JOIN inquiries i ON u.id = i.buyer_id
          ${whereClause}
          GROUP BY u.id
          ORDER BY u.created_at DESC
          LIMIT ? OFFSET ?
        `,
          [...params, limit, offset]
        ),

        AdminController.db.execute(
          `SELECT COUNT(*) as count FROM users u ${whereClause}`,
          params
        ),
      ]);

      res.json({
        success: true,
        message: "Users retrieved successfully",
        data: {
          users: users.map((user) => ({
            ...user,
            password_hash: undefined, // Remove sensitive data
          })),
          pagination: {
            page,
            limit,
            total: totalCount[0].count,
            pages: Math.ceil(totalCount[0].count / limit),
          },
        },
      } as ApiResponse);
    }
  );

  /**
   * Ban/unban user
   */
  static toggleUserBan = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = parseInt(req.params.id);
      const { reason, duration_days } = req.body;

      if (userId === req.user!.id) {
        throw new AuthorizationError("You cannot ban yourself");
      }

      // Get user details
      const users = await AdminController.db.execute(
        "SELECT id, email, is_banned, first_name, last_name FROM users WHERE id = ?",
        [userId]
      );

      if (users.length === 0) {
        throw new NotFoundError("User not found");
      }

      const user = users[0];
      const newBanStatus = !user.is_banned;
      const banUntil = duration_days
        ? new Date(Date.now() + duration_days * 24 * 60 * 60 * 1000)
        : null;

      // Update user ban status
      await AdminController.db.execute(
        "UPDATE users SET is_banned = ?, ban_reason = ?, ban_until = ?, banned_by = ?, banned_at = ? WHERE id = ?",
        [
          newBanStatus,
          reason || null,
          banUntil,
          req.user!.id,
          newBanStatus ? new Date() : null,
          userId,
        ]
      );

      // Log admin action
      await AdminController.logAdminAction(
        req.user!.id,
        newBanStatus ? "user_banned" : "user_unbanned",
        {
          user_id: userId,
          user_email: user.email,
          reason,
          duration_days,
        }
      );

      // Send notification to user
      const notificationType = newBanStatus
        ? "account_suspended"
        : "account_reinstated";
      const message = newBanStatus
        ? `Your account has been suspended. ${
            reason ? `Reason: ${reason}` : ""
          }`
        : "Your account has been reinstated.";

      await AdminController.queueManager.addJob("notifications", {
        type: "send_notification",
        payload: {
          user_id: userId,
          type: notificationType,
          title: newBanStatus ? "Account Suspended" : "Account Reinstated",
          message,
          send_email: true,
        },
      });

      res.json({
        success: true,
        message: `User ${newBanStatus ? "banned" : "unbanned"} successfully`,
      } as ApiResponse);
    }
  );

  /**
   * Get system configuration
   */
  static getSystemConfig = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const configs = await AdminController.db.execute(
        "SELECT config_key, config_value, description FROM system_config ORDER BY config_key"
      );

      const configMap: Record<string, any> = {};
      configs.forEach((config: any) => {
        configMap[config.config_key] = {
          value: config.config_value,
          description: config.description,
        };
      });

      res.json({
        success: true,
        message: "System configuration retrieved successfully",
        data: configMap,
      } as ApiResponse);
    }
  );

  /**
   * Update system configuration
   */
  static updateSystemConfig = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const { configs } = req.body;

      if (!configs || typeof configs !== "object") {
        res.status(400).json({
          success: false,
          message: "Invalid configuration data",
        } as ApiResponse);
        return;
      }

      // Update configurations
      for (const [key, value] of Object.entries(configs)) {
        await AdminController.db.execute(
          "INSERT INTO system_config (config_key, config_value, updated_by, updated_at) VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)",
          [key, value, req.user!.id]
        );
      }

      // Log admin action
      await AdminController.logAdminAction(
        req.user!.id,
        "system_config_updated",
        {
          updated_configs: Object.keys(configs),
        }
      );

      // Clear system config cache
      await redis.del("system:config");

      res.json({
        success: true,
        message: "System configuration updated successfully",
      } as ApiResponse);
    }
  );

  /**
   * Get admin activity logs
   */
  static getActivityLogs = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = (page - 1) * limit;
      const action = req.query.action as string;
      const adminId = req.query.admin_id
        ? parseInt(req.query.admin_id as string)
        : undefined;

      let whereClause = "WHERE 1=1";
      const params: any[] = [];

      if (action) {
        whereClause += " AND al.action = ?";
        params.push(action);
      }

      if (adminId) {
        whereClause += " AND al.admin_id = ?";
        params.push(adminId);
      }

      const [logs, totalCount] = await Promise.all([
        AdminController.db.execute(
          `
          SELECT 
            al.*,
            u.first_name as admin_name,
            u.email as admin_email
          FROM admin_logs al
          INNER JOIN users u ON al.admin_id = u.id
          ${whereClause}
          ORDER BY al.created_at DESC
          LIMIT ? OFFSET ?
        `,
          [...params, limit, offset]
        ),

        AdminController.db.execute(
          `SELECT COUNT(*) as count FROM admin_logs al ${whereClause}`,
          params
        ),
      ]);

      res.json({
        success: true,
        message: "Activity logs retrieved successfully",
        data: {
          logs,
          pagination: {
            page,
            limit,
            total: totalCount[0].count,
            pages: Math.ceil(totalCount[0].count / limit),
          },
        },
      } as ApiResponse);
    }
  );

  // Private helper methods

  private static async getTotalCars(): Promise<number> {
    const result = await AdminController.db.execute(
      "SELECT COUNT(*) as count FROM cars WHERE is_active = TRUE"
    );
    return result[0].count;
  }

  private static async getPendingCars(): Promise<number> {
    const result = await AdminController.db.execute(
      "SELECT COUNT(*) as count FROM cars WHERE approval_status = 'pending'"
    );
    return result[0].count;
  }

  private static async getActiveCars(): Promise<number> {
    const result = await AdminController.db.execute(
      "SELECT COUNT(*) as count FROM cars WHERE approval_status = 'approved' AND status = 'active'"
    );
    return result[0].count;
  }

  private static async getTotalUsers(): Promise<number> {
    const result = await AdminController.db.execute(
      "SELECT COUNT(*) as count FROM users WHERE is_active = TRUE"
    );
    return result[0].count;
  }

  private static async getNewUsersToday(): Promise<number> {
    const result = await AdminController.db.execute(
      "SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = CURDATE()"
    );
    return result[0].count;
  }

  private static async getTotalInquiries(): Promise<number> {
    const result = await AdminController.db.execute(
      "SELECT COUNT(*) as count FROM inquiries"
    );
    return result[0].count;
  }

  private static async getNewInquiriesToday(): Promise<number> {
    const result = await AdminController.db.execute(
      "SELECT COUNT(*) as count FROM inquiries WHERE DATE(created_at) = CURDATE()"
    );
    return result[0].count;
  }

  private static async getRevenueStats(): Promise<any> {
    // Placeholder for revenue statistics
    return {
      monthly_revenue: 0,
      total_revenue: 0,
      premium_listings: 0,
      featured_listings: 0,
    };
  }

  private static async getPopularBrands(): Promise<any[]> {
    return await AdminController.db.execute(`
      SELECT 
        b.id, 
        b.name, 
        COUNT(c.id) as listing_count,
        COUNT(DISTINCT cv.user_id) as view_count
      FROM brands b
      INNER JOIN cars c ON b.id = c.brand_id AND c.approval_status = 'approved'
      LEFT JOIN car_views cv ON c.id = cv.car_id
      GROUP BY b.id, b.name
      ORDER BY listing_count DESC
      LIMIT 10
    `);
  }

  private static async getTopCities(): Promise<any[]> {
    return await AdminController.db.execute(`
      SELECT 
        ct.id, 
        ct.name, 
        COUNT(c.id) as listing_count
      FROM ph_cities ct
      INNER JOIN cars c ON ct.id = c.city_id AND c.approval_status = 'approved'
      GROUP BY ct.id, ct.name
      ORDER BY listing_count DESC
      LIMIT 10
    `);
  }

  private static async getFraudReports(): Promise<any> {
    const [pendingReports, totalReports] = await Promise.all([
      AdminController.db.execute(
        "SELECT COUNT(*) as count FROM fraud_reports WHERE status = 'pending'"
      ),
      AdminController.db.execute("SELECT COUNT(*) as count FROM fraud_reports"),
    ]);

    return {
      pending: pendingReports[0].count,
      total: totalReports[0].count,
    };
  }

  private static async getSystemHealth(): Promise<any> {
    const queueStats = await AdminController.queueManager.getAllQueueStats();

    return {
      database: "healthy",
      redis: "healthy",
      queues: queueStats,
      last_checked: new Date(),
    };
  }

  private static async logAdminAction(
    adminId: number,
    action: string,
    metadata: any
  ): Promise<void> {
    try {
      await AdminController.db.execute(
        "INSERT INTO admin_logs (admin_id, action, metadata, ip_address, user_agent, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
        [adminId, action, JSON.stringify(metadata), null, null] // IP and user agent would come from request
      );
    } catch (error) {
      logger.error("Error logging admin action:", error);
    }
  }

  private static async clearCarCaches(carId: number): Promise<void> {
    try {
      const cacheKeys = [
        `car:${carId}`,
        "cars:list",
        "cars:featured",
        "admin:dashboard:stats",
      ];

      await Promise.all(cacheKeys.map((key) => redis.del(key)));
    } catch (error) {
      logger.error("Error clearing caches:", error);
    }
  }
}

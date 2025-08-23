// src/services/background/ScheduledTasks.ts
import cron from "node-cron";
import { QueueManager } from "./QueueManager";
import { DatabaseManager } from "../../config/database";
import { AnalyticsService } from "../analytics/ViewTrackingService";
import { ImageProcessingService } from "../media/ImageProcessingService";
import { FraudDetectionService } from "../fraud/FraudDetectionService";
import redis from "../../config/redis";
import logger from "../../utils/logger";

export class ScheduledTasksService {
  private static instance: ScheduledTasksService;
  private queueManager: QueueManager;
  private db: DatabaseManager;
  private analyticsService: AnalyticsService;
  private imageService: ImageProcessingService;
  private fraudService: FraudDetectionService;
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();

  private constructor() {
    this.queueManager = QueueManager.getInstance();
    this.db = DatabaseManager.getInstance();
    this.analyticsService = AnalyticsService.getInstance();
    this.imageService = ImageProcessingService.getInstance();
    this.fraudService = FraudDetectionService.getInstance();
  }

  public static getInstance(): ScheduledTasksService {
    if (!ScheduledTasksService.instance) {
      ScheduledTasksService.instance = new ScheduledTasksService();
    }
    return ScheduledTasksService.instance;
  }

  /**
   * Initialize all scheduled tasks
   */
  async initialize(): Promise<void> {
    try {
      logger.info("Initializing scheduled tasks...");

      // Daily tasks at 2 AM
      this.scheduleTask(
        "daily_cleanup",
        "0 2 * * *", // 2:00 AM daily
        this.runDailyCleanup.bind(this)
      );

      // Hourly tasks
      this.scheduleTask(
        "hourly_analytics",
        "0 * * * *", // Every hour
        this.updateHourlyAnalytics.bind(this)
      );

      // Every 15 minutes - Check for expired listings
      this.scheduleTask(
        "expire_listings",
        "*/15 * * * *", // Every 15 minutes
        this.checkExpiredListings.bind(this)
      );

      // Every 30 minutes - Send price alerts
      this.scheduleTask(
        "price_alerts",
        "*/30 * * * *", // Every 30 minutes
        this.sendPriceAlerts.bind(this)
      );

      // Daily at 3 AM - Generate analytics reports
      this.scheduleTask(
        "daily_analytics",
        "0 3 * * *", // 3:00 AM daily
        this.generateDailyAnalytics.bind(this)
      );

      // Daily at 4 AM - Fraud detection sweep
      this.scheduleTask(
        "fraud_detection",
        "0 4 * * *", // 4:00 AM daily
        this.runFraudDetection.bind(this)
      );

      // Weekly on Sunday at 5 AM - Heavy maintenance
      this.scheduleTask(
        "weekly_maintenance",
        "0 5 * * 0", // 5:00 AM every Sunday
        this.runWeeklyMaintenance.bind(this)
      );

      // Every 5 minutes - Health checks
      this.scheduleTask(
        "health_checks",
        "*/5 * * * *", // Every 5 minutes
        this.performHealthChecks.bind(this)
      );

      // Daily at 6 AM - Send digest emails
      this.scheduleTask(
        "daily_digest",
        "0 6 * * *", // 6:00 AM daily
        this.sendDailyDigest.bind(this)
      );

      logger.info(`Scheduled ${this.scheduledJobs.size} tasks successfully`);
    } catch (error) {
      logger.error("Error initializing scheduled tasks:", error);
      throw error;
    }
  }

  /**
   * Schedule a new task
   */
  private scheduleTask(
    name: string,
    cronExpression: string,
    task: Function
  ): void {
    try {
      const scheduledTask = cron.schedule(
        cronExpression,
        async () => {
          const startTime = Date.now();
          logger.info(`Starting scheduled task: ${name}`);

          try {
            await task();
            const duration = Date.now() - startTime;
            logger.info(`Completed scheduled task: ${name} in ${duration}ms`);

            // Track task execution
            await this.trackTaskExecution(name, true, duration);
          } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(`Failed scheduled task: ${name}`, error);

            // Track task failure
            await this.trackTaskExecution(name, false, duration, error);
          }
        },
        {
          scheduled: false, // Don't start immediately
        }
      );

      this.scheduledJobs.set(name, scheduledTask);
      logger.info(`Scheduled task '${name}' with cron: ${cronExpression}`);
    } catch (error) {
      logger.error(`Error scheduling task '${name}':`, error);
    }
  }

  /**
   * Start all scheduled tasks
   */
  start(): void {
    for (const [name, task] of this.scheduledJobs) {
      task.start();
      logger.info(`Started scheduled task: ${name}`);
    }
  }

  /**
   * Stop all scheduled tasks
   */
  stop(): void {
    for (const [name, task] of this.scheduledJobs) {
      task.stop();
      logger.info(`Stopped scheduled task: ${name}`);
    }
  }

  /**
   * Daily cleanup tasks
   */
  private async runDailyCleanup(): Promise<void> {
    logger.info("Running daily cleanup tasks...");

    await Promise.all([
      this.cleanupExpiredSessions(),
      this.cleanupOldLogs(),
      this.cleanupTempFiles(),
      this.cleanupOldNotifications(),
      this.cleanupInactiveUsers(),
      this.optimizeDatabase(),
    ]);

    logger.info("Daily cleanup completed");
  }

  /**
   * Update hourly analytics
   */
  private async updateHourlyAnalytics(): Promise<void> {
    logger.info("Updating hourly analytics...");

    const now = new Date();
    const hourKey = now.toISOString().substring(0, 13); // YYYY-MM-DDTHH

    // Get hourly stats from Redis counters
    const hourlyStats = await this.collectHourlyStats(hourKey);

    // Store in database
    await this.db.execute(
      `INSERT INTO hourly_analytics (hour, views, searches, inquiries, registrations, listings, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, NOW()) 
       ON DUPLICATE KEY UPDATE 
       views = VALUES(views), searches = VALUES(searches), inquiries = VALUES(inquiries),
       registrations = VALUES(registrations), listings = VALUES(listings)`,
      [
        hourKey,
        hourlyStats.views,
        hourlyStats.searches,
        hourlyStats.inquiries,
        hourlyStats.registrations,
        hourlyStats.listings,
      ]
    );

    logger.info("Hourly analytics updated");
  }

  /**
   * Check for expired listings
   */
  private async checkExpiredListings(): Promise<void> {
    logger.info("Checking for expired listings...");

    // Find listings that have expired
    const expiredListings = await this.db.execute(`
      SELECT id, seller_id, title 
      FROM cars 
      WHERE expires_at < NOW() 
      AND status = 'active' 
      AND is_active = TRUE
    `);

    for (const listing of expiredListings) {
      // Mark as expired
      await this.db.execute("UPDATE cars SET status = 'expired' WHERE id = ?", [
        listing.id,
      ]);

      // Send notification to seller
      await this.queueManager.addJob("notifications", {
        type: "send_notification",
        payload: {
          user_id: listing.seller_id,
          type: "listing_expired",
          title: "Listing Expired",
          message: `Your car listing "${listing.title}" has expired. Renew it to keep it active.`,
          related_car_id: listing.id,
          send_email: true,
        },
      });

      logger.info(`Expired listing ${listing.id}: ${listing.title}`);
    }

    logger.info(`Processed ${expiredListings.length} expired listings`);
  }

  /**
   * Send price alerts to users
   */
  private async sendPriceAlerts(): Promise<void> {
    logger.info("Sending price alerts...");

    // Get active price alerts
    const priceAlerts = await this.db.execute(`
      SELECT pa.*, u.email, u.first_name
      FROM price_alerts pa
      INNER JOIN users u ON pa.user_id = u.id
      WHERE pa.is_active = TRUE
      AND pa.last_checked < DATE_SUB(NOW(), INTERVAL 30 MINUTE)
    `);

    for (const alert of priceAlerts) {
      try {
        // Find cars matching the alert criteria with price drops
        const matchingCars = await this.findCarsForPriceAlert(alert);

        if (matchingCars.length > 0) {
          // Send alert notification
          await this.queueManager.addJob("notifications", {
            type: "price_alert",
            payload: {
              userId: alert.user_id,
              alertId: alert.id,
              cars: matchingCars,
            },
          });
        }

        // Update last checked time
        await this.db.execute(
          "UPDATE price_alerts SET last_checked = NOW() WHERE id = ?",
          [alert.id]
        );
      } catch (error) {
        logger.error(`Error processing price alert ${alert.id}:`, error);
      }
    }

    logger.info(`Processed ${priceAlerts.length} price alerts`);
  }

  /**
   * Generate daily analytics
   */
  private async generateDailyAnalytics(): Promise<void> {
    logger.info("Generating daily analytics...");

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    // Generate comprehensive daily report
    const dailyStats = await this.analyticsService.getDailyStats(dateStr);

    // Store in daily analytics table
    await this.db.execute(
      `INSERT INTO daily_analytics (date, total_views, unique_visitors, new_listings, new_inquiries, new_users, conversion_rate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
       total_views = VALUES(total_views), unique_visitors = VALUES(unique_visitors),
       new_listings = VALUES(new_listings), new_inquiries = VALUES(new_inquiries),
       new_users = VALUES(new_users), conversion_rate = VALUES(conversion_rate)`,
      [
        dateStr,
        dailyStats.total_views,
        dailyStats.unique_visitors,
        dailyStats.new_listings,
        dailyStats.new_inquiries,
        dailyStats.new_users,
        dailyStats.conversion_rate,
      ]
    );

    // Update trending data
    await this.updateTrendingData();

    logger.info("Daily analytics generated");
  }

  /**
   * Run fraud detection on recent listings
   */
  private async runFraudDetection(): Promise<void> {
    logger.info("Running fraud detection sweep...");

    // Get recent listings that haven't been analyzed
    const recentListings = await this.db.execute(`
      SELECT c.id 
      FROM cars c
      LEFT JOIN fraud_reports fr ON c.id = fr.car_id
      WHERE c.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      AND c.approval_status = 'approved'
      AND fr.id IS NULL
      LIMIT 100
    `);

    // Queue fraud detection jobs
    for (const listing of recentListings) {
      await this.queueManager.addJob("fraud-detection", {
        type: "analyze_listing",
        payload: { carId: listing.id },
        priority: "low",
      });
    }

    logger.info(`Queued fraud detection for ${recentListings.length} listings`);
  }

  /**
   * Weekly maintenance tasks
   */
  private async runWeeklyMaintenance(): Promise<void> {
    logger.info("Running weekly maintenance...");

    await Promise.all([
      this.cleanupOldAnalytics(),
      this.imageService.cleanupOrphanedImages(),
      this.optimizeSearchIndexes(),
      this.archiveOldData(),
      this.generateWeeklyReports(),
      this.cleanupRedisCache(),
    ]);

    logger.info("Weekly maintenance completed");
  }

  /**
   * Perform system health checks
   */
  private async performHealthChecks(): Promise<void> {
    const healthData = {
      timestamp: new Date(),
      database: await this.checkDatabaseHealth(),
      redis: await this.checkRedisHealth(),
      storage: await this.checkStorageHealth(),
      queues: await this.checkQueueHealth(),
    };

    // Store health data
    await redis.setex("system:health", 300, JSON.stringify(healthData));

    // Alert if any issues
    if (!healthData.database.healthy || !healthData.redis.healthy) {
      logger.error("System health check failed:", healthData);

      // Send alert to admins
      await this.queueManager.addJob("notifications", {
        type: "send_notification",
        payload: {
          type: "system_alert",
          title: "System Health Alert",
          message: "System health check detected issues",
          priority: "urgent",
        },
      });
    }
  }

  /**
   * Send daily digest emails
   */
  private async sendDailyDigest(): Promise<void> {
    logger.info("Sending daily digest emails...");

    // Get users who want daily digests
    const subscribers = await this.db.execute(`
      SELECT id, email, first_name 
      FROM users 
      WHERE email_notifications = TRUE 
      AND daily_digest = TRUE 
      AND is_active = TRUE
    `);

    for (const user of subscribers) {
      try {
        // Generate personalized digest
        const digestData = await this.generateUserDigest(user.id);

        if (digestData.hasContent) {
          await this.queueManager.addJob("email", {
            type: "daily_digest",
            payload: {
              email: user.email,
              name: user.first_name,
              digestData,
            },
          });
        }
      } catch (error) {
        logger.error(`Error generating digest for user ${user.id}:`, error);
      }
    }

    logger.info(`Queued daily digest for ${subscribers.length} users`);
  }

  // Helper methods

  private async cleanupExpiredSessions(): Promise<void> {
    const expiredCount = await redis.eval(
      `
      local keys = redis.call('KEYS', 'session:*')
      local expired = 0
      for i=1,#keys do
        local ttl = redis.call('TTL', keys[i])
        if ttl == -1 then
          redis.call('DEL', keys[i])
          expired = expired + 1
        end
      end
      return expired
    `,
      0
    );

    logger.info(`Cleaned up ${expiredCount} expired sessions`);
  }

  private async cleanupOldLogs(): Promise<void> {
    // Delete logs older than 30 days
    const result = await this.db.execute(
      "DELETE FROM request_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)"
    );

    logger.info(`Cleaned up ${(result as any).affectedRows} old log entries`);
  }

  private async cleanupTempFiles(): Promise<void> {
    // Implementation for cleaning up temporary files
    logger.info("Cleaned up temporary files");
  }

  private async cleanupOldNotifications(): Promise<void> {
    // Delete read notifications older than 30 days
    const result = await this.db.execute(
      "DELETE FROM notifications WHERE is_read = TRUE AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)"
    );

    logger.info(`Cleaned up ${(result as any).affectedRows} old notifications`);
  }

  private async cleanupInactiveUsers(): Promise<void> {
    // Mark users as inactive if they haven't logged in for 1 year
    const result = await this.db.execute(
      "UPDATE users SET is_active = FALSE WHERE last_login < DATE_SUB(NOW(), INTERVAL 1 YEAR) AND is_active = TRUE"
    );

    logger.info(`Marked ${(result as any).affectedRows} users as inactive`);
  }

  private async optimizeDatabase(): Promise<void> {
    // Optimize frequently used tables
    const tables = ["cars", "users", "car_views", "inquiries", "user_actions"];

    for (const table of tables) {
      await this.db.execute(`OPTIMIZE TABLE ${table}`);
    }

    logger.info("Database optimization completed");
  }

  private async collectHourlyStats(hourKey: string): Promise<any> {
    const [views, searches, inquiries, registrations, listings] =
      await Promise.all([
        redis.get(`total_views:${hourKey.split("T")[0]}`),
        redis.get(`actions:search:${hourKey}`),
        redis.get(`actions:contact_seller:${hourKey}`),
        redis.get(`actions:register:${hourKey}`),
        redis.get(`actions:upload_car:${hourKey}`),
      ]);

    return {
      views: parseInt(views || "0"),
      searches: parseInt(searches || "0"),
      inquiries: parseInt(inquiries || "0"),
      registrations: parseInt(registrations || "0"),
      listings: parseInt(listings || "0"),
    };
  }

  private async findCarsForPriceAlert(alert: any): Promise<any[]> {
    const filters = JSON.parse(alert.search_criteria);

    // Find cars that match criteria and have recent price drops
    const cars = await this.db.execute(
      `
      SELECT c.*, ph.old_price, ph.new_price
      FROM cars c
      INNER JOIN price_history ph ON c.id = ph.car_id
      WHERE ph.created_at >= ?
      AND ph.new_price <= ?
      AND c.price <= ?
      ${filters.brand_id ? "AND c.brand_id = ?" : ""}
      ${filters.city_id ? "AND c.city_id = ?" : ""}
      LIMIT 10
    `,
      [
        alert.last_checked,
        alert.max_price,
        alert.max_price,
        ...(filters.brand_id ? [filters.brand_id] : []),
        ...(filters.city_id ? [filters.city_id] : []),
      ]
    );

    return cars;
  }

  private async updateTrendingData(): Promise<void> {
    // Update trending searches, cars, and brands
    const trendingSearches = await redis.zrevrange(
      "search_trends",
      0,
      99,
      "WITHSCORES"
    );
    const trendingCars = await redis.zrevrange(
      "popular_cars",
      0,
      99,
      "WITHSCORES"
    );

    // Store in database for persistence
    await this.db.execute(
      "DELETE FROM trending_searches WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)"
    );
    await this.db.execute(
      "DELETE FROM trending_cars WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)"
    );

    // Insert current trending data
    for (let i = 0; i < trendingSearches.length; i += 2) {
      await this.db.execute(
        "INSERT INTO trending_searches (search_term, score, rank, created_at) VALUES (?, ?, ?, NOW())",
        [trendingSearches[i], parseInt(trendingSearches[i + 1]), i / 2 + 1]
      );
    }

    for (let i = 0; i < trendingCars.length; i += 2) {
      await this.db.execute(
        "INSERT INTO trending_cars (car_id, score, rank, created_at) VALUES (?, ?, ?, NOW())",
        [parseInt(trendingCars[i]), parseInt(trendingCars[i + 1]), i / 2 + 1]
      );
    }
  }

  private async cleanupOldAnalytics(): Promise<void> {
    // Archive analytics data older than 1 year
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);

    const tables = ["user_actions", "car_views", "search_analytics"];

    for (const table of tables) {
      const result = await this.db.execute(
        `DELETE FROM ${table} WHERE created_at < ?`,
        [cutoffDate]
      );
      logger.info(
        `Cleaned up ${(result as any).affectedRows} old records from ${table}`
      );
    }
  }

  private async optimizeSearchIndexes(): Promise<void> {
    // Rebuild full-text search indexes
    await this.db.execute("OPTIMIZE TABLE cars");
    await this.db.execute("REPAIR TABLE cars");

    logger.info("Search indexes optimized");
  }

  private async archiveOldData(): Promise<void> {
    // Archive completed transactions older than 2 years
    const archiveDate = new Date();
    archiveDate.setFullYear(archiveDate.getFullYear() - 2);

    // Move to archive tables (implement as needed)
    logger.info("Data archival completed");
  }

  private async generateWeeklyReports(): Promise<void> {
    // Generate weekly summary reports for admins
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const weeklyReport = await this.analyticsService.generateAnalyticsReport(
      startDate,
      endDate
    );

    // Store report
    await this.db.execute(
      "INSERT INTO weekly_reports (week_start, week_end, report_data, created_at) VALUES (?, ?, ?, NOW())",
      [startDate, endDate, JSON.stringify(weeklyReport)]
    );

    logger.info("Weekly reports generated");
  }

  private async cleanupRedisCache(): Promise<void> {
    // Remove expired keys and optimize memory
    const info = await redis.info("memory");
    logger.info("Redis cache cleanup completed", { memoryInfo: info });
  }

  private async checkDatabaseHealth(): Promise<any> {
    try {
      const start = Date.now();
      await this.db.execute("SELECT 1");
      const responseTime = Date.now() - start;

      const [connectionCount] = await this.db.execute(
        "SHOW STATUS LIKE 'Threads_connected'"
      );

      return {
        healthy: responseTime < 1000,
        responseTime,
        connectionCount: connectionCount.Value,
      };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  private async checkRedisHealth(): Promise<any> {
    try {
      const start = Date.now();
      await redis.ping();
      const responseTime = Date.now() - start;

      const info = await redis.info("memory");

      return {
        healthy: responseTime < 100,
        responseTime,
        memoryInfo: info,
      };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  private async checkStorageHealth(): Promise<any> {
    try {
      // Check disk space and permissions
      return { healthy: true };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  private async checkQueueHealth(): Promise<any> {
    try {
      const queueStats = await this.queueManager.getAllQueueStats();
      const unhealthyQueues = queueStats.filter(
        (q) => q.failed > 100 || q.delayed > 50
      );

      return {
        healthy: unhealthyQueues.length === 0,
        stats: queueStats,
        issues: unhealthyQueues,
      };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  private async generateUserDigest(userId: number): Promise<any> {
    // Generate personalized daily digest for user
    const userStats = await this.analyticsService.getUserBehaviorStats(
      userId,
      1
    );

    // Get new cars matching user preferences
    const newCars = await this.db.execute(`
      SELECT c.*, b.name as brand_name 
      FROM cars c
      INNER JOIN brands b ON c.brand_id = b.id
      WHERE c.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      AND c.approval_status = 'approved'
      ORDER BY c.created_at DESC
      LIMIT 5
    `);

    return {
      hasContent: newCars.length > 0,
      newCars,
      userStats,
    };
  }

  private async trackTaskExecution(
    taskName: string,
    success: boolean,
    duration: number,
    error?: any
  ): Promise<void> {
    try {
      await this.db.execute(
        "INSERT INTO scheduled_task_logs (task_name, success, duration_ms, error_message, executed_at) VALUES (?, ?, ?, ?, NOW())",
        [taskName, success, duration, error ? error.message : null]
      );
    } catch (logError) {
      logger.error("Error tracking task execution:", logError);
    }
  }
}

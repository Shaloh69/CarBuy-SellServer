// src/app.ts
import express, { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { createServer, Server as HttpServer } from "http";
import { config } from "./config/env";
import { DatabaseManager } from "./config/database";
import SocketManager from "./config/socket";
import redis from "./config/redis";
import logger from "./utils/logger";

// Import services
import { QueueManager } from "./services/background/QueueManager";
import { JobProcessor } from "./services/background/JobProcessor";
import { ScheduledTasksService } from "./services/background/ScheduledTasks";
import { AnalyticsService } from "./services/analytics/ViewTrackingService";
import { ImageProcessingService } from "./services/media/ImageProcessingService";
import { FraudDetectionService } from "./services/fraud/FraudDetectionService";
import { SpatialService } from "./services/location/SpatialService";
import { CarSearchService } from "./services/search/CarSearchService";

// Import middleware
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/logging";

// Import routes
import authRoutes from "./routes/auth";
import carRoutes from "./routes/cars";
import userRoutes from "./routes/users";
import locationRoutes from "./routes/location";
import searchRoutes from "./routes/search";
import analyticsRoutes from "./routes/analytics";
import uploadRoutes from "./routes/upload";
import notificationRoutes from "./routes/notifications";
import transactionRoutes from "./routes/transactions";
import inquiryRoutes from "./routes/inquiries";
import adminRoutes from "./routes/admin";

export default class App {
  private app: Application;
  private httpServer: HttpServer;
  private db: DatabaseManager;
  private socketManager: SocketManager;
  private queueManager: QueueManager;
  private jobProcessor: JobProcessor;
  private scheduledTasks: ScheduledTasksService;

  // Service instances
  private analyticsService: AnalyticsService;
  private imageService: ImageProcessingService;
  private fraudService: FraudDetectionService;
  private spatialService: SpatialService;
  private searchService: CarSearchService;

  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);

    // Initialize services
    this.db = DatabaseManager.getInstance();
    this.socketManager = SocketManager.getInstance();
    this.queueManager = QueueManager.getInstance();
    this.jobProcessor = JobProcessor.getInstance();
    this.scheduledTasks = ScheduledTasksService.getInstance();

    this.analyticsService = AnalyticsService.getInstance();
    this.imageService = ImageProcessingService.getInstance();
    this.fraudService = FraudDetectionService.getInstance();
    this.spatialService = SpatialService.getInstance();
    this.searchService = CarSearchService.getInstance();
  }

  /**
   * Start the application
   */
  async start(): Promise<void> {
    try {
      // Initialize core services first
      await this.initializeDatabase();
      await this.initializeRedis();

      // Configure Express app
      this.configureMiddleware();
      this.configureRoutes();
      this.configureErrorHandling();

      // Initialize advanced services
      await this.initializeQueues();
      await this.initializeSocket();
      await this.initializeScheduledTasks();

      // Start the server
      await this.startServer();

      // Perform health checks
      await this.performHealthChecks();

      logger.info(
        "🚗 Car Marketplace Philippines API Server started successfully!"
      );
    } catch (error) {
      logger.error("Failed to start application:", error);
      throw error;
    }
  }

  /**
   * Initialize database connection
   */
  private async initializeDatabase(): Promise<void> {
    try {
      logger.info("Initializing database connection...");

      await this.db.initialize();
      await this.runMigrations();

      logger.info("✅ Database initialized successfully");
    } catch (error) {
      logger.error("❌ Database initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize Redis connection
   */
  private async initializeRedis(): Promise<void> {
    try {
      logger.info("Initializing Redis connection...");

      await redis.ping();

      logger.info("✅ Redis initialized successfully");
    } catch (error) {
      logger.error("❌ Redis initialization failed:", error);
      throw error;
    }
  }

  /**
   * Configure Express middleware
   */
  private configureMiddleware(): void {
    logger.info("Configuring middleware...");

    // Security middleware
    this.app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
          },
        },
        crossOriginEmbedderPolicy: false,
      })
    );

    // CORS configuration
    this.app.use(
      cors({
        origin: process.env.FRONTEND_URL?.split(",") || [
          "http://localhost:3000",
        ],
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: [
          "Origin",
          "X-Requested-With",
          "Content-Type",
          "Accept",
          "Authorization",
          "X-Session-ID",
          "X-User-Agent",
          "X-Forwarded-For",
        ],
      })
    );

    // Body parsing middleware
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // Compression
    this.app.use(compression());

    // Request logging
    this.app.use(requestLogger);

    // Trust proxy (for rate limiting and IP detection)
    this.app.set("trust proxy", true);

    // Serve static files
    this.app.use("/uploads", express.static("uploads"));
    this.app.use("/public", express.static("public"));

    logger.info("✅ Middleware configured successfully");
  }

  /**
   * Configure application routes
   */
  private configureRoutes(): void {
    logger.info("Configuring routes...");

    // Health check endpoint
    this.app.get("/health", this.healthCheck.bind(this));

    // API routes
    this.app.use("/api/auth", authRoutes);
    this.app.use("/api/cars", carRoutes);
    this.app.use("/api/users", userRoutes);
    this.app.use("/api/location", locationRoutes);
    this.app.use("/api/search", searchRoutes);
    this.app.use("/api/analytics", analyticsRoutes);
    this.app.use("/api/upload", uploadRoutes);
    this.app.use("/api/notifications", notificationRoutes);
    this.app.use("/api/transactions", transactionRoutes);
    this.app.use("/api/inquiries", inquiryRoutes);
    this.app.use("/api/admin", adminRoutes);

    // API documentation route
    this.app.get("/api", (req: Request, res: Response) => {
      res.json({
        success: true,
        message: "Car Marketplace Philippines API",
        version: "1.0.0",
        documentation: "/api/docs",
        endpoints: {
          auth: "/api/auth",
          cars: "/api/cars",
          users: "/api/users",
          location: "/api/location",
          search: "/api/search",
          analytics: "/api/analytics",
          upload: "/api/upload",
          notifications: "/api/notifications",
          transactions: "/api/transactions",
          inquiries: "/api/inquiries",
          admin: "/api/admin",
        },
      });
    });

    // 404 handler for API routes
    this.app.use("/api/*", (req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        message: "API endpoint not found",
        error: `Route ${req.method} ${req.path} does not exist`,
      });
    });

    // Root route
    this.app.get("/", (req: Request, res: Response) => {
      res.json({
        success: true,
        message: "🚗 Car Marketplace Philippines API Server",
        version: "1.0.0",
        status: "running",
        api: "/api",
      });
    });

    logger.info("✅ Routes configured successfully");
  }

  /**
   * Configure error handling
   */
  private configureErrorHandling(): void {
    logger.info("Configuring error handling...");

    // Global error handler
    this.app.use(errorHandler);

    // Handle uncaught exceptions
    process.on("uncaughtException", (error: Error) => {
      logger.error("Uncaught Exception:", error);
      this.gracefulShutdown(1);
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      this.gracefulShutdown(1);
    });

    // Handle SIGTERM and SIGINT for graceful shutdown
    process.on("SIGTERM", () => {
      logger.info("SIGTERM received, initiating graceful shutdown...");
      this.gracefulShutdown(0);
    });

    process.on("SIGINT", () => {
      logger.info("SIGINT received, initiating graceful shutdown...");
      this.gracefulShutdown(0);
    });

    logger.info("✅ Error handling configured successfully");
  }

  /**
   * Initialize queue system
   */
  private async initializeQueues(): Promise<void> {
    try {
      logger.info("Initializing queue system...");

      await this.queueManager.initialize();
      await this.jobProcessor.initialize();

      logger.info("✅ Queue system initialized successfully");
    } catch (error) {
      logger.error("❌ Queue system initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize Socket.IO
   */
  private async initializeSocket(): Promise<void> {
    try {
      logger.info("Initializing Socket.IO...");

      await this.socketManager.initialize(this.httpServer);

      logger.info("✅ Socket.IO initialized successfully");
    } catch (error) {
      logger.error("❌ Socket.IO initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize scheduled tasks
   */
  private async initializeScheduledTasks(): Promise<void> {
    try {
      logger.info("Initializing scheduled tasks...");

      await this.scheduledTasks.initialize();
      this.scheduledTasks.start();

      logger.info("✅ Scheduled tasks initialized successfully");
    } catch (error) {
      logger.error("❌ Scheduled tasks initialization failed:", error);
      throw error;
    }
  }

  /**
   * Start HTTP server
   */
  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const PORT = config.port;

        this.httpServer.listen(PORT, () => {
          logger.info(`🚀 Server running on port ${PORT}`);
          logger.info(`📊 Environment: ${config.nodeEnv}`);
          logger.info(`🔗 API Base URL: http://localhost:${PORT}/api`);
          logger.info(`📡 Socket.IO enabled on port ${PORT}`);
          resolve();
        });

        this.httpServer.on("error", (error: Error) => {
          logger.error("Server error:", error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Perform health checks
   */
  private async performHealthChecks(): Promise<void> {
    try {
      logger.info("Performing health checks...");

      // Database health check
      await this.db.execute("SELECT 1");
      logger.info("✅ Database health check passed");

      // Redis health check
      await redis.ping();
      logger.info("✅ Redis health check passed");

      // Queue health check
      const queueStats = await this.queueManager.getAllQueueStats();
      logger.info("✅ Queue health check passed", { queueStats });

      logger.info("✅ All health checks passed");
    } catch (error) {
      logger.error("❌ Health check failed:", error);
      throw error;
    }
  }

  /**
   * Run database migrations
   */
  private async runMigrations(): Promise<void> {
    try {
      logger.info("Running database migrations...");

      // Check if migrations table exists
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS migrations (
          id INT PRIMARY KEY AUTO_INCREMENT,
          migration_name VARCHAR(255) NOT NULL UNIQUE,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // List of migrations to run
      const migrations = [
        "001_create_analytics_tables",
        "002_create_fraud_tables",
        "003_create_queue_tables",
        "004_create_notification_tables",
        "005_create_transaction_tables",
        "006_add_spatial_indexes",
        "007_add_search_indexes",
      ];

      for (const migration of migrations) {
        await this.runMigration(migration);
      }

      logger.info("✅ Database migrations completed");
    } catch (error) {
      logger.error("❌ Database migration failed:", error);
      throw error;
    }
  }

  /**
   * Run a single migration
   */
  private async runMigration(migrationName: string): Promise<void> {
    // Check if migration already executed
    const existing = await this.db.execute(
      "SELECT id FROM migrations WHERE migration_name = ?",
      [migrationName]
    );

    if (existing.length > 0) {
      logger.debug(`Migration ${migrationName} already executed, skipping`);
      return;
    }

    logger.info(`Running migration: ${migrationName}`);

    // Execute migration SQL based on name
    switch (migrationName) {
      case "001_create_analytics_tables":
        await this.createAnalyticsTables();
        break;
      case "002_create_fraud_tables":
        await this.createFraudTables();
        break;
      case "003_create_queue_tables":
        await this.createQueueTables();
        break;
      case "004_create_notification_tables":
        await this.createNotificationTables();
        break;
      case "005_create_transaction_tables":
        await this.createTransactionTables();
        break;
      case "006_add_spatial_indexes":
        await this.addSpatialIndexes();
        break;
      case "007_add_search_indexes":
        await this.addSearchIndexes();
        break;
      default:
        logger.warn(`Unknown migration: ${migrationName}`);
        return;
    }

    // Mark migration as executed
    await this.db.execute(
      "INSERT INTO migrations (migration_name) VALUES (?)",
      [migrationName]
    );

    logger.info(`✅ Migration ${migrationName} completed`);
  }

  /**
   * Health check endpoint handler
   */
  private async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const healthData = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
        environment: config.nodeEnv,
        services: {
          database: await this.checkDatabaseHealth(),
          redis: await this.checkRedisHealth(),
          queues: await this.checkQueueHealth(),
          socket: this.socketManager.getConnectedUserCount(),
        },
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
      };

      const isHealthy =
        healthData.services.database.healthy &&
        healthData.services.redis.healthy;

      res.status(isHealthy ? 200 : 503).json(healthData);
    } catch (error) {
      res.status(503).json({
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error.message,
      });
    }
  }

  /**
   * Graceful shutdown
   */
  private async gracefulShutdown(exitCode: number): Promise<void> {
    logger.info("Initiating graceful shutdown...");

    try {
      // Stop scheduled tasks
      this.scheduledTasks.stop();
      logger.info("✅ Scheduled tasks stopped");

      // Close queue connections
      await this.queueManager.shutdown();
      logger.info("✅ Queue manager shutdown");

      // Close database connections
      await this.db.close();
      logger.info("✅ Database connections closed");

      // Close Redis connections
      await redis.quit();
      logger.info("✅ Redis connections closed");

      // Close HTTP server
      this.httpServer.close(() => {
        logger.info("✅ HTTP server closed");
        process.exit(exitCode);
      });

      // Force exit after 30 seconds
      setTimeout(() => {
        logger.error("❌ Forced shutdown after timeout");
        process.exit(1);
      }, 30000);
    } catch (error) {
      logger.error("❌ Error during graceful shutdown:", error);
      process.exit(1);
    }
  }

  // Health check helper methods
  private async checkDatabaseHealth(): Promise<any> {
    try {
      const start = Date.now();
      await this.db.execute("SELECT 1");
      const responseTime = Date.now() - start;

      return {
        healthy: responseTime < 1000,
        responseTime,
        status: "connected",
      };
    } catch (error) {
      return {
        healthy: false,
        status: "disconnected",
        error: error.message,
      };
    }
  }

  private async checkRedisHealth(): Promise<any> {
    try {
      const start = Date.now();
      await redis.ping();
      const responseTime = Date.now() - start;

      return {
        healthy: responseTime < 100,
        responseTime,
        status: "connected",
      };
    } catch (error) {
      return {
        healthy: false,
        status: "disconnected",
        error: error.message,
      };
    }
  }

  private async checkQueueHealth(): Promise<any> {
    try {
      const stats = await this.queueManager.getAllQueueStats();
      const hasIssues = stats.some((q) => q.failed > 100);

      return {
        healthy: !hasIssues,
        stats,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
      };
    }
  }

  // Migration methods
  private async createAnalyticsTables(): Promise<void> {
    // User actions table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS user_actions (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        user_id INT,
        session_id VARCHAR(255),
        action_type ENUM('view_car', 'search', 'contact_seller', 'favorite', 'unfavorite', 'share', 'report', 'save_search', 'login', 'register', 'upload_car') NOT NULL,
        target_type ENUM('car', 'user', 'search', 'category', 'brand', 'system') NOT NULL,
        target_id INT,
        metadata JSON,
        ip_address VARCHAR(45),
        user_agent TEXT,
        referrer TEXT,
        page_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_user_actions_user_id (user_id),
        INDEX idx_user_actions_session (session_id),
        INDEX idx_user_actions_type (action_type),
        INDEX idx_user_actions_target (target_type, target_id),
        INDEX idx_user_actions_created (created_at),
        
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Search analytics table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS search_analytics (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        user_id INT,
        search_query TEXT,
        filters JSON,
        result_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_search_analytics_user (user_id),
        INDEX idx_search_analytics_created (created_at),
        FULLTEXT INDEX idx_search_query (search_query),
        
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Hourly analytics table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS hourly_analytics (
        id INT PRIMARY KEY AUTO_INCREMENT,
        hour VARCHAR(13) NOT NULL UNIQUE, -- YYYY-MM-DDTHH
        views INT DEFAULT 0,
        searches INT DEFAULT 0,
        inquiries INT DEFAULT 0,
        registrations INT DEFAULT 0,
        listings INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_hourly_analytics_hour (hour)
      )
    `);

    // Daily analytics table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS daily_analytics (
        id INT PRIMARY KEY AUTO_INCREMENT,
        date DATE NOT NULL UNIQUE,
        total_views INT DEFAULT 0,
        unique_visitors INT DEFAULT 0,
        new_listings INT DEFAULT 0,
        new_inquiries INT DEFAULT 0,
        new_users INT DEFAULT 0,
        conversion_rate DECIMAL(5,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_daily_analytics_date (date)
      )
    `);
  }

  private async createFraudTables(): Promise<void> {
    // Fraud reports table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS fraud_reports (
        id INT PRIMARY KEY AUTO_INCREMENT,
        car_id INT,
        user_id INT,
        risk_score DECIMAL(3,1) NOT NULL,
        risk_level ENUM('low', 'medium', 'high', 'critical') NOT NULL,
        indicators JSON,
        recommendations JSON,
        status ENUM('pending', 'reviewed', 'resolved') DEFAULT 'pending',
        reviewed_by INT,
        analysis_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP NULL,
        
        INDEX idx_fraud_reports_car (car_id),
        INDEX idx_fraud_reports_risk (risk_level),
        INDEX idx_fraud_reports_status (status),
        INDEX idx_fraud_reports_date (analysis_date),
        
        FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Image hashes for duplicate detection
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS image_hashes (
        id INT PRIMARY KEY AUTO_INCREMENT,
        image_id INT NOT NULL,
        hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_image_hashes_hash (hash),
        INDEX idx_image_hashes_image (image_id),
        
        FOREIGN KEY (image_id) REFERENCES car_images(id) ON DELETE CASCADE
      )
    `);

    // Car reports table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS car_reports (
        id INT PRIMARY KEY AUTO_INCREMENT,
        car_id INT NOT NULL,
        reporter_id INT,
        reason ENUM('spam', 'fraud', 'inappropriate', 'duplicate', 'stolen', 'other') NOT NULL,
        description TEXT,
        status ENUM('pending', 'investigating', 'resolved', 'dismissed') DEFAULT 'pending',
        resolved_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP NULL,
        
        INDEX idx_car_reports_car (car_id),
        INDEX idx_car_reports_reporter (reporter_id),
        INDEX idx_car_reports_status (status),
        INDEX idx_car_reports_reason (reason),
        
        FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE,
        FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
  }

  private async createQueueTables(): Promise<void> {
    // Scheduled task logs
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS scheduled_task_logs (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        task_name VARCHAR(100) NOT NULL,
        success BOOLEAN NOT NULL,
        duration_ms INT NOT NULL,
        error_message TEXT,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_task_logs_name (task_name),
        INDEX idx_task_logs_success (success),
        INDEX idx_task_logs_executed (executed_at)
      )
    `);
  }

  private async createNotificationTables(): Promise<void> {
    // Enhanced notifications table (if not exists)
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        type ENUM('car_approved', 'car_rejected', 'new_inquiry', 'inquiry_response', 'car_sold', 'price_drop_alert', 'system_maintenance', 'listing_expired', 'new_transaction', 'transaction_created', 'transaction_status_update', 'account_suspended', 'account_reinstated') NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        action_text VARCHAR(100),
        action_url VARCHAR(500),
        related_car_id INT,
        related_inquiry_id INT,
        related_transaction_id INT,
        priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
        is_read BOOLEAN DEFAULT FALSE,
        is_email_sent BOOLEAN DEFAULT FALSE,
        is_sms_sent BOOLEAN DEFAULT FALSE,
        is_push_sent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP NULL,
        
        INDEX idx_notifications_user (user_id),
        INDEX idx_notifications_type (type),
        INDEX idx_notifications_read (is_read),
        INDEX idx_notifications_created (created_at),
        INDEX idx_notifications_car (related_car_id),
        INDEX idx_notifications_inquiry (related_inquiry_id),
        INDEX idx_notifications_transaction (related_transaction_id),
        
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (related_car_id) REFERENCES cars(id) ON DELETE SET NULL,
        FOREIGN KEY (related_inquiry_id) REFERENCES inquiries(id) ON DELETE SET NULL
      )
    `);

    // Price alerts table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS price_alerts (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        search_criteria JSON NOT NULL,
        max_price DECIMAL(12,2) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_price_alerts_user (user_id),
        INDEX idx_price_alerts_active (is_active),
        INDEX idx_price_alerts_checked (last_checked),
        
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  }

  private async createTransactionTables(): Promise<void> {
    // Transactions table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        car_id INT NOT NULL,
        buyer_id INT NOT NULL,
        seller_id INT NOT NULL,
        transaction_type ENUM('sale', 'trade', 'consignment') DEFAULT 'sale',
        payment_method ENUM('cash', 'bank_transfer', 'financing', 'trade_in', 'installment', 'check') DEFAULT 'cash',
        agreed_price DECIMAL(12,2) NOT NULL,
        financing_bank VARCHAR(100),
        down_payment DECIMAL(12,2),
        loan_amount DECIMAL(12,2),
        monthly_payment DECIMAL(12,2),
        loan_term_months INT,
        trade_in_vehicle_id INT,
        trade_in_value DECIMAL(12,2),
        meeting_location VARCHAR(500),
        transaction_city_id INT,
        seller_notes TEXT,
        buyer_notes TEXT,
        status ENUM('pending', 'accepted', 'in_progress', 'completed', 'cancelled', 'rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        INDEX idx_transactions_car (car_id),
        INDEX idx_transactions_buyer (buyer_id),
        INDEX idx_transactions_seller (seller_id),
        INDEX idx_transactions_status (status),
        INDEX idx_transactions_created (created_at),
        
        FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE,
        FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (transaction_city_id) REFERENCES ph_cities(id) ON DELETE SET NULL
      )
    `);

    // Transaction timeline
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS transaction_timeline (
        id INT PRIMARY KEY AUTO_INCREMENT,
        transaction_id INT NOT NULL,
        user_id INT NOT NULL,
        action VARCHAR(100) NOT NULL,
        status VARCHAR(50),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_transaction_timeline_transaction (transaction_id),
        INDEX idx_transaction_timeline_user (user_id),
        INDEX idx_transaction_timeline_created (created_at),
        
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Transaction documents
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS transaction_documents (
        id INT PRIMARY KEY AUTO_INCREMENT,
        transaction_id INT NOT NULL,
        uploaded_by INT NOT NULL,
        document_type ENUM('contract', 'receipt', 'id_copy', 'insurance', 'registration', 'other') NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INT NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_transaction_docs_transaction (transaction_id),
        INDEX idx_transaction_docs_uploader (uploaded_by),
        INDEX idx_transaction_docs_type (document_type),
        
        FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  }

  private async addSpatialIndexes(): Promise<void> {
    // Add spatial indexes for location-based searches
    try {
      await this.db.execute(
        "ALTER TABLE cars ADD SPATIAL INDEX idx_cars_location_spatial (location_point)"
      );
    } catch (error) {
      // Index might already exist
      logger.debug("Spatial index on cars.location_point might already exist");
    }

    try {
      await this.db.execute(
        "ALTER TABLE ph_cities ADD SPATIAL INDEX idx_cities_location_spatial (location_point)"
      );
    } catch (error) {
      // Index might already exist
      logger.debug(
        "Spatial index on ph_cities.location_point might already exist"
      );
    }
  }

  private async addSearchIndexes(): Promise<void> {
    // Add optimized indexes for search performance
    const indexes = [
      "CREATE INDEX IF NOT EXISTS idx_cars_search_enhanced ON cars (brand_id, price, year, fuel_type, transmission, condition_rating)",
      "CREATE INDEX IF NOT EXISTS idx_cars_featured_approved ON cars (is_featured, approval_status, created_at)",
      "CREATE INDEX IF NOT EXISTS idx_cars_rating_views ON cars (average_rating, views_count)",
      "CREATE INDEX IF NOT EXISTS idx_cars_location_price ON cars (city_id, price)",
      "CREATE INDEX IF NOT EXISTS idx_cars_seller_status ON cars (seller_id, status, created_at)",
      "CREATE FULLTEXT INDEX IF NOT EXISTS idx_cars_search ON cars (title, description, keywords)",
      "CREATE INDEX IF NOT EXISTS idx_user_actions_analytics ON user_actions (action_type, created_at, target_type)",
      "CREATE INDEX IF NOT EXISTS idx_car_views_analytics ON car_views (car_id, viewed_at)",
      "CREATE INDEX IF NOT EXISTS idx_inquiries_active ON inquiries (status, created_at, car_id)",
    ];

    for (const indexSQL of indexes) {
      try {
        await this.db.execute(indexSQL);
      } catch (error) {
        logger.debug(
          `Index creation skipped (might already exist): ${indexSQL}`
        );
      }
    }
  }
}

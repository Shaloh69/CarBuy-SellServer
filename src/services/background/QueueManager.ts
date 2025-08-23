// src/services/background/QueueManager.ts
import Queue from "bull";
import redis from "../../config/redis";
import { config } from "../../config/env";
import logger from "../../utils/logger";
import { JobData, JobResult } from "../../types";

export interface QueueConfig {
  name: string;
  concurrency: number;
  attempts: number;
  backoff: {
    type: "fixed" | "exponential";
    delay: number;
  };
  removeOnComplete: number;
  removeOnFail: number;
}

export class QueueManager {
  private static instance: QueueManager;
  private queues: Map<string, Queue.Queue> = new Map();
  private processors: Map<string, Function> = new Map();

  private readonly queueConfigs: QueueConfig[] = [
    {
      name: "notifications",
      concurrency: 10,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    },
    {
      name: "email",
      concurrency: 5,
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 25,
    },
    {
      name: "image-processing",
      concurrency: 3,
      attempts: 2,
      backoff: { type: "fixed", delay: 10000 },
      removeOnComplete: 20,
      removeOnFail: 10,
    },
    {
      name: "analytics",
      concurrency: 2,
      attempts: 2,
      backoff: { type: "fixed", delay: 30000 },
      removeOnComplete: 10,
      removeOnFail: 5,
    },
    {
      name: "fraud-detection",
      concurrency: 5,
      attempts: 2,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 25,
    },
    {
      name: "maintenance",
      concurrency: 1,
      attempts: 1,
      backoff: { type: "fixed", delay: 60000 },
      removeOnComplete: 5,
      removeOnFail: 5,
    },
  ];

  private constructor() {}

  public static getInstance(): QueueManager {
    if (!QueueManager.instance) {
      QueueManager.instance = new QueueManager();
    }
    return QueueManager.instance;
  }

  /**
   * Initialize all queues
   */
  async initialize(): Promise<void> {
    try {
      logger.info("Initializing queue manager...");

      for (const queueConfig of this.queueConfigs) {
        await this.createQueue(queueConfig);
      }

      // Set up global error handlers
      this.setupGlobalErrorHandlers();

      logger.info(`Queue manager initialized with ${this.queues.size} queues`);
    } catch (error) {
      logger.error("Error initializing queue manager:", error);
      throw error;
    }
  }

  /**
   * Create a queue with configuration
   */
  private async createQueue(queueConfig: QueueConfig): Promise<void> {
    const queue = new Queue(queueConfig.name, {
      redis: {
        port: config.redis.port,
        host: config.redis.host,
        password: config.redis.password,
        db: config.redis.db,
      },
      defaultJobOptions: {
        attempts: queueConfig.attempts,
        backoff: queueConfig.backoff,
        removeOnComplete: queueConfig.removeOnComplete,
        removeOnFail: queueConfig.removeOnFail,
      },
    });

    // Set up queue event listeners
    this.setupQueueEventListeners(queue, queueConfig.name);

    this.queues.set(queueConfig.name, queue);
    logger.info(`Queue '${queueConfig.name}' created successfully`);
  }

  /**
   * Register a job processor for a queue
   */
  registerProcessor(queueName: string, processor: Function): void {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    const queueConfig = this.queueConfigs.find((c) => c.name === queueName);
    if (!queueConfig) {
      throw new Error(`Queue config for '${queueName}' not found`);
    }

    // Register processor with concurrency
    queue.process(queueConfig.concurrency, async (job) => {
      const startTime = Date.now();

      try {
        logger.info(`Processing job ${job.id} in queue '${queueName}'`, {
          jobId: job.id,
          jobType: job.data.type,
          attempt: job.attemptsMade + 1,
        });

        const result = await processor(job.data, job);
        const processingTime = Date.now() - startTime;

        logger.info(`Job ${job.id} completed successfully`, {
          jobId: job.id,
          processingTime,
          queueName,
        });

        return {
          success: true,
          data: result,
          processed_at: new Date(),
          processing_time: processingTime,
        } as JobResult;
      } catch (error) {
        const processingTime = Date.now() - startTime;

        logger.error(`Job ${job.id} failed:`, {
          jobId: job.id,
          error: error instanceof Error ? error.message : error,
          processingTime,
          attempt: job.attemptsMade + 1,
          queueName,
        });

        throw error;
      }
    });

    this.processors.set(queueName, processor);
    logger.info(`Processor registered for queue '${queueName}'`);
  }

  /**
   * Add a job to a queue
   */
  async addJob(
    queueName: string,
    jobData: JobData,
    options?: any
  ): Promise<Queue.Job> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    const jobOptions = {
      priority: this.getPriorityValue(jobData.priority),
      delay: jobData.delay || 0,
      attempts: jobData.attempts,
      backoff: jobData.backoff,
      ...options,
    };

    const job = await queue.add(jobData.type, jobData.payload, jobOptions);

    logger.info(`Job added to queue '${queueName}'`, {
      jobId: job.id,
      jobType: jobData.type,
      priority: jobData.priority,
      delay: jobData.delay,
    });

    return job;
  }

  /**
   * Add a scheduled/recurring job
   */
  async addScheduledJob(
    queueName: string,
    jobData: JobData,
    cronExpression: string
  ): Promise<Queue.Job> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    const job = await queue.add(jobData.type, jobData.payload, {
      repeat: { cron: cronExpression },
      priority: this.getPriorityValue(jobData.priority),
    });

    logger.info(`Scheduled job added to queue '${queueName}'`, {
      jobId: job.id,
      jobType: jobData.type,
      cronExpression,
    });

    return job;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: string): Promise<any> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
    ]);

    return {
      name: queueName,
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  /**
   * Get all queue statistics
   */
  async getAllQueueStats(): Promise<any[]> {
    const stats = [];

    for (const queueName of this.queues.keys()) {
      const queueStats = await this.getQueueStats(queueName);
      stats.push(queueStats);
    }

    return stats;
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    await queue.pause();
    logger.info(`Queue '${queueName}' paused`);
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    await queue.resume();
    logger.info(`Queue '${queueName}' resumed`);
  }

  /**
   * Clean old jobs from a queue
   */
  async cleanQueue(
    queueName: string,
    grace: number = 24 * 60 * 60 * 1000
  ): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue '${queueName}' not found`);
    }

    await queue.clean(grace, "completed");
    await queue.clean(grace, "failed");

    logger.info(`Queue '${queueName}' cleaned`);
  }

  /**
   * Shutdown all queues gracefully
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down queue manager...");

    const shutdownPromises = Array.from(this.queues.values()).map((queue) =>
      queue.close()
    );
    await Promise.all(shutdownPromises);

    logger.info("Queue manager shutdown complete");
  }

  // Private helper methods

  private setupQueueEventListeners(
    queue: Queue.Queue,
    queueName: string
  ): void {
    queue.on("completed", (job, result) => {
      logger.debug(`Job ${job.id} completed in queue '${queueName}'`, {
        jobId: job.id,
        jobType: job.data.type,
        result: result?.success ? "success" : "unknown",
      });
    });

    queue.on("failed", (job, error) => {
      logger.error(`Job ${job.id} failed in queue '${queueName}':`, {
        jobId: job.id,
        jobType: job.data?.type,
        error: error.message,
        attempt: job.attemptsMade,
        maxAttempts: job.opts.attempts,
      });
    });

    queue.on("stalled", (job) => {
      logger.warn(`Job ${job.id} stalled in queue '${queueName}'`, {
        jobId: job.id,
        jobType: job.data?.type,
      });
    });

    queue.on("waiting", (jobId) => {
      logger.debug(`Job ${jobId} waiting in queue '${queueName}'`);
    });
  }

  private setupGlobalErrorHandlers(): void {
    // Handle global queue errors
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled rejection in queue:", { reason, promise });
    });
  }

  private getPriorityValue(
    priority?: "low" | "normal" | "high" | "critical"
  ): number {
    switch (priority) {
      case "critical":
        return 10;
      case "high":
        return 5;
      case "normal":
        return 0;
      case "low":
        return -5;
      default:
        return 0;
    }
  }
}

// Job Processors

// src/services/background/JobProcessor.ts
import { EmailService } from "../external/EmailService";
import { NotificationService } from "../realtime/NotificationService";
import { FraudDetectionService } from "../fraud/FraudDetectionService";
import { AnalyticsService } from "../analytics/ViewTrackingService";

export class JobProcessor {
  private static instance: JobProcessor;
  private queueManager: QueueManager;

  private constructor() {
    this.queueManager = QueueManager.getInstance();
  }

  public static getInstance(): JobProcessor {
    if (!JobProcessor.instance) {
      JobProcessor.instance = new JobProcessor();
    }
    return JobProcessor.instance;
  }

  /**
   * Initialize all job processors
   */
  async initialize(): Promise<void> {
    logger.info("Initializing job processors...");

    // Register notification processors
    this.queueManager.registerProcessor(
      "notifications",
      this.processNotification.bind(this)
    );

    // Register email processors
    this.queueManager.registerProcessor("email", this.processEmail.bind(this));

    // Register image processing
    this.queueManager.registerProcessor(
      "image-processing",
      this.processImage.bind(this)
    );

    // Register analytics processors
    this.queueManager.registerProcessor(
      "analytics",
      this.processAnalytics.bind(this)
    );

    // Register fraud detection
    this.queueManager.registerProcessor(
      "fraud-detection",
      this.processFraudDetection.bind(this)
    );

    // Register maintenance tasks
    this.queueManager.registerProcessor(
      "maintenance",
      this.processMaintenance.bind(this)
    );

    logger.info("Job processors initialized");
  }

  /**
   * Process notification jobs
   */
  private async processNotification(data: any, job: Queue.Job): Promise<any> {
    switch (data.type) {
      case "send_notification":
        return await NotificationService.createNotification(
          data.notificationData
        );

      case "price_alert":
        return await this.processPriceAlert(data);

      case "expiry_reminder":
        return await this.processExpiryReminder(data);

      default:
        throw new Error(`Unknown notification job type: ${data.type}`);
    }
  }

  /**
   * Process email jobs
   */
  private async processEmail(data: any, job: Queue.Job): Promise<any> {
    switch (data.type) {
      case "welcome_email":
        return await EmailService.sendWelcomeEmail(data.email, data.name);

      case "verification_email":
        return await EmailService.sendVerificationEmail(data.email, data.token);

      case "password_reset":
        return await EmailService.sendPasswordResetEmail(
          data.email,
          data.token
        );

      case "notification_email":
        return await EmailService.sendNotificationEmail(
          data.email,
          data.name,
          data.title,
          data.message,
          data.actionText,
          data.actionUrl
        );

      default:
        throw new Error(`Unknown email job type: ${data.type}`);
    }
  }

  /**
   * Process image jobs
   */
  private async processImage(data: any, job: Queue.Job): Promise<any> {
    // Placeholder for image processing
    logger.info(`Processing image job: ${data.type}`, {
      imageId: data.imageId,
    });
    return { processed: true };
  }

  /**
   * Process analytics jobs
   */
  private async processAnalytics(data: any, job: Queue.Job): Promise<any> {
    switch (data.type) {
      case "daily_stats":
        return await this.processDailyStats(data);

      case "user_action":
        return await AnalyticsService.trackUserAction(data.action);

      default:
        throw new Error(`Unknown analytics job type: ${data.type}`);
    }
  }

  /**
   * Process fraud detection jobs
   */
  private async processFraudDetection(data: any, job: Queue.Job): Promise<any> {
    switch (data.type) {
      case "analyze_listing":
        return await FraudDetectionService.getInstance().analyzeListing(
          data.carId
        );

      case "bulk_analysis":
        return await FraudDetectionService.getInstance().bulkAnalyzeCars(
          data.carIds
        );

      default:
        throw new Error(`Unknown fraud detection job type: ${data.type}`);
    }
  }

  /**
   * Process maintenance jobs
   */
  private async processMaintenance(data: any, job: Queue.Job): Promise<any> {
    switch (data.type) {
      case "cleanup_expired_cars":
        return await this.cleanupExpiredCars();

      case "update_search_trends":
        return await this.updateSearchTrends();

      case "backup_analytics":
        return await this.backupAnalytics();

      default:
        throw new Error(`Unknown maintenance job type: ${data.type}`);
    }
  }

  // Helper methods for specific job types

  private async processPriceAlert(data: any): Promise<any> {
    // Implementation for price drop alerts
    logger.info("Processing price alert", {
      carId: data.carId,
      userId: data.userId,
    });
    return { sent: true };
  }

  private async processExpiryReminder(data: any): Promise<any> {
    // Implementation for listing expiry reminders
    logger.info("Processing expiry reminder", { carId: data.carId });
    return { sent: true };
  }

  private async processDailyStats(data: any): Promise<any> {
    // Implementation for daily statistics processing
    logger.info("Processing daily stats", { date: data.date });
    return { processed: true };
  }

  private async cleanupExpiredCars(): Promise<any> {
    // Implementation for cleaning up expired listings
    logger.info("Cleaning up expired cars");
    return { cleaned: 0 };
  }

  private async updateSearchTrends(): Promise<any> {
    // Implementation for updating search trends
    logger.info("Updating search trends");
    return { updated: true };
  }

  private async backupAnalytics(): Promise<any> {
    // Implementation for backing up analytics data
    logger.info("Backing up analytics");
    return { backed_up: true };
  }
}

import Redis from "redis";
import { config } from "./env";
import logger from "../utils/logger";

class RedisManager {
  private static instance: RedisManager;
  private client: Redis.RedisClientType;
  private subscriber: Redis.RedisClientType;
  private publisher: Redis.RedisClientType;

  private constructor() {
    const redisConfig = {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      db: config.redis.db,
      retryDelayOnFailover: config.redis.retryDelayOnFailover,
      maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
      lazyConnect: true,
    };

    this.client = Redis.createClient(redisConfig);
    this.subscriber = Redis.createClient(redisConfig);
    this.publisher = Redis.createClient(redisConfig);

    this.setupEventListeners();
  }

  public static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  private setupEventListeners(): void {
    // Main client events
    this.client.on("connect", () => {
      logger.info("Redis client connected");
    });

    this.client.on("ready", () => {
      logger.info("Redis client ready");
    });

    this.client.on("error", (err) => {
      logger.error("Redis client error:", err);
    });

    this.client.on("end", () => {
      logger.info("Redis client connection ended");
    });

    // Subscriber events
    this.subscriber.on("connect", () => {
      logger.info("Redis subscriber connected");
    });

    this.subscriber.on("error", (err) => {
      logger.error("Redis subscriber error:", err);
    });

    // Publisher events
    this.publisher.on("connect", () => {
      logger.info("Redis publisher connected");
    });

    this.publisher.on("error", (err) => {
      logger.error("Redis publisher error:", err);
    });
  }

  public async connect(): Promise<void> {
    try {
      await Promise.all([
        this.client.connect(),
        this.subscriber.connect(),
        this.publisher.connect(),
      ]);
      logger.info("All Redis connections established");
    } catch (error) {
      logger.error("Redis connection error:", error);
      throw error;
    }
  }

  public getClient(): Redis.RedisClientType {
    return this.client;
  }

  public getSubscriber(): Redis.RedisClientType {
    return this.subscriber;
  }

  public getPublisher(): Redis.RedisClientType {
    return this.publisher;
  }

  // Key management utilities
  public formatKey(key: string): string {
    return `${config.redis.keyPrefix}${key}`;
  }

  // Cache operations
  public async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(this.formatKey(key));
    } catch (error) {
      logger.error(`Redis GET error for key ${key}:`, error);
      return null;
    }
  }

  public async set(key: string, value: string, ttl?: number): Promise<boolean> {
    try {
      const formattedKey = this.formatKey(key);
      if (ttl) {
        await this.client.setEx(formattedKey, ttl, value);
      } else {
        await this.client.set(formattedKey, value);
      }
      return true;
    } catch (error) {
      logger.error(`Redis SET error for key ${key}:`, error);
      return false;
    }
  }

  public async del(key: string | string[]): Promise<number> {
    try {
      const keys = Array.isArray(key)
        ? key.map((k) => this.formatKey(k))
        : [this.formatKey(key)];
      return await this.client.del(keys);
    } catch (error) {
      logger.error(`Redis DEL error for key(s) ${key}:`, error);
      return 0;
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(this.formatKey(key));
      return result === 1;
    } catch (error) {
      logger.error(`Redis EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  public async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const result = await this.client.expire(this.formatKey(key), ttl);
      return result === 1;
    } catch (error) {
      logger.error(`Redis EXPIRE error for key ${key}:`, error);
      return false;
    }
  }

  // Hash operations
  public async hGet(key: string, field: string): Promise<string | null> {
    try {
      return await this.client.hGet(this.formatKey(key), field);
    } catch (error) {
      logger.error(`Redis HGET error for key ${key}, field ${field}:`, error);
      return null;
    }
  }

  public async hSet(
    key: string,
    field: string,
    value: string
  ): Promise<boolean> {
    try {
      await this.client.hSet(this.formatKey(key), field, value);
      return true;
    } catch (error) {
      logger.error(`Redis HSET error for key ${key}, field ${field}:`, error);
      return false;
    }
  }

  public async hGetAll(key: string): Promise<Record<string, string>> {
    try {
      return await this.client.hGetAll(this.formatKey(key));
    } catch (error) {
      logger.error(`Redis HGETALL error for key ${key}:`, error);
      return {};
    }
  }

  // List operations
  public async lPush(key: string, value: string): Promise<number> {
    try {
      return await this.client.lPush(this.formatKey(key), value);
    } catch (error) {
      logger.error(`Redis LPUSH error for key ${key}:`, error);
      return 0;
    }
  }

  public async rPop(key: string): Promise<string | null> {
    try {
      return await this.client.rPop(this.formatKey(key));
    } catch (error) {
      logger.error(`Redis RPOP error for key ${key}:`, error);
      return null;
    }
  }

  public async lRange(
    key: string,
    start: number,
    stop: number
  ): Promise<string[]> {
    try {
      return await this.client.lRange(this.formatKey(key), start, stop);
    } catch (error) {
      logger.error(`Redis LRANGE error for key ${key}:`, error);
      return [];
    }
  }

  // Set operations
  public async sAdd(key: string, member: string): Promise<number> {
    try {
      return await this.client.sAdd(this.formatKey(key), member);
    } catch (error) {
      logger.error(`Redis SADD error for key ${key}:`, error);
      return 0;
    }
  }

  public async sRem(key: string, member: string): Promise<number> {
    try {
      return await this.client.sRem(this.formatKey(key), member);
    } catch (error) {
      logger.error(`Redis SREM error for key ${key}:`, error);
      return 0;
    }
  }

  public async sMembers(key: string): Promise<string[]> {
    try {
      return await this.client.sMembers(this.formatKey(key));
    } catch (error) {
      logger.error(`Redis SMEMBERS error for key ${key}:`, error);
      return [];
    }
  }

  // Pub/Sub operations
  public async publish(channel: string, message: string): Promise<number> {
    try {
      return await this.publisher.publish(this.formatKey(channel), message);
    } catch (error) {
      logger.error(`Redis PUBLISH error for channel ${channel}:`, error);
      return 0;
    }
  }

  public async subscribe(
    channel: string,
    callback: (message: string, channel: string) => void
  ): Promise<void> {
    try {
      await this.subscriber.subscribe(this.formatKey(channel), callback);
    } catch (error) {
      logger.error(`Redis SUBSCRIBE error for channel ${channel}:`, error);
    }
  }

  // Pattern matching
  public async keys(pattern: string): Promise<string[]> {
    try {
      const keys = await this.client.keys(this.formatKey(pattern));
      return keys.map((key) => key.replace(config.redis.keyPrefix, ""));
    } catch (error) {
      logger.error(`Redis KEYS error for pattern ${pattern}:`, error);
      return [];
    }
  }

  // Increment operations
  public async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(this.formatKey(key));
    } catch (error) {
      logger.error(`Redis INCR error for key ${key}:`, error);
      return 0;
    }
  }

  public async incrBy(key: string, increment: number): Promise<number> {
    try {
      return await this.client.incrBy(this.formatKey(key), increment);
    } catch (error) {
      logger.error(`Redis INCRBY error for key ${key}:`, error);
      return 0;
    }
  }

  // Health check
  public async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch (error) {
      logger.error("Redis PING error:", error);
      return false;
    }
  }

  public async getInfo(): Promise<{
    status: "healthy" | "unhealthy";
    connectedClients: number;
    usedMemory: number;
    uptime: number;
  }> {
    try {
      const info = await this.client.info();
      const lines = info.split("\r\n");
      const stats: any = {};

      lines.forEach((line) => {
        const [key, value] = line.split(":");
        if (key && value) {
          stats[key] = value;
        }
      });

      return {
        status: "healthy",
        connectedClients: parseInt(stats.connected_clients || "0"),
        usedMemory: parseInt(stats.used_memory || "0"),
        uptime: parseInt(stats.uptime_in_seconds || "0"),
      };
    } catch (error) {
      logger.error("Redis INFO error:", error);
      return {
        status: "unhealthy",
        connectedClients: 0,
        usedMemory: 0,
        uptime: 0,
      };
    }
  }

  // Cleanup
  public async disconnect(): Promise<void> {
    try {
      await Promise.all([
        this.client.quit(),
        this.subscriber.quit(),
        this.publisher.quit(),
      ]);
      logger.info("All Redis connections closed");
    } catch (error) {
      logger.error("Redis disconnect error:", error);
    }
  }
}

const redis = RedisManager.getInstance();
export default redis;

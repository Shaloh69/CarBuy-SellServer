import NodeCache from "node-cache";
import redis from "../../config/redis";
import { config } from "../../config/env";
import logger, { logCacheOperation, performance } from "../../utils/logger";

// Cache key definitions following the architecture
export const CACHE_KEYS = {
  // Car listings with TTL based on activity
  CARS: {
    LIST: "cars:list",
    FEATURED: "cars:featured",
    BY_BRAND: (brandId: number) => `cars:brand:${brandId}`,
    BY_LOCATION: (cityId: number) => `cars:city:${cityId}`,
    SINGLE: (carId: number) => `car:${carId}`,
    SEARCH: (hash: string) => `search:${hash}`,
    NEARBY: (lat: number, lng: number, radius: number) =>
      `nearby:${lat}:${lng}:${radius}`,
  },

  // User data and sessions
  USERS: {
    PROFILE: (userId: number) => `user:${userId}`,
    FAVORITES: (userId: number) => `user:${userId}:favorites`,
    NOTIFICATIONS: (userId: number) => `user:${userId}:notifications`,
    SESSIONS: (userId: number) => `user:${userId}:sessions`,
  },

  // Location data (static, long TTL)
  LOCATION: {
    REGIONS: "location:regions",
    PROVINCES: (regionId: number) => `location:provinces:${regionId}`,
    CITIES: (provinceId: number) => `location:cities:${provinceId}`,
    POPULAR_CITIES: "location:popular_cities",
  },

  // Real-time data
  REALTIME: {
    ONLINE_USERS: "realtime:online_users",
    ACTIVE_INQUIRIES: "realtime:active_inquiries",
    LIVE_VIEWS: (carId: number) => `realtime:views:${carId}`,
  },

  // Analytics & metrics
  ANALYTICS: {
    CAR_VIEWS: (carId: number) => `analytics:views:${carId}`,
    SEARCH_TRENDS: "analytics:search_trends",
    POPULAR_BRANDS: "analytics:popular_brands",
    DAILY_STATS: (date: string) => `analytics:daily:${date}`,
  },
};

// Cache TTL strategy
export const CACHE_TTL = {
  SHORT: 300, // 5 minutes - real-time data
  MEDIUM: 1800, // 30 minutes - frequently changing
  LONG: 86400, // 24 hours - stable data
  STATIC: 604800, // 7 days - location, brands, etc.
};

export interface CacheOptions {
  ttl?: number;
  refreshOnHit?: boolean;
  forceUpdate?: boolean;
  useMemoryCache?: boolean;
  serialize?: boolean;
}

class MultiLevelCache {
  private memoryCache: NodeCache;
  private redisCache = redis;

  constructor() {
    this.memoryCache = new NodeCache({
      stdTTL: config.performance.memoryCache.ttl / 1000, // Convert to seconds
      maxKeys: config.performance.memoryCache.max,
      useClones: false,
      deleteOnExpire: true,
      checkperiod: 120, // Check for expired keys every 2 minutes
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.memoryCache.on("set", (key, value) => {
      logger.debug(`Memory cache SET: ${key}`);
    });

    this.memoryCache.on("del", (key, value) => {
      logger.debug(`Memory cache DEL: ${key}`);
    });

    this.memoryCache.on("expired", (key, value) => {
      logger.debug(`Memory cache EXPIRED: ${key}`);
    });
  }

  // Get from multi-level cache
  async get<T = any>(
    key: string,
    options: CacheOptions = {}
  ): Promise<T | null> {
    const startTime = performance.start(`cache_get_${key}`);

    try {
      const { useMemoryCache = true } = options;

      // L1: Memory cache (fastest)
      if (useMemoryCache) {
        const memoryValue = this.memoryCache.get<T>(key);
        if (memoryValue !== undefined) {
          logCacheOperation(
            "GET",
            key,
            true,
            performance.end(`cache_get_${key}`)
          );
          return memoryValue;
        }
      }

      // L2: Redis cache (fast)
      const redisValue = await this.redisCache.get(key);
      if (redisValue) {
        let parsed: T;
        try {
          parsed = JSON.parse(redisValue);
        } catch {
          parsed = redisValue as T;
        }

        // Store in memory cache for future L1 hits
        if (useMemoryCache) {
          this.memoryCache.set(key, parsed, 300); // 5 min in memory
        }

        logCacheOperation(
          "GET",
          key,
          true,
          performance.end(`cache_get_${key}`)
        );
        return parsed;
      }

      logCacheOperation("GET", key, false, performance.end(`cache_get_${key}`));
      return null;
    } catch (error) {
      logger.error(`Cache GET error for key ${key}:`, error);
      performance.end(`cache_get_${key}`);
      return null;
    }
  }

  // Set in multi-level cache
  async set<T = any>(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<boolean> {
    const startTime = performance.start(`cache_set_${key}`);

    try {
      const {
        ttl = CACHE_TTL.MEDIUM,
        useMemoryCache = true,
        serialize = true,
      } = options;

      // Store in Redis
      const serializedValue = serialize
        ? JSON.stringify(value)
        : (value as string);
      const redisSuccess = await this.redisCache.set(key, serializedValue, ttl);

      // Store in memory cache with shorter TTL
      if (useMemoryCache && redisSuccess) {
        const memoryTtl = Math.min(ttl, 300); // Max 5 minutes in memory
        this.memoryCache.set(key, value, memoryTtl);
      }

      logCacheOperation(
        "SET",
        key,
        redisSuccess,
        performance.end(`cache_set_${key}`)
      );
      return redisSuccess;
    } catch (error) {
      logger.error(`Cache SET error for key ${key}:`, error);
      performance.end(`cache_set_${key}`);
      return false;
    }
  }

  // Delete from multi-level cache
  async del(key: string | string[]): Promise<number> {
    const startTime = performance.start(`cache_del`);

    try {
      const keys = Array.isArray(key) ? key : [key];

      // Delete from memory cache
      for (const k of keys) {
        this.memoryCache.del(k);
      }

      // Delete from Redis
      const deletedCount = await this.redisCache.del(keys);

      logCacheOperation(
        "DEL",
        Array.isArray(key) ? key.join(",") : key,
        true,
        performance.end(`cache_del`)
      );
      return deletedCount;
    } catch (error) {
      logger.error(`Cache DEL error for key(s) ${key}:`, error);
      performance.end(`cache_del`);
      return 0;
    }
  }

  // Check if key exists
  async exists(key: string): Promise<boolean> {
    try {
      // Check memory cache first
      if (this.memoryCache.has(key)) {
        return true;
      }

      // Check Redis
      return await this.redisCache.exists(key);
    } catch (error) {
      logger.error(`Cache EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  // Get or set pattern (cache-aside)
  async getOrSet<T = any>(
    key: string,
    fetchFunction: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const { forceUpdate = false } = options;

    // Try to get from cache first (unless forcing update)
    if (!forceUpdate) {
      const cached = await this.get<T>(key, options);
      if (cached !== null) {
        return cached;
      }
    }

    // Fetch fresh data
    try {
      const freshData = await performance.measureAsync(
        `cache_fetch_${key}`,
        fetchFunction,
        "CacheManager"
      );

      // Store in cache
      await this.set(key, freshData, options);

      return freshData;
    } catch (error) {
      logger.error(`Cache getOrSet fetch error for key ${key}:`, error);

      // If fetch fails, try to return stale cache data
      if (forceUpdate) {
        const staleData = await this.get<T>(key, options);
        if (staleData !== null) {
          logger.warn(
            `Returning stale cache data for key ${key} due to fetch error`
          );
          return staleData;
        }
      }

      throw error;
    }
  }

  // Invalidate cache patterns
  async invalidatePattern(pattern: string): Promise<number> {
    try {
      const keys = await this.redisCache.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }

      // Delete from memory cache
      for (const key of keys) {
        this.memoryCache.del(key);
      }

      // Delete from Redis
      return await this.redisCache.del(keys);
    } catch (error) {
      logger.error(
        `Cache invalidatePattern error for pattern ${pattern}:`,
        error
      );
      return 0;
    }
  }

  // Cache warming functions
  async warmup(): Promise<void> {
    logger.info("Starting cache warmup...");

    try {
      // Warm up static data
      await this.warmupStaticData();

      // Warm up popular content
      await this.warmupPopularContent();

      logger.info("Cache warmup completed successfully");
    } catch (error) {
      logger.error("Cache warmup failed:", error);
    }
  }

  private async warmupStaticData(): Promise<void> {
    // This would be implemented to pre-load static data like locations, brands, etc.
    logger.debug("Warming up static data...");
    // Implementation would go here
  }

  private async warmupPopularContent(): Promise<void> {
    // This would be implemented to pre-load popular cars, searches, etc.
    logger.debug("Warming up popular content...");
    // Implementation would go here
  }

  // Cache statistics
  async getStats(): Promise<{
    memory: {
      keys: number;
      hits: number;
      misses: number;
      ksize: number;
      vsize: number;
    };
    redis: {
      status: "healthy" | "unhealthy";
      memory_usage: number;
      connected_clients: number;
      uptime: number;
    };
  }> {
    try {
      const memoryStats = this.memoryCache.getStats();
      const redisInfo = await this.redisCache.getInfo();

      return {
        memory: {
          keys: memoryStats.keys,
          hits: memoryStats.hits,
          misses: memoryStats.misses,
          ksize: memoryStats.ksize,
          vsize: memoryStats.vsize,
        },
        redis: redisInfo,
      };
    } catch (error) {
      logger.error("Error getting cache stats:", error);
      return {
        memory: { keys: 0, hits: 0, misses: 0, ksize: 0, vsize: 0 },
        redis: {
          status: "unhealthy",
          memory_usage: 0,
          connected_clients: 0,
          uptime: 0,
        },
      };
    }
  }

  // Cleanup expired keys
  async cleanup(): Promise<void> {
    try {
      // Memory cache cleanup is automatic
      logger.debug("Cache cleanup completed");
    } catch (error) {
      logger.error("Cache cleanup error:", error);
    }
  }

  // Flush all caches
  async flush(): Promise<void> {
    try {
      this.memoryCache.flushAll();
      // Note: Not flushing Redis as it might affect other services
      logger.info("Memory cache flushed");
    } catch (error) {
      logger.error("Cache flush error:", error);
    }
  }
}

// Specialized cache services
export class CarCacheService {
  constructor(private cache: MultiLevelCache) {}

  async getCar(carId: number): Promise<any> {
    return this.cache.get(CACHE_KEYS.CARS.SINGLE(carId), {
      ttl: CACHE_TTL.MEDIUM,
    });
  }

  async setCar(carId: number, carData: any): Promise<boolean> {
    return this.cache.set(CACHE_KEYS.CARS.SINGLE(carId), carData, {
      ttl: CACHE_TTL.MEDIUM,
    });
  }

  async getFeaturedCars(): Promise<any[]> {
    return this.cache.get(CACHE_KEYS.CARS.FEATURED, { ttl: CACHE_TTL.SHORT });
  }

  async setFeaturedCars(cars: any[]): Promise<boolean> {
    return this.cache.set(CACHE_KEYS.CARS.FEATURED, cars, {
      ttl: CACHE_TTL.SHORT,
    });
  }

  async getCarsByBrand(brandId: number): Promise<any[]> {
    return this.cache.get(CACHE_KEYS.CARS.BY_BRAND(brandId), {
      ttl: CACHE_TTL.MEDIUM,
    });
  }

  async setCarsByBrand(brandId: number, cars: any[]): Promise<boolean> {
    return this.cache.set(CACHE_KEYS.CARS.BY_BRAND(brandId), cars, {
      ttl: CACHE_TTL.MEDIUM,
    });
  }

  async getSearchResults(searchHash: string): Promise<any> {
    return this.cache.get(CACHE_KEYS.CARS.SEARCH(searchHash), {
      ttl: CACHE_TTL.SHORT,
    });
  }

  async setSearchResults(searchHash: string, results: any): Promise<boolean> {
    return this.cache.set(CACHE_KEYS.CARS.SEARCH(searchHash), results, {
      ttl: CACHE_TTL.SHORT,
    });
  }

  async invalidateCarCache(carId: number): Promise<void> {
    await this.cache.del([
      CACHE_KEYS.CARS.SINGLE(carId),
      CACHE_KEYS.CARS.LIST,
      CACHE_KEYS.CARS.FEATURED,
    ]);

    // Invalidate search caches
    await this.cache.invalidatePattern(CACHE_KEYS.CARS.SEARCH("*"));
  }

  async invalidateLocationCache(cityId: number): Promise<void> {
    await this.cache.del(CACHE_KEYS.CARS.BY_LOCATION(cityId));
    await this.cache.invalidatePattern(
      CACHE_KEYS.CARS.NEARBY(0, 0, 0).replace("0:0:0", "*")
    );
  }
}

export class UserCacheService {
  constructor(private cache: MultiLevelCache) {}

  async getUserProfile(userId: number): Promise<any> {
    return this.cache.get(CACHE_KEYS.USERS.PROFILE(userId), {
      ttl: CACHE_TTL.MEDIUM,
    });
  }

  async setUserProfile(userId: number, profile: any): Promise<boolean> {
    return this.cache.set(CACHE_KEYS.USERS.PROFILE(userId), profile, {
      ttl: CACHE_TTL.MEDIUM,
    });
  }

  async getUserFavorites(userId: number): Promise<number[]> {
    return this.cache.get(CACHE_KEYS.USERS.FAVORITES(userId), {
      ttl: CACHE_TTL.SHORT,
    });
  }

  async setUserFavorites(
    userId: number,
    favorites: number[]
  ): Promise<boolean> {
    return this.cache.set(CACHE_KEYS.USERS.FAVORITES(userId), favorites, {
      ttl: CACHE_TTL.SHORT,
    });
  }

  async invalidateUserCache(userId: number): Promise<void> {
    await this.cache.del([
      CACHE_KEYS.USERS.PROFILE(userId),
      CACHE_KEYS.USERS.FAVORITES(userId),
      CACHE_KEYS.USERS.NOTIFICATIONS(userId),
    ]);
  }
}

export class LocationCacheService {
  constructor(private cache: MultiLevelCache) {}

  async getRegions(): Promise<any[]> {
    return this.cache.get(CACHE_KEYS.LOCATION.REGIONS, {
      ttl: CACHE_TTL.STATIC,
    });
  }

  async setRegions(regions: any[]): Promise<boolean> {
    return this.cache.set(CACHE_KEYS.LOCATION.REGIONS, regions, {
      ttl: CACHE_TTL.STATIC,
    });
  }

  async getProvinces(regionId: number): Promise<any[]> {
    return this.cache.get(CACHE_KEYS.LOCATION.PROVINCES(regionId), {
      ttl: CACHE_TTL.STATIC,
    });
  }

  async setProvinces(regionId: number, provinces: any[]): Promise<boolean> {
    return this.cache.set(CACHE_KEYS.LOCATION.PROVINCES(regionId), provinces, {
      ttl: CACHE_TTL.STATIC,
    });
  }

  async getCities(provinceId: number): Promise<any[]> {
    return this.cache.get(CACHE_KEYS.LOCATION.CITIES(provinceId), {
      ttl: CACHE_TTL.STATIC,
    });
  }

  async setCities(provinceId: number, cities: any[]): Promise<boolean> {
    return this.cache.set(CACHE_KEYS.LOCATION.CITIES(provinceId), cities, {
      ttl: CACHE_TTL.STATIC,
    });
  }

  async getPopularCities(): Promise<any[]> {
    return this.cache.get(CACHE_KEYS.LOCATION.POPULAR_CITIES, {
      ttl: CACHE_TTL.LONG,
    });
  }

  async setPopularCities(cities: any[]): Promise<boolean> {
    return this.cache.set(CACHE_KEYS.LOCATION.POPULAR_CITIES, cities, {
      ttl: CACHE_TTL.LONG,
    });
  }
}

// Create and export cache manager instance
const cacheManager = new MultiLevelCache();

export const carCache = new CarCacheService(cacheManager);
export const userCache = new UserCacheService(cacheManager);
export const locationCache = new LocationCacheService(cacheManager);

export default cacheManager;

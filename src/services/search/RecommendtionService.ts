// src/services/search/RecommendationService.ts
import { DatabaseManager } from "../../config/database";
import redis from "../../config/redis";
import logger from "../../utils/logger";
import { Car, UserAction } from "../../types";

export interface RecommendationOptions {
  limit?: number;
  include_viewed?: boolean;
  price_variance?: number;
  location_radius?: number;
  exclude_car_ids?: number[];
}

export interface UserPreferences {
  preferred_brands: number[];
  price_range: { min: number; max: number };
  preferred_locations: number[];
  preferred_features: string[];
  fuel_type_preference: string[];
  transmission_preference: string[];
  body_type_preference: string[];
}

export class RecommendationService {
  private static instance: RecommendationService;
  private db: DatabaseManager;

  private constructor() {
    this.db = DatabaseManager.getInstance();
  }

  public static getInstance(): RecommendationService {
    if (!RecommendationService.instance) {
      RecommendationService.instance = new RecommendationService();
    }
    return RecommendationService.instance;
  }

  /**
   * Get personalized car recommendations for a user
   */
  async getPersonalizedRecommendations(
    userId: number,
    options: RecommendationOptions = {}
  ): Promise<Car[]> {
    try {
      const {
        limit = 20,
        include_viewed = false,
        price_variance = 0.3,
        location_radius = 50,
        exclude_car_ids = []
      } = options;

      // Get user preferences
      const userPreferences = await this.getUserPreferences(userId);
      
      // Get user's recent activity for context
      const recentActivity = await this.getRecentUserActivity(userId);

      // Build recommendation query based on preferences
      let query = `
        SELECT DISTINCT
          c.*,
          b.name as brand_name,
          m.name as model_name,
          ct.name as city_name,
          pr.name as province_name,
          u.first_name as seller_name,
          u.average_rating as seller_rating,
          u.is_verified as seller_verified,
          (
            ${this.buildRecommendationScore(userPreferences, recentActivity)}
          ) as recommendation_score
        FROM cars c
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        INNER JOIN ph_cities ct ON c.city_id = ct.id
        INNER JOIN ph_provinces pr ON ct.province_id = pr.id
        INNER JOIN users u ON c.seller_id = u.id
        WHERE c.approval_status = 'approved'
          AND c.status = 'active'
          AND c.is_active = TRUE
          AND c.seller_id != ?
      `;

      const params = [userId];

      // Apply preference filters
      if (userPreferences.preferred_brands.length > 0) {
        query += ` AND c.brand_id IN (${userPreferences.preferred_brands.map(() => '?').join(',')})`;
        params.push(...userPreferences.preferred_brands);
      }

      if (userPreferences.price_range.min > 0 || userPreferences.price_range.max > 0) {
        const minPrice = userPreferences.price_range.min * (1 - price_variance);
        const maxPrice = userPreferences.price_range.max * (1 + price_variance);
        query += ` AND c.price BETWEEN ? AND ?`;
        params.push(minPrice, maxPrice);
      }

      if (userPreferences.preferred_locations.length > 0) {
        query += ` AND c.city_id IN (${userPreferences.preferred_locations.map(() => '?').join(',')})`;
        params.push(...userPreferences.preferred_locations);
      }

      if (userPreferences.fuel_type_preference.length > 0) {
        query += ` AND c.fuel_type IN (${userPreferences.fuel_type_preference.map(() => '?').join(',')})`;
        params.push(...userPreferences.fuel_type_preference);
      }

      if (userPreferences.transmission_preference.length > 0) {
        query += ` AND c.transmission IN (${userPreferences.transmission_preference.map(() => '?').join(',')})`;
        params.push(...userPreferences.transmission_preference);
      }

      // Exclude already viewed cars if specified
      if (!include_viewed) {
        const viewedCars = await this.getViewedCarIds(userId);
        if (viewedCars.length > 0) {
          query += ` AND c.id NOT IN (${viewedCars.map(() => '?').join(',')})`;
          params.push(...viewedCars);
        }
      }

      // Exclude specific car IDs
      if (exclude_car_ids.length > 0) {
        query += ` AND c.id NOT IN (${exclude_car_ids.map(() => '?').join(',')})`;
        params.push(...exclude_car_ids);
      }

      query += `
        ORDER BY recommendation_score DESC, c.created_at DESC
        LIMIT ?
      `;
      params.push(limit);

      const recommendations = await this.db.execute(query, params);

      // Cache recommendations for 1 hour
      await redis.setex(
        `recommendations:${userId}`, 
        3600, 
        JSON.stringify(recommendations)
      );

      return recommendations;

    } catch (error) {
      logger.error("Error getting personalized recommendations:", error);
      return [];
    }
  }

  /**
   * Get similar cars based on a specific car
   */
  async getSimilarCars(
    carId: number,
    options: RecommendationOptions = {}
  ): Promise<Car[]> {
    try {
      const { limit = 10, exclude_car_ids = [] } = options;

      // Get the reference car details
      const refCars = await this.db.execute(
        "SELECT * FROM cars WHERE id = ?",
        [carId]
      );

      if (refCars.length === 0) {
        return [];
      }

      const refCar = refCars[0];

      // Find similar cars based on multiple criteria
      let query = `
        SELECT 
          c.*,
          b.name as brand_name,
          m.name as model_name,
          ct.name as city_name,
          (
            ${this.buildSimilarityScore(refCar)}
          ) as similarity_score
        FROM cars c
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        INNER JOIN ph_cities ct ON c.city_id = ct.id
        WHERE c.approval_status = 'approved'
          AND c.status = 'active'
          AND c.is_active = TRUE
          AND c.id != ?
          AND c.seller_id != ?
      `;

      const params = [carId, refCar.seller_id];

      // Exclude specific car IDs
      if (exclude_car_ids.length > 0) {
        query += ` AND c.id NOT IN (${exclude_car_ids.map(() => '?').join(',')})`;
        params.push(...exclude_car_ids);
      }

      query += `
        ORDER BY similarity_score DESC
        LIMIT ?
      `;
      params.push(limit);

      const similarCars = await this.db.execute(query, params);
      return similarCars;

    } catch (error) {
      logger.error("Error getting similar cars:", error);
      return [];
    }
  }

  /**
   * Get trending cars based on recent activity
   */
  async getTrendingCars(limit: number = 20): Promise<Car[]> {
    try {
      // Check cache first
      const cached = await redis.get('trending_cars');
      if (cached) {
        return JSON.parse(cached).slice(0, limit);
      }

      const query = `
        SELECT 
          c.*,
          b.name as brand_name,
          m.name as model_name,
          ct.name as city_name,
          (
            COUNT(DISTINCT cv.id) * 1.0 +
            COUNT(DISTINCT uf.id) * 2.0 +
            COUNT(DISTINCT i.id) * 3.0 +
            (CASE WHEN c.is_featured THEN 5.0 ELSE 0.0 END) +
            (CASE WHEN c.is_premium THEN 3.0 ELSE 0.0 END)
          ) as trending_score
        FROM cars c
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        INNER JOIN ph_cities ct ON c.city_id = ct.id
        LEFT JOIN car_views cv ON c.id = cv.car_id AND cv.viewed_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        LEFT JOIN user_favorites uf ON c.id = uf.car_id AND uf.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        LEFT JOIN inquiries i ON c.id = i.car_id AND i.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        WHERE c.approval_status = 'approved'
          AND c.status = 'active'
          AND c.is_active = TRUE
        GROUP BY c.id
        HAVING trending_score > 0
        ORDER BY trending_score DESC, c.created_at DESC
        LIMIT ?
      `;

      const trendingCars = await this.db.execute(query, [limit]);

      // Cache for 30 minutes
      await redis.setex('trending_cars', 1800, JSON.stringify(trendingCars));

      return trendingCars;

    } catch (error) {
      logger.error("Error getting trending cars:", error);
      return [];
    }
  }

  /**
   * Get recommendations for users in similar locations
   */
  async getLocationBasedRecommendations(
    cityId: number,
    limit: number = 20
  ): Promise<Car[]> {
    try {
      const query = `
        SELECT 
          c.*,
          b.name as brand_name,
          m.name as model_name,
          COUNT(cv.id) as local_popularity
        FROM cars c
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        LEFT JOIN car_views cv ON c.id = cv.car_id AND cv.viewed_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        WHERE c.approval_status = 'approved'
          AND c.status = 'active'
          AND c.is_active = TRUE
          AND c.city_id = ?
        GROUP BY c.id
        ORDER BY local_popularity DESC, c.average_rating DESC
        LIMIT ?
      `;

      return await this.db.execute(query, [cityId, limit]);

    } catch (error) {
      logger.error("Error getting location-based recommendations:", error);
      return [];
    }
  }

  /**
   * Get budget-friendly recommendations
   */
  async getBudgetFriendlyRecommendations(
    maxBudget: number,
    limit: number = 20
  ): Promise<Car[]> {
    try {
      const query = `
        SELECT 
          c.*,
          b.name as brand_name,
          m.name as model_name,
          ct.name as city_name,
          (
            (c.price / ?) * -0.5 +  -- Lower price is better
            (c.average_rating / 5.0) * 0.3 +  -- Higher rating is better
            (c.condition_rating / 10.0) * 0.2  -- Better condition is better
          ) as value_score
        FROM cars c
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        INNER JOIN ph_cities ct ON c.city_id = ct.id
        WHERE c.approval_status = 'approved'
          AND c.status = 'active'
          AND c.is_active = TRUE
          AND c.price <= ?
        ORDER BY value_score DESC, c.price ASC
        LIMIT ?
      `;

      return await this.db.execute(query, [maxBudget, maxBudget, limit]);

    } catch (error) {
      logger.error("Error getting budget-friendly recommendations:", error);
      return [];
    }
  }

  // Private helper methods

  private async getUserPreferences(userId: number): Promise<UserPreferences> {
    try {
      // Analyze user's viewing and searching behavior
      const [brandPrefs, pricePrefs, locationPrefs, featurePrefs, fuelPrefs, transPrefs] = await Promise.all([
        this.getUserBrandPreferences(userId),
        this.getUserPriceRange(userId),
        this.getUserLocationPreferences(userId),
        this.getUserFeaturePreferences(userId),
        this.getUserFuelPreferences(userId),
        this.getUserTransmissionPreferences(userId)
      ]);

      return {
        preferred_brands: brandPrefs,
        price_range: pricePrefs,
        preferred_locations: locationPrefs,
        preferred_features: featurePrefs,
        fuel_type_preference: fuelPrefs,
        transmission_preference: transPrefs,
        body_type_preference: []
      };

    } catch (error) {
      logger.error("Error getting user preferences:", error);
      return {
        preferred_brands: [],
        price_range: { min: 0, max: 0 },
        preferred_locations: [],
        preferred_features: [],
        fuel_type_preference: [],
        transmission_preference: [],
        body_type_preference: []
      };
    }
  }

  private async getUserBrandPreferences(userId: number): Promise<number[]> {
    const brands = await this.db.execute(`
      SELECT c.brand_id, COUNT(*) as view_count
      FROM user_actions ua
      INNER JOIN cars c ON ua.target_id = c.id
      WHERE ua.user_id = ? 
        AND ua.action_type = 'view_car'
        AND ua.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY c.brand_id
      ORDER BY view_count DESC
      LIMIT 5
    `, [userId]);

    return brands.map((b: any) => b.brand_id);
  }

  private async getUserPriceRange(userId: number): Promise<{ min: number; max: number }> {
    const priceStats = await this.db.execute(`
      SELECT 
        MIN(c.price) as min_price,
        MAX(c.price) as max_price,
        AVG(c.price) as avg_price
      FROM user_actions ua
      INNER JOIN cars c ON ua.target_id = c.id
      WHERE ua.user_id = ? 
        AND ua.action_type = 'view_car'
        AND ua.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    `, [userId]);

    if (priceStats.length === 0 || !priceStats[0].avg_price) {
      return { min: 0, max: 0 };
    }

    const stats = priceStats[0];
    return {
      min: Math.max(0, stats.min_price * 0.8),
      max: stats.max_price * 1.2
    };
  }

  private async getUserLocationPreferences(userId: number): Promise<number[]> {
    const locations = await this.db.execute(`
      SELECT c.city_id, COUNT(*) as view_count
      FROM user_actions ua
      INNER JOIN cars c ON ua.target_id = c.id
      WHERE ua.user_id = ? 
        AND ua.action_type = 'view_car'
        AND ua.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY c.city_id
      ORDER BY view_count DESC
      LIMIT 5
    `, [userId]);

    return locations.map((l: any) => l.city_id);
  }

  private async getUserFeaturePreferences(userId: number): Promise<string[]> {
    // This would analyze which car features the user views most
    return [];
  }

  private async getUserFuelPreferences(userId: number): Promise<string[]> {
    const fuelTypes = await this.db.execute(`
      SELECT c.fuel_type, COUNT(*) as view_count
      FROM user_actions ua
      INNER JOIN cars c ON ua.target_id = c.id
      WHERE ua.user_id = ? 
        AND ua.action_type = 'view_car'
        AND ua.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY c.fuel_type
      ORDER BY view_count DESC
      LIMIT 3
    `, [userId]);

    return fuelTypes.map((f: any) => f.fuel_type);
  }

  private async getUserTransmissionPreferences(userId: number): Promise<string[]> {
    const transmissions = await this.db.execute(`
      SELECT c.transmission, COUNT(*) as view_count
      FROM user_actions ua
      INNER JOIN cars c ON ua.target_id = c.id
      WHERE ua.user_id = ? 
        AND ua.action_type = 'view_car'
        AND ua.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
      GROUP BY c.transmission
      ORDER BY view_count DESC
      LIMIT 2
    `, [userId]);

    return transmissions.map((t: any) => t.transmission);
  }

  private async getRecentUserActivity(userId: number): Promise<UserAction[]> {
    return await this.db.execute(`
      SELECT * FROM user_actions
      WHERE user_id = ?
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      ORDER BY created_at DESC
      LIMIT 100
    `, [userId]);
  }

  private async getViewedCarIds(userId: number): Promise<number[]> {
    const viewed = await this.db.execute(`
      SELECT DISTINCT target_id as car_id
      FROM user_actions
      WHERE user_id = ? 
        AND action_type = 'view_car'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `, [userId]);

    return viewed.map((v: any) => v.car_id);
  }

  private buildRecommendationScore(
    preferences: UserPreferences,
    recentActivity: UserAction[]
  ): string {
    return `
      (
        -- Brand preference score (0-30 points)
        (CASE 
          WHEN c.brand_id IN (${preferences.preferred_brands.map(() => '?').join(',') || 'NULL'}) THEN 30
          ELSE 0
        END) +
        
        -- Price preference score (0-25 points)
        (CASE 
          WHEN c.price BETWEEN ${preferences.price_range.min} AND ${preferences.price_range.max} THEN 25
          WHEN c.price < ${preferences.price_range.min * 1.5} AND c.price > ${preferences.price_range.min * 0.5} THEN 15
          ELSE 5
        END) +
        
        -- Location preference score (0-20 points)
        (CASE 
          WHEN c.city_id IN (${preferences.preferred_locations.map(() => '?').join(',') || 'NULL'}) THEN 20
          ELSE 0
        END) +
        
        -- Car quality score (0-15 points)
        (c.average_rating * 3) +
        
        -- Popularity score (0-10 points)
        LEAST(10, LOG(c.views_count + 1) * 2)
      ) / 100.0
    `;
  }

  private buildSimilarityScore(refCar: any): string {
    return `
      (
        -- Same brand (40 points)
        (CASE WHEN c.brand_id = ${refCar.brand_id} THEN 40 ELSE 0 END) +
        
        -- Same model (60 points, overrides brand)
        (CASE WHEN c.model_id = ${refCar.model_id} THEN 60 ELSE 0 END) +
        
        -- Price similarity (20 points)
        (20 - ABS(c.price - ${refCar.price}) / ${refCar.price} * 20) +
        
        -- Year similarity (15 points)
        (15 - ABS(c.year - ${refCar.year}) * 3) +
        
        -- Same fuel type (10 points)
        (CASE WHEN c.fuel_type = '${refCar.fuel_type}' THEN 10 ELSE 0 END) +
        
        -- Same transmission (5 points)
        (CASE WHEN c.transmission = '${refCar.transmission}' THEN 5 ELSE 0 END)
      )
    `;
  }

  /**
   * Update user recommendation cache when they perform actions
   */
  async invalidateUserRecommendations(userId: number): Promise<void> {
    try {
      await redis.del(`recommendations:${userId}`);
      logger.debug(`Invalidated recommendations cache for user ${userId}`);
    } catch (error) {
      logger.error("Error invalidating user recommendations:", error);
    }
  }

  /**
   * Get recommendation statistics for analytics
   */
  async getRecommendationStats(): Promise<any> {
    try {
      const stats = await this.db.execute(`
        SELECT 
          COUNT(*) as total_views,
          COUNT(CASE WHEN ua.metadata->>'$.is_recommendation' = 'true' THEN 1 END) as recommendation_views,
          COUNT(CASE WHEN ua.action_type = 'contact_seller' AND ua.metadata->>'$.is_recommendation' = 'true' THEN 1 END) as recommendation_inquiries
        FROM user_actions ua
        WHERE ua.action_type IN ('view_car', 'contact_seller')
          AND ua.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `);

      return stats[0];
    } catch (error) {
      logger.error("Error getting recommendation stats:", error);
      return null;
    }
  }
}
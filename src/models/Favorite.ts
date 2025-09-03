// src/models/Favorite.ts
import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface Favorite {
  id: number;
  user_id: number;
  car_id: number;
  notes?: string;
  price_alert_enabled: boolean;
  price_alert_threshold?: number;
  created_at: Date;
  updated_at: Date;

  // Additional fields from joins
  car_title?: string;
  car_brand?: string;
  car_model?: string;
  car_year?: number;
  car_price?: number;
  car_currency?: string;
  car_status?: string;
  car_image?: string;
  car_city?: string;
  car_province?: string;
  seller_name?: string;
  seller_rating?: number;
  price_changed?: boolean;
  current_price?: number;
  original_favorite_price?: number;
}

export interface CreateFavoriteData {
  user_id: number;
  car_id: number;
  notes?: string;
  price_alert_enabled?: boolean;
  price_alert_threshold?: number;
}

export interface UpdateFavoriteData {
  notes?: string;
  price_alert_enabled?: boolean;
  price_alert_threshold?: number;
}

export interface FavoriteFilters {
  user_id?: number;
  car_status?: string;
  price_alert_enabled?: boolean;
  price_changed?: boolean;
  search?: string;
  brand_id?: number;
  city_id?: number;
  price_min?: number;
  price_max?: number;
}

export interface FavoriteSearchOptions {
  page?: number;
  limit?: number;
  sort_by?: "created_at" | "car_title" | "car_price" | "car_year" | "price_change";
  sort_order?: "ASC" | "DESC";
  include_car_details?: boolean;
}

export class FavoriteModel {
  private static tableName = "favorites";

  // Add to favorites
  static async create(favoriteData: CreateFavoriteData): Promise<Favorite> {
    try {
      // Check if car exists and is active
      const car = await database.execute(
        "SELECT id, price, seller_id FROM cars WHERE id = ? AND is_active = TRUE",
        [favoriteData.car_id]
      );

      if (car.length === 0) {
        throw new Error("Car not found or inactive");
      }

      // Check if user exists
      const user = await database.execute(
        "SELECT id FROM users WHERE id = ?",
        [favoriteData.user_id]
      );

      if (user.length === 0) {
        throw new Error("User not found");
      }

      // Check if user is not the seller
      if (car[0].seller_id === favoriteData.user_id) {
        throw new Error("Cannot favorite your own car listing");
      }

      // Check if already favorited
      const existingFavorite = await this.findByUserAndCar(favoriteData.user_id, favoriteData.car_id);
      if (existingFavorite) {
        throw new Error("Car is already in favorites");
      }

      const insertData = {
        ...favoriteData,
        price_alert_enabled: favoriteData.price_alert_enabled || false,
        price_alert_threshold: favoriteData.price_alert_threshold || car[0].price,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const favoriteId = (result as ResultSetHeader).insertId;

      // Update car favorite count
      await database.execute(
        "UPDATE cars SET favorite_count = favorite_count + 1 WHERE id = ?",
        [favoriteData.car_id]
      );

      const favorite = await this.findById(favoriteId);

      if (!favorite) {
        throw new Error("Failed to create favorite");
      }

      logger.info(`Favorite created successfully: User ${favoriteData.user_id}, Car ${favoriteData.car_id}`);
      return favorite;
    } catch (error) {
      logger.error("Error creating favorite:", error);
      throw error;
    }
  }

  // Find favorite by ID
  static async findById(id: number, includeCarDetails: boolean = true): Promise<Favorite | null> {
    try {
      let selectFields = ["f.*"];

      if (includeCarDetails) {
        selectFields.push(
          "c.title as car_title",
          "c.year as car_year",
          "c.price as car_price",
          "c.currency as car_currency",
          "c.status as car_status",
          "b.name as car_brand",
          "m.name as car_model",
          "city.name as car_city",
          "prov.name as car_province",
          'CONCAT(u.first_name, " ", u.last_name) as seller_name',
          "u.average_rating as seller_rating",
          "ci.image_url as car_image",
          "f.price_alert_threshold as original_favorite_price",
          "(c.price != f.price_alert_threshold) as price_changed"
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} f`);

      if (includeCarDetails) {
        query = query
          .join("cars c", "f.car_id = c.id")
          .join("brands b", "c.brand_id = b.id")
          .join("models m", "c.model_id = m.id")
          .join("users u", "c.seller_id = u.id")
          .join("ph_cities city", "c.city_id = city.id")
          .join("ph_provinces prov", "c.province_id = prov.id")
          .leftJoin("car_images ci", "c.id = ci.car_id AND ci.is_primary = TRUE");
      }

      const favorites = await query
        .where("f.id = ?", id)
        .execute();

      if (favorites.length === 0) {
        return null;
      }

      const favorite = favorites[0];

      // Set current price for easier access
      if (includeCarDetails) {
        favorite.current_price = favorite.car_price;
      }

      return favorite;
    } catch (error) {
      logger.error(`Error finding favorite by ID ${id}:`, error);
      return null;
    }
  }

  // Find favorite by user and car
  static async findByUserAndCar(userId: number, carId: number): Promise<Favorite | null> {
    try {
      const favorites = await QueryBuilder.select()
        .from(this.tableName)
        .where("user_id = ?", userId)
        .where("car_id = ?", carId)
        .execute();

      return favorites.length > 0 ? favorites[0] : null;
    } catch (error) {
      logger.error(`Error finding favorite by user ${userId} and car ${carId}:`, error);
      return null;
    }
  }

  // Get user's favorites
  static async getUserFavorites(
    userId: number,
    filters: FavoriteFilters = {},
    options: FavoriteSearchOptions = {}
  ): Promise<{
    favorites: Favorite[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const {
        page = 1,
        limit = 20,
        sort_by = "created_at",
        sort_order = "DESC",
        include_car_details = true,
      } = options;

      let selectFields = ["f.*"];

      if (include_car_details) {
        selectFields.push(
          "c.title as car_title",
          "c.year as car_year",
          "c.price as car_price",
          "c.currency as car_currency",
          "c.status as car_status",
          "c.is_active as car_is_active",
          "b.name as car_brand",
          "m.name as car_model",
          "city.name as car_city",
          "prov.name as car_province",
          'CONCAT(u.first_name, " ", u.last_name) as seller_name',
          "u.average_rating as seller_rating",
          "ci.image_url as car_image",
          "f.price_alert_threshold as original_favorite_price",
          "(c.price != f.price_alert_threshold) as price_changed"
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} f`);

      if (include_car_details) {
        query = query
          .join("cars c", "f.car_id = c.id")
          .join("brands b", "c.brand_id = b.id")
          .join("models m", "c.model_id = m.id")
          .join("users u", "c.seller_id = u.id")
          .join("ph_cities city", "c.city_id = city.id")
          .join("ph_provinces prov", "c.province_id = prov.id")
          .leftJoin("car_images ci", "c.id = ci.car_id AND ci.is_primary = TRUE");
      }

      query = query.where("f.user_id = ?", userId);

      // Apply filters
      if (filters.car_status) {
        query = query.where("c.status = ?", filters.car_status);
      } else {
        // Default to active cars only
        query = query.where("c.is_active = ?", true);
      }

      if (filters.price_alert_enabled !== undefined) {
        query = query.where("f.price_alert_enabled = ?", filters.price_alert_enabled);
      }

      if (filters.price_changed) {
        query = query.where("c.price != f.price_alert_threshold");
      }

      if (filters.brand_id) {
        query = query.where("c.brand_id = ?", filters.brand_id);
      }

      if (filters.city_id) {
        query = query.where("c.city_id = ?", filters.city_id);
      }

      if (filters.price_min) {
        query = query.where("c.price >= ?", filters.price_min);
      }

      if (filters.price_max) {
        query = query.where("c.price <= ?", filters.price_max);
      }

      if (filters.search) {
        query = query.where(
          "(c.title LIKE ? OR b.name LIKE ? OR m.name LIKE ?)",
          `%${filters.search}%`,
          `%${filters.search}%`,
          `%${filters.search}%`
        );
      }

      // Get total count for pagination
      const countQuery = query.build();
      const countResult = await database.execute(
        countQuery.query.replace(/SELECT .+ FROM/, "SELECT COUNT(*) as total FROM"),
        countQuery.params
      );
      const total = countResult[0].total;

      // Apply sorting
      let orderByColumn = "f.created_at";
      switch (sort_by) {
        case "car_title":
          orderByColumn = "c.title";
          break;
        case "car_price":
          orderByColumn = "c.price";
          break;
        case "car_year":
          orderByColumn = "c.year";
          break;
        case "price_change":
          orderByColumn = "(c.price - f.price_alert_threshold)";
          break;
        default:
          orderByColumn = "f.created_at";
      }

      // Add pagination and ordering
      const offset = (page - 1) * limit;
      query = query.orderBy(orderByColumn, sort_order).limit(limit, offset);

      const favorites = await query.execute();

      // Set current price for easier access
      if (include_car_details) {
        for (const favorite of favorites) {
          favorite.current_price = favorite.car_price;
        }
      }

      return {
        favorites,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error(`Error getting user favorites for user ${userId}:`, error);
      throw error;
    }
  }

  // Update favorite
  static async update(id: number, updateData: UpdateFavoriteData): Promise<Favorite | null> {
    try {
      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return await this.findById(id);
    } catch (error) {
      logger.error(`Error updating favorite ${id}:`, error);
      throw error;
    }
  }

  // Remove from favorites
  static async remove(userId: number, carId: number): Promise<boolean> {
    try {
      const result = await QueryBuilder.delete()
        .from(this.tableName)
        .where("user_id = ?", userId)
        .where("car_id = ?", carId)
        .execute();

      if ((result as ResultSetHeader).affectedRows > 0) {
        // Update car favorite count
        await database.execute(
          "UPDATE cars SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = ?",
          [carId]
        );

        logger.info(`Favorite removed: User ${userId}, Car ${carId}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Error removing favorite for user ${userId} and car ${carId}:`, error);
      return false;
    }
  }

  // Remove favorite by ID
  static async removeById(id: number): Promise<boolean> {
    try {
      // Get favorite details before deleting
      const favorite = await this.findById(id, false);
      if (!favorite) {
        return false;
      }

      await QueryBuilder.delete()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      // Update car favorite count
      await database.execute(
        "UPDATE cars SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id = ?",
        [favorite.car_id]
      );

      logger.info(`Favorite removed by ID: ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error removing favorite by ID ${id}:`, error);
      return false;
    }
  }

  // Check if car is favorited by user
  static async isFavorited(userId: number, carId: number): Promise<boolean> {
    try {
      const favorites = await QueryBuilder.select(["id"])
        .from(this.tableName)
        .where("user_id = ?", userId)
        .where("car_id = ?", carId)
        .limit(1)
        .execute();

      return favorites.length > 0;
    } catch (error) {
      logger.error(`Error checking if car ${carId} is favorited by user ${userId}:`, error);
      return false;
    }
  }

  // Get user's favorite count
  static async getUserFavoriteCount(userId: number, activeOnly: boolean = true): Promise<number> {
    try {
      let query = QueryBuilder.select(["COUNT(*) as count"])
        .from(`${this.tableName} f`);

      if (activeOnly) {
        query = query
          .join("cars c", "f.car_id = c.id")
          .where("c.is_active = ?", true)
          .where("c.status != ?", "sold");
      }

      const result = await query
        .where("f.user_id = ?", userId)
        .execute();

      return result[0]?.count || 0;
    } catch (error) {
      logger.error(`Error getting favorite count for user ${userId}:`, error);
      return 0;
    }
  }

  // Get car's favorite count
  static async getCarFavoriteCount(carId: number): Promise<number> {
    try {
      const result = await QueryBuilder.select(["COUNT(*) as count"])
        .from(this.tableName)
        .where("car_id = ?", carId)
        .execute();

      return result[0]?.count || 0;
    } catch (error) {
      logger.error(`Error getting favorite count for car ${carId}:`, error);
      return 0;
    }
  }

  // Get favorites with price alerts enabled
  static async getFavoritesWithPriceAlerts(userId?: number): Promise<Favorite[]> {
    try {
      let query = QueryBuilder.select([
        "f.*",
        "c.title as car_title",
        "c.price as car_price",
        "c.currency as car_currency",
        "b.name as car_brand",
        "m.name as car_model",
        "c.year as car_year",
        "(c.price != f.price_alert_threshold) as price_changed",
        "(c.price < f.price_alert_threshold) as price_dropped"
      ])
        .from(`${this.tableName} f`)
        .join("cars c", "f.car_id = c.id")
        .join("brands b", "c.brand_id = b.id")
        .join("models m", "c.model_id = m.id")
        .where("f.price_alert_enabled = ?", true)
        .where("c.is_active = ?", true)
        .where("c.status = ?", "active");

      if (userId) {
        query = query.where("f.user_id = ?", userId);
      }

      const favorites = await query
        .orderBy("price_changed", "DESC")
        .orderBy("f.created_at", "DESC")
        .execute();

      return favorites;
    } catch (error) {
      logger.error(`Error getting favorites with price alerts for user ${userId}:`, error);
      return [];
    }
  }

  // Get favorites with price drops
  static async getFavoritesWithPriceDrops(userId?: number): Promise<Favorite[]> {
    try {
      let query = QueryBuilder.select([
        "f.*",
        "c.title as car_title",
        "c.price as car_price",
        "c.currency as car_currency",
        "b.name as car_brand",
        "m.name as car_model",
        "c.year as car_year",
        "(f.price_alert_threshold - c.price) as price_drop_amount",
        "((f.price_alert_threshold - c.price) / f.price_alert_threshold * 100) as price_drop_percentage"
      ])
        .from(`${this.tableName} f`)
        .join("cars c", "f.car_id = c.id")
        .join("brands b", "c.brand_id = b.id")
        .join("models m", "c.model_id = m.id")
        .where("f.price_alert_enabled = ?", true)
        .where("c.price < f.price_alert_threshold")
        .where("c.is_active = ?", true)
        .where("c.status = ?", "active");

      if (userId) {
        query = query.where("f.user_id = ?", userId);
      }

      const favorites = await query
        .orderBy("price_drop_percentage", "DESC")
        .orderBy("f.created_at", "DESC")
        .execute();

      return favorites;
    } catch (error) {
      logger.error(`Error getting favorites with price drops for user ${userId}:`, error);
      return [];
    }
  }

  // Get most favorited cars
  static async getMostFavorited(
    limit: number = 10,
    timeframe?: "day" | "week" | "month"
  ): Promise<Array<{
    car_id: number;
    car_title: string;
    car_brand: string;
    car_model: string;
    car_year: number;
    car_price: number;
    favorite_count: number;
    car_image?: string;
  }>> {
    try {
      let query = QueryBuilder.select([
        "c.id as car_id",
        "c.title as car_title",
        "c.year as car_year",
        "c.price as car_price",
        "b.name as car_brand",
        "m.name as car_model",
        "COUNT(f.id) as favorite_count",
        "ci.image_url as car_image"
      ])
        .from("cars c")
        .join(`${this.tableName} f`, "c.id = f.car_id")
        .join("brands b", "c.brand_id = b.id")
        .join("models m", "c.model_id = m.id")
        .leftJoin("car_images ci", "c.id = ci.car_id AND ci.is_primary = TRUE")
        .where("c.is_active = ?", true)
        .where("c.status = ?", "active");

      if (timeframe) {
        let interval: string;
        switch (timeframe) {
          case "day":
            interval = "1 DAY";
            break;
          case "week":
            interval = "7 DAY";
            break;
          case "month":
            interval = "30 DAY";
            break;
          default:
            interval = "30 DAY";
        }
        query = query.where(`f.created_at >= DATE_SUB(NOW(), INTERVAL ${interval})`);
      }

      const cars = await query
        .groupBy("c.id")
        .orderBy("favorite_count", "DESC")
        .orderBy("c.created_at", "DESC")
        .limit(limit)
        .execute();

      return cars;
    } catch (error) {
      logger.error(`Error getting most favorited cars:`, error);
      return [];
    }
  }

  // Get favorite statistics for analytics
  static async getFavoriteStatistics(): Promise<{
    total_favorites: number;
    unique_users: number;
    unique_cars: number;
    price_alerts_enabled: number;
    average_favorites_per_user: number;
    average_favorites_per_car: number;
  }> {
    try {
      const stats = await database.execute(`
        SELECT 
          COUNT(*) as total_favorites,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT car_id) as unique_cars,
          COUNT(CASE WHEN price_alert_enabled = TRUE THEN 1 END) as price_alerts_enabled
        FROM ${this.tableName} f
        INNER JOIN cars c ON f.car_id = c.id
        WHERE c.is_active = TRUE
      `);

      if (stats.length === 0) {
        return {
          total_favorites: 0,
          unique_users: 0,
          unique_cars: 0,
          price_alerts_enabled: 0,
          average_favorites_per_user: 0,
          average_favorites_per_car: 0,
        };
      }

      const stat = stats[0];

      return {
        total_favorites: stat.total_favorites,
        unique_users: stat.unique_users,
        unique_cars: stat.unique_cars,
        price_alerts_enabled: stat.price_alerts_enabled,
        average_favorites_per_user: stat.unique_users > 0 ? Math.round((stat.total_favorites / stat.unique_users) * 100) / 100 : 0,
        average_favorites_per_car: stat.unique_cars > 0 ? Math.round((stat.total_favorites / stat.unique_cars) * 100) / 100 : 0,
      };
    } catch (error) {
      logger.error("Error getting favorite statistics:", error);
      return {
        total_favorites: 0,
        unique_users: 0,
        unique_cars: 0,
        price_alerts_enabled: 0,
        average_favorites_per_user: 0,
        average_favorites_per_car: 0,
      };
    }
  }

  // Toggle favorite (add if not exists, remove if exists)
  static async toggle(userId: number, carId: number): Promise<{
    action: "added" | "removed";
    favorite?: Favorite;
  }> {
    try {
      const existingFavorite = await this.findByUserAndCar(userId, carId);

      if (existingFavorite) {
        await this.remove(userId, carId);
        return { action: "removed" };
      } else {
        const favorite = await this.create({ user_id: userId, car_id: carId });
        return { action: "added", favorite };
      }
    } catch (error) {
      logger.error(`Error toggling favorite for user ${userId} and car ${carId}:`, error);
      throw error;
    }
  }

  // Update price alert settings
  static async updatePriceAlert(
    userId: number,
    carId: number,
    enabled: boolean,
    threshold?: number
  ): Promise<boolean> {
    try {
      const updateData: any = { price_alert_enabled: enabled };

      if (enabled && threshold) {
        updateData.price_alert_threshold = threshold;
      }

      const result = await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("user_id = ?", userId)
        .where("car_id = ?", carId)
        .execute();

      return (result as ResultSetHeader).affectedRows > 0;
    } catch (error) {
      logger.error(`Error updating price alert for user ${userId} and car ${carId}:`, error);
      return false;
    }
  }

  // Cleanup favorites for sold/inactive cars
  static async cleanup(): Promise<number> {
    try {
      const result = await database.execute(`
        DELETE f FROM ${this.tableName} f
        INNER JOIN cars c ON f.car_id = c.id
        WHERE c.is_active = FALSE OR c.status = 'sold'
      `);

      const deletedCount = (result as ResultSetHeader).affectedRows;
      
      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} favorites for inactive/sold cars`);
      }

      return deletedCount;
    } catch (error) {
      logger.error("Error cleaning up favorites:", error);
      return 0;
    }
  }

  // Get user's favorite brands (for recommendations)
  static async getUserFavoriteBrands(userId: number, limit: number = 5): Promise<Array<{
    brand_id: number;
    brand_name: string;
    favorite_count: number;
  }>> {
    try {
      const brands = await database.execute(`
        SELECT 
          b.id as brand_id,
          b.name as brand_name,
          COUNT(f.id) as favorite_count
        FROM ${this.tableName} f
        INNER JOIN cars c ON f.car_id = c.id
        INNER JOIN brands b ON c.brand_id = b.id
        WHERE f.user_id = ? AND c.is_active = TRUE
        GROUP BY b.id, b.name
        ORDER BY favorite_count DESC, b.name ASC
        LIMIT ?
      `, [userId, limit]);

      return brands;
    } catch (error) {
      logger.error(`Error getting favorite brands for user ${userId}:`, error);
      return [];
    }
  }

  // Get user's favorite price range (for recommendations)
  static async getUserFavoritePriceRange(userId: number): Promise<{
    min_price: number;
    max_price: number;
    average_price: number;
    median_price: number;
  } | null> {
    try {
      const priceData = await database.execute(`
        SELECT 
          MIN(c.price) as min_price,
          MAX(c.price) as max_price,
          AVG(c.price) as average_price
        FROM ${this.tableName} f
        INNER JOIN cars c ON f.car_id = c.id
        WHERE f.user_id = ? AND c.is_active = TRUE AND c.status = 'active'
      `, [userId]);

      if (priceData.length === 0) {
        return null;
      }

      // Get median price
      const medianData = await database.execute(`
        SELECT c.price
        FROM ${this.tableName} f
        INNER JOIN cars c ON f.car_id = c.id
        WHERE f.user_id = ? AND c.is_active = TRUE AND c.status = 'active'
        ORDER BY c.price
      `, [userId]);

      let medianPrice = 0;
      if (medianData.length > 0) {
        const middleIndex = Math.floor(medianData.length / 2);
        medianPrice = medianData.length % 2 === 0
          ? (medianData[middleIndex - 1].price + medianData[middleIndex].price) / 2
          : medianData[middleIndex].price;
      }

      const stat = priceData[0];
      return {
        min_price: stat.min_price,
        max_price: stat.max_price,
        average_price: Math.round(stat.average_price * 100) / 100,
        median_price: Math.round(medianPrice * 100) / 100,
      };
    } catch (error) {
      logger.error(`Error getting favorite price range for user ${userId}:`, error);
      return null;
    }
  }

  // Get trending favorites (cars being favorited frequently)
  static async getTrendingFavorites(
    timeframe: "day" | "week" | "month" = "week",
    limit: number = 10
  ): Promise<Array<{
    car_id: number;
    car_title: string;
    car_brand: string;
    car_model: string;
    recent_favorites: number;
    total_favorites: number;
    car_image?: string;
  }>> {
    try {
      let interval: string;
      switch (timeframe) {
        case "day":
          interval = "1 DAY";
          break;
        case "week":
          interval = "7 DAY";
          break;
        case "month":
          interval = "30 DAY";
          break;
        default:
          interval = "7 DAY";
      }

      const trending = await database.execute(`
        SELECT 
          c.id as car_id,
          c.title as car_title,
          b.name as car_brand,
          m.name as car_model,
          COUNT(CASE WHEN f.created_at >= DATE_SUB(NOW(), INTERVAL ${interval}) THEN 1 END) as recent_favorites,
          COUNT(f.id) as total_favorites,
          ci.image_url as car_image
        FROM cars c
        INNER JOIN ${this.tableName} f ON c.id = f.car_id
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        LEFT JOIN car_images ci ON c.id = ci.car_id AND ci.is_primary = TRUE
        WHERE c.is_active = TRUE AND c.status = 'active'
        GROUP BY c.id
        HAVING recent_favorites > 0
        ORDER BY recent_favorites DESC, total_favorites DESC
        LIMIT ?
      `, [limit]);

      return trending;
    } catch (error) {
      logger.error(`Error getting trending favorites for ${timeframe}:`, error);
      return [];
    }
  }

  // Bulk remove favorites
  static async bulkRemove(userId: number, carIds: number[]): Promise<number> {
    try {
      if (carIds.length === 0) {
        return 0;
      }

      const placeholders = carIds.map(() => "?").join(",");
      const result = await database.execute(
        `DELETE FROM ${this.tableName} WHERE user_id = ? AND car_id IN (${placeholders})`,
        [userId, ...carIds]
      );

      const deletedCount = (result as ResultSetHeader).affectedRows;

      // Update car favorite counts
      if (deletedCount > 0) {
        await database.execute(
          `UPDATE cars SET favorite_count = GREATEST(favorite_count - 1, 0) WHERE id IN (${placeholders})`,
          carIds
        );
      }

      logger.info(`Bulk removed ${deletedCount} favorites for user ${userId}`);
      return deletedCount;
    } catch (error) {
      logger.error(`Error bulk removing favorites for user ${userId}:`, error);
      return 0;
    }
  }

  // Validate favorite data
  static validateFavoriteData(data: CreateFavoriteData | UpdateFavoriteData): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if ('notes' in data && data.notes) {
      if (data.notes.length > 500) {
        errors.push("Notes cannot exceed 500 characters");
      }
    }

    if ('price_alert_threshold' in data && data.price_alert_threshold !== undefined) {
      if (data.price_alert_threshold < 0) {
        errors.push("Price alert threshold cannot be negative");
      }
      if (data.price_alert_threshold > 100000000) {
        errors.push("Price alert threshold cannot exceed 100,000,000");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Get recommendation data based on favorites
  static async getRecommendationData(userId: number): Promise<{
    favorite_brands: number[];
    favorite_models: number[];
    favorite_categories: number[];
    price_range: { min: number; max: number };
    preferred_cities: number[];
  }> {
    try {
      // Get favorite brands
      const brands = await database.execute(`
        SELECT DISTINCT c.brand_id
        FROM ${this.tableName} f
        INNER JOIN cars c ON f.car_id = c.id
        WHERE f.user_id = ? AND c.is_active = TRUE
        GROUP BY c.brand_id
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `, [userId]);

      // Get favorite models
      const models = await database.execute(`
        SELECT DISTINCT c.model_id
        FROM ${this.tableName} f
        INNER JOIN cars c ON f.car_id = c.id
        WHERE f.user_id = ? AND c.is_active = TRUE
        GROUP BY c.model_id
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `, [userId]);

      // Get favorite categories
      const categories = await database.execute(`
        SELECT DISTINCT c.category_id
        FROM ${this.tableName} f
        INNER JOIN cars c ON f.car_id = c.id
        WHERE f.user_id = ? AND c.is_active = TRUE AND c.category_id IS NOT NULL
        GROUP BY c.category_id
        ORDER BY COUNT(*) DESC
        LIMIT 3
      `, [userId]);

      // Get price range
      const priceRange = await this.getUserFavoritePriceRange(userId);

      // Get preferred cities
      const cities = await database.execute(`
        SELECT DISTINCT c.city_id
        FROM ${this.tableName} f
        INNER JOIN cars c ON f.car_id = c.id
        WHERE f.user_id = ? AND c.is_active = TRUE
        GROUP BY c.city_id
        ORDER BY COUNT(*) DESC
        LIMIT 3
      `, [userId]);

      return {
        favorite_brands: brands.map(b => b.brand_id),
        favorite_models: models.map(m => m.model_id),
        favorite_categories: categories.map(c => c.category_id),
        price_range: priceRange || { min: 0, max: 10000000 },
        preferred_cities: cities.map(c => c.city_id),
      };
    } catch (error) {
      logger.error(`Error getting recommendation data for user ${userId}:`, error);
      return {
        favorite_brands: [],
        favorite_models: [],
        favorite_categories: [],
        price_range: { min: 0, max: 10000000 },
        preferred_cities: [],
      };
    }
  }
}

export default FavoriteModel;
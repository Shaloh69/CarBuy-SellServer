// src/models/Feature.ts
import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface Feature {
  id: number;
  name: string;
  category: "safety" | "comfort" | "technology" | "performance" | "exterior" | "interior" | "entertainment" | "convenience";
  description?: string;
  icon_class?: string;
  is_premium: boolean;
  is_popular: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;

  // Additional fields from joins and calculations
  usage_count?: number;
  car_count?: number;
  premium_listings_count?: number;
}

export interface CreateFeatureData {
  name: string;
  category: "safety" | "comfort" | "technology" | "performance" | "exterior" | "interior" | "entertainment" | "convenience";
  description?: string;
  icon_class?: string;
  is_premium?: boolean;
  is_popular?: boolean;
  is_active?: boolean;
}

export interface UpdateFeatureData extends Partial<CreateFeatureData> {}

export interface FeatureFilters {
  category?: string;
  is_premium?: boolean;
  is_popular?: boolean;
  is_active?: boolean;
  search?: string;
}

export interface FeatureSearchOptions {
  page?: number;
  limit?: number;
  sort_by?: "name" | "category" | "usage_count" | "created_at";
  sort_order?: "ASC" | "DESC";
  include_stats?: boolean;
}

export class FeatureModel {
  private static tableName = "features";

  // Create new feature
  static async create(featureData: CreateFeatureData): Promise<Feature> {
    try {
      // Check for duplicate name
      const existingFeature = await this.findByName(featureData.name);
      if (existingFeature) {
        throw new Error("Feature with this name already exists");
      }

      const insertData = {
        ...featureData,
        is_premium: featureData.is_premium || false,
        is_popular: featureData.is_popular || false,
        is_active: featureData.is_active !== false,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const featureId = (result as ResultSetHeader).insertId;
      const feature = await this.findById(featureId);

      if (!feature) {
        throw new Error("Failed to create feature");
      }

      logger.info(`Feature created successfully: ${feature.name} (ID: ${featureId})`);
      return feature;
    } catch (error) {
      logger.error("Error creating feature:", error);
      throw error;
    }
  }

  // Find feature by ID
  static async findById(id: number, includeStats: boolean = false): Promise<Feature | null> {
    try {
      let selectFields = ["f.*"];

      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = f.id) as usage_count",
          "(SELECT COUNT(DISTINCT cf.car_id) FROM car_features cf INNER JOIN cars c ON cf.car_id = c.id WHERE cf.feature_id = f.id AND c.status = 'active' AND c.is_active = TRUE) as car_count",
          "(SELECT COUNT(DISTINCT cf.car_id) FROM car_features cf INNER JOIN cars c ON cf.car_id = c.id WHERE cf.feature_id = f.id AND c.status = 'active' AND c.is_active = TRUE AND c.is_premium = TRUE) as premium_listings_count"
        );
      }

      const features = await QueryBuilder.select(selectFields)
        .from(`${this.tableName} f`)
        .where("f.id = ?", id)
        .execute();

      return features.length > 0 ? features[0] : null;
    } catch (error) {
      logger.error(`Error finding feature by ID ${id}:`, error);
      return null;
    }
  }

  // Find feature by name
  static async findByName(name: string): Promise<Feature | null> {
    try {
      const features = await QueryBuilder.select()
        .from(this.tableName)
        .where("name = ?", name)
        .execute();

      return features.length > 0 ? features[0] : null;
    } catch (error) {
      logger.error(`Error finding feature by name ${name}:`, error);
      return null;
    }
  }

  // Get all features with optional filtering
  static async getAll(
    filters: FeatureFilters = {},
    options: FeatureSearchOptions = {}
  ): Promise<{
    features: Feature[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const {
        page = 1,
        limit = 50,
        sort_by = "name",
        sort_order = "ASC",
        include_stats = false,
      } = options;

      let selectFields = ["f.*"];

      if (include_stats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = f.id) as usage_count",
          "(SELECT COUNT(DISTINCT cf.car_id) FROM car_features cf INNER JOIN cars c ON cf.car_id = c.id WHERE cf.feature_id = f.id AND c.status = 'active' AND c.is_active = TRUE) as car_count"
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} f`);

      // Apply filters
      if (filters.category) {
        query = query.where("f.category = ?", filters.category);
      }

      if (filters.is_premium !== undefined) {
        query = query.where("f.is_premium = ?", filters.is_premium);
      }

      if (filters.is_popular !== undefined) {
        query = query.where("f.is_popular = ?", filters.is_popular);
      }

      if (filters.is_active !== undefined) {
        query = query.where("f.is_active = ?", filters.is_active);
      } else {
        // Default to active features only
        query = query.where("f.is_active = ?", true);
      }

      if (filters.search) {
        query = query.where(
          "(f.name LIKE ? OR f.description LIKE ?)",
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
      let orderByColumn = "f.name";
      switch (sort_by) {
        case "category":
          orderByColumn = "f.category";
          break;
        case "usage_count":
          orderByColumn = "usage_count";
          break;
        case "created_at":
          orderByColumn = "f.created_at";
          break;
        default:
          orderByColumn = "f.name";
      }

      // Add pagination and ordering
      const offset = (page - 1) * limit;
      query = query.orderBy(orderByColumn, sort_order);
      
      // Secondary sort by name for consistency
      if (sort_by !== "name") {
        query = query.orderBy("f.name", "ASC");
      }
      
      query = query.limit(limit, offset);

      const features = await query.execute();

      return {
        features,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Error getting all features:", error);
      throw error;
    }
  }

  // Get features by category
  static async getByCategory(
    category: string,
    includeStats: boolean = false,
    activeOnly: boolean = true
  ): Promise<Feature[]> {
    try {
      let selectFields = ["f.*"];

      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = f.id) as usage_count",
          "(SELECT COUNT(DISTINCT cf.car_id) FROM car_features cf INNER JOIN cars c ON cf.car_id = c.id WHERE cf.feature_id = f.id AND c.status = 'active' AND c.is_active = TRUE) as car_count"
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} f`)
        .where("f.category = ?", category);

      if (activeOnly) {
        query = query.where("f.is_active = ?", true);
      }

      const features = await query
        .orderBy("f.is_popular", "DESC")
        .orderBy("usage_count", "DESC")
        .orderBy("f.name", "ASC")
        .execute();

      return features;
    } catch (error) {
      logger.error(`Error getting features by category ${category}:`, error);
      return [];
    }
  }

  // Get popular features
  static async getPopular(limit: number = 20): Promise<Feature[]> {
    try {
      const features = await QueryBuilder.select([
        "f.*",
        "(SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = f.id) as usage_count",
        "(SELECT COUNT(DISTINCT cf.car_id) FROM car_features cf INNER JOIN cars c ON cf.car_id = c.id WHERE cf.feature_id = f.id AND c.status = 'active' AND c.is_active = TRUE) as car_count"
      ])
        .from(`${this.tableName} f`)
        .where("f.is_popular = ?", true)
        .where("f.is_active = ?", true)
        .orderBy("usage_count", "DESC")
        .orderBy("f.name", "ASC")
        .limit(limit)
        .execute();

      return features;
    } catch (error) {
      logger.error("Error getting popular features:", error);
      return [];
    }
  }

  // Get premium features
  static async getPremium(limit: number = 20): Promise<Feature[]> {
    try {
      const features = await QueryBuilder.select([
        "f.*",
        "(SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = f.id) as usage_count"
      ])
        .from(`${this.tableName} f`)
        .where("f.is_premium = ?", true)
        .where("f.is_active = ?", true)
        .orderBy("usage_count", "DESC")
        .orderBy("f.name", "ASC")
        .limit(limit)
        .execute();

      return features;
    } catch (error) {
      logger.error("Error getting premium features:", error);
      return [];
    }
  }

  // Update feature
  static async update(id: number, updateData: UpdateFeatureData): Promise<Feature | null> {
    try {
      // Check for duplicate name if name is being updated
      if (updateData.name) {
        const existingFeature = await this.findByName(updateData.name);
        if (existingFeature && existingFeature.id !== id) {
          throw new Error("Feature with this name already exists");
        }
      }

      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return await this.findById(id);
    } catch (error) {
      logger.error(`Error updating feature ${id}:`, error);
      throw error;
    }
  }

  // Soft delete feature
  static async softDelete(id: number): Promise<boolean> {
    try {
      // Check if feature is used in active cars
      const activeUsage = await database.execute(`
        SELECT COUNT(*) as count 
        FROM car_features cf 
        INNER JOIN cars c ON cf.car_id = c.id 
        WHERE cf.feature_id = ? AND c.status = 'active' AND c.is_active = TRUE
      `, [id]);

      if (activeUsage[0].count > 0) {
        throw new Error("Cannot delete feature that is used in active car listings");
      }

      await QueryBuilder.update(this.tableName)
        .set({ is_active: false })
        .where("id = ?", id)
        .execute();

      logger.info(`Feature soft deleted: ID ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error soft deleting feature ${id}:`, error);
      throw error;
    }
  }

  // Hard delete feature (admin only)
  static async hardDelete(id: number): Promise<boolean> {
    try {
      // Check for dependencies
      const dependencies = await this.checkDependencies(id);
      if (dependencies.hasDependencies) {
        throw new Error(`Cannot delete feature. Dependencies: ${dependencies.details.join(", ")}`);
      }

      // Delete feature and all its relationships
      await database.execute("DELETE FROM car_features WHERE feature_id = ?", [id]);
      
      await QueryBuilder.delete()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      logger.info(`Feature hard deleted: ID ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error hard deleting feature ${id}:`, error);
      throw error;
    }
  }

  // Check if feature has dependencies
  static async checkDependencies(id: number): Promise<{
    hasDependencies: boolean;
    details: string[];
  }> {
    try {
      const details: string[] = [];

      // Check car features
      const carFeatures = await database.execute(
        "SELECT COUNT(*) as count FROM car_features WHERE feature_id = ?",
        [id]
      );
      if (carFeatures[0].count > 0) {
        details.push(`${carFeatures[0].count} car-feature associations`);
      }

      return {
        hasDependencies: details.length > 0,
        details,
      };
    } catch (error) {
      logger.error(`Error checking feature dependencies ${id}:`, error);
      return { hasDependencies: true, details: ["Error checking dependencies"] };
    }
  }

  // Search features
  static async search(searchTerm: string, limit: number = 10): Promise<Feature[]> {
    try {
      const features = await QueryBuilder.select([
        "f.*",
        "(SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = f.id) as usage_count"
      ])
        .from(`${this.tableName} f`)
        .where("(f.name LIKE ? OR f.description LIKE ?)", `%${searchTerm}%`, `%${searchTerm}%`)
        .where("f.is_active = ?", true)
        .orderBy("usage_count", "DESC")
        .orderBy("f.is_popular", "DESC")
        .orderBy("f.name", "ASC")
        .limit(limit)
        .execute();

      return features;
    } catch (error) {
      logger.error(`Error searching features with term "${searchTerm}":`, error);
      return [];
    }
  }

  // Get feature statistics
  static async getStatistics(id: number): Promise<{
    total_cars: number;
    active_cars: number;
    premium_cars: number;
    usage_percentage: number;
    average_car_price: number;
    category_rank: number;
  } | null> {
    try {
      const stats = await database.execute(`
        SELECT 
          (SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = ?) as total_cars,
          (SELECT COUNT(*) FROM car_features cf INNER JOIN cars c ON cf.car_id = c.id WHERE cf.feature_id = ? AND c.status = 'active' AND c.is_active = TRUE) as active_cars,
          (SELECT COUNT(*) FROM car_features cf INNER JOIN cars c ON cf.car_id = c.id WHERE cf.feature_id = ? AND c.status = 'active' AND c.is_active = TRUE AND c.is_premium = TRUE) as premium_cars,
          (SELECT COALESCE(AVG(c.price), 0) FROM car_features cf INNER JOIN cars c ON cf.car_id = c.id WHERE cf.feature_id = ? AND c.status = 'active') as average_car_price,
          (SELECT COUNT(*) FROM cars WHERE status = 'active' AND is_active = TRUE) as total_active_cars
      `, [id, id, id, id]);

      if (stats.length === 0) {
        return null;
      }

      const stat = stats[0];

      // Calculate usage percentage
      const usagePercentage = stat.total_active_cars > 0 
        ? (stat.active_cars / stat.total_active_cars) * 100 
        : 0;

      // Get category rank
      const feature = await this.findById(id);
      const categoryRank = await this.getCategoryRank(id, feature?.category || "comfort");

      return {
        total_cars: stat.total_cars,
        active_cars: stat.active_cars,
        premium_cars: stat.premium_cars,
        usage_percentage: Math.round(usagePercentage * 100) / 100,
        average_car_price: stat.average_car_price,
        category_rank: categoryRank,
      };
    } catch (error) {
      logger.error(`Error getting feature statistics ${id}:`, error);
      return null;
    }
  }

  // Get category statistics
  static async getCategoryStatistics(): Promise<Array<{
    category: string;
    feature_count: number;
    usage_count: number;
    average_usage_per_feature: number;
  }>> {
    try {
      const stats = await database.execute(`
        SELECT 
          f.category,
          COUNT(DISTINCT f.id) as feature_count,
          COUNT(cf.id) as usage_count,
          ROUND(COUNT(cf.id) / COUNT(DISTINCT f.id), 2) as average_usage_per_feature
        FROM ${this.tableName} f
        LEFT JOIN car_features cf ON f.id = cf.feature_id
        WHERE f.is_active = TRUE
        GROUP BY f.category
        ORDER BY usage_count DESC, feature_count DESC
      `);

      return stats;
    } catch (error) {
      logger.error("Error getting feature category statistics:", error);
      return [];
    }
  }

  // Get most used features
  static async getMostUsed(limit: number = 10): Promise<Feature[]> {
    try {
      const features = await QueryBuilder.select([
        "f.*",
        "(SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = f.id) as usage_count",
        "(SELECT COUNT(DISTINCT cf.car_id) FROM car_features cf INNER JOIN cars c ON cf.car_id = c.id WHERE cf.feature_id = f.id AND c.status = 'active' AND c.is_active = TRUE) as car_count"
      ])
        .from(`${this.tableName} f`)
        .where("f.is_active = ?", true)
        .orderBy("usage_count", "DESC")
        .orderBy("f.name", "ASC")
        .limit(limit)
        .execute();

      return features.filter(feature => feature.usage_count > 0);
    } catch (error) {
      logger.error("Error getting most used features:", error);
      return [];
    }
  }

  // Get features for car filtering (group by category)
  static async getForFiltering(): Promise<{
    [category: string]: Feature[];
  }> {
    try {
      const features = await QueryBuilder.select([
        "f.*",
        "(SELECT COUNT(*) FROM car_features cf INNER JOIN cars c ON cf.car_id = c.id WHERE cf.feature_id = f.id AND c.status = 'active' AND c.is_active = TRUE) as car_count"
      ])
        .from(`${this.tableName} f`)
        .where("f.is_active = ?", true)
        .orderBy("f.category", "ASC")
        .orderBy("car_count", "DESC")
        .orderBy("f.is_popular", "DESC")
        .orderBy("f.name", "ASC")
        .execute();

      // Group by category
      const grouped: { [category: string]: Feature[] } = {};

      for (const feature of features) {
        if (!grouped[feature.category]) {
          grouped[feature.category] = [];
        }
        
        // Only include features that are actually used
        if (feature.car_count > 0) {
          grouped[feature.category].push(feature);
        }
      }

      return grouped;
    } catch (error) {
      logger.error("Error getting features for filtering:", error);
      return {};
    }
  }

  // Get feature dropdown options for forms
  static async getDropdownOptions(
    category?: string,
    popularOnly: boolean = false
  ): Promise<Array<{
    id: number;
    name: string;
    category: string;
    icon_class?: string;
    is_premium: boolean;
    usage_count: number;
  }>> {
    try {
      let query = QueryBuilder.select([
        "f.id",
        "f.name",
        "f.category",
        "f.icon_class",
        "f.is_premium",
        "(SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = f.id) as usage_count"
      ])
        .from(`${this.tableName} f`)
        .where("f.is_active = ?", true);

      if (category) {
        query = query.where("f.category = ?", category);
      }

      if (popularOnly) {
        query = query.where("f.is_popular = ?", true);
      }

      const features = await query
        .orderBy("f.category", "ASC")
        .orderBy("usage_count", "DESC")
        .orderBy("f.is_popular", "DESC")
        .orderBy("f.name", "ASC")
        .execute();

      return features;
    } catch (error) {
      logger.error("Error getting feature dropdown options:", error);
      return [];
    }
  }

  // Utility methods
  private static async getCategoryRank(featureId: number, category: string): Promise<number> {
    try {
      const rank = await database.execute(`
        SELECT COUNT(*) + 1 as rank
        FROM ${this.tableName} f
        WHERE f.category = ? 
        AND f.is_active = TRUE
        AND (SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = f.id) > 
            (SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = ?)
      `, [category, featureId]);

      return rank[0]?.rank || 1;
    } catch (error) {
      logger.error(`Error getting category rank for feature ${featureId}:`, error);
      return 1;
    }
  }

  // Validate feature data
  static validateFeatureData(data: CreateFeatureData | UpdateFeatureData): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if ('name' in data && data.name) {
      if (data.name.length < 2) {
        errors.push("Feature name must be at least 2 characters long");
      }
      if (data.name.length > 100) {
        errors.push("Feature name cannot exceed 100 characters");
      }
    }

    if ('category' in data && data.category) {
      const validCategories = [
        "safety", "comfort", "technology", "performance", 
        "exterior", "interior", "entertainment", "convenience"
      ];
      if (!validCategories.includes(data.category)) {
        errors.push(`Feature category must be one of: ${validCategories.join(", ")}`);
      }
    }

    if ('description' in data && data.description) {
      if (data.description.length > 500) {
        errors.push("Feature description cannot exceed 500 characters");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Activate/Deactivate feature
  static async setActive(id: number, isActive: boolean): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ is_active: isActive })
        .where("id = ?", id)
        .execute();

      logger.info(`Feature ${id} ${isActive ? "activated" : "deactivated"}`);
      return true;
    } catch (error) {
      logger.error(`Error setting feature active status ${id}:`, error);
      return false;
    }
  }

  // Set as popular/premium
  static async setPopular(id: number, isPopular: boolean): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ is_popular: isPopular })
        .where("id = ?", id)
        .execute();

      logger.info(`Feature ${id} ${isPopular ? "marked as popular" : "unmarked as popular"}`);
      return true;
    } catch (error) {
      logger.error(`Error setting feature popular status ${id}:`, error);
      return false;
    }
  }

  static async setPremium(id: number, isPremium: boolean): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ is_premium: isPremium })
        .where("id = ?", id)
        .execute();

      logger.info(`Feature ${id} ${isPremium ? "marked as premium" : "unmarked as premium"}`);
      return true;
    } catch (error) {
      logger.error(`Error setting feature premium status ${id}:`, error);
      return false;
    }
  }

  // Bulk operations
  static async bulkUpdateActive(ids: number[], isActive: boolean): Promise<boolean> {
    try {
      if (ids.length === 0) {
        return true;
      }

      const placeholders = ids.map(() => "?").join(",");
      await database.execute(
        `UPDATE ${this.tableName} SET is_active = ? WHERE id IN (${placeholders})`,
        [isActive, ...ids]
      );

      logger.info(`Bulk updated ${ids.length} features to ${isActive ? "active" : "inactive"}`);
      return true;
    } catch (error) {
      logger.error("Error bulk updating feature active status:", error);
      return false;
    }
  }

  static async bulkUpdateByCategory(
    category: string, 
    updateData: Partial<Feature>
  ): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("category = ?", category)
        .execute();

      logger.info(`Bulk updated features for category ${category}`);
      return true;
    } catch (error) {
      logger.error(`Error bulk updating features for category ${category}:`, error);
      return false;
    }
  }

  // Get all unique categories
  static async getCategories(): Promise<Array<{
    category: string;
    feature_count: number;
    usage_count: number;
  }>> {
    try {
      const categories = await database.execute(`
        SELECT 
          f.category,
          COUNT(DISTINCT f.id) as feature_count,
          COUNT(cf.id) as usage_count
        FROM ${this.tableName} f
        LEFT JOIN car_features cf ON f.id = cf.feature_id
        WHERE f.is_active = TRUE
        GROUP BY f.category
        ORDER BY usage_count DESC, feature_count DESC
      `);

      return categories;
    } catch (error) {
      logger.error("Error getting feature categories:", error);
      return [];
    }
  }

  // Sync popular features based on usage
  static async syncPopularFeatures(threshold: number = 100): Promise<boolean> {
    try {
      // Reset all popular flags
      await database.execute(
        `UPDATE ${this.tableName} SET is_popular = FALSE WHERE is_active = TRUE`
      );

      // Set popular based on usage count
      await database.execute(`
        UPDATE ${this.tableName} f
        SET is_popular = TRUE
        WHERE f.is_active = TRUE
        AND (SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = f.id) >= ?
      `, [threshold]);

      logger.info(`Synced popular features with threshold ${threshold}`);
      return true;
    } catch (error) {
      logger.error("Error syncing popular features:", error);
      return false;
    }
  }

  // Get usage trends (for analytics)
  static async getUsageTrends(days: number = 30): Promise<Array<{
    feature_id: number;
    feature_name: string;
    date: string;
    new_usage_count: number;
    cumulative_usage: number;
  }>> {
    try {
      const trends = await database.execute(`
        SELECT 
          f.id as feature_id,
          f.name as feature_name,
          DATE(c.created_at) as date,
          COUNT(*) as new_usage_count,
          (
            SELECT COUNT(*) 
            FROM car_features cf2 
            INNER JOIN cars c2 ON cf2.car_id = c2.id 
            WHERE cf2.feature_id = f.id 
            AND c2.created_at <= c.created_at
          ) as cumulative_usage
        FROM ${this.tableName} f
        INNER JOIN car_features cf ON f.id = cf.feature_id
        INNER JOIN cars c ON cf.car_id = c.id
        WHERE f.is_active = TRUE 
        AND c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY f.id, f.name, DATE(c.created_at)
        ORDER BY date DESC, new_usage_count DESC
      `, [days]);

      return trends;
    } catch (error) {
      logger.error(`Error getting feature usage trends for ${days} days:`, error);
      return [];
    }
  }
}

export default FeatureModel;
// src/models/CarFeature.ts
import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface CarFeature {
  id: number;
  car_id: number;
  feature_id: number;
  is_standard: boolean;
  is_optional: boolean;
  additional_cost?: number;
  notes?: string;
  created_at: Date;

  // Additional fields from joins
  feature_name?: string;
  feature_category?: string;
  feature_description?: string;
  feature_icon_class?: string;
  is_premium_feature?: boolean;
}

export interface CreateCarFeatureData {
  car_id: number;
  feature_id: number;
  is_standard?: boolean;
  is_optional?: boolean;
  additional_cost?: number;
  notes?: string;
}

export interface UpdateCarFeatureData {
  is_standard?: boolean;
  is_optional?: boolean;
  additional_cost?: number;
  notes?: string;
}

export interface CarFeatureFilters {
  car_id?: number;
  feature_id?: number;
  feature_category?: string;
  is_standard?: boolean;
  is_optional?: boolean;
  has_additional_cost?: boolean;
}

export class CarFeatureModel {
  private static tableName = "car_features";

  // Add feature to car
  static async create(carFeatureData: CreateCarFeatureData): Promise<CarFeature> {
    try {
      // Validate car exists
      const car = await database.execute(
        "SELECT id FROM cars WHERE id = ? AND is_active = TRUE",
        [carFeatureData.car_id]
      );

      if (car.length === 0) {
        throw new Error("Car not found or inactive");
      }

      // Validate feature exists
      const feature = await database.execute(
        "SELECT id FROM features WHERE id = ? AND is_active = TRUE",
        [carFeatureData.feature_id]
      );

      if (feature.length === 0) {
        throw new Error("Feature not found or inactive");
      }

      // Check if car-feature relationship already exists
      const existingRelation = await this.findByCarAndFeature(
        carFeatureData.car_id,
        carFeatureData.feature_id
      );

      if (existingRelation) {
        throw new Error("Feature is already added to this car");
      }

      const insertData = {
        ...carFeatureData,
        is_standard: carFeatureData.is_standard || false,
        is_optional: carFeatureData.is_optional || false,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const carFeatureId = (result as ResultSetHeader).insertId;
      const carFeature = await this.findById(carFeatureId);

      if (!carFeature) {
        throw new Error("Failed to add feature to car");
      }

      logger.info(`Feature ${carFeatureData.feature_id} added to car ${carFeatureData.car_id}`);
      return carFeature;
    } catch (error) {
      logger.error("Error creating car feature:", error);
      throw error;
    }
  }

  // Find car feature by ID
  static async findById(id: number): Promise<CarFeature | null> {
    try {
      const carFeatures = await QueryBuilder.select([
        "cf.*",
        "f.name as feature_name",
        "f.category as feature_category",
        "f.description as feature_description",
        "f.icon_class as feature_icon_class",
        "f.is_premium as is_premium_feature"
      ])
        .from(`${this.tableName} cf`)
        .join("features f", "cf.feature_id = f.id")
        .where("cf.id = ?", id)
        .execute();

      return carFeatures.length > 0 ? carFeatures[0] : null;
    } catch (error) {
      logger.error(`Error finding car feature by ID ${id}:`, error);
      return null;
    }
  }

  // Find car feature by car and feature
  static async findByCarAndFeature(carId: number, featureId: number): Promise<CarFeature | null> {
    try {
      const carFeatures = await QueryBuilder.select()
        .from(this.tableName)
        .where("car_id = ?", carId)
        .where("feature_id = ?", featureId)
        .execute();

      return carFeatures.length > 0 ? carFeatures[0] : null;
    } catch (error) {
      logger.error(`Error finding car feature by car ${carId} and feature ${featureId}:`, error);
      return null;
    }
  }

  // Get all features for a car
  static async getCarFeatures(carId: number, category?: string): Promise<CarFeature[]> {
    try {
      let query = QueryBuilder.select([
        "cf.*",
        "f.name as feature_name",
        "f.category as feature_category",
        "f.description as feature_description",
        "f.icon_class as feature_icon_class",
        "f.is_premium as is_premium_feature",
        "f.is_popular as is_popular_feature"
      ])
        .from(`${this.tableName} cf`)
        .join("features f", "cf.feature_id = f.id")
        .where("cf.car_id = ?", carId)
        .where("f.is_active = ?", true);

      if (category) {
        query = query.where("f.category = ?", category);
      }

      const carFeatures = await query
        .orderBy("f.category", "ASC")
        .orderBy("f.is_popular", "DESC")
        .orderBy("f.name", "ASC")
        .execute();

      return carFeatures;
    } catch (error) {
      logger.error(`Error getting features for car ${carId}:`, error);
      return [];
    }
  }

  // Get features grouped by category for a car
  static async getCarFeaturesGrouped(carId: number): Promise<{
    [category: string]: CarFeature[];
  }> {
    try {
      const carFeatures = await this.getCarFeatures(carId);

      // Group by category
      const grouped: { [category: string]: CarFeature[] } = {};

      for (const carFeature of carFeatures) {
        const category = carFeature.feature_category || "other";
        
        if (!grouped[category]) {
          grouped[category] = [];
        }
        
        grouped[category].push(carFeature);
      }

      return grouped;
    } catch (error) {
      logger.error(`Error getting grouped features for car ${carId}:`, error);
      return {};
    }
  }

  // Get cars with a specific feature
  static async getCarsWithFeature(
    featureId: number,
    limit: number = 20,
    activeOnly: boolean = true
  ): Promise<Array<{
    car_id: number;
    car_title: string;
    car_brand: string;
    car_model: string;
    car_year: number;
    car_price: number;
    is_standard: boolean;
    is_optional: boolean;
    additional_cost?: number;
  }>> {
    try {
      let query = QueryBuilder.select([
        "cf.car_id",
        "c.title as car_title",
        "c.year as car_year",
        "c.price as car_price",
        "b.name as car_brand",
        "m.name as car_model",
        "cf.is_standard",
        "cf.is_optional",
        "cf.additional_cost"
      ])
        .from(`${this.tableName} cf`)
        .join("cars c", "cf.car_id = c.id")
        .join("brands b", "c.brand_id = b.id")
        .join("models m", "c.model_id = m.id")
        .where("cf.feature_id = ?", featureId);

      if (activeOnly) {
        query = query
          .where("c.status = ?", "active")
          .where("c.is_active = ?", true);
      }

      const cars = await query
        .orderBy("c.created_at", "DESC")
        .limit(limit)
        .execute();

      return cars;
    } catch (error) {
      logger.error(`Error getting cars with feature ${featureId}:`, error);
      return [];
    }
  }

  // Update car feature
  static async update(id: number, updateData: UpdateCarFeatureData): Promise<CarFeature | null> {
    try {
      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return await this.findById(id);
    } catch (error) {
      logger.error(`Error updating car feature ${id}:`, error);
      throw error;
    }
  }

  // Remove feature from car
  static async remove(carId: number, featureId: number): Promise<boolean> {
    try {
      const result = await QueryBuilder.delete()
        .from(this.tableName)
        .where("car_id = ?", carId)
        .where("feature_id = ?", featureId)
        .execute();

      const success = (result as ResultSetHeader).affectedRows > 0;

      if (success) {
        logger.info(`Feature ${featureId} removed from car ${carId}`);
      }

      return success;
    } catch (error) {
      logger.error(`Error removing feature ${featureId} from car ${carId}:`, error);
      return false;
    }
  }

  // Remove car feature by ID
  static async removeById(id: number): Promise<boolean> {
    try {
      const result = await QueryBuilder.delete()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      const success = (result as ResultSetHeader).affectedRows > 0;

      if (success) {
        logger.info(`Car feature removed by ID: ${id}`);
      }

      return success;
    } catch (error) {
      logger.error(`Error removing car feature by ID ${id}:`, error);
      return false;
    }
  }

  // Bulk add features to car
  static async bulkAddFeatures(
    carId: number,
    featureData: Array<{
      feature_id: number;
      is_standard?: boolean;
      is_optional?: boolean;
      additional_cost?: number;
      notes?: string;
    }>
  ): Promise<CarFeature[]> {
    try {
      if (featureData.length === 0) {
        return [];
      }

      // Validate car exists
      const car = await database.execute(
        "SELECT id FROM cars WHERE id = ? AND is_active = TRUE",
        [carId]
      );

      if (car.length === 0) {
        throw new Error("Car not found or inactive");
      }

      // Validate all features exist
      const featureIds = featureData.map(f => f.feature_id);
      const placeholders = featureIds.map(() => "?").join(",");
      const features = await database.execute(
        `SELECT id FROM features WHERE id IN (${placeholders}) AND is_active = TRUE`,
        featureIds
      );

      if (features.length !== featureIds.length) {
        throw new Error("Some features not found or inactive");
      }

      // Check for existing relationships
      const existingRelations = await database.execute(
        `SELECT feature_id FROM ${this.tableName} WHERE car_id = ? AND feature_id IN (${placeholders})`,
        [carId, ...featureIds]
      );

      if (existingRelations.length > 0) {
        const existingFeatureIds = existingRelations.map(r => r.feature_id);
        throw new Error(`Features already added to car: ${existingFeatureIds.join(", ")}`);
      }

      const addedFeatures: CarFeature[] = [];

      // Add each feature
      for (const data of featureData) {
        const carFeature = await this.create({
          car_id: carId,
          ...data,
        });
        addedFeatures.push(carFeature);
      }

      logger.info(`Bulk added ${addedFeatures.length} features to car ${carId}`);
      return addedFeatures;
    } catch (error) {
      logger.error(`Error bulk adding features to car ${carId}:`, error);
      throw error;
    }
  }

  // Bulk remove features from car
  static async bulkRemoveFeatures(carId: number, featureIds: number[]): Promise<number> {
    try {
      if (featureIds.length === 0) {
        return 0;
      }

      const placeholders = featureIds.map(() => "?").join(",");
      const result = await database.execute(
        `DELETE FROM ${this.tableName} WHERE car_id = ? AND feature_id IN (${placeholders})`,
        [carId, ...featureIds]
      );

      const deletedCount = (result as ResultSetHeader).affectedRows;
      
      if (deletedCount > 0) {
        logger.info(`Bulk removed ${deletedCount} features from car ${carId}`);
      }

      return deletedCount;
    } catch (error) {
      logger.error(`Error bulk removing features from car ${carId}:`, error);
      return 0;
    }
  }

  // Replace all car features
  static async replaceCarFeatures(
    carId: number,
    featureData: Array<{
      feature_id: number;
      is_standard?: boolean;
      is_optional?: boolean;
      additional_cost?: number;
      notes?: string;
    }>
  ): Promise<CarFeature[]> {
    try {
      // Remove all existing features
      await database.execute(
        `DELETE FROM ${this.tableName} WHERE car_id = ?`,
        [carId]
      );

      // Add new features
      if (featureData.length > 0) {
        return await this.bulkAddFeatures(carId, featureData);
      }

      return [];
    } catch (error) {
      logger.error(`Error replacing car features for car ${carId}:`, error);
      throw error;
    }
  }

  // Get feature statistics for a car
  static async getCarFeatureStatistics(carId: number): Promise<{
    total_features: number;
    standard_features: number;
    optional_features: number;
    premium_features: number;
    features_by_category: Array<{ category: string; count: number }>;
    total_additional_cost: number;
  }> {
    try {
      const stats = await database.execute(`
        SELECT 
          COUNT(*) as total_features,
          COUNT(CASE WHEN cf.is_standard = TRUE THEN 1 END) as standard_features,
          COUNT(CASE WHEN cf.is_optional = TRUE THEN 1 END) as optional_features,
          COUNT(CASE WHEN f.is_premium = TRUE THEN 1 END) as premium_features,
          COALESCE(SUM(cf.additional_cost), 0) as total_additional_cost
        FROM ${this.tableName} cf
        INNER JOIN features f ON cf.feature_id = f.id
        WHERE cf.car_id = ?
      `, [carId]);

      // Get features by category
      const categoryStats = await database.execute(`
        SELECT 
          f.category,
          COUNT(*) as count
        FROM ${this.tableName} cf
        INNER JOIN features f ON cf.feature_id = f.id
        WHERE cf.car_id = ?
        GROUP BY f.category
        ORDER BY count DESC
      `, [carId]);

      const result = stats[0] || {
        total_features: 0,
        standard_features: 0,
        optional_features: 0,
        premium_features: 0,
        total_additional_cost: 0,
      };

      result.features_by_category = categoryStats;

      return result;
    } catch (error) {
      logger.error(`Error getting car feature statistics for car ${carId}:`, error);
      return {
        total_features: 0,
        standard_features: 0,
        optional_features: 0,
        premium_features: 0,
        features_by_category: [],
        total_additional_cost: 0,
      };
    }
  }

  // Get feature usage statistics
  static async getFeatureUsageStatistics(featureId: number): Promise<{
    total_cars: number;
    standard_usage: number;
    optional_usage: number;
    average_additional_cost: number;
    usage_by_brand: Array<{ brand_name: string; count: number }>;
    usage_by_category: Array<{ car_category: string; count: number }>;
  }> {
    try {
      const stats = await database.execute(`
        SELECT 
          COUNT(*) as total_cars,
          COUNT(CASE WHEN cf.is_standard = TRUE THEN 1 END) as standard_usage,
          COUNT(CASE WHEN cf.is_optional = TRUE THEN 1 END) as optional_usage,
          COALESCE(AVG(cf.additional_cost), 0) as average_additional_cost
        FROM ${this.tableName} cf
        INNER JOIN cars c ON cf.car_id = c.id
        WHERE cf.feature_id = ? AND c.is_active = TRUE
      `, [featureId]);

      // Get usage by brand
      const brandStats = await database.execute(`
        SELECT 
          b.name as brand_name,
          COUNT(*) as count
        FROM ${this.tableName} cf
        INNER JOIN cars c ON cf.car_id = c.id
        INNER JOIN brands b ON c.brand_id = b.id
        WHERE cf.feature_id = ? AND c.is_active = TRUE
        GROUP BY b.id, b.name
        ORDER BY count DESC
        LIMIT 10
      `, [featureId]);

      // Get usage by car category
      const categoryStats = await database.execute(`
        SELECT 
          cat.name as car_category,
          COUNT(*) as count
        FROM ${this.tableName} cf
        INNER JOIN cars c ON cf.car_id = c.id
        INNER JOIN categories cat ON c.category_id = cat.id
        WHERE cf.feature_id = ? AND c.is_active = TRUE
        GROUP BY cat.id, cat.name
        ORDER BY count DESC
      `, [featureId]);

      const result = stats[0] || {
        total_cars: 0,
        standard_usage: 0,
        optional_usage: 0,
        average_additional_cost: 0,
      };

      result.usage_by_brand = brandStats;
      result.usage_by_category = categoryStats;

      return result;
    } catch (error) {
      logger.error(`Error getting feature usage statistics for feature ${featureId}:`, error);
      return {
        total_cars: 0,
        standard_usage: 0,
        optional_usage: 0,
        average_additional_cost: 0,
        usage_by_brand: [],
        usage_by_category: [],
      };
    }
  }

  // Get cars missing specific features (for recommendations)
  static async getCarsWithoutFeature(
    featureId: number,
    limit: number = 10,
    filterOptions?: {
      brand_id?: number;
      model_id?: number;
      category_id?: number;
      price_min?: number;
      price_max?: number;
    }
  ): Promise<Array<{
    car_id: number;
    car_title: string;
    car_brand: string;
    car_model: string;
    car_year: number;
    car_price: number;
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
        "ci.image_url as car_image"
      ])
        .from("cars c")
        .join("brands b", "c.brand_id = b.id")
        .join("models m", "c.model_id = m.id")
        .leftJoin("car_images ci", "c.id = ci.car_id AND ci.is_primary = TRUE")
        .where("c.status = ?", "active")
        .where("c.is_active = ?", true)
        .where(`c.id NOT IN (
          SELECT car_id FROM ${this.tableName} WHERE feature_id = ?
        )`, featureId);

      // Apply filters if provided
      if (filterOptions?.brand_id) {
        query = query.where("c.brand_id = ?", filterOptions.brand_id);
      }

      if (filterOptions?.model_id) {
        query = query.where("c.model_id = ?", filterOptions.model_id);
      }

      if (filterOptions?.category_id) {
        query = query.where("c.category_id = ?", filterOptions.category_id);
      }

      if (filterOptions?.price_min) {
        query = query.where("c.price >= ?", filterOptions.price_min);
      }

      if (filterOptions?.price_max) {
        query = query.where("c.price <= ?", filterOptions.price_max);
      }

      const cars = await query
        .orderBy("c.created_at", "DESC")
        .limit(limit)
        .execute();

      return cars;
    } catch (error) {
      logger.error(`Error getting cars without feature ${featureId}:`, error);
      return [];
    }
  }

  // Get feature combinations (features that often appear together)
  static async getFeatureCombinations(
    featureId: number,
    limit: number = 10
  ): Promise<Array<{
    feature_id: number;
    feature_name: string;
    feature_category: string;
    combination_count: number;
    combination_percentage: number;
  }>> {
    try {
      const combinations = await database.execute(`
        SELECT 
          f2.id as feature_id,
          f2.name as feature_name,
          f2.category as feature_category,
          COUNT(*) as combination_count,
          ROUND(
            COUNT(*) * 100.0 / (
              SELECT COUNT(*) 
              FROM ${this.tableName} cf1 
              INNER JOIN cars c1 ON cf1.car_id = c1.id 
              WHERE cf1.feature_id = ? AND c1.is_active = TRUE
            ), 
            2
          ) as combination_percentage
        FROM ${this.tableName} cf1
        INNER JOIN ${this.tableName} cf2 ON cf1.car_id = cf2.car_id
        INNER JOIN features f2 ON cf2.feature_id = f2.id
        INNER JOIN cars c ON cf1.car_id = c.id
        WHERE cf1.feature_id = ?
        AND cf2.feature_id != ?
        AND c.is_active = TRUE
        AND c.status = 'active'
        AND f2.is_active = TRUE
        GROUP BY f2.id, f2.name, f2.category
        ORDER BY combination_count DESC, combination_percentage DESC
        LIMIT ?
      `, [featureId, featureId, featureId, limit]);

      return combinations;
    } catch (error) {
      logger.error(`Error getting feature combinations for feature ${featureId}:`, error);
      return [];
    }
  }

  // Check if car has feature
  static async carHasFeature(carId: number, featureId: number): Promise<boolean> {
    try {
      const result = await QueryBuilder.select(["id"])
        .from(this.tableName)
        .where("car_id = ?", carId)
        .where("feature_id = ?", featureId)
        .limit(1)
        .execute();

      return result.length > 0;
    } catch (error) {
      logger.error(`Error checking if car ${carId} has feature ${featureId}:`, error);
      return false;
    }
  }

  // Get car feature IDs (simple array)
  static async getCarFeatureIds(carId: number): Promise<number[]> {
    try {
      const features = await QueryBuilder.select(["feature_id"])
        .from(this.tableName)
        .where("car_id = ?", carId)
        .execute();

      return features.map(f => f.feature_id);
    } catch (error) {
      logger.error(`Error getting feature IDs for car ${carId}:`, error);
      return [];
    }
  }

  // Sync car features from array of feature IDs
  static async syncCarFeatures(
    carId: number,
    featureIds: number[],
    defaultAsStandard: boolean = true
  ): Promise<boolean> {
    try {
      // Remove all existing features
      await database.execute(
        `DELETE FROM ${this.tableName} WHERE car_id = ?`,
        [carId]
      );

      // Add new features if any
      if (featureIds.length > 0) {
        const featureData = featureIds.map(featureId => ({
          feature_id: featureId,
          is_standard: defaultAsStandard,
          is_optional: !defaultAsStandard,
        }));

        await this.bulkAddFeatures(carId, featureData);
      }

      logger.info(`Synced ${featureIds.length} features for car ${carId}`);
      return true;
    } catch (error) {
      logger.error(`Error syncing features for car ${carId}:`, error);
      return false;
    }
  }

  // Get feature popularity by category
  static async getFeaturePopularityByCategory(): Promise<Array<{
    category: string;
    feature_count: number;
    total_usage: number;
    average_usage_per_feature: number;
    most_popular_feature: string;
  }>> {
    try {
      const popularity = await database.execute(`
        SELECT 
          f.category,
          COUNT(DISTINCT f.id) as feature_count,
          COUNT(cf.id) as total_usage,
          ROUND(COUNT(cf.id) / COUNT(DISTINCT f.id), 2) as average_usage_per_feature,
          (
            SELECT f2.name 
            FROM features f2 
            INNER JOIN ${this.tableName} cf2 ON f2.id = cf2.feature_id 
            WHERE f2.category = f.category 
            GROUP BY f2.id, f2.name 
            ORDER BY COUNT(cf2.id) DESC 
            LIMIT 1
          ) as most_popular_feature
        FROM features f
        LEFT JOIN ${this.tableName} cf ON f.id = cf.feature_id
        WHERE f.is_active = TRUE
        GROUP BY f.category
        ORDER BY total_usage DESC, feature_count DESC
      `);

      return popularity;
    } catch (error) {
      logger.error("Error getting feature popularity by category:", error);
      return [];
    }
  }

  // Get missing features for car (features not yet added)
  static async getMissingFeatures(
    carId: number,
    category?: string,
    popularOnly: boolean = false
  ): Promise<Array<{
    feature_id: number;
    feature_name: string;
    feature_category: string;
    feature_description?: string;
    is_premium: boolean;
    is_popular: boolean;
    usage_count: number;
  }>> {
    try {
      let query = QueryBuilder.select([
        "f.id as feature_id",
        "f.name as feature_name",
        "f.category as feature_category",
        "f.description as feature_description",
        "f.is_premium",
        "f.is_popular",
        "(SELECT COUNT(*) FROM car_features cf WHERE cf.feature_id = f.id) as usage_count"
      ])
        .from("features f")
        .where("f.is_active = ?", true)
        .where(`f.id NOT IN (
          SELECT feature_id FROM ${this.tableName} WHERE car_id = ?
        )`, carId);

      if (category) {
        query = query.where("f.category = ?", category);
      }

      if (popularOnly) {
        query = query.where("f.is_popular = ?", true);
      }

      const features = await query
        .orderBy("f.is_popular", "DESC")
        .orderBy("usage_count", "DESC")
        .orderBy("f.name", "ASC")
        .execute();

      return features;
    } catch (error) {
      logger.error(`Error getting missing features for car ${carId}:`, error);
      return [];
    }
  }

  // Validate car feature data
  static validateCarFeatureData(data: CreateCarFeatureData | UpdateCarFeatureData): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if ('additional_cost' in data && data.additional_cost !== undefined) {
      if (data.additional_cost < 0) {
        errors.push("Additional cost cannot be negative");
      }
      if (data.additional_cost > 10000000) {
        errors.push("Additional cost cannot exceed 10,000,000");
      }
    }

    if ('notes' in data && data.notes) {
      if (data.notes.length > 500) {
        errors.push("Notes cannot exceed 500 characters");
      }
    }

    // Validate that at least one of is_standard or is_optional is true
    if ('is_standard' in data && 'is_optional' in data) {
      if (!data.is_standard && !data.is_optional) {
        errors.push("Feature must be either standard or optional");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Get recommended features for car (based on similar cars)
  static async getRecommendedFeatures(
    carId: number,
    limit: number = 10
  ): Promise<Array<{
    feature_id: number;
    feature_name: string;
    feature_category: string;
    similarity_score: number;
    usage_in_similar_cars: number;
  }>> {
    try {
      // Get car details for similarity matching
      const car = await database.execute(
        "SELECT brand_id, model_id, category_id, year, price FROM cars WHERE id = ?",
        [carId]
      );

      if (car.length === 0) {
        return [];
      }

      const carDetails = car[0];

      // Find features used in similar cars
      const recommendations = await database.execute(`
        SELECT 
          f.id as feature_id,
          f.name as feature_name,
          f.category as feature_category,
          COUNT(*) as usage_in_similar_cars,
          (
            -- Similarity score based on matching criteria
            (CASE WHEN c.brand_id = ? THEN 3 ELSE 0 END) +
            (CASE WHEN c.model_id = ? THEN 2 ELSE 0 END) +
            (CASE WHEN c.category_id = ? THEN 1 ELSE 0 END) +
            (CASE WHEN ABS(c.year - ?) <= 2 THEN 1 ELSE 0 END) +
            (CASE WHEN ABS(c.price - ?) / ? <= 0.2 THEN 1 ELSE 0 END)
          ) as similarity_score
        FROM ${this.tableName} cf
        INNER JOIN cars c ON cf.car_id = c.id
        INNER JOIN features f ON cf.feature_id = f.id
        WHERE c.is_active = TRUE 
        AND c.status = 'active'
        AND f.is_active = TRUE
        AND c.id != ?
        AND f.id NOT IN (
          SELECT feature_id FROM ${this.tableName} WHERE car_id = ?
        )
        AND (
          c.brand_id = ? OR 
          c.model_id = ? OR 
          c.category_id = ? OR
          ABS(c.year - ?) <= 3 OR
          ABS(c.price - ?) / ? <= 0.3
        )
        GROUP BY f.id, f.name, f.category
        HAVING similarity_score > 0
        ORDER BY similarity_score DESC, usage_in_similar_cars DESC
        LIMIT ?
      `, [
        carDetails.brand_id, carDetails.model_id, carDetails.category_id, 
        carDetails.year, carDetails.price, carDetails.price,
        carId, carId,
        carDetails.brand_id, carDetails.model_id, carDetails.category_id,
        carDetails.year, carDetails.price, carDetails.price,
        limit
      ]);

      return recommendations;
    } catch (error) {
      logger.error(`Error getting recommended features for car ${carId}:`, error);
      return [];
    }
  }

  // Cleanup orphaned car features (features for deleted/inactive cars)
  static async cleanup(): Promise<number> {
    try {
      const result = await database.execute(`
        DELETE cf FROM ${this.tableName} cf
        LEFT JOIN cars c ON cf.car_id = c.id
        LEFT JOIN features f ON cf.feature_id = f.id
        WHERE c.id IS NULL OR f.id IS NULL OR c.is_active = FALSE
      `);

      const deletedCount = (result as ResultSetHeader).affectedRows;
      
      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} orphaned car features`);
      }

      return deletedCount;
    } catch (error) {
      logger.error("Error cleaning up car features:", error);
      return 0;
    }
  }
}

export default CarFeatureModel;
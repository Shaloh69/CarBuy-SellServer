// src/models/Model.ts
import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface Model {
  id: number;
  brand_id: number;
  name: string;
  body_type: "sedan" | "hatchback" | "suv" | "coupe" | "convertible" | "pickup" | "van" | "wagon" | "crossover" | "minivan" | "mpv" | "jeepney" | "tricycle";
  generation?: string;
  year_start?: number;
  year_end?: number;
  is_popular_in_ph: boolean;
  is_active: boolean;
  seo_slug: string;
  meta_title?: string;
  meta_description?: string;
  created_at: Date;
  updated_at: Date;

  // Additional fields from joins
  brand_name?: string;
  active_listing_count?: number;
  total_views?: number;
  average_price?: number;
  price_range?: { min: number; max: number };
}

export interface CreateModelData {
  brand_id: number;
  name: string;
  body_type: "sedan" | "hatchback" | "suv" | "coupe" | "convertible" | "pickup" | "van" | "wagon" | "crossover" | "minivan" | "mpv" | "jeepney" | "tricycle";
  generation?: string;
  year_start?: number;
  year_end?: number;
  is_popular_in_ph?: boolean;
  is_active?: boolean;
  seo_slug?: string;
  meta_title?: string;
  meta_description?: string;
}

export interface UpdateModelData extends Partial<CreateModelData> {}

export interface ModelFilters {
  brand_id?: number;
  body_type?: string;
  is_popular_in_ph?: boolean;
  is_active?: boolean;
  year_start?: number;
  year_end?: number;
  search?: string;
}

export interface ModelSearchOptions {
  page?: number;
  limit?: number;
  sort_by?: "name" | "created_at" | "listing_count" | "popularity" | "year_start";
  sort_order?: "ASC" | "DESC";
  include_stats?: boolean;
  include_brand?: boolean;
}

export class ModelModel {
  private static tableName = "models";

  // Create new model
  static async create(modelData: CreateModelData): Promise<Model> {
    try {
      // Validate brand exists
      const brandExists = await database.execute(
        "SELECT id FROM brands WHERE id = ? AND is_active = TRUE",
        [modelData.brand_id]
      );

      if (brandExists.length === 0) {
        throw new Error("Brand not found or inactive");
      }

      // Generate SEO slug if not provided
      if (!modelData.seo_slug) {
        const brandName = brandExists[0].name || modelData.brand_id.toString();
        modelData.seo_slug = this.generateSlug(`${brandName}-${modelData.name}`);
      }

      // Ensure unique slug within brand
      const existingSlug = await this.findBySlug(modelData.seo_slug);
      if (existingSlug) {
        modelData.seo_slug = `${modelData.seo_slug}-${Date.now()}`;
      }

      // Check for duplicate model name within brand
      const existingModel = await this.findByBrandAndName(modelData.brand_id, modelData.name, modelData.generation);
      if (existingModel) {
        throw new Error("Model with this name already exists for this brand");
      }

      const insertData = {
        ...modelData,
        is_popular_in_ph: modelData.is_popular_in_ph || false,
        is_active: modelData.is_active !== false,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const modelId = (result as ResultSetHeader).insertId;
      const model = await this.findById(modelId);

      if (!model) {
        throw new Error("Failed to create model");
      }

      logger.info(`Model created successfully: ${model.name} (ID: ${modelId})`);
      return model;
    } catch (error) {
      logger.error("Error creating model:", error);
      throw error;
    }
  }

  // Find model by ID
  static async findById(id: number, includeStats: boolean = false): Promise<Model | null> {
    try {
      let selectFields = ["m.*", "b.name as brand_name"];

      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars c WHERE c.model_id = m.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count",
          "(SELECT COALESCE(SUM(c.views_count), 0) FROM cars c WHERE c.model_id = m.id) as total_views",
          "(SELECT COALESCE(AVG(c.price), 0) FROM cars c WHERE c.model_id = m.id AND c.status = 'active') as average_price",
          "(SELECT COALESCE(MIN(c.price), 0) FROM cars c WHERE c.model_id = m.id AND c.status = 'active') as min_price",
          "(SELECT COALESCE(MAX(c.price), 0) FROM cars c WHERE c.model_id = m.id AND c.status = 'active') as max_price"
        );
      }

      const models = await QueryBuilder.select(selectFields)
        .from(`${this.tableName} m`)
        .join("brands b", "m.brand_id = b.id")
        .where("m.id = ?", id)
        .execute();

      if (models.length === 0) {
        return null;
      }

      const model = models[0];

      if (includeStats && model.min_price !== undefined && model.max_price !== undefined) {
        model.price_range = {
          min: model.min_price,
          max: model.max_price,
        };
        delete model.min_price;
        delete model.max_price;
      }

      return model;
    } catch (error) {
      logger.error(`Error finding model by ID ${id}:`, error);
      return null;
    }
  }

  // Find model by brand and name
  static async findByBrandAndName(
    brandId: number,
    name: string,
    generation?: string
  ): Promise<Model | null> {
    try {
      let query = QueryBuilder.select()
        .from(this.tableName)
        .where("brand_id = ?", brandId)
        .where("name = ?", name);

      if (generation) {
        query = query.where("generation = ?", generation);
      }

      const models = await query.execute();
      return models.length > 0 ? models[0] : null;
    } catch (error) {
      logger.error(`Error finding model by brand ${brandId} and name ${name}:`, error);
      return null;
    }
  }

  // Find model by slug
  static async findBySlug(slug: string): Promise<Model | null> {
    try {
      const models = await QueryBuilder.select(["m.*", "b.name as brand_name"])
        .from(`${this.tableName} m`)
        .join("brands b", "m.brand_id = b.id")
        .where("m.seo_slug = ?", slug)
        .execute();

      return models.length > 0 ? models[0] : null;
    } catch (error) {
      logger.error(`Error finding model by slug ${slug}:`, error);
      return null;
    }
  }

  // Get all models with optional filtering
  static async getAll(
    filters: ModelFilters = {},
    options: ModelSearchOptions = {}
  ): Promise<{
    models: Model[];
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
        include_brand = true,
      } = options;

      let selectFields = ["m.*"];

      if (include_brand) {
        selectFields.push("b.name as brand_name");
      }

      if (include_stats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars c WHERE c.model_id = m.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count",
          "(SELECT COALESCE(SUM(c.views_count), 0) FROM cars c WHERE c.model_id = m.id) as total_views",
          "(SELECT COALESCE(AVG(c.price), 0) FROM cars c WHERE c.model_id = m.id AND c.status = 'active') as average_price"
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} m`);

      if (include_brand || include_stats) {
        query = query.join("brands b", "m.brand_id = b.id");
      }

      // Apply filters
      if (filters.brand_id) {
        query = query.where("m.brand_id = ?", filters.brand_id);
      }

      if (filters.body_type) {
        query = query.where("m.body_type = ?", filters.body_type);
      }

      if (filters.is_popular_in_ph !== undefined) {
        query = query.where("m.is_popular_in_ph = ?", filters.is_popular_in_ph);
      }

      if (filters.is_active !== undefined) {
        query = query.where("m.is_active = ?", filters.is_active);
      } else {
        // Default to active models only
        query = query.where("m.is_active = ?", true);
        if (include_brand) {
          query = query.where("b.is_active = ?", true);
        }
      }

      if (filters.year_start) {
        query = query.where("(m.year_start IS NULL OR m.year_start <= ?)", filters.year_start);
      }

      if (filters.year_end) {
        query = query.where("(m.year_end IS NULL OR m.year_end >= ?)", filters.year_end);
      }

      if (filters.search) {
        query = query.where(
          "(m.name LIKE ? OR b.name LIKE ? OR m.generation LIKE ?)",
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
      let orderByColumn = "m.name";
      switch (sort_by) {
        case "created_at":
          orderByColumn = "m.created_at";
          break;
        case "listing_count":
          orderByColumn = "active_listing_count";
          break;
        case "popularity":
          orderByColumn = "total_views";
          break;
        case "year_start":
          orderByColumn = "m.year_start";
          break;
        default:
          orderByColumn = "m.name";
      }

      // Add pagination and ordering
      const offset = (page - 1) * limit;
      query = query.orderBy(orderByColumn, sort_order).limit(limit, offset);

      const models = await query.execute();

      return {
        models,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Error getting all models:", error);
      throw error;
    }
  }

  // Get models by brand
  static async getByBrand(
    brandId: number,
    includeStats: boolean = false,
    activeOnly: boolean = true
  ): Promise<Model[]> {
    try {
      let selectFields = ["m.*"];

      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars c WHERE c.model_id = m.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count",
          "(SELECT COALESCE(AVG(c.price), 0) FROM cars c WHERE c.model_id = m.id AND c.status = 'active') as average_price"
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(this.tableName + " m")
        .where("m.brand_id = ?", brandId);

      if (activeOnly) {
        query = query.where("m.is_active = ?", true);
      }

      const models = await query
        .orderBy("m.is_popular_in_ph", "DESC")
        .orderBy("m.name", "ASC")
        .execute();

      return models;
    } catch (error) {
      logger.error(`Error getting models by brand ${brandId}:`, error);
      return [];
    }
  }

  // Get models by body type
  static async getByBodyType(
    bodyType: string,
    includeStats: boolean = false
  ): Promise<Model[]> {
    try {
      let selectFields = ["m.*", "b.name as brand_name"];

      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars c WHERE c.model_id = m.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count"
        );
      }

      const models = await QueryBuilder.select(selectFields)
        .from(`${this.tableName} m`)
        .join("brands b", "m.brand_id = b.id")
        .where("m.body_type = ?", bodyType)
        .where("m.is_active = ?", true)
        .where("b.is_active = ?", true)
        .orderBy("active_listing_count", "DESC")
        .orderBy("b.name", "ASC")
        .orderBy("m.name", "ASC")
        .execute();

      return models;
    } catch (error) {
      logger.error(`Error getting models by body type ${bodyType}:`, error);
      return [];
    }
  }

  // Get popular models in Philippines
  static async getPopularInPhilippines(limit: number = 20): Promise<Model[]> {
    try {
      const models = await QueryBuilder.select([
        "m.*",
        "b.name as brand_name",
        "(SELECT COUNT(*) FROM cars c WHERE c.model_id = m.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count"
      ])
        .from(`${this.tableName} m`)
        .join("brands b", "m.brand_id = b.id")
        .where("m.is_popular_in_ph = ?", true)
        .where("m.is_active = ?", true)
        .where("b.is_active = ?", true)
        .orderBy("active_listing_count", "DESC")
        .orderBy("b.name", "ASC")
        .orderBy("m.name", "ASC")
        .limit(limit)
        .execute();

      return models;
    } catch (error) {
      logger.error("Error getting popular models in Philippines:", error);
      return [];
    }
  }

  // Update model
  static async update(id: number, updateData: UpdateModelData): Promise<Model | null> {
    try {
      // Update slug if name or brand is being changed
      if ((updateData.name && !updateData.seo_slug) || updateData.brand_id) {
        const currentModel = await this.findById(id);
        if (currentModel) {
          const brandId = updateData.brand_id || currentModel.brand_id;
          const modelName = updateData.name || currentModel.name;
          
          // Get brand name for slug generation
          const brand = await database.execute(
            "SELECT name FROM brands WHERE id = ?",
            [brandId]
          );
          
          if (brand.length > 0) {
            updateData.seo_slug = this.generateSlug(`${brand[0].name}-${modelName}`);
            
            // Ensure unique slug
            const existingSlug = await this.findBySlug(updateData.seo_slug);
            if (existingSlug && existingSlug.id !== id) {
              updateData.seo_slug = `${updateData.seo_slug}-${Date.now()}`;
            }
          }
        }
      }

      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return await this.findById(id);
    } catch (error) {
      logger.error(`Error updating model ${id}:`, error);
      throw error;
    }
  }

  // Soft delete model
  static async softDelete(id: number): Promise<boolean> {
    try {
      // Check if model has active cars
      const activeCars = await database.execute(
        "SELECT COUNT(*) as count FROM cars WHERE model_id = ? AND status = 'active'",
        [id]
      );

      if (activeCars[0].count > 0) {
        throw new Error("Cannot delete model with active car listings");
      }

      await QueryBuilder.update(this.tableName)
        .set({ is_active: false })
        .where("id = ?", id)
        .execute();

      logger.info(`Model soft deleted: ID ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error soft deleting model ${id}:`, error);
      throw error;
    }
  }

  // Hard delete model (admin only)
  static async hardDelete(id: number): Promise<boolean> {
    try {
      // Check for dependencies
      const dependencies = await this.checkDependencies(id);
      if (dependencies.hasDependencies) {
        throw new Error(`Cannot delete model. Dependencies: ${dependencies.details.join(", ")}`);
      }

      await QueryBuilder.delete()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      logger.info(`Model hard deleted: ID ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error hard deleting model ${id}:`, error);
      throw error;
    }
  }

  // Check if model has dependencies
  static async checkDependencies(id: number): Promise<{
    hasDependencies: boolean;
    details: string[];
  }> {
    try {
      const details: string[] = [];

      // Check cars
      const cars = await database.execute(
        "SELECT COUNT(*) as count FROM cars WHERE model_id = ?",
        [id]
      );
      if (cars[0].count > 0) {
        details.push(`${cars[0].count} cars`);
      }

      return {
        hasDependencies: details.length > 0,
        details,
      };
    } catch (error) {
      logger.error(`Error checking model dependencies ${id}:`, error);
      return { hasDependencies: true, details: ["Error checking dependencies"] };
    }
  }

  // Search models
  static async search(
    searchTerm: string,
    brandId?: number,
    limit: number = 10
  ): Promise<Model[]> {
    try {
      let query = QueryBuilder.select([
        "m.*",
        "b.name as brand_name",
        "(SELECT COUNT(*) FROM cars c WHERE c.model_id = m.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count"
      ])
        .from(`${this.tableName} m`)
        .join("brands b", "m.brand_id = b.id")
        .where("m.name LIKE ?", `%${searchTerm}%`)
        .where("m.is_active = ?", true)
        .where("b.is_active = ?", true);

      if (brandId) {
        query = query.where("m.brand_id = ?", brandId);
      }

      const models = await query
        .orderBy("active_listing_count", "DESC")
        .orderBy("m.name", "ASC")
        .limit(limit)
        .execute();

      return models;
    } catch (error) {
      logger.error(`Error searching models with term "${searchTerm}":`, error);
      return [];
    }
  }

  // Get model statistics
  static async getStatistics(id: number): Promise<{
    total_cars: number;
    active_cars: number;
    sold_cars: number;
    total_views: number;
    average_price: number;
    price_range: { min: number; max: number };
    year_range: { min: number; max: number };
    popular_years: Array<{ year: number; count: number }>;
  } | null> {
    try {
      const stats = await database.execute(`
        SELECT 
          (SELECT COUNT(*) FROM cars WHERE model_id = ?) as total_cars,
          (SELECT COUNT(*) FROM cars WHERE model_id = ? AND status = 'active' AND is_active = TRUE) as active_cars,
          (SELECT COUNT(*) FROM cars WHERE model_id = ? AND status = 'sold') as sold_cars,
          (SELECT COALESCE(SUM(views_count), 0) FROM cars WHERE model_id = ?) as total_views,
          (SELECT COALESCE(AVG(price), 0) FROM cars WHERE model_id = ? AND status = 'active') as average_price,
          (SELECT COALESCE(MIN(price), 0) FROM cars WHERE model_id = ? AND status = 'active') as min_price,
          (SELECT COALESCE(MAX(price), 0) FROM cars WHERE model_id = ? AND status = 'active') as max_price,
          (SELECT COALESCE(MIN(year), 0) FROM cars WHERE model_id = ? AND status = 'active') as min_year,
          (SELECT COALESCE(MAX(year), 0) FROM cars WHERE model_id = ? AND status = 'active') as max_year
      `, [id, id, id, id, id, id, id, id, id]);

      if (stats.length === 0) {
        return null;
      }

      const stat = stats[0];

      // Get popular years
      const popularYears = await database.execute(`
        SELECT year, COUNT(*) as count
        FROM cars
        WHERE model_id = ? AND status = 'active' AND is_active = TRUE
        GROUP BY year
        ORDER BY count DESC, year DESC
        LIMIT 10
      `, [id]);

      return {
        total_cars: stat.total_cars,
        active_cars: stat.active_cars,
        sold_cars: stat.sold_cars,
        total_views: stat.total_views,
        average_price: stat.average_price,
        price_range: {
          min: stat.min_price,
          max: stat.max_price,
        },
        year_range: {
          min: stat.min_year,
          max: stat.max_year,
        },
        popular_years: popularYears,
      };
    } catch (error) {
      logger.error(`Error getting model statistics ${id}:`, error);
      return null;
    }
  }

  // Get body type statistics
  static async getBodyTypeStatistics(): Promise<Array<{
    body_type: string;
    model_count: number;
    listing_count: number;
    average_price: number;
  }>> {
    try {
      const stats = await database.execute(`
        SELECT 
          m.body_type,
          COUNT(DISTINCT m.id) as model_count,
          COUNT(c.id) as listing_count,
          COALESCE(AVG(c.price), 0) as average_price
        FROM ${this.tableName} m
        LEFT JOIN cars c ON m.id = c.model_id AND c.status = 'active' AND c.is_active = TRUE
        WHERE m.is_active = TRUE
        GROUP BY m.body_type
        ORDER BY listing_count DESC, model_count DESC
      `);

      return stats;
    } catch (error) {
      logger.error("Error getting body type statistics:", error);
      return [];
    }
  }

  // Validate model data
  static validateModelData(data: CreateModelData | UpdateModelData): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if ('name' in data && data.name) {
      if (data.name.length < 1) {
        errors.push("Model name is required");
      }
      if (data.name.length > 100) {
        errors.push("Model name cannot exceed 100 characters");
      }
    }

    if ('body_type' in data && data.body_type) {
      const validBodyTypes = [
        "sedan", "hatchback", "suv", "coupe", "convertible", "pickup", 
        "van", "wagon", "crossover", "minivan", "mpv", "jeepney", "tricycle"
      ];
      if (!validBodyTypes.includes(data.body_type)) {
        errors.push(`Body type must be one of: ${validBodyTypes.join(", ")}`);
      }
    }

    if ('year_start' in data && data.year_start) {
      const currentYear = new Date().getFullYear();
      if (data.year_start < 1900 || data.year_start > currentYear + 5) {
        errors.push("Year start must be between 1900 and " + (currentYear + 5));
      }
    }

    if ('year_end' in data && data.year_end) {
      const currentYear = new Date().getFullYear();
      if (data.year_end < 1900 || data.year_end > currentYear + 5) {
        errors.push("Year end must be between 1900 and " + (currentYear + 5));
      }
    }

    if ('year_start' in data && 'year_end' in data && data.year_start && data.year_end) {
      if (data.year_start > data.year_end) {
        errors.push("Year start cannot be after year end");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Utility methods
  private static generateSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
  }

  // Activate/Deactivate model
  static async setActive(id: number, isActive: boolean): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ is_active: isActive })
        .where("id = ?", id)
        .execute();

      logger.info(`Model ${id} ${isActive ? "activated" : "deactivated"}`);
      return true;
    } catch (error) {
      logger.error(`Error setting model active status ${id}:`, error);
      return false;
    }
  }

  // Get model dropdown options for forms (filtered by brand)
  static async getDropdownOptions(brandId?: number): Promise<Array<{ 
    id: number; 
    name: string; 
    brand_name: string;
    body_type: string;
    generation?: string;
  }>> {
    try {
      let query = QueryBuilder.select([
        "m.id", 
        "m.name", 
        "m.body_type", 
        "m.generation",
        "b.name as brand_name"
      ])
        .from(`${this.tableName} m`)
        .join("brands b", "m.brand_id = b.id")
        .where("m.is_active = ?", true)
        .where("b.is_active = ?", true);

      if (brandId) {
        query = query.where("m.brand_id = ?", brandId);
      }

      const models = await query
        .orderBy("b.name", "ASC")
        .orderBy("m.name", "ASC")
        .execute();

      return models;
    } catch (error) {
      logger.error("Error getting model dropdown options:", error);
      return [];
    }
  }

  // Get year range for a model
  static async getModelYearRange(id: number): Promise<{ min: number; max: number } | null> {
    try {
      const years = await database.execute(`
        SELECT 
          COALESCE(MIN(year), 0) as min_year,
          COALESCE(MAX(year), 0) as max_year
        FROM cars 
        WHERE model_id = ? AND status = 'active' AND is_active = TRUE
      `, [id]);

      if (years.length === 0) {
        return null;
      }

      return {
        min: years[0].min_year,
        max: years[0].max_year,
      };
    } catch (error) {
      logger.error(`Error getting model year range ${id}:`, error);
      return null;
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

      logger.info(`Bulk updated ${ids.length} models to ${isActive ? "active" : "inactive"}`);
      return true;
    } catch (error) {
      logger.error("Error bulk updating model active status:", error);
      return false;
    }
  }

  // Bulk operations by brand
  static async bulkUpdateByBrand(brandId: number, updateData: Partial<Model>): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("brand_id = ?", brandId)
        .execute();

      logger.info(`Bulk updated models for brand ${brandId}`);
      return true;
    } catch (error) {
      logger.error(`Error bulk updating models for brand ${brandId}:`, error);
      return false;
    }
  }

  // Get models by generation
  static async getByGeneration(generation: string): Promise<Model[]> {
    try {
      const models = await QueryBuilder.select(["m.*", "b.name as brand_name"])
        .from(`${this.tableName} m`)
        .join("brands b", "m.brand_id = b.id")
        .where("m.generation = ?", generation)
        .where("m.is_active = ?", true)
        .where("b.is_active = ?", true)
        .orderBy("b.name", "ASC")
        .orderBy("m.name", "ASC")
        .execute();

      return models;
    } catch (error) {
      logger.error(`Error getting models by generation ${generation}:`, error);
      return [];
    }
  }

  // Get all unique generations
  static async getGenerations(): Promise<Array<{ generation: string; count: number }>> {
    try {
      const generations = await database.execute(`
        SELECT 
          generation,
          COUNT(*) as count
        FROM ${this.tableName}
        WHERE generation IS NOT NULL AND generation != '' AND is_active = TRUE
        GROUP BY generation
        ORDER BY count DESC, generation ASC
      `);

      return generations;
    } catch (error) {
      logger.error("Error getting model generations:", error);
      return [];
    }
  }

  // Get all unique body types
  static async getBodyTypes(): Promise<Array<{ body_type: string; count: number }>> {
    try {
      const bodyTypes = await database.execute(`
        SELECT 
          body_type,
          COUNT(*) as count
        FROM ${this.tableName}
        WHERE is_active = TRUE
        GROUP BY body_type
        ORDER BY count DESC, body_type ASC
      `);

      return bodyTypes;
    } catch (error) {
      logger.error("Error getting model body types:", error);
      return [];
    }
  }
}

export default ModelModel;
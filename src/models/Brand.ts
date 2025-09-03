// src/models/Brand.ts
import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface Brand {
  id: number;
  name: string;
  logo_url?: string;
  country_origin?: string;
  brand_type: "luxury" | "mainstream" | "economy" | "commercial" | "motorcycle";
  is_popular_in_ph: boolean;
  is_active: boolean;
  seo_slug: string;
  meta_title?: string;
  meta_description?: string;
  created_at: Date;
  updated_at: Date;

  // Additional fields from joins
  model_count?: number;
  active_listing_count?: number;
  total_views?: number;
}

export interface CreateBrandData {
  name: string;
  logo_url?: string;
  country_origin?: string;
  brand_type?: "luxury" | "mainstream" | "economy" | "commercial" | "motorcycle";
  is_popular_in_ph?: boolean;
  is_active?: boolean;
  seo_slug?: string;
  meta_title?: string;
  meta_description?: string;
}

export interface UpdateBrandData extends Partial<CreateBrandData> {}

export interface BrandFilters {
  brand_type?: string;
  is_popular_in_ph?: boolean;
  is_active?: boolean;
  country_origin?: string;
  search?: string;
}

export interface BrandSearchOptions {
  page?: number;
  limit?: number;
  sort_by?: "name" | "created_at" | "listing_count" | "popularity";
  sort_order?: "ASC" | "DESC";
  include_stats?: boolean;
}

export class BrandModel {
  private static tableName = "brands";

  // Create new brand
  static async create(brandData: CreateBrandData): Promise<Brand> {
    try {
      // Generate SEO slug if not provided
      if (!brandData.seo_slug) {
        brandData.seo_slug = this.generateSlug(brandData.name);
      }

      // Ensure unique slug
      const existingSlug = await this.findBySlug(brandData.seo_slug);
      if (existingSlug) {
        brandData.seo_slug = `${brandData.seo_slug}-${Date.now()}`;
      }

      const insertData = {
        ...brandData,
        brand_type: brandData.brand_type || "mainstream",
        is_popular_in_ph: brandData.is_popular_in_ph || false,
        is_active: brandData.is_active !== false,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const brandId = (result as ResultSetHeader).insertId;
      const brand = await this.findById(brandId);

      if (!brand) {
        throw new Error("Failed to create brand");
      }

      logger.info(`Brand created successfully: ${brand.name} (ID: ${brandId})`);
      return brand;
    } catch (error) {
      logger.error("Error creating brand:", error);
      throw error;
    }
  }

  // Find brand by ID
  static async findById(id: number, includeStats: boolean = false): Promise<Brand | null> {
    try {
      let query = QueryBuilder.select();

      if (includeStats) {
        query = query.select([
          "b.*",
          "(SELECT COUNT(*) FROM models m WHERE m.brand_id = b.id AND m.is_active = TRUE) as model_count",
          "(SELECT COUNT(*) FROM cars c WHERE c.brand_id = b.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count",
          "(SELECT COALESCE(SUM(c.views_count), 0) FROM cars c WHERE c.brand_id = b.id) as total_views"
        ]);
      }

      const brands = await query
        .from(`${this.tableName} b`)
        .where("b.id = ?", id)
        .execute();

      return brands.length > 0 ? brands[0] : null;
    } catch (error) {
      logger.error(`Error finding brand by ID ${id}:`, error);
      return null;
    }
  }

  // Find brand by name
  static async findByName(name: string): Promise<Brand | null> {
    try {
      const brands = await QueryBuilder.select()
        .from(this.tableName)
        .where("name = ?", name)
        .execute();

      return brands.length > 0 ? brands[0] : null;
    } catch (error) {
      logger.error(`Error finding brand by name ${name}:`, error);
      return null;
    }
  }

  // Find brand by slug
  static async findBySlug(slug: string): Promise<Brand | null> {
    try {
      const brands = await QueryBuilder.select()
        .from(this.tableName)
        .where("seo_slug = ?", slug)
        .execute();

      return brands.length > 0 ? brands[0] : null;
    } catch (error) {
      logger.error(`Error finding brand by slug ${slug}:`, error);
      return null;
    }
  }

  // Get all brands with optional filtering
  static async getAll(
    filters: BrandFilters = {},
    options: BrandSearchOptions = {}
  ): Promise<{
    brands: Brand[];
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

      let selectFields = ["b.*"];
      
      if (include_stats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM models m WHERE m.brand_id = b.id AND m.is_active = TRUE) as model_count",
          "(SELECT COUNT(*) FROM cars c WHERE c.brand_id = b.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count",
          "(SELECT COALESCE(SUM(c.views_count), 0) FROM cars c WHERE c.brand_id = b.id) as total_views"
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} b`);

      // Apply filters
      if (filters.brand_type) {
        query = query.where("b.brand_type = ?", filters.brand_type);
      }

      if (filters.is_popular_in_ph !== undefined) {
        query = query.where("b.is_popular_in_ph = ?", filters.is_popular_in_ph);
      }

      if (filters.is_active !== undefined) {
        query = query.where("b.is_active = ?", filters.is_active);
      } else {
        // Default to active brands only
        query = query.where("b.is_active = ?", true);
      }

      if (filters.country_origin) {
        query = query.where("b.country_origin = ?", filters.country_origin);
      }

      if (filters.search) {
        query = query.where(
          "(b.name LIKE ? OR b.country_origin LIKE ?)",
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
      let orderByColumn = "b.name";
      switch (sort_by) {
        case "created_at":
          orderByColumn = "b.created_at";
          break;
        case "listing_count":
          orderByColumn = "active_listing_count";
          break;
        case "popularity":
          orderByColumn = "total_views";
          break;
        default:
          orderByColumn = "b.name";
      }

      // Add pagination and ordering
      const offset = (page - 1) * limit;
      query = query.orderBy(orderByColumn, sort_order).limit(limit, offset);

      const brands = await query.execute();

      return {
        brands,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Error getting all brands:", error);
      throw error;
    }
  }

  // Get popular brands in Philippines
  static async getPopularInPhilippines(limit: number = 10): Promise<Brand[]> {
    try {
      const brands = await QueryBuilder.select([
        "b.*",
        "(SELECT COUNT(*) FROM cars c WHERE c.brand_id = b.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count"
      ])
        .from(`${this.tableName} b`)
        .where("b.is_popular_in_ph = ?", true)
        .where("b.is_active = ?", true)
        .orderBy("active_listing_count", "DESC")
        .orderBy("b.name", "ASC")
        .limit(limit)
        .execute();

      return brands;
    } catch (error) {
      logger.error("Error getting popular brands in Philippines:", error);
      return [];
    }
  }

  // Get brands by type
  static async getByType(brandType: string, includeStats: boolean = false): Promise<Brand[]> {
    try {
      let selectFields = ["b.*"];
      
      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM models m WHERE m.brand_id = b.id AND m.is_active = TRUE) as model_count",
          "(SELECT COUNT(*) FROM cars c WHERE c.brand_id = b.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count"
        );
      }

      const brands = await QueryBuilder.select(selectFields)
        .from(`${this.tableName} b`)
        .where("b.brand_type = ?", brandType)
        .where("b.is_active = ?", true)
        .orderBy("b.name", "ASC")
        .execute();

      return brands;
    } catch (error) {
      logger.error(`Error getting brands by type ${brandType}:`, error);
      return [];
    }
  }

  // Update brand
  static async update(id: number, updateData: UpdateBrandData): Promise<Brand | null> {
    try {
      // Update slug if name is being changed
      if (updateData.name && !updateData.seo_slug) {
        updateData.seo_slug = this.generateSlug(updateData.name);
        
        // Ensure unique slug
        const existingSlug = await this.findBySlug(updateData.seo_slug);
        if (existingSlug && existingSlug.id !== id) {
          updateData.seo_slug = `${updateData.seo_slug}-${Date.now()}`;
        }
      }

      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return await this.findById(id);
    } catch (error) {
      logger.error(`Error updating brand ${id}:`, error);
      throw error;
    }
  }

  // Soft delete brand
  static async softDelete(id: number): Promise<boolean> {
    try {
      // Check if brand has active cars
      const activeCars = await database.execute(
        "SELECT COUNT(*) as count FROM cars WHERE brand_id = ? AND status = 'active'",
        [id]
      );

      if (activeCars[0].count > 0) {
        throw new Error("Cannot delete brand with active car listings");
      }

      await QueryBuilder.update(this.tableName)
        .set({ is_active: false })
        .where("id = ?", id)
        .execute();

      // Also deactivate all models of this brand
      await database.execute(
        "UPDATE models SET is_active = FALSE WHERE brand_id = ?",
        [id]
      );

      logger.info(`Brand soft deleted: ID ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error soft deleting brand ${id}:`, error);
      throw error;
    }
  }

  // Hard delete brand (admin only)
  static async hardDelete(id: number): Promise<boolean> {
    try {
      // Check for dependencies
      const dependencies = await this.checkDependencies(id);
      if (dependencies.hasDependencies) {
        throw new Error(`Cannot delete brand. Dependencies: ${dependencies.details.join(", ")}`);
      }

      await QueryBuilder.delete()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      logger.info(`Brand hard deleted: ID ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error hard deleting brand ${id}:`, error);
      throw error;
    }
  }

  // Check if brand has dependencies
  static async checkDependencies(id: number): Promise<{
    hasDependencies: boolean;
    details: string[];
  }> {
    try {
      const details: string[] = [];

      // Check models
      const models = await database.execute(
        "SELECT COUNT(*) as count FROM models WHERE brand_id = ?",
        [id]
      );
      if (models[0].count > 0) {
        details.push(`${models[0].count} models`);
      }

      // Check cars
      const cars = await database.execute(
        "SELECT COUNT(*) as count FROM cars WHERE brand_id = ?",
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
      logger.error(`Error checking brand dependencies ${id}:`, error);
      return { hasDependencies: true, details: ["Error checking dependencies"] };
    }
  }

  // Search brands
  static async search(
    searchTerm: string,
    limit: number = 10
  ): Promise<Brand[]> {
    try {
      const brands = await QueryBuilder.select([
        "b.*",
        "(SELECT COUNT(*) FROM cars c WHERE c.brand_id = b.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count"
      ])
        .from(`${this.tableName} b`)
        .where("b.name LIKE ?", `%${searchTerm}%`)
        .where("b.is_active = ?", true)
        .orderBy("active_listing_count", "DESC")
        .orderBy("b.name", "ASC")
        .limit(limit)
        .execute();

      return brands;
    } catch (error) {
      logger.error(`Error searching brands with term "${searchTerm}":`, error);
      return [];
    }
  }

  // Get brand statistics
  static async getStatistics(id: number): Promise<{
    total_models: number;
    active_models: number;
    total_cars: number;
    active_cars: number;
    sold_cars: number;
    total_views: number;
    average_price: number;
    price_range: { min: number; max: number };
  } | null> {
    try {
      const stats = await database.execute(`
        SELECT 
          (SELECT COUNT(*) FROM models WHERE brand_id = ?) as total_models,
          (SELECT COUNT(*) FROM models WHERE brand_id = ? AND is_active = TRUE) as active_models,
          (SELECT COUNT(*) FROM cars WHERE brand_id = ?) as total_cars,
          (SELECT COUNT(*) FROM cars WHERE brand_id = ? AND status = 'active' AND is_active = TRUE) as active_cars,
          (SELECT COUNT(*) FROM cars WHERE brand_id = ? AND status = 'sold') as sold_cars,
          (SELECT COALESCE(SUM(views_count), 0) FROM cars WHERE brand_id = ?) as total_views,
          (SELECT COALESCE(AVG(price), 0) FROM cars WHERE brand_id = ? AND status = 'active') as average_price,
          (SELECT COALESCE(MIN(price), 0) FROM cars WHERE brand_id = ? AND status = 'active') as min_price,
          (SELECT COALESCE(MAX(price), 0) FROM cars WHERE brand_id = ? AND status = 'active') as max_price
      `, [id, id, id, id, id, id, id, id, id]);

      if (stats.length === 0) {
        return null;
      }

      const stat = stats[0];
      return {
        total_models: stat.total_models,
        active_models: stat.active_models,
        total_cars: stat.total_cars,
        active_cars: stat.active_cars,
        sold_cars: stat.sold_cars,
        total_views: stat.total_views,
        average_price: stat.average_price,
        price_range: {
          min: stat.min_price,
          max: stat.max_price,
        },
      };
    } catch (error) {
      logger.error(`Error getting brand statistics ${id}:`, error);
      return null;
    }
  }

  // Get brands with most listings
  static async getMostPopular(limit: number = 10): Promise<Brand[]> {
    try {
      const brands = await QueryBuilder.select([
        "b.*",
        "(SELECT COUNT(*) FROM cars c WHERE c.brand_id = b.id AND c.status = 'active' AND c.is_active = TRUE) as active_listing_count",
        "(SELECT COALESCE(SUM(c.views_count), 0) FROM cars c WHERE c.brand_id = b.id) as total_views"
      ])
        .from(`${this.tableName} b`)
        .where("b.is_active = ?", true)
        .orderBy("active_listing_count", "DESC")
        .orderBy("total_views", "DESC")
        .limit(limit)
        .execute();

      return brands.filter(brand => brand.active_listing_count > 0);
    } catch (error) {
      logger.error("Error getting most popular brands:", error);
      return [];
    }
  }

  // Validate brand data
  static validateBrandData(data: CreateBrandData | UpdateBrandData): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if ('name' in data && data.name) {
      if (data.name.length < 2) {
        errors.push("Brand name must be at least 2 characters long");
      }
      if (data.name.length > 100) {
        errors.push("Brand name cannot exceed 100 characters");
      }
    }

    if ('brand_type' in data && data.brand_type) {
      const validTypes = ["luxury", "mainstream", "economy", "commercial", "motorcycle"];
      if (!validTypes.includes(data.brand_type)) {
        errors.push(`Brand type must be one of: ${validTypes.join(", ")}`);
      }
    }

    if ('logo_url' in data && data.logo_url) {
      if (data.logo_url.length > 500) {
        errors.push("Logo URL cannot exceed 500 characters");
      }
    }

    if ('seo_slug' in data && data.seo_slug) {
      if (!/^[a-z0-9-]+$/.test(data.seo_slug)) {
        errors.push("SEO slug can only contain lowercase letters, numbers, and hyphens");
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Utility methods
  private static generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
  }

  // Activate/Deactivate brand
  static async setActive(id: number, isActive: boolean): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ is_active: isActive })
        .where("id = ?", id)
        .execute();

      // If deactivating, also deactivate all models
      if (!isActive) {
        await database.execute(
          "UPDATE models SET is_active = FALSE WHERE brand_id = ?",
          [id]
        );
      }

      logger.info(`Brand ${id} ${isActive ? "activated" : "deactivated"}`);
      return true;
    } catch (error) {
      logger.error(`Error setting brand active status ${id}:`, error);
      return false;
    }
  }

  // Get brand dropdown options for forms
  static async getDropdownOptions(): Promise<Array<{ id: number; name: string; logo_url?: string }>> {
    try {
      const brands = await QueryBuilder.select(["id", "name", "logo_url"])
        .from(this.tableName)
        .where("is_active = ?", true)
        .orderBy("is_popular_in_ph", "DESC")
        .orderBy("name", "ASC")
        .execute();

      return brands;
    } catch (error) {
      logger.error("Error getting brand dropdown options:", error);
      return [];
    }
  }

  // Get country statistics
  static async getCountryStatistics(): Promise<Array<{
    country_origin: string;
    brand_count: number;
    listing_count: number;
  }>> {
    try {
      const stats = await database.execute(`
        SELECT 
          b.country_origin,
          COUNT(DISTINCT b.id) as brand_count,
          COUNT(c.id) as listing_count
        FROM ${this.tableName} b
        LEFT JOIN cars c ON b.id = c.brand_id AND c.status = 'active' AND c.is_active = TRUE
        WHERE b.is_active = TRUE AND b.country_origin IS NOT NULL
        GROUP BY b.country_origin
        ORDER BY listing_count DESC, brand_count DESC
      `);

      return stats;
    } catch (error) {
      logger.error("Error getting country statistics:", error);
      return [];
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

      // If deactivating, also deactivate all models
      if (!isActive) {
        await database.execute(
          `UPDATE models SET is_active = FALSE WHERE brand_id IN (${placeholders})`,
          ids
        );
      }

      logger.info(`Bulk updated ${ids.length} brands to ${isActive ? "active" : "inactive"}`);
      return true;
    } catch (error) {
      logger.error("Error bulk updating brand active status:", error);
      return false;
    }
  }
}

export default BrandModel;
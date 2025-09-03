// src/models/StandardColor.ts
import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface StandardColor {
  id: number;
  name: string;
  hex_code?: string;
  color_family: "black" | "white" | "silver" | "gray" | "red" | "blue" | "green" | "yellow" | "orange" | "brown" | "purple" | "other";
  is_common: boolean;

  // Additional fields from calculations
  usage_count?: number;
  exterior_usage_count?: number;
  interior_usage_count?: number;
  percentage_usage?: number;
}

export interface CreateStandardColorData {
  name: string;
  hex_code?: string;
  color_family: "black" | "white" | "silver" | "gray" | "red" | "blue" | "green" | "yellow" | "orange" | "brown" | "purple" | "other";
  is_common?: boolean;
}

export interface UpdateStandardColorData extends Partial<CreateStandardColorData> {}

export interface ColorFilters {
  color_family?: string;
  is_common?: boolean;
  usage_type?: "exterior" | "interior" | "both";
  search?: string;
}

export interface ColorSearchOptions {
  page?: number;
  limit?: number;
  sort_by?: "name" | "color_family" | "usage_count" | "created_at";
  sort_order?: "ASC" | "DESC";
  include_stats?: boolean;
}

export class StandardColorModel {
  private static tableName = "standard_colors";

  // Create new standard color
  static async create(colorData: CreateStandardColorData): Promise<StandardColor> {
    try {
      // Check for duplicate name
      const existingColor = await this.findByName(colorData.name);
      if (existingColor) {
        throw new Error("Color with this name already exists");
      }

      // Validate hex code format if provided
      if (colorData.hex_code && !this.isValidHexCode(colorData.hex_code)) {
        throw new Error("Invalid hex code format. Use format: #RRGGBB");
      }

      const insertData = {
        ...colorData,
        is_common: colorData.is_common !== false,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const colorId = (result as ResultSetHeader).insertId;
      const color = await this.findById(colorId);

      if (!color) {
        throw new Error("Failed to create standard color");
      }

      logger.info(`Standard color created successfully: ${color.name} (ID: ${colorId})`);
      return color;
    } catch (error) {
      logger.error("Error creating standard color:", error);
      throw error;
    }
  }

  // Find color by ID
  static async findById(id: number, includeStats: boolean = false): Promise<StandardColor | null> {
    try {
      let selectFields = ["sc.*"];

      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id OR interior_color_id = sc.id) as usage_count",
          "(SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as exterior_usage_count",
          "(SELECT COUNT(*) FROM cars WHERE interior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as interior_usage_count"
        );
      }

      const colors = await QueryBuilder.select(selectFields)
        .from(`${this.tableName} sc`)
        .where("sc.id = ?", id)
        .execute();

      if (colors.length === 0) {
        return null;
      }

      const color = colors[0];

      // Calculate percentage usage if stats are included
      if (includeStats && color.usage_count !== undefined) {
        const totalCars = await this.getTotalActiveCars();
        color.percentage_usage = totalCars > 0 
          ? Math.round((color.usage_count / totalCars) * 10000) / 100 
          : 0;
      }

      return color;
    } catch (error) {
      logger.error(`Error finding standard color by ID ${id}:`, error);
      return null;
    }
  }

  // Find color by name
  static async findByName(name: string): Promise<StandardColor | null> {
    try {
      const colors = await QueryBuilder.select()
        .from(this.tableName)
        .where("name = ?", name)
        .execute();

      return colors.length > 0 ? colors[0] : null;
    } catch (error) {
      logger.error(`Error finding standard color by name ${name}:`, error);
      return null;
    }
  }

  // Find color by hex code
  static async findByHexCode(hexCode: string): Promise<StandardColor | null> {
    try {
      const colors = await QueryBuilder.select()
        .from(this.tableName)
        .where("hex_code = ?", hexCode)
        .execute();

      return colors.length > 0 ? colors[0] : null;
    } catch (error) {
      logger.error(`Error finding standard color by hex code ${hexCode}:`, error);
      return null;
    }
  }

  // Get all colors with optional filtering
  static async getAll(
    filters: ColorFilters = {},
    options: ColorSearchOptions = {}
  ): Promise<{
    colors: StandardColor[];
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

      let selectFields = ["sc.*"];

      if (include_stats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id OR interior_color_id = sc.id) as usage_count",
          "(SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as exterior_usage_count",
          "(SELECT COUNT(*) FROM cars WHERE interior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as interior_usage_count"
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} sc`);

      // Apply filters
      if (filters.color_family) {
        query = query.where("sc.color_family = ?", filters.color_family);
      }

      if (filters.is_common !== undefined) {
        query = query.where("sc.is_common = ?", filters.is_common);
      }

      if (filters.usage_type === "exterior") {
        query = query.where("(SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id AND status = 'active' AND is_active = TRUE) > 0");
      } else if (filters.usage_type === "interior") {
        query = query.where("(SELECT COUNT(*) FROM cars WHERE interior_color_id = sc.id AND status = 'active' AND is_active = TRUE) > 0");
      } else if (filters.usage_type === "both") {
        query = query.where(`
          (SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id AND status = 'active' AND is_active = TRUE) > 0
          AND (SELECT COUNT(*) FROM cars WHERE interior_color_id = sc.id AND status = 'active' AND is_active = TRUE) > 0
        `);
      }

      if (filters.search) {
        query = query.where("sc.name LIKE ?", `%${filters.search}%`);
      }

      // Get total count for pagination
      const countQuery = query.build();
      const countResult = await database.execute(
        countQuery.query.replace(/SELECT .+ FROM/, "SELECT COUNT(*) as total FROM"),
        countQuery.params
      );
      const total = countResult[0].total;

      // Apply sorting
      let orderByColumn = "sc.name";
      switch (sort_by) {
        case "color_family":
          orderByColumn = "sc.color_family";
          break;
        case "usage_count":
          orderByColumn = "usage_count";
          break;
        case "created_at":
          orderByColumn = "sc.created_at";
          break;
        default:
          orderByColumn = "sc.name";
      }

      // Add pagination and ordering
      const offset = (page - 1) * limit;
      query = query.orderBy(orderByColumn, sort_order);
      
      // Secondary sort by name for consistency
      if (sort_by !== "name") {
        query = query.orderBy("sc.name", "ASC");
      }
      
      query = query.limit(limit, offset);

      const colors = await query.execute();

      // Calculate percentage usage if stats are included
      if (include_stats) {
        const totalCars = await this.getTotalActiveCars();
        
        for (const color of colors) {
          if (color.usage_count !== undefined) {
            color.percentage_usage = totalCars > 0 
              ? Math.round((color.usage_count / totalCars) * 10000) / 100 
              : 0;
          }
        }
      }

      return {
        colors,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Error getting all standard colors:", error);
      throw error;
    }
  }

  // Get colors by family
  static async getByFamily(
    colorFamily: string,
    includeStats: boolean = false
  ): Promise<StandardColor[]> {
    try {
      let selectFields = ["sc.*"];

      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id OR interior_color_id = sc.id) as usage_count",
          "(SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as exterior_usage_count",
          "(SELECT COUNT(*) FROM cars WHERE interior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as interior_usage_count"
        );
      }

      const colors = await QueryBuilder.select(selectFields)
        .from(`${this.tableName} sc`)
        .where("sc.color_family = ?", colorFamily)
        .orderBy("sc.is_common", "DESC")
        .orderBy("usage_count", "DESC")
        .orderBy("sc.name", "ASC")
        .execute();

      return colors;
    } catch (error) {
      logger.error(`Error getting colors by family ${colorFamily}:`, error);
      return [];
    }
  }

  // Get common colors
  static async getCommonColors(includeStats: boolean = false): Promise<StandardColor[]> {
    try {
      let selectFields = ["sc.*"];

      if (includeStats) {
        selectFields.push(
          "(SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id OR interior_color_id = sc.id) as usage_count",
          "(SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as exterior_usage_count",
          "(SELECT COUNT(*) FROM cars WHERE interior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as interior_usage_count"
        );
      }

      const colors = await QueryBuilder.select(selectFields)
        .from(`${this.tableName} sc`)
        .where("sc.is_common = ?", true)
        .orderBy("usage_count", "DESC")
        .orderBy("sc.color_family", "ASC")
        .orderBy("sc.name", "ASC")
        .execute();

      return colors;
    } catch (error) {
      logger.error("Error getting common colors:", error);
      return [];
    }
  }

  // Get most used colors
  static async getMostUsed(
    usageType: "exterior" | "interior" | "both" = "both",
    limit: number = 10
  ): Promise<StandardColor[]> {
    try {
      let usageCountField: string;
      let orderByField: string;

      switch (usageType) {
        case "exterior":
          usageCountField = "(SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as exterior_usage_count";
          orderByField = "exterior_usage_count";
          break;
        case "interior":
          usageCountField = "(SELECT COUNT(*) FROM cars WHERE interior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as interior_usage_count";
          orderByField = "interior_usage_count";
          break;
        default:
          usageCountField = "(SELECT COUNT(*) FROM cars WHERE (exterior_color_id = sc.id OR interior_color_id = sc.id) AND status = 'active' AND is_active = TRUE) as usage_count";
          orderByField = "usage_count";
      }

      const colors = await QueryBuilder.select([
        "sc.*",
        usageCountField
      ])
        .from(`${this.tableName} sc`)
        .orderBy(orderByField, "DESC")
        .orderBy("sc.name", "ASC")
        .limit(limit)
        .execute();

      return colors.filter(color => {
        const usageCount = color.usage_count || color.exterior_usage_count || color.interior_usage_count || 0;
        return usageCount > 0;
      });
    } catch (error) {
      logger.error(`Error getting most used colors for ${usageType}:`, error);
      return [];
    }
  }

  // Update standard color
  static async update(id: number, updateData: UpdateStandardColorData): Promise<StandardColor | null> {
    try {
      // Check for duplicate name if name is being updated
      if (updateData.name) {
        const existingColor = await this.findByName(updateData.name);
        if (existingColor && existingColor.id !== id) {
          throw new Error("Color with this name already exists");
        }
      }

      // Validate hex code format if provided
      if (updateData.hex_code && !this.isValidHexCode(updateData.hex_code)) {
        throw new Error("Invalid hex code format. Use format: #RRGGBB");
      }

      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return await this.findById(id);
    } catch (error) {
      logger.error(`Error updating standard color ${id}:`, error);
      throw error;
    }
  }

  // Delete standard color
  static async delete(id: number): Promise<boolean> {
    try {
      // Check if color is used in any cars
      const dependencies = await this.checkDependencies(id);
      if (dependencies.hasDependencies) {
        throw new Error(`Cannot delete color. Dependencies: ${dependencies.details.join(", ")}`);
      }

      await QueryBuilder.delete()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      logger.info(`Standard color deleted: ID ${id}`);
      return true;
    } catch (error) {
      logger.error(`Error deleting standard color ${id}:`, error);
      throw error;
    }
  }

  // Check if color has dependencies
  static async checkDependencies(id: number): Promise<{
    hasDependencies: boolean;
    details: string[];
  }> {
    try {
      const details: string[] = [];

      // Check exterior color usage
      const exteriorUsage = await database.execute(
        "SELECT COUNT(*) as count FROM cars WHERE exterior_color_id = ?",
        [id]
      );
      if (exteriorUsage[0].count > 0) {
        details.push(`${exteriorUsage[0].count} cars (exterior color)`);
      }

      // Check interior color usage
      const interiorUsage = await database.execute(
        "SELECT COUNT(*) as count FROM cars WHERE interior_color_id = ?",
        [id]
      );
      if (interiorUsage[0].count > 0) {
        details.push(`${interiorUsage[0].count} cars (interior color)`);
      }

      return {
        hasDependencies: details.length > 0,
        details,
      };
    } catch (error) {
      logger.error(`Error checking standard color dependencies ${id}:`, error);
      return { hasDependencies: true, details: ["Error checking dependencies"] };
    }
  }

  // Search colors
  static async search(searchTerm: string, limit: number = 10): Promise<StandardColor[]> {
    try {
      const colors = await QueryBuilder.select([
        "sc.*",
        "(SELECT COUNT(*) FROM cars WHERE (exterior_color_id = sc.id OR interior_color_id = sc.id) AND status = 'active' AND is_active = TRUE) as usage_count"
      ])
        .from(`${this.tableName} sc`)
        .where("sc.name LIKE ?", `%${searchTerm}%`)
        .orderBy("usage_count", "DESC")
        .orderBy("sc.is_common", "DESC")
        .orderBy("sc.name", "ASC")
        .limit(limit)
        .execute();

      return colors;
    } catch (error) {
      logger.error(`Error searching standard colors with term "${searchTerm}":`, error);
      return [];
    }
  }

  // Get color statistics
  static async getStatistics(id: number): Promise<{
    total_exterior_usage: number;
    total_interior_usage: number;
    active_exterior_usage: number;
    active_interior_usage: number;
    percentage_of_total: number;
    average_car_price: number;
    most_common_brand?: string;
    family_rank: number;
  } | null> {
    try {
      const stats = await database.execute(`
        SELECT 
          (SELECT COUNT(*) FROM cars WHERE exterior_color_id = ?) as total_exterior_usage,
          (SELECT COUNT(*) FROM cars WHERE interior_color_id = ?) as total_interior_usage,
          (SELECT COUNT(*) FROM cars WHERE exterior_color_id = ? AND status = 'active' AND is_active = TRUE) as active_exterior_usage,
          (SELECT COUNT(*) FROM cars WHERE interior_color_id = ? AND status = 'active' AND is_active = TRUE) as active_interior_usage,
          (SELECT COALESCE(AVG(c.price), 0) FROM cars c WHERE (c.exterior_color_id = ? OR c.interior_color_id = ?) AND c.status = 'active') as average_car_price
      `, [id, id, id, id, id, id]);

      if (stats.length === 0) {
        return null;
      }

      const stat = stats[0];

      // Get total active cars for percentage calculation
      const totalActiveCars = await this.getTotalActiveCars();
      const totalUsage = stat.active_exterior_usage + stat.active_interior_usage;
      const percentageOfTotal = totalActiveCars > 0 
        ? Math.round((totalUsage / totalActiveCars) * 10000) / 100 
        : 0;

      // Get most common brand using this color
      const brandStats = await database.execute(`
        SELECT b.name, COUNT(*) as count
        FROM cars c
        INNER JOIN brands b ON c.brand_id = b.id
        WHERE (c.exterior_color_id = ? OR c.interior_color_id = ?)
        AND c.status = 'active' AND c.is_active = TRUE
        GROUP BY b.id, b.name
        ORDER BY count DESC
        LIMIT 1
      `, [id, id]);

      const mostCommonBrand = brandStats.length > 0 ? brandStats[0].name : undefined;

      // Get family rank
      const color = await this.findById(id);
      const familyRank = color ? await this.getFamilyRank(id, color.color_family) : 1;

      return {
        total_exterior_usage: stat.total_exterior_usage,
        total_interior_usage: stat.total_interior_usage,
        active_exterior_usage: stat.active_exterior_usage,
        active_interior_usage: stat.active_interior_usage,
        percentage_of_total: percentageOfTotal,
        average_car_price: stat.average_car_price,
        most_common_brand: mostCommonBrand,
        family_rank: familyRank,
      };
    } catch (error) {
      logger.error(`Error getting standard color statistics ${id}:`, error);
      return null;
    }
  }

  // Get color family statistics
  static async getFamilyStatistics(): Promise<Array<{
    color_family: string;
    color_count: number;
    exterior_usage: number;
    interior_usage: number;
    total_usage: number;
    average_price: number;
  }>> {
    try {
      const stats = await database.execute(`
        SELECT 
          sc.color_family,
          COUNT(DISTINCT sc.id) as color_count,
          COUNT(DISTINCT c1.id) as exterior_usage,
          COUNT(DISTINCT c2.id) as interior_usage,
          COUNT(DISTINCT COALESCE(c1.id, c2.id)) as total_usage,
          COALESCE(AVG(COALESCE(c1.price, c2.price)), 0) as average_price
        FROM ${this.tableName} sc
        LEFT JOIN cars c1 ON sc.id = c1.exterior_color_id AND c1.status = 'active' AND c1.is_active = TRUE
        LEFT JOIN cars c2 ON sc.id = c2.interior_color_id AND c2.status = 'active' AND c2.is_active = TRUE
        GROUP BY sc.color_family
        ORDER BY total_usage DESC, color_count DESC
      `);

      return stats;
    } catch (error) {
      logger.error("Error getting color family statistics:", error);
      return [];
    }
  }

  // Get color dropdown options for forms
  static async getDropdownOptions(
    usageType: "exterior" | "interior" | "both" = "both",
    commonOnly: boolean = false
  ): Promise<Array<{
    id: number;
    name: string;
    hex_code?: string;
    color_family: string;
    usage_count: number;
  }>> {
    try {
      let usageCountField = "(SELECT COUNT(*) FROM cars WHERE (exterior_color_id = sc.id OR interior_color_id = sc.id) AND status = 'active' AND is_active = TRUE) as usage_count";

      if (usageType === "exterior") {
        usageCountField = "(SELECT COUNT(*) FROM cars WHERE exterior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as usage_count";
      } else if (usageType === "interior") {
        usageCountField = "(SELECT COUNT(*) FROM cars WHERE interior_color_id = sc.id AND status = 'active' AND is_active = TRUE) as usage_count";
      }

      let query = QueryBuilder.select([
        "sc.id",
        "sc.name",
        "sc.hex_code",
        "sc.color_family",
        usageCountField
      ])
        .from(`${this.tableName} sc`);

      if (commonOnly) {
        query = query.where("sc.is_common = ?", true);
      }

      const colors = await query
        .orderBy("sc.color_family", "ASC")
        .orderBy("usage_count", "DESC")
        .orderBy("sc.is_common", "DESC")
        .orderBy("sc.name", "ASC")
        .execute();

      return colors;
    } catch (error) {
      logger.error("Error getting color dropdown options:", error);
      return [];
    }
  }

  // Get color palette (colors grouped by family with hex codes)
  static async getColorPalette(): Promise<{
    [family: string]: Array<{
      id: number;
      name: string;
      hex_code?: string;
      usage_count: number;
    }>;
  }> {
    try {
      const colors = await QueryBuilder.select([
        "sc.*",
        "(SELECT COUNT(*) FROM cars WHERE (exterior_color_id = sc.id OR interior_color_id = sc.id) AND status = 'active' AND is_active = TRUE) as usage_count"
      ])
        .from(`${this.tableName} sc`)
        .where("sc.hex_code IS NOT NULL")
        .orderBy("sc.color_family", "ASC")
        .orderBy("usage_count", "DESC")
        .orderBy("sc.name", "ASC")
        .execute();

      // Group by color family
      const palette: { [family: string]: Array<{ id: number; name: string; hex_code?: string; usage_count: number; }> } = {};

      for (const color of colors) {
        if (!palette[color.color_family]) {
          palette[color.color_family] = [];
        }

        palette[color.color_family].push({
          id: color.id,
          name: color.name,
          hex_code: color.hex_code,
          usage_count: color.usage_count,
        });
      }

      return palette;
    } catch (error) {
      logger.error("Error getting color palette:", error);
      return {};
    }
  }

  // Utility methods
  private static async getTotalActiveCars(): Promise<number> {
    try {
      const result = await database.execute(
        "SELECT COUNT(*) as count FROM cars WHERE status = 'active' AND is_active = TRUE"
      );
      return result[0]?.count || 0;
    } catch (error) {
      logger.error("Error getting total active cars:", error);
      return 0;
    }
  }

  private static async getFamilyRank(colorId: number, colorFamily: string): Promise<number> {
    try {
      const rank = await database.execute(`
        SELECT COUNT(*) + 1 as rank
        FROM ${this.tableName} sc
        WHERE sc.color_family = ? 
        AND (SELECT COUNT(*) FROM cars WHERE (exterior_color_id = sc.id OR interior_color_id = sc.id) AND status = 'active' AND is_active = TRUE) > 
            (SELECT COUNT(*) FROM cars WHERE (exterior_color_id = ? OR interior_color_id = ?) AND status = 'active' AND is_active = TRUE)
      `, [colorFamily, colorId, colorId]);

      return rank[0]?.rank || 1;
    } catch (error) {
      logger.error(`Error getting family rank for color ${colorId}:`, error);
      return 1;
    }
  }

  private static isValidHexCode(hexCode: string): boolean {
    return /^#[0-9A-Fa-f]{6}$/.test(hexCode);
  }

  // Validate color data
  static validateColorData(data: CreateStandardColorData | UpdateStandardColorData): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if ('name' in data && data.name) {
      if (data.name.length < 2) {
        errors.push("Color name must be at least 2 characters long");
      }
      if (data.name.length > 50) {
        errors.push("Color name cannot exceed 50 characters");
      }
    }

    if ('hex_code' in data && data.hex_code) {
      if (!this.isValidHexCode(data.hex_code)) {
        errors.push("Invalid hex code format. Use format: #RRGGBB");
      }
    }

    if ('color_family' in data && data.color_family) {
      const validFamilies = [
        "black", "white", "silver", "gray", "red", "blue", 
        "green", "yellow", "orange", "brown", "purple", "other"
      ];
      if (!validFamilies.includes(data.color_family)) {
        errors.push(`Color family must be one of: ${validFamilies.join(", ")}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Set as common color
  static async setCommon(id: number, isCommon: boolean): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({ is_common: isCommon })
        .where("id = ?", id)
        .execute();

      logger.info(`Color ${id} ${isCommon ? "marked as common" : "unmarked as common"}`);
      return true;
    } catch (error) {
      logger.error(`Error setting color common status ${id}:`, error);
      return false;
    }
  }

  // Sync common colors based on usage
  static async syncCommonColors(threshold: number = 50): Promise<boolean> {
    try {
      // Reset all common flags
      await database.execute(
        `UPDATE ${this.tableName} SET is_common = FALSE`
      );

      // Set common based on usage count
      await database.execute(`
        UPDATE ${this.tableName} sc
        SET is_common = TRUE
        WHERE (
          SELECT COUNT(*) 
          FROM cars 
          WHERE (exterior_color_id = sc.id OR interior_color_id = sc.id) 
          AND status = 'active' 
          AND is_active = TRUE
        ) >= ?
      `, [threshold]);

      logger.info(`Synced common colors with threshold ${threshold}`);
      return true;
    } catch (error) {
      logger.error("Error syncing common colors:", error);
      return false;
    }
  }

  // Get color usage trends
  static async getUsageTrends(days: number = 30): Promise<Array<{
    color_id: number;
    color_name: string;
    color_family: string;
    date: string;
    exterior_usage: number;
    interior_usage: number;
    total_usage: number;
  }>> {
    try {
      const trends = await database.execute(`
        SELECT 
          sc.id as color_id,
          sc.name as color_name,
          sc.color_family,
          DATE(c.created_at) as date,
          COUNT(CASE WHEN c.exterior_color_id = sc.id THEN 1 END) as exterior_usage,
          COUNT(CASE WHEN c.interior_color_id = sc.id THEN 1 END) as interior_usage,
          COUNT(*) as total_usage
        FROM ${this.tableName} sc
        INNER JOIN cars c ON (c.exterior_color_id = sc.id OR c.interior_color_id = sc.id)
        WHERE c.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY sc.id, sc.name, sc.color_family, DATE(c.created_at)
        ORDER BY date DESC, total_usage DESC
      `, [days]);

      return trends;
    } catch (error) {
      logger.error(`Error getting color usage trends for ${days} days:`, error);
      return [];
    }
  }

  // Get colors that complement a given color (color theory)
  static async getComplementaryColors(colorId: number): Promise<StandardColor[]> {
    try {
      const color = await this.findById(colorId);
      if (!color || !color.hex_code) {
        return [];
      }

      // Simple complementary color logic based on color families
      const complementaryFamilies: { [key: string]: string[] } = {
        "black": ["white", "silver", "yellow"],
        "white": ["black", "blue", "red"],
        "silver": ["black", "blue", "red"],
        "gray": ["yellow", "orange", "blue"],
        "red": ["white", "black", "gray"],
        "blue": ["white", "silver", "yellow"],
        "green": ["red", "white", "brown"],
        "yellow": ["black", "blue", "purple"],
        "orange": ["blue", "white", "black"],
        "brown": ["white", "green", "blue"],
        "purple": ["yellow", "white", "green"],
        "other": ["white", "black", "gray"],
      };

      const families = complementaryFamilies[color.color_family] || ["white", "black"];

      if (families.length === 0) {
        return [];
      }

      const placeholders = families.map(() => "?").join(",");
      const complementaryColors = await database.execute(
        `SELECT sc.*, (SELECT COUNT(*) FROM cars WHERE (exterior_color_id = sc.id OR interior_color_id = sc.id) AND status = 'active' AND is_active = TRUE) as usage_count
         FROM ${this.tableName} sc 
         WHERE sc.color_family IN (${placeholders}) 
         AND sc.id != ?
         ORDER BY usage_count DESC, sc.is_common DESC, sc.name ASC
         LIMIT 5`,
        [...families, colorId]
      );

      return complementaryColors;
    } catch (error) {
      logger.error(`Error getting complementary colors for ${colorId}:`, error);
      return [];
    }
  }

  // Bulk operations
  static async bulkUpdateCommon(ids: number[], isCommon: boolean): Promise<boolean> {
    try {
      if (ids.length === 0) {
        return true;
      }

      const placeholders = ids.map(() => "?").join(",");
      await database.execute(
        `UPDATE ${this.tableName} SET is_common = ? WHERE id IN (${placeholders})`,
        [isCommon, ...ids]
      );

      logger.info(`Bulk updated ${ids.length} colors to ${isCommon ? "common" : "not common"}`);
      return true;
    } catch (error) {
      logger.error("Error bulk updating color common status:", error);
      return false;
    }
  }

  // Seed default colors (for initial setup)
  static async seedDefaultColors(): Promise<boolean> {
    try {
      const defaultColors = [
        { name: "Pearl White", hex_code: "#F8F8FF", color_family: "white", is_common: true },
        { name: "Solid White", hex_code: "#FFFFFF", color_family: "white", is_common: true },
        { name: "Jet Black", hex_code: "#000000", color_family: "black", is_common: true },
        { name: "Metallic Black", hex_code: "#1C1C1C", color_family: "black", is_common: true },
        { name: "Silver Metallic", hex_code: "#C0C0C0", color_family: "silver", is_common: true },
        { name: "Space Gray", hex_code: "#4A4A4A", color_family: "gray", is_common: true },
        { name: "Midnight Blue", hex_code: "#191970", color_family: "blue", is_common: true },
        { name: "Royal Blue", hex_code: "#4169E1", color_family: "blue", is_common: true },
        { name: "Cherry Red", hex_code: "#DC143C", color_family: "red", is_common: true },
        { name: "Metallic Red", hex_code: "#B22222", color_family: "red", is_common: true },
        { name: "Forest Green", hex_code: "#228B22", color_family: "green", is_common: false },
        { name: "Champagne Gold", hex_code: "#F7E7CE", color_family: "yellow", is_common: false },
        { name: "Bronze", hex_code: "#CD7F32", color_family: "brown", is_common: false },
        { name: "Maroon", hex_code: "#800000", color_family: "red", is_common: false },
      ];

      let insertedCount = 0;

      for (const colorData of defaultColors) {
        const existingColor = await this.findByName(colorData.name);
        if (!existingColor) {
          await this.create(colorData as CreateStandardColorData);
          insertedCount++;
        }
      }

      logger.info(`Seeded ${insertedCount} default colors`);
      return true;
    } catch (error) {
      logger.error("Error seeding default colors:", error);
      return false;
    }
  }
}

export default StandardColorModel;
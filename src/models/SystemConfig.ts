// src/models/SystemConfig.ts
import { RowDataPacket } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface SystemConfig {
  id: number;
  config_key: string;
  config_value: string;
  data_type: "string" | "integer" | "decimal" | "boolean" | "json";
  category: string;
  description?: string;
  is_public: boolean;
  updated_by?: number;
  updated_at: Date;
}

export interface CreateSystemConfigData {
  config_key: string;
  config_value: string;
  data_type?: "string" | "integer" | "decimal" | "boolean" | "json";
  category?: string;
  description?: string;
  is_public?: boolean;
  updated_by?: number;
}

export interface UpdateSystemConfigData {
  config_value?: string;
  data_type?: "string" | "integer" | "decimal" | "boolean" | "json";
  category?: string;
  description?: string;
  is_public?: boolean;
  updated_by?: number;
}

export interface SystemConfigCache {
  [key: string]: {
    value: any;
    raw_value: string;
    data_type: string;
    is_public: boolean;
    cached_at: Date;
  };
}

export class SystemConfigModel {
  private static tableName = "system_config";
  private static cache: SystemConfigCache = {};
  private static cacheExpiry = 5 * 60 * 1000; // 5 minutes

  // Create new system configuration
  static async create(configData: CreateSystemConfigData): Promise<SystemConfig> {
    try {
      const insertData = {
        ...configData,
        data_type: configData.data_type || "string",
        category: configData.category || "general",
        is_public: configData.is_public ?? false,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const configId = (result as any).insertId;
      const config = await this.findById(configId);

      if (!config) {
        throw new Error("Failed to create system configuration");
      }

      // Clear cache for this key
      delete this.cache[config.config_key];

      logger.info(`System config created: ${config.config_key}`);
      return config;
    } catch (error) {
      logger.error("Error creating system config:", error);
      throw error;
    }
  }

  // Find by ID
  static async findById(id: number): Promise<SystemConfig | null> {
    try {
      const configs = await QueryBuilder.select()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      return configs.length > 0 ? configs[0] : null;
    } catch (error) {
      logger.error(`Error finding system config by ID ${id}:`, error);
      return null;
    }
  }

  // Find by key
  static async findByKey(key: string): Promise<SystemConfig | null> {
    try {
      const configs = await QueryBuilder.select()
        .from(this.tableName)
        .where("config_key = ?", key)
        .execute();

      return configs.length > 0 ? configs[0] : null;
    } catch (error) {
      logger.error(`Error finding system config by key ${key}:`, error);
      return null;
    }
  }

  // Get configuration value with type conversion
  static async getValue(
    key: string,
    defaultValue?: any,
    useCache: boolean = true
  ): Promise<any> {
    try {
      // Check cache first
      if (useCache && this.cache[key]) {
        const cached = this.cache[key];
        const cacheAge = Date.now() - cached.cached_at.getTime();
        
        if (cacheAge < this.cacheExpiry) {
          return cached.value;
        }
      }

      const config = await this.findByKey(key);
      
      if (!config) {
        return defaultValue;
      }

      const convertedValue = this.convertValue(config.config_value, config.data_type);

      // Update cache
      this.cache[key] = {
        value: convertedValue,
        raw_value: config.config_value,
        data_type: config.data_type,
        is_public: config.is_public,
        cached_at: new Date(),
      };

      return convertedValue;
    } catch (error) {
      logger.error(`Error getting system config value for key ${key}:`, error);
      return defaultValue;
    }
  }

  // Set configuration value
  static async setValue(
    key: string,
    value: any,
    updatedBy?: number
  ): Promise<boolean> {
    try {
      const config = await this.findByKey(key);
      
      if (!config) {
        throw new Error(`Configuration key "${key}" not found`);
      }

      const stringValue = this.valueToString(value, config.data_type);

      await QueryBuilder.update(this.tableName)
        .set({ config_value: stringValue, updated_by: updatedBy })
        .where("config_key = ?", key)
        .execute();

      // Clear cache
      delete this.cache[key];

      logger.info(`System config updated: ${key} = ${stringValue}`);
      return true;
    } catch (error) {
      logger.error(`Error setting system config value for key ${key}:`, error);
      return false;
    }
  }

  // Get multiple configurations
  static async getMultiple(
    keys: string[],
    includePrivate: boolean = false
  ): Promise<{ [key: string]: any }> {
    try {
      let query = QueryBuilder.select()
        .from(this.tableName)
        .whereIn("config_key", keys);

      if (!includePrivate) {
        query = query.where("is_public = ?", true);
      }

      const configs = await query.execute();
      const result: { [key: string]: any } = {};

      for (const config of configs) {
        result[config.config_key] = this.convertValue(
          config.config_value,
          config.data_type
        );
      }

      return result;
    } catch (error) {
      logger.error("Error getting multiple system configs:", error);
      return {};
    }
  }

  // Get configurations by category
  static async getByCategory(
    category: string,
    includePrivate: boolean = false
  ): Promise<{ [key: string]: any }> {
    try {
      let query = QueryBuilder.select()
        .from(this.tableName)
        .where("category = ?", category);

      if (!includePrivate) {
        query = query.where("is_public = ?", true);
      }

      const configs = await query.execute();
      const result: { [key: string]: any } = {};

      for (const config of configs) {
        result[config.config_key] = this.convertValue(
          config.config_value,
          config.data_type
        );
      }

      return result;
    } catch (error) {
      logger.error(`Error getting system configs by category ${category}:`, error);
      return {};
    }
  }

  // Get all public configurations
  static async getPublicConfigs(): Promise<{ [key: string]: any }> {
    try {
      const configs = await QueryBuilder.select()
        .from(this.tableName)
        .where("is_public = ?", true)
        .execute();

      const result: { [key: string]: any } = {};

      for (const config of configs) {
        result[config.config_key] = this.convertValue(
          config.config_value,
          config.data_type
        );
      }

      return result;
    } catch (error) {
      logger.error("Error getting public system configs:", error);
      return {};
    }
  }

  // Update configuration
  static async update(
    key: string,
    updateData: UpdateSystemConfigData
  ): Promise<boolean> {
    try {
      const config = await this.findByKey(key);
      
      if (!config) {
        throw new Error(`Configuration key "${key}" not found`);
      }

      // Convert value if provided
      if (updateData.config_value !== undefined) {
        const dataType = updateData.data_type || config.data_type;
        updateData.config_value = this.valueToString(updateData.config_value, dataType);
      }

      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("config_key = ?", key)
        .execute();

      // Clear cache
      delete this.cache[key];

      logger.info(`System config updated: ${key}`);
      return true;
    } catch (error) {
      logger.error(`Error updating system config ${key}:`, error);
      return false;
    }
  }

  // Delete configuration
  static async delete(key: string): Promise<boolean> {
    try {
      await QueryBuilder.delete()
        .from(this.tableName)
        .where("config_key = ?", key)
        .execute();

      // Clear cache
      delete this.cache[key];

      logger.info(`System config deleted: ${key}`);
      return true;
    } catch (error) {
      logger.error(`Error deleting system config ${key}:`, error);
      return false;
    }
  }

  // Get all configurations with pagination
  static async getAll(
    page: number = 1,
    limit: number = 50,
    category?: string,
    includePrivate: boolean = false
  ): Promise<{
    configs: SystemConfig[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      let query = QueryBuilder.select()
        .from(this.tableName);

      if (category) {
        query = query.where("category = ?", category);
      }

      if (!includePrivate) {
        query = query.where("is_public = ?", true);
      }

      // Get total count
      const totalQuery = query.clone().select(["COUNT(*) as total"]);
      const totalResult = await totalQuery.execute();
      const total = totalResult[0].total;

      // Get paginated results
      const configs = await query
        .orderBy("category", "ASC")
        .orderBy("config_key", "ASC")
        .limit(limit)
        .offset((page - 1) * limit)
        .execute();

      return {
        configs,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Error getting all system configs:", error);
      return {
        configs: [],
        total: 0,
        page,
        totalPages: 0,
      };
    }
  }

  // Get configuration categories
  static async getCategories(): Promise<Array<{ category: string; count: number }>> {
    try {
      const categories = await database.execute(`
        SELECT 
          category,
          COUNT(*) as count
        FROM ${this.tableName}
        GROUP BY category
        ORDER BY category ASC
      `);

      return categories;
    } catch (error) {
      logger.error("Error getting system config categories:", error);
      return [];
    }
  }

  // Clear cache
  static clearCache(key?: string): void {
    if (key) {
      delete this.cache[key];
    } else {
      this.cache = {};
    }
  }

  // Convert string value to appropriate type
  private static convertValue(value: string, dataType: string): any {
    switch (dataType) {
      case "integer":
        return parseInt(value, 10) || 0;
      
      case "decimal":
        return parseFloat(value) || 0.0;
      
      case "boolean":
        return value.toLowerCase() === "true" || value === "1";
      
      case "json":
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      
      default:
        return value;
    }
  }

  // Convert value to string for storage
  private static valueToString(value: any, dataType: string): string {
    switch (dataType) {
      case "json":
        return JSON.stringify(value);
      
      case "boolean":
        return value ? "true" : "false";
      
      default:
        return String(value);
    }
  }

  // Validate data type
  static validateDataType(value: any, dataType: string): boolean {
    switch (dataType) {
      case "integer":
        return Number.isInteger(Number(value));
      
      case "decimal":
        return !isNaN(Number(value));
      
      case "boolean":
        return typeof value === "boolean" || value === "true" || value === "false" || value === "1" || value === "0";
      
      case "json":
        try {
          JSON.parse(typeof value === "string" ? value : JSON.stringify(value));
          return true;
        } catch {
          return false;
        }
      
      case "string":
      default:
        return true;
    }
  }

  // Bulk update configurations
  static async bulkUpdate(
    updates: Array<{ key: string; value: any }>,
    updatedBy?: number
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const result = { success: 0, failed: 0, errors: [] };

    for (const update of updates) {
      try {
        const success = await this.setValue(update.key, update.value, updatedBy);
        if (success) {
          result.success++;
        } else {
          result.failed++;
          result.errors.push(`Failed to update ${update.key}`);
        }
      } catch (error) {
        result.failed++;
        result.errors.push(`Error updating ${update.key}: ${error.message}`);
      }
    }

    return result;
  }
}
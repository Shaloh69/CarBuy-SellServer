// src/controllers/vehicles/ColorController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import StandardColorModel, { ColorFilters, ColorSearchOptions } from "../../models/StandardColor";
import { ApiResponse, PaginatedResponse } from "../../types";
import { AuthorizationError, ValidationError, NotFoundError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

export class ColorController {
  // Get all colors with filtering and pagination
  static getAllColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const {
        page = 1,
        limit = 50,
        sort_by = "name",
        sort_order = "ASC",
        color_family,
        is_common,
        usage_type,
        search,
        include_stats = false,
      } = req.query;

      const filters: ColorFilters = {};
      const options: ColorSearchOptions = {
        page: parseInt(page as string),
        limit: Math.min(parseInt(limit as string), 100), // Max 100 per page
        sort_by: sort_by as "name" | "color_family" | "usage_count" | "created_at",
        sort_order: sort_order as "ASC" | "DESC",
        include_stats: include_stats === "true",
      };

      // Apply filters
      if (color_family) filters.color_family = color_family as string;
      if (is_common !== undefined) filters.is_common = is_common === "true";
      if (usage_type) filters.usage_type = usage_type as "exterior" | "interior" | "both";
      if (search) filters.search = search as string;

      const result = await StandardColorModel.getAll(filters, options);

      res.json({
        success: true,
        message: "Colors retrieved successfully",
        data: result.colors,
        meta: {
          pagination: {
            page: result.page,
            limit: options.limit,
            total: result.total,
            totalPages: result.totalPages,
          },
          filters: filters,
        },
      } as PaginatedResponse);
    }
  );

  // Get single color by ID
  static getColor = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const colorId = parseInt(req.params.id);
      const includeStats = req.query.include_stats === "true";

      if (isNaN(colorId)) {
        throw new ValidationError("Invalid color ID");
      }

      const color = await StandardColorModel.findById(colorId, includeStats);

      if (!color) {
        throw new NotFoundError("Color");
      }

      res.json({
        success: true,
        message: "Color retrieved successfully",
        data: color,
      } as ApiResponse);
    }
  );

  // Get colors by family
  static getColorsByFamily = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const colorFamily = req.params.family;
      const includeStats = req.query.include_stats === "true";

      if (!colorFamily) {
        throw new ValidationError("Color family is required");
      }

      const validFamilies = [
        "black", "white", "silver", "gray", "red", "blue", 
        "green", "yellow", "orange", "brown", "purple", "other"
      ];

      if (!validFamilies.includes(colorFamily)) {
        throw new ValidationError(`Color family must be one of: ${validFamilies.join(", ")}`);
      }

      const colors = await StandardColorModel.getByFamily(colorFamily, includeStats);

      res.json({
        success: true,
        message: `${colorFamily} colors retrieved successfully`,
        data: colors,
        meta: {
          color_family: colorFamily,
          count: colors.length,
        },
      } as ApiResponse);
    }
  );

  // Get common colors
  static getCommonColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const includeStats = req.query.include_stats === "true";

      const colors = await StandardColorModel.getCommonColors(includeStats);

      res.json({
        success: true,
        message: "Common colors retrieved successfully",
        data: colors,
      } as ApiResponse);
    }
  );

  // Get most used colors
  static getMostUsedColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const usageType = req.query.usage_type as "exterior" | "interior" | "both" || "both";
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      if (!["exterior", "interior", "both"].includes(usageType)) {
        throw new ValidationError("usage_type must be 'exterior', 'interior', or 'both'");
      }

      const colors = await StandardColorModel.getMostUsed(usageType, limit);

      res.json({
        success: true,
        message: `Most used ${usageType} colors retrieved successfully`,
        data: colors,
        meta: {
          usage_type: usageType,
          count: colors.length,
        },
      } as ApiResponse);
    }
  );

  // Search colors
  static searchColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const searchTerm = req.query.q as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      if (!searchTerm || searchTerm.length < 2) {
        throw new ValidationError("Search term must be at least 2 characters");
      }

      const colors = await StandardColorModel.search(searchTerm, limit);

      res.json({
        success: true,
        message: "Color search completed",
        data: colors,
      } as ApiResponse);
    }
  );

  // Get color statistics
  static getColorStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const colorId = parseInt(req.params.id);

      if (isNaN(colorId)) {
        throw new ValidationError("Invalid color ID");
      }

      const stats = await StandardColorModel.getStatistics(colorId);

      if (!stats) {
        throw new NotFoundError("Color statistics");
      }

      res.json({
        success: true,
        message: "Color statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get color family statistics
  static getFamilyStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const stats = await StandardColorModel.getFamilyStatistics();

      res.json({
        success: true,
        message: "Color family statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get color dropdown options (for forms)
  static getDropdownOptions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const usageType = req.query.usage_type as "exterior" | "interior" | "both" || "both";
      const commonOnly = req.query.common_only === "true";

      if (!["exterior", "interior", "both"].includes(usageType)) {
        throw new ValidationError("usage_type must be 'exterior', 'interior', or 'both'");
      }

      const colors = await StandardColorModel.getDropdownOptions(usageType, commonOnly);

      res.json({
        success: true,
        message: "Color dropdown options retrieved successfully",
        data: colors,
        meta: {
          usage_type: usageType,
          common_only: commonOnly,
        },
      } as ApiResponse);
    }
  );

  // Get color palette (colors with hex codes grouped by family)
  static getColorPalette = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const palette = await StandardColorModel.getColorPalette();

      res.json({
        success: true,
        message: "Color palette retrieved successfully",
        data: palette,
      } as ApiResponse);
    }
  );

  // Get complementary colors
  static getComplementaryColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const colorId = parseInt(req.params.id);

      if (isNaN(colorId)) {
        throw new ValidationError("Invalid color ID");
      }

      const complementaryColors = await StandardColorModel.getComplementaryColors(colorId);

      res.json({
        success: true,
        message: "Complementary colors retrieved successfully",
        data: complementaryColors,
      } as ApiResponse);
    }
  );

  // Get color usage trends
  static getUsageTrends = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const days = Math.min(parseInt(req.query.days as string) || 30, 365);

      const trends = await StandardColorModel.getUsageTrends(days);

      res.json({
        success: true,
        message: "Color usage trends retrieved successfully",
        data: trends,
        meta: {
          days: days,
          period: `Last ${days} days`,
        },
      } as ApiResponse);
    }
  );

  // ADMIN ENDPOINTS (require admin role)

  // Create new color
  static createColor = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const {
        name,
        hex_code,
        color_family,
        is_common = true,
      } = req.body;

      // Validate required fields
      if (!name || !color_family) {
        throw new ValidationError("Color name and family are required");
      }

      // Validate color family
      const validFamilies = [
        "black", "white", "silver", "gray", "red", "blue", 
        "green", "yellow", "orange", "brown", "purple", "other"
      ];

      if (!validFamilies.includes(color_family)) {
        throw new ValidationError(`Color family must be one of: ${validFamilies.join(", ")}`);
      }

      // Validate color data
      const validation = StandardColorModel.validateColorData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const color = await StandardColorModel.create({
        name,
        hex_code,
        color_family,
        is_common,
      });

      logger.info(`Color created by user ${req.user.id}: ${color.name}`);

      res.status(201).json({
        success: true,
        message: "Color created successfully",
        data: color,
      } as ApiResponse);
    }
  );

  // Update color
  static updateColor = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const colorId = parseInt(req.params.id);

      if (isNaN(colorId)) {
        throw new ValidationError("Invalid color ID");
      }

      // Check if color exists
      const existingColor = await StandardColorModel.findById(colorId);
      if (!existingColor) {
        throw new NotFoundError("Color");
      }

      // Validate color family if being changed
      if (req.body.color_family) {
        const validFamilies = [
          "black", "white", "silver", "gray", "red", "blue", 
          "green", "yellow", "orange", "brown", "purple", "other"
        ];

        if (!validFamilies.includes(req.body.color_family)) {
          throw new ValidationError(`Color family must be one of: ${validFamilies.join(", ")}`);
        }
      }

      // Validate color data
      const validation = StandardColorModel.validateColorData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const updatedColor = await StandardColorModel.update(colorId, req.body);

      if (!updatedColor) {
        throw new Error("Failed to update color");
      }

      logger.info(`Color updated by user ${req.user.id}: ${updatedColor.name}`);

      res.json({
        success: true,
        message: "Color updated successfully",
        data: updatedColor,
      } as ApiResponse);
    }
  );

  // Delete color
  static deleteColor = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const colorId = parseInt(req.params.id);

      if (isNaN(colorId)) {
        throw new ValidationError("Invalid color ID");
      }

      // Check if color exists
      const existingColor = await StandardColorModel.findById(colorId);
      if (!existingColor) {
        throw new NotFoundError("Color");
      }

      const success = await StandardColorModel.delete(colorId);

      if (!success) {
        throw new Error("Failed to delete color");
      }

      logger.info(`Color deleted by user ${req.user.id}: ${existingColor.name}`);

      res.json({
        success: true,
        message: "Color deleted successfully",
      } as ApiResponse);
    }
  );

  // Set color as common
  static toggleCommonStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const colorId = parseInt(req.params.id);
      const { is_common } = req.body;

      if (isNaN(colorId)) {
        throw new ValidationError("Invalid color ID");
      }

      if (typeof is_common !== "boolean") {
        throw new ValidationError("is_common must be a boolean");
      }

      // Check if color exists
      const existingColor = await StandardColorModel.findById(colorId);
      if (!existingColor) {
        throw new NotFoundError("Color");
      }

      const success = await StandardColorModel.setCommon(colorId, is_common);

      if (!success) {
        throw new Error("Failed to update color common status");
      }

      logger.info(`Color ${is_common ? "marked as common" : "unmarked as common"} by user ${req.user.id}: ${existingColor.name}`);

      res.json({
        success: true,
        message: `Color ${is_common ? "marked as common" : "unmarked as common"} successfully`,
      } as ApiResponse);
    }
  );

  // Bulk operations
  static bulkUpdateCommonStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { color_ids, is_common } = req.body;

      if (!Array.isArray(color_ids) || color_ids.length === 0) {
        throw new ValidationError("color_ids must be a non-empty array");
      }

      if (typeof is_common !== "boolean") {
        throw new ValidationError("is_common must be a boolean");
      }

      // Validate all IDs are numbers
      const validIds = color_ids.every(id => Number.isInteger(id) && id > 0);
      if (!validIds) {
        throw new ValidationError("All color IDs must be positive integers");
      }

      const success = await StandardColorModel.bulkUpdateCommon(color_ids, is_common);

      if (!success) {
        throw new Error("Failed to bulk update colors");
      }

      logger.info(`Bulk updated ${color_ids.length} colors to ${is_common ? "common" : "not common"} by user ${req.user.id}`);

      res.json({
        success: true,
        message: `${color_ids.length} colors ${is_common ? "marked as common" : "unmarked as common"} successfully`,
      } as ApiResponse);
    }
  );

  // Check color dependencies before deletion
  static checkDependencies = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const colorId = parseInt(req.params.id);

      if (isNaN(colorId)) {
        throw new ValidationError("Invalid color ID");
      }

      const dependencies = await StandardColorModel.checkDependencies(colorId);

      res.json({
        success: true,
        message: "Color dependencies checked",
        data: {
          can_delete: !dependencies.hasDependencies,
          dependencies: dependencies.details,
        },
      } as ApiResponse);
    }
  );

  // Sync common colors based on usage
  static syncCommonColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const threshold = parseInt(req.body.threshold as string) || 50;

      const success = await StandardColorModel.syncCommonColors(threshold);

      if (!success) {
        throw new Error("Failed to sync common colors");
      }

      logger.info(`Common colors synced by user ${req.user.id} with threshold ${threshold}`);

      res.json({
        success: true,
        message: `Common colors synced successfully (threshold: ${threshold} usages)`,
      } as ApiResponse);
    }
  );

  // Seed default colors
  static seedDefaultColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const success = await StandardColorModel.seedDefaultColors();

      if (!success) {
        throw new Error("Failed to seed default colors");
      }

      logger.info(`Default colors seeded by user ${req.user.id}`);

      res.json({
        success: true,
        message: "Default colors seeded successfully",
      } as ApiResponse);
    }
  );

  // Import colors from CSV/JSON
  static importColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { colors } = req.body;

      if (!Array.isArray(colors) || colors.length === 0) {
        throw new ValidationError("colors must be a non-empty array");
      }

      const results = {
        imported: 0,
        skipped: 0,
        errors: [] as string[],
      };

      for (let i = 0; i < colors.length; i++) {
        const colorData = colors[i];
        
        try {
          // Validate color data
          const validation = StandardColorModel.validateColorData(colorData);
          if (!validation.isValid) {
            results.errors.push(`Color ${i + 1}: ${validation.errors.join(", ")}`);
            results.skipped++;
            continue;
          }

          // Check if color already exists
          const existingColor = await StandardColorModel.findByName(colorData.name);
          if (existingColor) {
            results.skipped++;
            continue;
          }

          // Create color
          await StandardColorModel.create(colorData);
          results.imported++;

        } catch (error) {
          results.errors.push(`Color ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
          results.skipped++;
        }
      }

      logger.info(`Color import completed by user ${req.user.id}: ${results.imported} imported, ${results.skipped} skipped`);

      res.json({
        success: true,
        message: "Color import completed",
        data: results,
      } as ApiResponse);
    }
  );

  // Export colors to CSV/JSON
  static exportColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const format = req.query.format as string || "json";
      const colorFamily = req.query.color_family as string;

      const filters: ColorFilters = {};
      if (colorFamily) {
        filters.color_family = colorFamily;
      }

      const result = await StandardColorModel.getAll(filters, { 
        limit: 10000, 
        include_stats: true 
      });

      if (format === "csv") {
        // Convert to CSV format
        const csvHeader = "ID,Name,Hex Code,Color Family,Common,Usage Count,Exterior Usage,Interior Usage\n";
        const csvData = result.colors.map(color => 
          `${color.id},"${color.name}","${color.hex_code || ""}","${color.color_family}",${color.is_common},${color.usage_count || 0},${color.exterior_usage_count || 0},${color.interior_usage_count || 0}`
        ).join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=colors.csv");
        res.send(csvHeader + csvData);
      } else {
        res.json({
          success: true,
          message: "Colors exported successfully",
          data: {
            colors: result.colors,
            total: result.total,
            exported_at: new Date(),
          },
        } as ApiResponse);
      }

      logger.info(`Colors exported by user ${req.user.id} in ${format} format`);
    }
  );

  // Color analytics
  static getColorAnalytics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      // Get overall color statistics
      const totalColors = await StandardColorModel.getAll({}, { limit: 1 });
      const commonColors = await StandardColorModel.getAll({ is_common: true }, { limit: 1 });
      
      // Get family statistics
      const familyStats = await StandardColorModel.getFamilyStatistics();
      
      // Get most used colors
      const mostUsedExterior = await StandardColorModel.getMostUsed("exterior", 10);
      const mostUsedInterior = await StandardColorModel.getMostUsed("interior", 10);

      res.json({
        success: true,
        message: "Color analytics retrieved successfully",
        data: {
          summary: {
            total_colors: totalColors.total,
            common_colors: commonColors.total,
            rare_colors: totalColors.total - commonColors.total,
            color_families: familyStats.length,
          },
          by_family: familyStats,
          most_used: {
            exterior: mostUsedExterior,
            interior: mostUsedInterior,
          },
          generated_at: new Date(),
        },
      } as ApiResponse);
    }
  );
}

export default ColorController;
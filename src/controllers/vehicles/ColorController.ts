// src/controllers/vehicles/ColorController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { StandardColorModel, ColorFilters, ColorSearchOptions, CreateStandardColorData, UpdateStandardColorData } from "../../models/StandardColor";
import { ApiResponse, PaginatedResponse } from "../../types";
import { ValidationError, NotFoundError, AuthorizationError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

export class ColorController {
  // Get all colors with filtering and pagination
  static getAllColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
      const sortBy = (req.query.sort_by as string) || "color_family";
      const sortOrder = (req.query.sort_order as "ASC" | "DESC") || "ASC";
      const includeStats = req.query.include_stats === "true";

      const filters: ColorFilters = {};
      
      if (req.query.color_family) {
        filters.color_family = req.query.color_family as string;
      }
      
      if (req.query.is_common !== undefined) {
        filters.is_common = req.query.is_common === "true";
      }

      if (req.query.usage_type) {
        filters.usage_type = req.query.usage_type as "exterior" | "interior" | "both";
      }

      if (req.query.search) {
        filters.search = req.query.search as string;
      }

      const options: ColorSearchOptions = {
        page,
        limit,
        sort_by: sortBy,
        sort_order: sortOrder,
        include_stats: includeStats,
      };

      const result = await StandardColorModel.getAll(filters, options);

      res.json({
        success: true,
        message: "Colors retrieved successfully",
        data: result.colors,
        pagination: {
          page: result.page,
          limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      } as PaginatedResponse);
    }
  );

  // Get colors grouped by family
  static getColorsByFamily = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const commonOnly = req.query.common_only === "true";
      const includeStats = req.query.include_stats === "true";

      const colors = await StandardColorModel.getColorsByFamily(commonOnly, includeStats);

      res.json({
        success: true,
        message: "Colors by family retrieved successfully",
        data: colors,
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

  // Get single color by ID
  static getColor = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const colorId = parseInt(req.params.id);

      if (isNaN(colorId)) {
        throw new ValidationError("Invalid color ID");
      }

      const includeStats = req.query.include_stats === "true";
      const color = await StandardColorModel.findById(colorId, includeStats);

      if (!color) {
        throw new NotFoundError("Color not found");
      }

      res.json({
        success: true,
        message: "Color retrieved successfully",
        data: color,
      } as ApiResponse);
    }
  );

  // Create new color (Admin only)
  static createColor = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      // Validate color data
      const validation = StandardColorModel.validateColorData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const colorData: CreateStandardColorData = {
        name: req.body.name,
        hex_code: req.body.hex_code,
        color_family: req.body.color_family,
        is_common: req.body.is_common,
      };

      const color = await StandardColorModel.create(colorData);

      logger.info(`Color created by admin ${req.user.id}: ${color.name}`);

      res.status(201).json({
        success: true,
        message: "Color created successfully",
        data: color,
      } as ApiResponse);
    }
  );

  // Update color (Admin only)
  static updateColor = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

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
        throw new NotFoundError("Color not found");
      }

      // Validate update data
      const validation = StandardColorModel.validateColorData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const updateData: UpdateStandardColorData = req.body;
      const updatedColor = await StandardColorModel.update(colorId, updateData);

      if (!updatedColor) {
        throw new Error("Failed to update color");
      }

      logger.info(`Color updated by admin ${req.user.id}: ${updatedColor.name}`);

      res.json({
        success: true,
        message: "Color updated successfully",
        data: updatedColor,
      } as ApiResponse);
    }
  );

  // Delete color (Admin only)
  static deleteColor = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

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
        throw new NotFoundError("Color not found");
      }

      const success = await StandardColorModel.delete(colorId);

      if (!success) {
        throw new Error("Failed to delete color");
      }

      logger.info(`Color deleted by admin ${req.user.id}: ${existingColor.name}`);

      res.json({
        success: true,
        message: "Color deleted successfully",
      } as ApiResponse);
    }
  );

  // Get common colors
  static getCommonColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const usageType = req.query.usage_type as "exterior" | "interior" | "both";
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 14));

      const colors = await StandardColorModel.getCommonColors(usageType, limit);

      res.json({
        success: true,
        message: "Common colors retrieved successfully",
        data: colors,
      } as ApiResponse);
    }
  );

  // Get most popular colors
  static getMostPopularColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const usageType = req.query.usage_type as "exterior" | "interior" | "both";
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));

      const colors = await StandardColorModel.getMostPopularColors(usageType, limit);

      res.json({
        success: true,
        message: "Most popular colors retrieved successfully",
        data: colors,
      } as ApiResponse);
    }
  );

  // Get color dropdown options for forms
  static getDropdownOptions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const usageType = req.query.usage_type as "exterior" | "interior" | "both";
      const commonOnly = req.query.common_only === "true";

      const colors = await StandardColorModel.getDropdownOptions(usageType, commonOnly);

      res.json({
        success: true,
        message: "Color options retrieved successfully",
        data: colors,
      } as ApiResponse);
    }
  );

  // Toggle color common status (Admin only)
  static toggleCommonStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const colorId = parseInt(req.params.id);

      if (isNaN(colorId)) {
        throw new ValidationError("Invalid color ID");
      }

      const color = await StandardColorModel.findById(colorId);
      if (!color) {
        throw new NotFoundError("Color not found");
      }

      const newStatus = !color.is_common;
      const success = await StandardColorModel.setCommon(colorId, newStatus);

      if (!success) {
        throw new Error("Failed to update color common status");
      }

      logger.info(`Color ${colorId} ${newStatus ? "marked as common" : "unmarked as common"} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: `Color ${newStatus ? "marked as common" : "unmarked as common"} successfully`,
        data: { id: colorId, is_common: newStatus },
      } as ApiResponse);
    }
  );

  // Sync common colors based on usage (Admin only)
  static syncCommonColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const threshold = Math.max(10, parseInt(req.body.threshold || "50"));

      const success = await StandardColorModel.syncCommonColors(threshold);

      if (!success) {
        throw new Error("Failed to sync common colors");
      }

      logger.info(`Common colors synced with threshold ${threshold} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: "Common colors synced successfully",
        data: { threshold },
      } as ApiResponse);
    }
  );

  // Get color usage statistics (Admin only)
  static getColorUsageStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const colorId = parseInt(req.params.id);

      if (isNaN(colorId)) {
        throw new ValidationError("Invalid color ID");
      }

      const stats = await StandardColorModel.getColorUsageStatistics(colorId);

      if (!stats) {
        throw new NotFoundError("No usage statistics found for this color");
      }

      res.json({
        success: true,
        message: "Color usage statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get color usage trends (Admin only)
  static getColorUsageTrends = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const days = Math.min(90, Math.max(7, parseInt(req.query.days as string) || 30));

      const trends = await StandardColorModel.getUsageTrends(days);

      res.json({
        success: true,
        message: "Color usage trends retrieved successfully",
        data: trends,
      } as ApiResponse);
    }
  );

  // Search colors
  static searchColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const query = req.query.q as string;
      const colorFamily = req.query.color_family as string;
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 10));

      if (!query || query.length < 2) {
        throw new ValidationError("Search query must be at least 2 characters");
      }

      const colors = await StandardColorModel.search(query, colorFamily, limit);

      res.json({
        success: true,
        message: "Color search completed",
        data: colors,
      } as ApiResponse);
    }
  );

  // Get color statistics (Admin only)
  static getColorStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const stats = await StandardColorModel.getColorStatistics();

      res.json({
        success: true,
        message: "Color statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get colors by hex similarity (Admin/Advanced users)
  static getColorsByHexSimilarity = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const hexCode = req.query.hex_code as string;
      const tolerance = Math.min(50, Math.max(5, parseInt(req.query.tolerance as string) || 20));
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));

      if (!hexCode) {
        throw new ValidationError("Hex code is required");
      }

      // Validate hex code format
      if (!/^#[0-9A-Fa-f]{6}$/.test(hexCode)) {
        throw new ValidationError("Invalid hex code format. Use format: #RRGGBB");
      }

      const colors = await StandardColorModel.findSimilarColors(hexCode, tolerance, limit);

      res.json({
        success: true,
        message: "Similar colors retrieved successfully",
        data: colors,
      } as ApiResponse);
    }
  );

  // Bulk update colors (Admin only)
  static bulkUpdateColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { color_ids, update_data } = req.body;

      if (!Array.isArray(color_ids) || color_ids.length === 0) {
        throw new ValidationError("Color IDs array is required");
      }

      if (!update_data || typeof update_data !== "object") {
        throw new ValidationError("Update data is required");
      }

      // Validate that all color IDs are valid numbers
      const invalidIds = color_ids.filter((id) => !Number.isInteger(id) || id <= 0);
      if (invalidIds.length > 0) {
        throw new ValidationError(`Invalid color IDs: ${invalidIds.join(", ")}`);
      }

      // Handle special bulk operations
      if ('is_common' in update_data) {
        const success = await StandardColorModel.bulkUpdateCommon(color_ids, update_data.is_common);
        
        if (!success) {
          throw new Error("Failed to bulk update color common status");
        }

        logger.info(`Bulk updated ${color_ids.length} colors by admin ${req.user.id}`);

        res.json({
          success: true,
          message: `${color_ids.length} colors updated successfully`,
          data: { updated_count: color_ids.length },
        } as ApiResponse);
        return;
      }

      // For other updates, validate each color exists first
      const colors = await Promise.all(color_ids.map((id: number) => StandardColorModel.findById(id)));
      const missingColors = color_ids.filter((id: number, index: number) => !colors[index]);

      if (missingColors.length > 0) {
        throw new ValidationError(`Colors not found: ${missingColors.join(", ")}`);
      }

      // Perform bulk update
      const updatePromises = color_ids.map((id: number) => StandardColorModel.update(id, update_data));
      const results = await Promise.allSettled(updatePromises);

      const successful = results.filter(r => r.status === "fulfilled").length;
      const failed = results.length - successful;

      if (failed > 0) {
        logger.warn(`Bulk color update partially failed: ${successful}/${results.length} successful`);
      }

      logger.info(`Bulk updated ${successful} colors by admin ${req.user.id}`);

      res.json({
        success: successful > 0,
        message: failed > 0 
          ? `${successful} colors updated successfully, ${failed} failed`
          : `${successful} colors updated successfully`,
        data: { 
          updated_count: successful, 
          failed_count: failed 
        },
      } as ApiResponse);
    }
  );

  // Bulk update colors by family (Admin only)
  static bulkUpdateByFamily = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const colorFamily = req.params.colorFamily;
      const updateData = req.body;

      if (!colorFamily) {
        throw new ValidationError("Color family is required");
      }

      if (!updateData || typeof updateData !== "object") {
        throw new ValidationError("Update data is required");
      }

      // Validate color family
      const validFamilies = [
        "black", "white", "silver", "gray", "red", "blue", 
        "green", "yellow", "orange", "brown", "purple", "other"
      ];
      if (!validFamilies.includes(colorFamily)) {
        throw new ValidationError(`Invalid color family. Must be one of: ${validFamilies.join(", ")}`);
      }

      const success = await StandardColorModel.bulkUpdateByFamily(colorFamily, updateData);

      if (!success) {
        throw new Error("Failed to bulk update colors by family");
      }

      logger.info(`Bulk updated colors in family ${colorFamily} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: `Colors in family '${colorFamily}' updated successfully`,
        data: { color_family: colorFamily },
      } as ApiResponse);
    }
  );

  // Get trending colors
  static getTrendingColors = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const timeframe = (req.query.timeframe as "day" | "week" | "month") || "week";
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));
      const usageType = req.query.usage_type as "exterior" | "interior" | "both";

      const colors = await StandardColorModel.getTrendingColors(timeframe, limit, usageType);

      res.json({
        success: true,
        message: "Trending colors retrieved successfully",
        data: colors,
      } as ApiResponse);
    }
  );

  // Import colors from CSV (Admin only)
  static importColorsFromCSV = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { colors_data } = req.body;

      if (!Array.isArray(colors_data) || colors_data.length === 0) {
        throw new ValidationError("Colors data array is required");
      }

      // Validate each color data entry
      const invalidEntries: string[] = [];
      const validEntries: CreateStandardColorData[] = [];

      for (let i = 0; i < colors_data.length; i++) {
        const colorData = colors_data[i];
        const validation = StandardColorModel.validateColorData(colorData);
        
        if (!validation.isValid) {
          invalidEntries.push(`Row ${i + 1}: ${validation.errors.join(", ")}`);
        } else {
          validEntries.push(colorData);
        }
      }

      if (invalidEntries.length > 0 && validEntries.length === 0) {
        throw new ValidationError(`All entries invalid:\n${invalidEntries.join("\n")}`);
      }

      // Import valid entries
      const results = await Promise.allSettled(
        validEntries.map(colorData => StandardColorModel.create(colorData))
      );

      const successful = results.filter(r => r.status === "fulfilled").length;
      const failed = results.length - successful;

      logger.info(`Imported ${successful} colors from CSV by admin ${req.user.id}`);

      res.json({
        success: successful > 0,
        message: `Import completed: ${successful} colors imported successfully` + 
                (failed > 0 ? `, ${failed} failed` : "") +
                (invalidEntries.length > 0 ? `, ${invalidEntries.length} invalid entries skipped` : ""),
        data: { 
          imported_count: successful,
          failed_count: failed,
          invalid_count: invalidEntries.length,
          invalid_entries: invalidEntries.slice(0, 5) // Show first 5 invalid entries
        },
      } as ApiResponse);
    }
  );
}

export default ColorController;
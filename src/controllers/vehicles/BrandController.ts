// src/controllers/vehicles/BrandController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import BrandModel, { BrandFilters, BrandSearchOptions } from "../../models/Brand";
import { ApiResponse, PaginatedResponse } from "../../types";
import { AuthorizationError, ValidationError, NotFoundError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

export class BrandController {
  // Get all brands with filtering and pagination
  static getAllBrands = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const {
        page = 1,
        limit = 50,
        sort_by = "name",
        sort_order = "ASC",
        brand_type,
        is_popular_in_ph,
        is_active,
        country_origin,
        search,
        include_stats = false,
      } = req.query;

      const filters: BrandFilters = {};
      const options: BrandSearchOptions = {
        page: parseInt(page as string),
        limit: Math.min(parseInt(limit as string), 100), // Max 100 per page
        sort_by: sort_by as "name" | "created_at" | "listing_count" | "popularity",
        sort_order: sort_order as "ASC" | "DESC",
        include_stats: include_stats === "true",
      };

      // Apply filters
      if (brand_type) filters.brand_type = brand_type as string;
      if (is_popular_in_ph !== undefined) filters.is_popular_in_ph = is_popular_in_ph === "true";
      if (is_active !== undefined) filters.is_active = is_active === "true";
      if (country_origin) filters.country_origin = country_origin as string;
      if (search) filters.search = search as string;

      const result = await BrandModel.getAll(filters, options);

      res.json({
        success: true,
        message: "Brands retrieved successfully",
        data: result.brands,
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

  // Get single brand by ID
  static getBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const brandId = parseInt(req.params.id);
      const includeStats = req.query.include_stats === "true";

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      const brand = await BrandModel.findById(brandId, includeStats);

      if (!brand) {
        throw new NotFoundError("Brand");
      }

      res.json({
        success: true,
        message: "Brand retrieved successfully",
        data: brand,
      } as ApiResponse);
    }
  );

  // Get brand by slug
  static getBrandBySlug = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const slug = req.params.slug;

      if (!slug) {
        throw new ValidationError("Brand slug is required");
      }

      const brand = await BrandModel.findBySlug(slug);

      if (!brand) {
        throw new NotFoundError("Brand");
      }

      res.json({
        success: true,
        message: "Brand retrieved successfully",
        data: brand,
      } as ApiResponse);
    }
  );

  // Get popular brands in Philippines
  static getPopularBrands = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      const brands = await BrandModel.getPopularInPhilippines(limit);

      res.json({
        success: true,
        message: "Popular brands retrieved successfully",
        data: brands,
      } as ApiResponse);
    }
  );

  // Get brands by type
  static getBrandsByType = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const brandType = req.params.type;
      const includeStats = req.query.include_stats === "true";

      if (!brandType) {
        throw new ValidationError("Brand type is required");
      }

      const validTypes = ["luxury", "mainstream", "economy", "commercial", "motorcycle"];
      if (!validTypes.includes(brandType)) {
        throw new ValidationError(`Brand type must be one of: ${validTypes.join(", ")}`);
      }

      const brands = await BrandModel.getByType(brandType, includeStats);

      res.json({
        success: true,
        message: `${brandType} brands retrieved successfully`,
        data: brands,
      } as ApiResponse);
    }
  );

  // Get most popular brands (by listings)
  static getMostPopular = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      const brands = await BrandModel.getMostPopular(limit);

      res.json({
        success: true,
        message: "Most popular brands retrieved successfully",
        data: brands,
      } as ApiResponse);
    }
  );

  // Search brands
  static searchBrands = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const searchTerm = req.query.q as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      if (!searchTerm || searchTerm.length < 2) {
        throw new ValidationError("Search term must be at least 2 characters");
      }

      const brands = await BrandModel.search(searchTerm, limit);

      res.json({
        success: true,
        message: "Brand search completed",
        data: brands,
      } as ApiResponse);
    }
  );

  // Get brand statistics
  static getBrandStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const brandId = parseInt(req.params.id);

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      const stats = await BrandModel.getStatistics(brandId);

      if (!stats) {
        throw new NotFoundError("Brand statistics");
      }

      res.json({
        success: true,
        message: "Brand statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get country statistics
  static getCountryStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const stats = await BrandModel.getCountryStatistics();

      res.json({
        success: true,
        message: "Country statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Get brand dropdown options (for forms)
  static getDropdownOptions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const brands = await BrandModel.getDropdownOptions();

      res.json({
        success: true,
        message: "Brand dropdown options retrieved successfully",
        data: brands,
      } as ApiResponse);
    }
  );

  // ADMIN ENDPOINTS (require admin role)

  // Create new brand
  static createBrand = asyncHandler(
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
        logo_url,
        country_origin,
        brand_type = "mainstream",
        is_popular_in_ph = false,
        is_active = true,
        seo_slug,
        meta_title,
        meta_description,
      } = req.body;

      // Validate required fields
      if (!name) {
        throw new ValidationError("Brand name is required");
      }

      // Validate brand data
      const validation = BrandModel.validateBrandData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const brand = await BrandModel.create({
        name,
        logo_url,
        country_origin,
        brand_type,
        is_popular_in_ph,
        is_active,
        seo_slug,
        meta_title,
        meta_description,
      });

      logger.info(`Brand created by user ${req.user.id}: ${brand.name}`);

      res.status(201).json({
        success: true,
        message: "Brand created successfully",
        data: brand,
      } as ApiResponse);
    }
  );

  // Update brand
  static updateBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const brandId = parseInt(req.params.id);

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      // Check if brand exists
      const existingBrand = await BrandModel.findById(brandId);
      if (!existingBrand) {
        throw new NotFoundError("Brand");
      }

      // Validate brand data
      const validation = BrandModel.validateBrandData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const updatedBrand = await BrandModel.update(brandId, req.body);

      if (!updatedBrand) {
        throw new Error("Failed to update brand");
      }

      logger.info(`Brand updated by user ${req.user.id}: ${updatedBrand.name}`);

      res.json({
        success: true,
        message: "Brand updated successfully",
        data: updatedBrand,
      } as ApiResponse);
    }
  );

  // Soft delete brand
  static deleteBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const brandId = parseInt(req.params.id);

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      // Check if brand exists
      const existingBrand = await BrandModel.findById(brandId);
      if (!existingBrand) {
        throw new NotFoundError("Brand");
      }

      const success = await BrandModel.softDelete(brandId);

      if (!success) {
        throw new Error("Failed to delete brand");
      }

      logger.info(`Brand soft deleted by user ${req.user.id}: ${existingBrand.name}`);

      res.json({
        success: true,
        message: "Brand deleted successfully",
      } as ApiResponse);
    }
  );

  // Hard delete brand (permanent)
  static hardDeleteBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const brandId = parseInt(req.params.id);

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      // Check if brand exists
      const existingBrand = await BrandModel.findById(brandId);
      if (!existingBrand) {
        throw new NotFoundError("Brand");
      }

      const success = await BrandModel.hardDelete(brandId);

      if (!success) {
        throw new Error("Failed to permanently delete brand");
      }

      logger.info(`Brand hard deleted by user ${req.user.id}: ${existingBrand.name}`);

      res.json({
        success: true,
        message: "Brand permanently deleted successfully",
      } as ApiResponse);
    }
  );

  // Activate/Deactivate brand
  static toggleBrandStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const brandId = parseInt(req.params.id);
      const { is_active } = req.body;

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      if (typeof is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean");
      }

      // Check if brand exists
      const existingBrand = await BrandModel.findById(brandId);
      if (!existingBrand) {
        throw new NotFoundError("Brand");
      }

      const success = await BrandModel.setActive(brandId, is_active);

      if (!success) {
        throw new Error("Failed to update brand status");
      }

      logger.info(`Brand ${is_active ? "activated" : "deactivated"} by user ${req.user.id}: ${existingBrand.name}`);

      res.json({
        success: true,
        message: `Brand ${is_active ? "activated" : "deactivated"} successfully`,
      } as ApiResponse);
    }
  );

  // Bulk operations
  static bulkUpdateStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { brand_ids, is_active } = req.body;

      if (!Array.isArray(brand_ids) || brand_ids.length === 0) {
        throw new ValidationError("brand_ids must be a non-empty array");
      }

      if (typeof is_active !== "boolean") {
        throw new ValidationError("is_active must be a boolean");
      }

      // Validate all IDs are numbers
      const validIds = brand_ids.every(id => Number.isInteger(id) && id > 0);
      if (!validIds) {
        throw new ValidationError("All brand IDs must be positive integers");
      }

      const success = await BrandModel.bulkUpdateActive(brand_ids, is_active);

      if (!success) {
        throw new Error("Failed to bulk update brands");
      }

      logger.info(`Bulk updated ${brand_ids.length} brands to ${is_active ? "active" : "inactive"} by user ${req.user.id}`);

      res.json({
        success: true,
        message: `${brand_ids.length} brands ${is_active ? "activated" : "deactivated"} successfully`,
      } as ApiResponse);
    }
  );

  // Check brand dependencies before deletion
  static checkDependencies = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const brandId = parseInt(req.params.id);

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      const dependencies = await BrandModel.checkDependencies(brandId);

      res.json({
        success: true,
        message: "Brand dependencies checked",
        data: {
          can_delete: !dependencies.hasDependencies,
          dependencies: dependencies.details,
        },
      } as ApiResponse);
    }
  );

  // Import brands from CSV/JSON
  static importBrands = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { brands } = req.body;

      if (!Array.isArray(brands) || brands.length === 0) {
        throw new ValidationError("brands must be a non-empty array");
      }

      const results = {
        imported: 0,
        skipped: 0,
        errors: [] as string[],
      };

      for (let i = 0; i < brands.length; i++) {
        const brandData = brands[i];
        
        try {
          // Validate brand data
          const validation = BrandModel.validateBrandData(brandData);
          if (!validation.isValid) {
            results.errors.push(`Brand ${i + 1}: ${validation.errors.join(", ")}`);
            results.skipped++;
            continue;
          }

          // Check if brand already exists
          const existingBrand = await BrandModel.findByName(brandData.name);
          if (existingBrand) {
            results.skipped++;
            continue;
          }

          // Create brand
          await BrandModel.create(brandData);
          results.imported++;

        } catch (error) {
          results.errors.push(`Brand ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
          results.skipped++;
        }
      }

      logger.info(`Brand import completed by user ${req.user.id}: ${results.imported} imported, ${results.skipped} skipped`);

      res.json({
        success: true,
        message: "Brand import completed",
        data: results,
      } as ApiResponse);
    }
  );

  // Export brands to CSV/JSON
  static exportBrands = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const format = req.query.format as string || "json";
      const includeInactive = req.query.include_inactive === "true";

      const filters: BrandFilters = {};
      if (!includeInactive) {
        filters.is_active = true;
      }

      const result = await BrandModel.getAll(filters, { limit: 10000, include_stats: true });

      if (format === "csv") {
        // Convert to CSV format
        const csvHeader = "ID,Name,Country,Type,Popular in PH,Active,Listing Count,Created At\n";
        const csvData = result.brands.map(brand => 
          `${brand.id},"${brand.name}","${brand.country_origin || ""}","${brand.brand_type}",${brand.is_popular_in_ph},${brand.is_active},${brand.active_listing_count || 0},"${brand.created_at}"`
        ).join("\n");

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=brands.csv");
        res.send(csvHeader + csvData);
      } else {
        res.json({
          success: true,
          message: "Brands exported successfully",
          data: {
            brands: result.brands,
            total: result.total,
            exported_at: new Date(),
          },
        } as ApiResponse);
      }

      logger.info(`Brands exported by user ${req.user.id} in ${format} format`);
    }
  );

  // Brand analytics
  static getBrandAnalytics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin or moderator
      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      // Get overall brand statistics
      const totalBrands = await BrandModel.getAll({}, { limit: 1 });
      const activeBrands = await BrandModel.getAll({ is_active: true }, { limit: 1 });
      const popularBrands = await BrandModel.getAll({ is_popular_in_ph: true }, { limit: 1 });
      
      // Get country statistics
      const countryStats = await BrandModel.getCountryStatistics();
      
      // Get most popular brands
      const topBrands = await BrandModel.getMostPopular(10);

      res.json({
        success: true,
        message: "Brand analytics retrieved successfully",
        data: {
          summary: {
            total_brands: totalBrands.total,
            active_brands: activeBrands.total,
            popular_brands: popularBrands.total,
            inactive_brands: totalBrands.total - activeBrands.total,
          },
          by_country: countryStats,
          top_brands: topBrands,
          generated_at: new Date(),
        },
      } as ApiResponse);
    }
  );

  // Sync popular brands based on listing count
  static syncPopularBrands = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Check if user is admin
      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const threshold = parseInt(req.body.threshold as string) || 10;

      // Get brands with listing count above threshold
      const popularBrands = await BrandModel.getMostPopular(100);
      const brandsToMarkPopular = popularBrands
        .filter(brand => (brand.active_listing_count || 0) >= threshold)
        .map(brand => brand.id);

      // Reset all brands to not popular
      await BrandModel.bulkUpdateByIds([], { is_popular_in_ph: false });

      // Mark qualifying brands as popular
      if (brandsToMarkPopular.length > 0) {
        await BrandModel.bulkUpdateByIds(brandsToMarkPopular, { is_popular_in_ph: true });
      }

      logger.info(`Popular brands synced by user ${req.user.id}: ${brandsToMarkPopular.length} brands marked as popular`);

      res.json({
        success: true,
        message: `${brandsToMarkPopular.length} brands marked as popular (threshold: ${threshold} listings)`,
      } as ApiResponse);
    }
  );
}

export default BrandController;
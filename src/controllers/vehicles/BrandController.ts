// src/controllers/vehicles/BrandController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { BrandModel, BrandFilters, BrandSearchOptions, CreateBrandData, UpdateBrandData } from "../../models/Brand";
import { ApiResponse, PaginatedResponse } from "../../types";
import { ValidationError, NotFoundError, AuthorizationError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

export class BrandController {
  // Get all brands with filtering and pagination
  static getAllBrands = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const sortBy = (req.query.sort_by as string) || "name";
      const sortOrder = (req.query.sort_order as "ASC" | "DESC") || "ASC";
      const includeStats = req.query.include_stats === "true";

      const filters: BrandFilters = {};
      
      if (req.query.brand_type) {
        filters.brand_type = req.query.brand_type as string;
      }
      
      if (req.query.is_popular_in_ph !== undefined) {
        filters.is_popular_in_ph = req.query.is_popular_in_ph === "true";
      }

      if (req.query.is_active !== undefined) {
        filters.is_active = req.query.is_active === "true";
      }

      if (req.query.search) {
        filters.search = req.query.search as string;
      }

      const options: BrandSearchOptions = {
        page,
        limit,
        sort_by: sortBy,
        sort_order: sortOrder,
        include_stats: includeStats,
      };

      const result = await BrandModel.getAll(filters, options);

      res.json({
        success: true,
        message: "Brands retrieved successfully",
        data: result.brands,
        pagination: {
          page: result.page,
          limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      } as PaginatedResponse);
    }
  );

  // Get single brand by ID
  static getBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const brandId = parseInt(req.params.id);

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      const includeStats = req.query.include_stats === "true";
      const brand = await BrandModel.findById(brandId, includeStats);

      if (!brand) {
        throw new NotFoundError("Brand not found");
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

      if (!slug || slug.length < 2) {
        throw new ValidationError("Invalid brand slug");
      }

      const brand = await BrandModel.findBySlug(slug);

      if (!brand) {
        throw new NotFoundError("Brand not found");
      }

      res.json({
        success: true,
        message: "Brand retrieved successfully",
        data: brand,
      } as ApiResponse);
    }
  );

  // Create new brand (Admin only)
  static createBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      // Validate brand data
      const validation = BrandModel.validateBrandData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const brandData: CreateBrandData = {
        name: req.body.name,
        brand_type: req.body.brand_type,
        country_of_origin: req.body.country_of_origin,
        logo_url: req.body.logo_url,
        official_website: req.body.official_website,
        is_popular_in_ph: req.body.is_popular_in_ph,
        is_active: req.body.is_active,
        seo_slug: req.body.seo_slug,
        meta_title: req.body.meta_title,
        meta_description: req.body.meta_description,
      };

      const brand = await BrandModel.create(brandData);

      logger.info(`Brand created by admin ${req.user.id}: ${brand.name}`);

      res.status(201).json({
        success: true,
        message: "Brand created successfully",
        data: brand,
      } as ApiResponse);
    }
  );

  // Update brand (Admin only)
  static updateBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

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
        throw new NotFoundError("Brand not found");
      }

      // Validate update data
      const validation = BrandModel.validateBrandData(req.body);
      if (!validation.isValid) {
        throw new ValidationError(validation.errors.join(", "));
      }

      const updateData: UpdateBrandData = req.body;
      const updatedBrand = await BrandModel.update(brandId, updateData);

      if (!updatedBrand) {
        throw new Error("Failed to update brand");
      }

      logger.info(`Brand updated by admin ${req.user.id}: ${updatedBrand.name}`);

      res.json({
        success: true,
        message: "Brand updated successfully",
        data: updatedBrand,
      } as ApiResponse);
    }
  );

  // Delete brand (Admin only)
  static deleteBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

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
        throw new NotFoundError("Brand not found");
      }

      const success = await BrandModel.delete(brandId);

      if (!success) {
        throw new Error("Failed to delete brand");
      }

      logger.info(`Brand deleted by admin ${req.user.id}: ${existingBrand.name}`);

      res.json({
        success: true,
        message: "Brand deleted successfully",
      } as ApiResponse);
    }
  );

  // Toggle brand active status (Admin only)
  static toggleBrandStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const brandId = parseInt(req.params.id);

      if (isNaN(brandId)) {
        throw new ValidationError("Invalid brand ID");
      }

      const brand = await BrandModel.findById(brandId);
      if (!brand) {
        throw new NotFoundError("Brand not found");
      }

      const newStatus = !brand.is_active;
      const success = await BrandModel.setActive(brandId, newStatus);

      if (!success) {
        throw new Error("Failed to update brand status");
      }

      logger.info(`Brand ${brandId} ${newStatus ? "activated" : "deactivated"} by admin ${req.user.id}`);

      res.json({
        success: true,
        message: `Brand ${newStatus ? "activated" : "deactivated"} successfully`,
        data: { id: brandId, is_active: newStatus },
      } as ApiResponse);
    }
  );

  // Get popular brands in Philippines
  static getPopularBrands = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));

      const brands = await BrandModel.getPopularInPhilippines(limit);

      res.json({
        success: true,
        message: "Popular brands retrieved successfully",
        data: brands,
      } as ApiResponse);
    }
  );

  // Get most popular brands by listing count
  static getMostPopular = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));

      const brands = await BrandModel.getMostPopular(limit);

      res.json({
        success: true,
        message: "Most popular brands retrieved successfully",
        data: brands,
      } as ApiResponse);
    }
  );

  // Get brand dropdown options for forms
  static getDropdownOptions = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const brands = await BrandModel.getDropdownOptions();

      res.json({
        success: true,
        message: "Brand options retrieved successfully",
        data: brands,
      } as ApiResponse);
    }
  );

  // Get brand statistics (Admin only)
  static getBrandStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const stats = await BrandModel.getBrandStatistics();

      res.json({
        success: true,
        message: "Brand statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Search brands
  static searchBrands = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const query = req.query.q as string;
      const limit = Math.min(20, Math.max(1, parseInt(req.query.limit as string) || 10));

      if (!query || query.length < 2) {
        throw new ValidationError("Search query must be at least 2 characters");
      }

      const brands = await BrandModel.search(query, limit);

      res.json({
        success: true,
        message: "Brand search completed",
        data: brands,
      } as ApiResponse);
    }
  );

  // Bulk update brands (Admin only)
  static bulkUpdateBrands = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (req.user.role !== "admin") {
        throw new AuthorizationError("Admin access required");
      }

      const { brand_ids, update_data } = req.body;

      if (!Array.isArray(brand_ids) || brand_ids.length === 0) {
        throw new ValidationError("Brand IDs array is required");
      }

      if (!update_data || typeof update_data !== "object") {
        throw new ValidationError("Update data is required");
      }

      // Validate that all brand IDs are valid numbers
      const invalidIds = brand_ids.filter((id) => !Number.isInteger(id) || id <= 0);
      if (invalidIds.length > 0) {
        throw new ValidationError(`Invalid brand IDs: ${invalidIds.join(", ")}`);
      }

      // If updating active status, use dedicated method
      if ('is_active' in update_data) {
        const success = await BrandModel.bulkUpdateActive(brand_ids, update_data.is_active);
        
        if (!success) {
          throw new Error("Failed to bulk update brand status");
        }

        logger.info(`Bulk updated ${brand_ids.length} brands by admin ${req.user.id}`);

        res.json({
          success: true,
          message: `${brand_ids.length} brands updated successfully`,
          data: { updated_count: brand_ids.length },
        } as ApiResponse);
        return;
      }

      // For other updates, validate each brand exists first
      const brands = await Promise.all(brand_ids.map((id: number) => BrandModel.findById(id)));
      const missingBrands = brand_ids.filter((id: number, index: number) => !brands[index]);

      if (missingBrands.length > 0) {
        throw new ValidationError(`Brands not found: ${missingBrands.join(", ")}`);
      }

      // Perform bulk update
      const updatePromises = brand_ids.map((id: number) => BrandModel.update(id, update_data));
      const results = await Promise.allSettled(updatePromises);

      const successful = results.filter(r => r.status === "fulfilled").length;
      const failed = results.length - successful;

      if (failed > 0) {
        logger.warn(`Bulk brand update partially failed: ${successful}/${results.length} successful`);
      }

      logger.info(`Bulk updated ${successful} brands by admin ${req.user.id}`);

      res.json({
        success: successful > 0,
        message: failed > 0 
          ? `${successful} brands updated successfully, ${failed} failed`
          : `${successful} brands updated successfully`,
        data: { 
          updated_count: successful, 
          failed_count: failed 
        },
      } as ApiResponse);
    }
  );
}

export default BrandController;
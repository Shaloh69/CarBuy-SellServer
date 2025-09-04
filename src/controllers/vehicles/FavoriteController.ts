// src/controllers/users/FavoriteController.ts
import { Request, Response } from "express";
import { asyncHandler } from "../../middleware/errorHandler";
import { FavoriteModel, FavoriteFilters, FavoriteSearchOptions, CreateFavoriteData, UpdateFavoriteData } from "../../models/Favorite";
import { ApiResponse, PaginatedResponse } from "../../types";
import { ValidationError, NotFoundError, AuthorizationError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

export class FavoriteController {
  // Get user's favorites with filtering and pagination
  static getUserFavorites = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const sortBy = (req.query.sort_by as string) || "created_at";
      const sortOrder = (req.query.sort_order as "ASC" | "DESC") || "DESC";
      const includeCarDetails = req.query.include_car_details !== "false";

      const filters: FavoriteFilters = {
        user_id: req.user.id,
      };
      
      if (req.query.car_status) {
        filters.car_status = req.query.car_status as string;
      }
      
      if (req.query.price_alert_enabled !== undefined) {
        filters.price_alert_enabled = req.query.price_alert_enabled === "true";
      }

      if (req.query.price_changed !== undefined) {
        filters.price_changed = req.query.price_changed === "true";
      }

      if (req.query.search) {
        filters.search = req.query.search as string;
      }

      if (req.query.brand_id) {
        const brandId = parseInt(req.query.brand_id as string);
        if (!isNaN(brandId)) {
          filters.brand_id = brandId;
        }
      }

      if (req.query.city_id) {
        const cityId = parseInt(req.query.city_id as string);
        if (!isNaN(cityId)) {
          filters.city_id = cityId;
        }
      }

      if (req.query.price_min) {
        const priceMin = parseFloat(req.query.price_min as string);
        if (!isNaN(priceMin)) {
          filters.price_min = priceMin;
        }
      }

      if (req.query.price_max) {
        const priceMax = parseFloat(req.query.price_max as string);
        if (!isNaN(priceMax)) {
          filters.price_max = priceMax;
        }
      }

      const options: FavoriteSearchOptions = {
        page,
        limit,
        sort_by: sortBy,
        sort_order: sortOrder,
        include_car_details: includeCarDetails,
      };

      const result = await FavoriteModel.getUserFavorites(req.user.id, filters, options);

      res.json({
        success: true,
        message: "Favorites retrieved successfully",
        data: result.favorites,
        pagination: {
          page: result.page,
          limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      } as PaginatedResponse);
    }
  );

  // Add car to favorites
  static addToFavorites = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const carId = parseInt(req.params.carId);

      if (isNaN(carId)) {
        throw new ValidationError("Invalid car ID");
      }

      const favoriteData: CreateFavoriteData = {
        user_id: req.user.id,
        car_id: carId,
        notes: req.body.notes,
        price_alert_enabled: req.body.price_alert_enabled || false,
        price_alert_threshold: req.body.price_alert_threshold,
      };

      const favorite = await FavoriteModel.create(favoriteData);

      logger.info(`User ${req.user.id} added car ${carId} to favorites`);

      res.status(201).json({
        success: true,
        message: "Car added to favorites successfully",
        data: favorite,
      } as ApiResponse);
    }
  );

  // Remove car from favorites
  static removeFromFavorites = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const carId = parseInt(req.params.carId);

      if (isNaN(carId)) {
        throw new ValidationError("Invalid car ID");
      }

      const success = await FavoriteModel.removeByUserAndCar(req.user.id, carId);

      if (!success) {
        throw new NotFoundError("Favorite not found");
      }

      logger.info(`User ${req.user.id} removed car ${carId} from favorites`);

      res.json({
        success: true,
        message: "Car removed from favorites successfully",
      } as ApiResponse);
    }
  );

  // Toggle favorite status
  static toggleFavorite = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const carId = parseInt(req.params.carId);

      if (isNaN(carId)) {
        throw new ValidationError("Invalid car ID");
      }

      const result = await FavoriteModel.toggle(req.user.id, carId);

      logger.info(`User ${req.user.id} ${result.action} car ${carId} ${result.action === 'added' ? 'to' : 'from'} favorites`);

      res.json({
        success: true,
        message: `Car ${result.action === 'added' ? 'added to' : 'removed from'} favorites successfully`,
        data: {
          action: result.action,
          favorite: result.favorite,
        },
      } as ApiResponse);
    }
  );

  // Update favorite
  static updateFavorite = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const favoriteId = parseInt(req.params.id);

      if (isNaN(favoriteId)) {
        throw new ValidationError("Invalid favorite ID");
      }

      // Check if favorite exists and belongs to user
      const existingFavorite = await FavoriteModel.findById(favoriteId);
      if (!existingFavorite) {
        throw new NotFoundError("Favorite not found");
      }

      if (existingFavorite.user_id !== req.user.id) {
        throw new AuthorizationError("Access denied");
      }

      const updateData: UpdateFavoriteData = {
        notes: req.body.notes,
        price_alert_enabled: req.body.price_alert_enabled,
        price_alert_threshold: req.body.price_alert_threshold,
      };

      const updatedFavorite = await FavoriteModel.update(favoriteId, updateData);

      if (!updatedFavorite) {
        throw new Error("Failed to update favorite");
      }

      logger.info(`User ${req.user.id} updated favorite ${favoriteId}`);

      res.json({
        success: true,
        message: "Favorite updated successfully",
        data: updatedFavorite,
      } as ApiResponse);
    }
  );

  // Get single favorite by ID
  static getFavorite = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const favoriteId = parseInt(req.params.id);

      if (isNaN(favoriteId)) {
        throw new ValidationError("Invalid favorite ID");
      }

      const includeCarDetails = req.query.include_car_details !== "false";
      const favorite = await FavoriteModel.findById(favoriteId, includeCarDetails);

      if (!favorite) {
        throw new NotFoundError("Favorite not found");
      }

      // Check if favorite belongs to user
      if (favorite.user_id !== req.user.id) {
        throw new AuthorizationError("Access denied");
      }

      res.json({
        success: true,
        message: "Favorite retrieved successfully",
        data: favorite,
      } as ApiResponse);
    }
  );

  // Check if car is favorited by user
  static checkFavoriteStatus = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const carId = parseInt(req.params.carId);

      if (isNaN(carId)) {
        throw new ValidationError("Invalid car ID");
      }

      const favorite = await FavoriteModel.findByUserAndCar(req.user.id, carId);
      const isFavorited = !!favorite;

      res.json({
        success: true,
        message: "Favorite status retrieved successfully",
        data: {
          is_favorited: isFavorited,
          favorite_id: favorite?.id || null,
          favorite_details: favorite,
        },
      } as ApiResponse);
    }
  );

  // Get user's favorite count
  static getUserFavoriteCount = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const activeOnly = req.query.active_only !== "false";
      const count = await FavoriteModel.getUserFavoriteCount(req.user.id, activeOnly);

      res.json({
        success: true,
        message: "Favorite count retrieved successfully",
        data: { count },
      } as ApiResponse);
    }
  );

  // Get favorites with price alerts
  static getFavoritesWithPriceAlerts = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const favorites = await FavoriteModel.getFavoritesWithPriceAlerts(req.user.id);

      res.json({
        success: true,
        message: "Favorites with price alerts retrieved successfully",
        data: favorites,
      } as ApiResponse);
    }
  );

  // Get favorites with price drops
  static getFavoritesWithPriceDrops = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const favorites = await FavoriteModel.getFavoritesWithPriceDrops(req.user.id);

      res.json({
        success: true,
        message: "Favorites with price drops retrieved successfully",
        data: favorites,
      } as ApiResponse);
    }
  );

  // Get user's favorite brands
  static getUserFavoriteBrands = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const limit = Math.min(10, Math.max(1, parseInt(req.query.limit as string) || 5));

      const brands = await FavoriteModel.getUserFavoriteBrands(req.user.id, limit);

      res.json({
        success: true,
        message: "Favorite brands retrieved successfully",
        data: brands,
      } as ApiResponse);
    }
  );

  // Get user's recommendation data based on favorites
  static getUserRecommendationData = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const recommendationData = await FavoriteModel.getUserRecommendationData(req.user.id);

      res.json({
        success: true,
        message: "Recommendation data retrieved successfully",
        data: recommendationData,
      } as ApiResponse);
    }
  );

  // Bulk remove favorites
  static bulkRemoveFavorites = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const { favorite_ids } = req.body;

      if (!Array.isArray(favorite_ids) || favorite_ids.length === 0) {
        throw new ValidationError("Favorite IDs array is required");
      }

      // Validate that all favorite IDs are valid numbers
      const invalidIds = favorite_ids.filter((id) => !Number.isInteger(id) || id <= 0);
      if (invalidIds.length > 0) {
        throw new ValidationError(`Invalid favorite IDs: ${invalidIds.join(", ")}`);
      }

      // Verify all favorites belong to the user
      const favorites = await Promise.all(
        favorite_ids.map((id: number) => FavoriteModel.findById(id, false))
      );

      const notFound = favorite_ids.filter((id: number, index: number) => !favorites[index]);
      const notOwned = favorite_ids.filter((id: number, index: number) => 
        favorites[index] && favorites[index].user_id !== req.user!.id
      );

      if (notFound.length > 0) {
        throw new NotFoundError(`Favorites not found: ${notFound.join(", ")}`);
      }

      if (notOwned.length > 0) {
        throw new AuthorizationError("Some favorites don't belong to you");
      }

      // Remove favorites
      const success = await FavoriteModel.bulkRemove(favorite_ids);

      if (!success) {
        throw new Error("Failed to remove favorites");
      }

      logger.info(`User ${req.user.id} removed ${favorite_ids.length} favorites`);

      res.json({
        success: true,
        message: `${favorite_ids.length} favorites removed successfully`,
        data: { removed_count: favorite_ids.length },
      } as ApiResponse);
    }
  );

  // Bulk update price alerts for favorites
  static bulkUpdatePriceAlerts = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const { favorite_ids, price_alert_enabled, price_alert_threshold } = req.body;

      if (!Array.isArray(favorite_ids) || favorite_ids.length === 0) {
        throw new ValidationError("Favorite IDs array is required");
      }

      if (typeof price_alert_enabled !== "boolean") {
        throw new ValidationError("Price alert enabled status is required");
      }

      // Validate that all favorite IDs are valid numbers
      const invalidIds = favorite_ids.filter((id) => !Number.isInteger(id) || id <= 0);
      if (invalidIds.length > 0) {
        throw new ValidationError(`Invalid favorite IDs: ${invalidIds.join(", ")}`);
      }

      // Verify all favorites belong to the user
      const favorites = await Promise.all(
        favorite_ids.map((id: number) => FavoriteModel.findById(id, false))
      );

      const notFound = favorite_ids.filter((id: number, index: number) => !favorites[index]);
      const notOwned = favorite_ids.filter((id: number, index: number) => 
        favorites[index] && favorites[index].user_id !== req.user!.id
      );

      if (notFound.length > 0) {
        throw new NotFoundError(`Favorites not found: ${notFound.join(", ")}`);
      }

      if (notOwned.length > 0) {
        throw new AuthorizationError("Some favorites don't belong to you");
      }

      const updateData: UpdateFavoriteData = {
        price_alert_enabled,
        price_alert_threshold,
      };

      const success = await FavoriteModel.bulkUpdatePriceAlerts(favorite_ids, updateData);

      if (!success) {
        throw new Error("Failed to update price alerts");
      }

      logger.info(`User ${req.user.id} updated price alerts for ${favorite_ids.length} favorites`);

      res.json({
        success: true,
        message: `Price alerts updated for ${favorite_ids.length} favorites`,
        data: { updated_count: favorite_ids.length },
      } as ApiResponse);
    }
  );

  // Get most favorited cars (Public)
  static getMostFavorited = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));
      const timeframe = req.query.timeframe as "day" | "week" | "month";

      const cars = await FavoriteModel.getMostFavorited(limit, timeframe);

      res.json({
        success: true,
        message: "Most favorited cars retrieved successfully",
        data: cars,
      } as ApiResponse);
    }
  );

  // Get trending favorites (Public)
  static getTrendingFavorites = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const timeframe = (req.query.timeframe as "day" | "week" | "month") || "week";
      const limit = Math.min(20, Math.max(5, parseInt(req.query.limit as string) || 10));

      const favorites = await FavoriteModel.getTrendingFavorites(timeframe, limit);

      res.json({
        success: true,
        message: "Trending favorites retrieved successfully",
        data: favorites,
      } as ApiResponse);
    }
  );

  // Get car's favorite count (Public)
  static getCarFavoriteCount = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const carId = parseInt(req.params.carId);

      if (isNaN(carId)) {
        throw new ValidationError("Invalid car ID");
      }

      const count = await FavoriteModel.getCarFavoriteCount(carId);

      res.json({
        success: true,
        message: "Car favorite count retrieved successfully",
        data: { car_id: carId, favorite_count: count },
      } as ApiResponse);
    }
  );

  // Get favorite statistics (Admin only)
  static getFavoriteStatistics = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      if (!["admin", "moderator"].includes(req.user.role)) {
        throw new AuthorizationError("Admin or moderator access required");
      }

      const stats = await FavoriteModel.getFavoriteStatistics();

      res.json({
        success: true,
        message: "Favorite statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );

  // Export user favorites to CSV
  static exportUserFavorites = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const favorites = await FavoriteModel.getUserFavorites(req.user.id, {}, {
        include_car_details: true,
        limit: 10000, // Large limit for export
      });

      if (favorites.favorites.length === 0) {
        throw new NotFoundError("No favorites to export");
      }

      // Convert to CSV format
      const csvHeaders = [
        "Car Title",
        "Brand",
        "Model", 
        "Year",
        "Price",
        "Currency",
        "City",
        "Province",
        "Notes",
        "Price Alert Enabled",
        "Price Alert Threshold",
        "Favorited Date",
      ];

      const csvRows = favorites.favorites.map(fav => [
        fav.car_title || "",
        fav.car_brand || "",
        fav.car_model || "",
        fav.car_year || "",
        fav.car_price || "",
        fav.car_currency || "",
        fav.car_city || "",
        fav.car_province || "",
        fav.notes || "",
        fav.price_alert_enabled ? "Yes" : "No",
        fav.price_alert_threshold || "",
        new Date(fav.created_at).toLocaleDateString(),
      ]);

      const csvContent = [csvHeaders, ...csvRows]
        .map(row => row.map(field => `"${field.toString().replace(/"/g, '""')}"`).join(","))
        .join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="favorites_${req.user.id}_${new Date().toISOString().split('T')[0]}.csv"`);
      
      res.send(csvContent);

      logger.info(`User ${req.user.id} exported ${favorites.favorites.length} favorites to CSV`);
    }
  );
}

export default FavoriteController;
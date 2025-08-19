import { Request, Response } from "express";
import {
  CarModel,
  CreateCarData,
  UpdateCarData,
  CarFilters,
  SearchOptions,
} from "../../models/Car";
import { LocationModel } from "../../models/Location";
import {
  asyncHandler,
  NotFoundError,
  AuthorizationError,
  ValidationError,
  BusinessLogicError,
} from "../../middleware/errorHandler";
import { carCache } from "../../services/cache/CacheManager";
import { MediaProcessingService } from "../../services/media/ImageProcessingService";
import { FraudDetectionService } from "../../services/fraud/FraudDetectionService";
import { NotificationService } from "../../services/realtime/NotificationService";
import SocketManager from "../../config/socket";
import logger, { business, performance } from "../../utils/logger";
import { ApiResponse, SearchFilters } from "../../types";
import crypto from "crypto";

export class CarController {
  // Get all cars with filters and pagination
  static getCars = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const searchOptions: SearchOptions = {
        sort_by: req.query.sort_by as any,
        page: parseInt(req.query.page as string) || 1,
        limit: Math.min(parseInt(req.query.limit as string) || 20, 100),
        include_images: req.query.include_images !== "false",
        include_features: req.query.include_features === "true",
        include_seller: req.query.include_seller !== "false",
      };

      // Build filters from query parameters
      const filters: CarFilters = {
        brand_id: req.query.brand_id
          ? parseInt(req.query.brand_id as string)
          : undefined,
        model_id: req.query.model_id
          ? parseInt(req.query.model_id as string)
          : undefined,
        category_id: req.query.category_id
          ? parseInt(req.query.category_id as string)
          : undefined,
        min_price: req.query.min_price
          ? parseFloat(req.query.min_price as string)
          : undefined,
        max_price: req.query.max_price
          ? parseFloat(req.query.max_price as string)
          : undefined,
        min_year: req.query.min_year
          ? parseInt(req.query.min_year as string)
          : undefined,
        max_year: req.query.max_year
          ? parseInt(req.query.max_year as string)
          : undefined,
        max_mileage: req.query.max_mileage
          ? parseInt(req.query.max_mileage as string)
          : undefined,
        fuel_type: req.query.fuel_type
          ? (req.query.fuel_type as string).split(",")
          : undefined,
        transmission: req.query.transmission
          ? (req.query.transmission as string).split(",")
          : undefined,
        condition_rating: req.query.condition_rating
          ? (req.query.condition_rating as string).split(",")
          : undefined,
        city_id: req.query.city_id
          ? parseInt(req.query.city_id as string)
          : undefined,
        province_id: req.query.province_id
          ? parseInt(req.query.province_id as string)
          : undefined,
        region_id: req.query.region_id
          ? parseInt(req.query.region_id as string)
          : undefined,
        latitude: req.query.latitude
          ? parseFloat(req.query.latitude as string)
          : undefined,
        longitude: req.query.longitude
          ? parseFloat(req.query.longitude as string)
          : undefined,
        radius: req.query.radius
          ? parseInt(req.query.radius as string)
          : undefined,
        features: req.query.features
          ? (req.query.features as string).split(",").map(Number)
          : undefined,
        seller_verified: req.query.seller_verified === "true",
        financing_available: req.query.financing_available === "true",
        trade_in_accepted: req.query.trade_in_accepted === "true",
        warranty_remaining: req.query.warranty_remaining === "true",
        casa_maintained: req.query.casa_maintained === "true",
        min_rating: req.query.min_rating
          ? parseFloat(req.query.min_rating as string)
          : undefined,
      };

      // Generate cache key for search results
      const searchHash = crypto
        .createHash("md5")
        .update(JSON.stringify({ filters, options: searchOptions }))
        .digest("hex");

      // Try to get from cache first
      let result = await carCache.getSearchResults(searchHash);

      if (!result) {
        // Search in database
        result = await performance.measureAsync(
          "car_search",
          () => CarModel.search(filters, searchOptions),
          "CarController"
        );

        // Cache results for 5 minutes
        await carCache.setSearchResults(searchHash, result);
      }

      res.json({
        success: true,
        message: "Cars retrieved successfully",
        data: result.cars,
        pagination: {
          page: result.page,
          limit: searchOptions.limit || 20,
          total: result.total,
          totalPages: result.totalPages,
        },
      } as ApiResponse);
    }
  );

  // Get single car by ID
  static getCar = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const carId = parseInt(req.params.id);
      const userId = req.user?.id;

      // Try cache first
      let car = await carCache.getCar(carId);

      if (!car) {
        // Get from database with full details
        car = await CarModel.getWithDetails(carId, userId);

        if (!car) {
          throw new NotFoundError("Car");
        }

        // Cache the car data
        await carCache.setCar(carId, car);
      } else if (userId) {
        // Track view even if cached
        await CarModel.trackView(carId, userId, undefined, req.ip);
      }

      res.json({
        success: true,
        message: "Car retrieved successfully",
        data: car,
      } as ApiResponse);
    }
  );

  // Create new car listing
  static createCar = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      // Validate location hierarchy if provided
      if (req.body.city_id && req.body.province_id && req.body.region_id) {
        const validLocation = await LocationModel.validateLocationHierarchy(
          req.body.city_id,
          req.body.province_id,
          req.body.region_id
        );

        if (!validLocation) {
          throw new ValidationError("Invalid location hierarchy");
        }
      }

      // Validate coordinates if provided
      if (req.body.latitude && req.body.longitude) {
        const validCoords = await LocationModel.validatePhilippinesCoordinates(
          req.body.latitude,
          req.body.longitude
        );

        if (!validCoords) {
          throw new ValidationError(
            "Coordinates must be within Philippines bounds"
          );
        }
      }

      const carData: CreateCarData = {
        ...req.body,
        seller_id: req.user.id,
      };

      // Create car listing
      const car = await CarModel.create(carData);

      // Run fraud detection
      try {
        const fraudAnalysis = await FraudDetectionService.analyzeListing(
          car.id
        );

        if (
          fraudAnalysis.risk_level === "high" ||
          fraudAnalysis.risk_level === "critical"
        ) {
          logger.warn(`High risk car listing detected: ${car.id}`, {
            risk_score: fraudAnalysis.risk_score,
            indicators: fraudAnalysis.indicators,
          });

          // Auto-suspend high-risk listings
          if (fraudAnalysis.risk_level === "critical") {
            await CarModel.update(car.id, { status: "suspended" });
          }
        }
      } catch (error) {
        logger.error("Fraud detection failed for car listing:", error);
      }

      // Invalidate relevant caches
      await carCache.invalidateLocationCache(car.city_id);

      // Log business event
      business.logCarListing(req.user.id, car.id, "created", {
        price: car.price,
        brand_id: car.brand_id,
        model_id: car.model_id,
      });

      // Send notification to admin for approval
      try {
        await NotificationService.notifyCarSubmittedForApproval(
          car.id,
          req.user.id
        );
      } catch (error) {
        logger.warn("Failed to send car approval notification:", error);
      }

      res.status(201).json({
        success: true,
        message: "Car listing created successfully",
        data: car,
      } as ApiResponse);
    }
  );

  // Update car listing
  static updateCar = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const carId = parseInt(req.params.id);

      // Get existing car
      const existingCar = await CarModel.findById(carId);
      if (!existingCar) {
        throw new NotFoundError("Car");
      }

      // Check ownership or admin access
      if (
        existingCar.seller_id !== req.user.id &&
        !["admin", "moderator"].includes(req.user.role)
      ) {
        throw new AuthorizationError("You can only update your own listings");
      }

      // Prevent updates to sold or suspended cars
      if (["sold", "suspended"].includes(existingCar.status)) {
        throw new BusinessLogicError(
          `Cannot update ${existingCar.status} listing`
        );
      }

      // Validate location hierarchy if being updated
      if (req.body.city_id && req.body.province_id && req.body.region_id) {
        const validLocation = await LocationModel.validateLocationHierarchy(
          req.body.city_id,
          req.body.province_id,
          req.body.region_id
        );

        if (!validLocation) {
          throw new ValidationError("Invalid location hierarchy");
        }
      }

      const updateData: UpdateCarData = req.body;

      // Update car
      const updatedCar = await CarModel.update(carId, updateData);
      if (!updatedCar) {
        throw new Error("Failed to update car");
      }

      // Invalidate caches
      await carCache.invalidateCarCache(carId);
      if (updateData.city_id) {
        await carCache.invalidateLocationCache(updateData.city_id);
      }

      // Notify watchers of updates if significant changes
      const significantFields = ["price", "mileage", "condition_rating"];
      const hasSignificantChanges = significantFields.some(
        (field) => field in updateData
      );

      if (hasSignificantChanges) {
        try {
          const socketManager = SocketManager.getInstance();
          socketManager.emitToCarWatchers(carId, "car:updated", {
            carId,
            changes: Object.keys(updateData),
            timestamp: new Date(),
          });
        } catch (error) {
          logger.warn("Failed to emit car update notification:", error);
        }
      }

      // Log business event
      business.logCarListing(req.user.id, carId, "updated", {
        changes: Object.keys(updateData),
      });

      res.json({
        success: true,
        message: "Car listing updated successfully",
        data: updatedCar,
      } as ApiResponse);
    }
  );

  // Delete car listing
  static deleteCar = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const carId = parseInt(req.params.id);

      // Get existing car
      const existingCar = await CarModel.findById(carId);
      if (!existingCar) {
        throw new NotFoundError("Car");
      }

      // Check ownership or admin access
      if (
        existingCar.seller_id !== req.user.id &&
        !["admin", "moderator"].includes(req.user.role)
      ) {
        throw new AuthorizationError("You can only delete your own listings");
      }

      // Prevent deletion of sold cars
      if (existingCar.status === "sold") {
        throw new BusinessLogicError("Cannot delete sold listing");
      }

      // Soft delete the car
      const success = await CarModel.softDelete(carId);
      if (!success) {
        throw new Error("Failed to delete car");
      }

      // Invalidate caches
      await carCache.invalidateCarCache(carId);
      await carCache.invalidateLocationCache(existingCar.city_id);

      // Notify watchers that car is no longer available
      try {
        const socketManager = SocketManager.getInstance();
        socketManager.emitToCarWatchers(carId, "car:removed", {
          carId,
          timestamp: new Date(),
        });
      } catch (error) {
        logger.warn("Failed to emit car removal notification:", error);
      }

      // Log business event
      business.logCarListing(req.user.id, carId, "deleted");

      res.json({
        success: true,
        message: "Car listing deleted successfully",
      } as ApiResponse);
    }
  );

  // Get user's car listings
  static getUserCars = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const status = req.query.status as string;

      // Build filters for user's cars
      const filters: CarFilters = {
        // Add seller filter here when implemented in CarModel
      };

      if (status) {
        // Filter by status would need to be implemented in CarModel
      }

      const searchOptions: SearchOptions = {
        page,
        limit,
        include_images: true,
        include_features: false,
        include_seller: false,
        sort_by: "newest",
      };

      // This would need a getUserCars method in CarModel
      const result = await CarModel.getSellerCars(req.user.id, page, limit);

      res.json({
        success: true,
        message: "User cars retrieved successfully",
        data: result.cars,
        pagination: {
          page: result.page,
          limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      } as ApiResponse);
    }
  );

  // Add car to favorites
  static addToFavorites = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const carId = parseInt(req.params.id);

      // Check if car exists
      const car = await CarModel.findById(carId);
      if (!car) {
        throw new NotFoundError("Car");
      }

      // Add to favorites (would need implementation in UserModel)
      // await UserModel.addToFavorites(req.user.id, carId);

      // Invalidate user cache
      // await userCache.invalidateUserCache(req.user.id);

      // Join car watchers room for real-time updates
      try {
        const socketManager = SocketManager.getInstance();
        socketManager.emitToUser(req.user.id, "car:favorited", {
          carId,
          timestamp: new Date(),
        });
      } catch (error) {
        logger.warn("Failed to emit favorite notification:", error);
      }

      res.json({
        success: true,
        message: "Car added to favorites successfully",
      } as ApiResponse);
    }
  );

  // Remove car from favorites
  static removeFromFavorites = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const carId = parseInt(req.params.id);

      // Remove from favorites (would need implementation in UserModel)
      // await UserModel.removeFromFavorites(req.user.id, carId);

      // Invalidate user cache
      // await userCache.invalidateUserCache(req.user.id);

      res.json({
        success: true,
        message: "Car removed from favorites successfully",
      } as ApiResponse);
    }
  );

  // Get featured cars
  static getFeaturedCars = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

      // Try cache first
      let featuredCars = await carCache.getFeaturedCars();

      if (!featuredCars) {
        // Get featured cars from database
        const filters: CarFilters = {
          // Featured cars would need a special filter
        };

        const searchOptions: SearchOptions = {
          limit,
          include_images: true,
          include_features: false,
          include_seller: true,
          sort_by: "newest",
        };

        const result = await CarModel.search(filters, searchOptions);
        featuredCars = result.cars;

        // Cache for 5 minutes
        await carCache.setFeaturedCars(featuredCars);
      }

      res.json({
        success: true,
        message: "Featured cars retrieved successfully",
        data: featuredCars,
      } as ApiResponse);
    }
  );

  // Get cars by brand
  static getCarsByBrand = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const brandId = parseInt(req.params.brandId);
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      // Try cache first
      let cars = await carCache.getCarsByBrand(brandId);

      if (!cars) {
        const filters: CarFilters = { brand_id: brandId };
        const searchOptions: SearchOptions = {
          page,
          limit,
          include_images: true,
          include_features: false,
          include_seller: true,
        };

        const result = await CarModel.search(filters, searchOptions);
        cars = result.cars;

        // Cache for 30 minutes
        await carCache.setCarsByBrand(brandId, cars);
      }

      res.json({
        success: true,
        message: "Cars by brand retrieved successfully",
        data: cars,
      } as ApiResponse);
    }
  );

  // Report suspicious listing
  static reportCar = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const carId = parseInt(req.params.id);
      const { reason, details } = req.body;

      // Check if car exists
      const car = await CarModel.findById(carId);
      if (!car) {
        throw new NotFoundError("Car");
      }

      // Create fraud indicator (would need implementation)
      // await FraudDetectionService.reportSuspiciousListing(carId, req.user.id, reason, details);

      logger.info(`Car ${carId} reported by user ${req.user.id}`, {
        reason,
        details,
        reporter_ip: req.ip,
      });

      res.json({
        success: true,
        message: "Report submitted successfully",
      } as ApiResponse);
    }
  );

  // Boost car listing (premium feature)
  static boostCar = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      if (!req.user) {
        throw new AuthorizationError("Authentication required");
      }

      const carId = parseInt(req.params.id);

      // Get existing car
      const existingCar = await CarModel.findById(carId);
      if (!existingCar) {
        throw new NotFoundError("Car");
      }

      // Check ownership
      if (existingCar.seller_id !== req.user.id) {
        throw new AuthorizationError("You can only boost your own listings");
      }

      // Update boost count and timestamp
      await CarModel.update(carId, {
        boost_count: existingCar.boost_count + 1,
        last_boosted_at: new Date(),
      });

      // Invalidate caches
      await carCache.invalidateCarCache(carId);

      // Log business event
      business.logCarListing(req.user.id, carId, "updated", {
        action: "boost",
      });

      res.json({
        success: true,
        message: "Car listing boosted successfully",
      } as ApiResponse);
    }
  );

  // Get car statistics
  static getCarStats = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const carId = parseInt(req.params.id);

      // Check if car exists and get basic stats
      const car = await CarModel.findById(carId);
      if (!car) {
        throw new NotFoundError("Car");
      }

      // Get detailed analytics (would need implementation)
      const stats = {
        views: {
          total: car.views_count,
          unique: car.unique_views_count,
          today: 0, // Would need daily tracking
          this_week: 0, // Would need weekly tracking
        },
        engagement: {
          contacts: car.contact_count,
          favorites: car.favorite_count,
          inquiries: 0, // Would need to count from inquiries table
        },
        performance: {
          average_rating: car.average_rating,
          total_ratings: car.total_ratings,
          quality_score: car.quality_score,
          search_score: car.search_score,
        },
      };

      res.json({
        success: true,
        message: "Car statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  );
}

import express from "express";
import { LocationModel } from "../models/Location";
import { asyncHandler } from "../middleware/errorHandler";
import { locationCache } from "../services/cache/CacheManager";
import {
  validate,
  validateIdParam,
  validatePagination,
} from "../middleware/validation";
import { generalRateLimit } from "../middleware/rateLimit";
import { ApiResponse } from "../types";
import Joi from "joi";

const router = express.Router();

// Get all regions
router.get(
  "/regions",
  generalRateLimit,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      // Try cache first
      let regions = await locationCache.getRegions();

      if (!regions) {
        regions = await LocationModel.getAllRegions();
        await locationCache.setRegions(regions);
      }

      res.json({
        success: true,
        message: "Regions retrieved successfully",
        data: regions,
      } as ApiResponse);
    }
  )
);

// Get provinces by region
router.get(
  "/regions/:regionId/provinces",
  generalRateLimit,
  validateIdParam,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const regionId = parseInt(req.params.regionId);

      // Try cache first
      let provinces = await locationCache.getProvinces(regionId);

      if (!provinces) {
        provinces = await LocationModel.getProvincesByRegion(regionId);
        await locationCache.setProvinces(regionId, provinces);
      }

      res.json({
        success: true,
        message: "Provinces retrieved successfully",
        data: provinces,
      } as ApiResponse);
    }
  )
);

// Get all provinces
router.get(
  "/provinces",
  generalRateLimit,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const provinces = await LocationModel.getAllProvinces();

      res.json({
        success: true,
        message: "All provinces retrieved successfully",
        data: provinces,
      } as ApiResponse);
    }
  )
);

// Get cities by province
router.get(
  "/provinces/:provinceId/cities",
  generalRateLimit,
  validateIdParam,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const provinceId = parseInt(req.params.provinceId);

      // Try cache first
      let cities = await locationCache.getCities(provinceId);

      if (!cities) {
        cities = await LocationModel.getCitiesByProvince(provinceId);
        await locationCache.setCities(provinceId, cities);
      }

      res.json({
        success: true,
        message: "Cities retrieved successfully",
        data: cities,
      } as ApiResponse);
    }
  )
);

// Get popular cities
router.get(
  "/cities/popular",
  generalRateLimit,
  validate(
    Joi.object({
      limit: Joi.number().integer().min(1).max(50).default(20),
    }),
    "query"
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const limit = parseInt(req.query.limit as string) || 20;

      // Try cache first
      let cities = await locationCache.getPopularCities();

      if (!cities) {
        cities = await LocationModel.getPopularCities(limit);
        await locationCache.setPopularCities(cities);
      } else {
        // Apply limit to cached data
        cities = cities.slice(0, limit);
      }

      res.json({
        success: true,
        message: "Popular cities retrieved successfully",
        data: cities,
      } as ApiResponse);
    }
  )
);

// Get cities with most car listings
router.get(
  "/cities/top-listings",
  generalRateLimit,
  validate(
    Joi.object({
      limit: Joi.number().integer().min(1).max(20).default(10),
    }),
    "query"
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const limit = parseInt(req.query.limit as string) || 10;

      const cities = await LocationModel.getCitiesWithMostListings(limit);

      res.json({
        success: true,
        message: "Top cities by listings retrieved successfully",
        data: cities,
      } as ApiResponse);
    }
  )
);

// Get nearby cities
router.get(
  "/cities/nearby",
  generalRateLimit,
  validate(
    Joi.object({
      latitude: Joi.number().min(4.0).max(21.0).required(),
      longitude: Joi.number().min(116.0).max(127.0).required(),
      radius: Joi.number().positive().max(500).default(50),
      limit: Joi.number().integer().min(1).max(50).default(20),
    }),
    "query"
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const latitude = parseFloat(req.query.latitude as string);
      const longitude = parseFloat(req.query.longitude as string);
      const radius = parseInt(req.query.radius as string) || 50;
      const limit = parseInt(req.query.limit as string) || 20;

      const nearbyCities = await LocationModel.getNearByCities(
        latitude,
        longitude,
        radius,
        limit
      );

      res.json({
        success: true,
        message: "Nearby cities retrieved successfully",
        data: nearbyCities,
      } as ApiResponse);
    }
  )
);

// Get cities in radius of another city
router.get(
  "/cities/:cityId/nearby",
  generalRateLimit,
  validateIdParam,
  validate(
    Joi.object({
      radius: Joi.number().positive().max(500).default(50),
      limit: Joi.number().integer().min(1).max(50).default(20),
    }),
    "query"
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const cityId = parseInt(req.params.cityId);
      const radius = parseInt(req.query.radius as string) || 50;
      const limit = parseInt(req.query.limit as string) || 20;

      const nearbyCities = await LocationModel.getCitiesInRadius(
        cityId,
        radius,
        limit
      );

      res.json({
        success: true,
        message: "Cities in radius retrieved successfully",
        data: nearbyCities,
      } as ApiResponse);
    }
  )
);

// Search locations
router.get(
  "/search",
  generalRateLimit,
  validate(
    Joi.object({
      q: Joi.string().min(2).max(50).required(),
      limit: Joi.number().integer().min(1).max(20).default(10),
    }),
    "query"
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 10;

      const results = await LocationModel.searchLocations(query, limit);

      res.json({
        success: true,
        message: "Location search completed successfully",
        data: results,
      } as ApiResponse);
    }
  )
);

// Get location hierarchy
router.get(
  "/hierarchy/city/:cityId",
  generalRateLimit,
  validateIdParam,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const cityId = parseInt(req.params.cityId);

      const hierarchy = await LocationModel.getLocationHierarchy(cityId);

      if (!hierarchy) {
        res.status(404).json({
          success: false,
          message: "Location not found",
        } as ApiResponse);
        return;
      }

      res.json({
        success: true,
        message: "Location hierarchy retrieved successfully",
        data: hierarchy,
      } as ApiResponse);
    }
  )
);

// Geocoding services
router.post(
  "/geocode",
  generalRateLimit,
  validate(
    Joi.object({
      address: Joi.string().min(5).max(500).required(),
      city_id: Joi.number().integer().positive().optional(),
    })
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const { address, city_id } = req.body;

      const result = await LocationModel.geocodeAddress(address, city_id);

      if (!result) {
        res.status(404).json({
          success: false,
          message: "Address could not be geocoded",
        } as ApiResponse);
        return;
      }

      res.json({
        success: true,
        message: "Address geocoded successfully",
        data: result,
      } as ApiResponse);
    }
  )
);

// Reverse geocoding
router.post(
  "/reverse-geocode",
  generalRateLimit,
  validate(
    Joi.object({
      latitude: Joi.number().min(4.0).max(21.0).required(),
      longitude: Joi.number().min(116.0).max(127.0).required(),
    })
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const { latitude, longitude } = req.body;

      const result = await LocationModel.reverseGeocode(latitude, longitude);

      res.json({
        success: true,
        message: "Coordinates reverse geocoded successfully",
        data: result,
      } as ApiResponse);
    }
  )
);

// Validate location hierarchy
router.post(
  "/validate",
  generalRateLimit,
  validate(
    Joi.object({
      city_id: Joi.number().integer().positive().required(),
      province_id: Joi.number().integer().positive().required(),
      region_id: Joi.number().integer().positive().required(),
    })
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const { city_id, province_id, region_id } = req.body;

      const isValid = await LocationModel.validateLocationHierarchy(
        city_id,
        province_id,
        region_id
      );

      res.json({
        success: true,
        message: "Location hierarchy validation completed",
        data: {
          is_valid: isValid,
          city_id,
          province_id,
          region_id,
        },
      } as ApiResponse);
    }
  )
);

// Validate coordinates
router.post(
  "/validate-coordinates",
  generalRateLimit,
  validate(
    Joi.object({
      latitude: Joi.number().required(),
      longitude: Joi.number().required(),
    })
  ),
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const { latitude, longitude } = req.body;

      const isValid = await LocationModel.validatePhilippinesCoordinates(
        latitude,
        longitude
      );

      res.json({
        success: true,
        message: "Coordinates validation completed",
        data: {
          is_valid: isValid,
          latitude,
          longitude,
          bounds: {
            north: 21.0,
            south: 4.0,
            east: 127.0,
            west: 116.0,
          },
        },
      } as ApiResponse);
    }
  )
);

// Location statistics
router.get(
  "/stats",
  generalRateLimit,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const stats = await LocationModel.getLocationStats();

      res.json({
        success: true,
        message: "Location statistics retrieved successfully",
        data: stats,
      } as ApiResponse);
    }
  )
);

// Get specific location details
router.get(
  "/regions/:id",
  generalRateLimit,
  validateIdParam,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const regionId = parseInt(req.params.id);

      const region = await LocationModel.getRegionById(regionId);

      if (!region) {
        res.status(404).json({
          success: false,
          message: "Region not found",
        } as ApiResponse);
        return;
      }

      res.json({
        success: true,
        message: "Region retrieved successfully",
        data: region,
      } as ApiResponse);
    }
  )
);

router.get(
  "/provinces/:id",
  generalRateLimit,
  validateIdParam,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const provinceId = parseInt(req.params.id);

      const province = await LocationModel.getProvinceById(provinceId);

      if (!province) {
        res.status(404).json({
          success: false,
          message: "Province not found",
        } as ApiResponse);
        return;
      }

      res.json({
        success: true,
        message: "Province retrieved successfully",
        data: province,
      } as ApiResponse);
    }
  )
);

router.get(
  "/cities/:id",
  generalRateLimit,
  validateIdParam,
  asyncHandler(
    async (req: express.Request, res: express.Response): Promise<void> => {
      const cityId = parseInt(req.params.id);

      const city = await LocationModel.getCityById(cityId);

      if (!city) {
        res.status(404).json({
          success: false,
          message: "City not found",
        } as ApiResponse);
        return;
      }

      res.json({
        success: true,
        message: "City retrieved successfully",
        data: city,
      } as ApiResponse);
    }
  )
);

export default router;

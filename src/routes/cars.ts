import express from "express";
import { CarController } from "../controllers/cars/CarController";
import {
  authenticate,
  optionalAuth,
  canCreateListings,
  requireOwnership,
  requireIdentityVerification,
  antiFraud,
} from "../middleware/auth";
import {
  validateCarCreation,
  validateCarUpdate,
  validateCarSearch,
  validateIdParam,
  validatePagination,
  validatePhilippinesLocation,
  sanitizeHtml,
  validate,
  schemas,
} from "../middleware/validation";
import {
  generalRateLimit,
  createListingRateLimit,
  searchRateLimit,
  uploadRateLimit,
} from "../middleware/rateLimit";
import { CarModel } from "../models/Car";

const router = express.Router();

// Public routes with optional authentication
router.get(
  "/",
  optionalAuth,
  searchRateLimit,
  validateCarSearch,
  CarController.getCars
);

router.get(
  "/featured",
  optionalAuth,
  generalRateLimit,
  validatePagination,
  CarController.getFeaturedCars
);

router.get(
  "/brands/:brandId",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  validatePagination,
  CarController.getCarsByBrand
);

router.get(
  "/:id",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  CarController.getCar
);

router.get(
  "/:id/stats",
  optionalAuth,
  generalRateLimit,
  validateIdParam,
  CarController.getCarStats
);

// Protected routes requiring authentication
router.use(authenticate);

// User's own cars
router.get(
  "/user/my-cars",
  generalRateLimit,
  validatePagination,
  CarController.getUserCars
);

// Car creation (requires seller account and verification)
router.post(
  "/",
  createListingRateLimit,
  canCreateListings,
  requireIdentityVerification,
  antiFraud,
  validateCarCreation,
  validatePhilippinesLocation,
  sanitizeHtml,
  CarController.createCar
);

// Car management routes with ownership check
const getCarOwnerId = async (req: express.Request): Promise<number> => {
  const carId = parseInt(req.params.id);
  const car = await CarModel.findById(carId);
  return car ? car.seller_id : 0;
};

router.put(
  "/:id",
  generalRateLimit,
  validateIdParam,
  requireOwnership(getCarOwnerId),
  validateCarUpdate,
  validatePhilippinesLocation,
  sanitizeHtml,
  CarController.updateCar
);

router.delete(
  "/:id",
  generalRateLimit,
  validateIdParam,
  requireOwnership(getCarOwnerId),
  CarController.deleteCar
);

// Car interactions
router.post(
  "/:id/favorite",
  generalRateLimit,
  validateIdParam,
  CarController.addToFavorites
);

router.delete(
  "/:id/favorite",
  generalRateLimit,
  validateIdParam,
  CarController.removeFromFavorites
);

router.post(
  "/:id/report",
  generalRateLimit,
  validateIdParam,
  validate(
    schemas.report ||
      (() => {
        const Joi = require("joi");
        return Joi.object({
          reason: Joi.string()
            .valid(
              "inappropriate_content",
              "fake_listing",
              "overpriced",
              "spam",
              "stolen_vehicle",
              "misleading_info",
              "other"
            )
            .required(),
          details: Joi.string().max(1000).optional(),
        });
      })()
  ),
  sanitizeHtml,
  CarController.reportCar
);

// Premium features (requires seller account)
router.post(
  "/:id/boost",
  generalRateLimit,
  canCreateListings,
  validateIdParam,
  requireOwnership(getCarOwnerId),
  CarController.boostCar
);

// Car images and media (would need separate controller)
// router.post('/:id/images',
//   uploadRateLimit,
//   validateIdParam,
//   requireOwnership(getCarOwnerId),
//   // multer middleware for file upload
//   CarImageController.uploadImages
// );

// router.delete('/:id/images/:imageId',
//   generalRateLimit,
//   validateIdParam,
//   requireOwnership(getCarOwnerId),
//   CarImageController.deleteImage
// );

// Car features management
// router.post('/:id/features',
//   generalRateLimit,
//   validateIdParam,
//   requireOwnership(getCarOwnerId),
//   validate(schemas.carFeatures || (() => {
//     const Joi = require('joi');
//     return Joi.object({
//       feature_ids: Joi.array().items(Joi.number().integer().positive()).min(1).required()
//     });
//   })()),
//   CarController.addFeatures
// );

// router.delete('/:id/features/:featureId',
//   generalRateLimit,
//   validateIdParam,
//   requireOwnership(getCarOwnerId),
//   CarController.removeFeature
// );

export default router;

// src/services/location/SpatialService.ts
import { DatabaseManager } from "../../config/database";
import redis from "../../config/redis";
import logger from "../../utils/logger";
import { Car, CarFilters } from "../../types";

interface LocationPoint {
  lat: number;
  lng: number;
}

interface NearbySearchOptions {
  radius: number; // in kilometers
  limit?: number;
  filters?: CarFilters;
  sort_by?: "distance" | "price" | "newest" | "rating";
}

export class SpatialService {
  private static instance: SpatialService;
  private db: DatabaseManager;

  private constructor() {
    this.db = DatabaseManager.getInstance();
  }

  public static getInstance(): SpatialService {
    if (!SpatialService.instance) {
      SpatialService.instance = new SpatialService();
    }
    return SpatialService.instance;
  }

  /**
   * Find nearby cars using spatial indexing
   */
  async findNearbyCars(
    lat: number,
    lng: number,
    options: NearbySearchOptions
  ): Promise<Car[]> {
    try {
      // Check cache first
      const cacheKey = `nearby:${lat}:${lng}:${options.radius}:${JSON.stringify(
        options.filters
      )}`;
      const cached = await redis.get(cacheKey);

      if (cached) {
        return JSON.parse(cached);
      }

      // Build spatial query with proper indexes
      const spatialQuery = `
        SELECT 
          c.*,
          b.name as brand_name,
          m.name as model_name,
          ct.name as city_name,
          pr.name as province_name,
          u.first_name as seller_name,
          u.average_rating as seller_rating,
          u.is_verified as seller_verified,
          ST_Distance_Sphere(c.location_point, ST_SRID(POINT(?, ?), 4326)) / 1000 AS distance_km
        FROM cars c
        USE INDEX (idx_cars_location_spatial)
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        INNER JOIN ph_cities ct ON c.city_id = ct.id
        INNER JOIN ph_provinces pr ON ct.province_id = pr.id
        INNER JOIN users u ON c.seller_id = u.id
        WHERE c.approval_status = 'approved'
          AND c.status = 'active'
          AND c.is_active = TRUE
          AND ST_Distance_Sphere(c.location_point, ST_SRID(POINT(?, ?), 4326)) <= ?
          ${this.buildFilterConditions(options.filters)}
        ORDER BY 
          ${this.buildSortCondition(options.sort_by)}
        LIMIT ?
      `;

      const params = [
        lng,
        lat, // First POINT for distance calculation
        lng,
        lat, // Second POINT for WHERE condition
        options.radius * 1000, // Convert km to meters
        ...this.buildFilterParams(options.filters),
        options.limit || 50,
      ];

      const results = await this.db.execute(spatialQuery, params);

      // Cache for location-based TTL
      const ttl = this.calculateLocationCacheTTL(options.radius);
      await redis.setex(cacheKey, ttl, JSON.stringify(results));

      logger.info(
        `Found ${results.length} cars within ${options.radius}km of (${lat}, ${lng})`
      );
      return results;
    } catch (error) {
      logger.error("Error finding nearby cars:", error);
      throw error;
    }
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  calculateDistance(point1: LocationPoint, point2: LocationPoint): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(point2.lat - point1.lat);
    const dLon = this.toRad(point2.lng - point1.lng);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(point1.lat)) *
        Math.cos(this.toRad(point2.lat)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Validate Philippines coordinates
   */
  validatePhilippinesCoordinates(lat: number, lng: number): boolean {
    const PH_BOUNDS = {
      north: 21.0,
      south: 4.0,
      east: 127.0,
      west: 116.0,
    };

    return (
      lat >= PH_BOUNDS.south &&
      lat <= PH_BOUNDS.north &&
      lng >= PH_BOUNDS.west &&
      lng <= PH_BOUNDS.east
    );
  }

  /**
   * Get nearest city to coordinates
   */
  async getNearestCity(lat: number, lng: number): Promise<any> {
    try {
      const query = `
        SELECT 
          id, name, province_id,
          ST_Distance_Sphere(location_point, ST_SRID(POINT(?, ?), 4326)) / 1000 as distance_km
        FROM ph_cities
        WHERE is_active = TRUE
        ORDER BY distance_km ASC
        LIMIT 1
      `;

      const results = await this.db.execute(query, [lng, lat]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      logger.error("Error finding nearest city:", error);
      return null;
    }
  }

  /**
   * Geocode address within Philippines
   */
  async geocodeAddress(
    address: string,
    cityId?: number
  ): Promise<LocationPoint | null> {
    try {
      // This would integrate with Google Maps API or similar
      // For now, return mock implementation
      logger.info(`Geocoding address: ${address} in city ${cityId}`);

      // In real implementation, call external geocoding service
      // const geocoded = await GoogleMapsService.geocode(address);

      return null; // Placeholder
    } catch (error) {
      logger.error("Error geocoding address:", error);
      return null;
    }
  }

  /**
   * Reverse geocode coordinates to address
   */
  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    try {
      // This would integrate with Google Maps API or similar
      logger.info(`Reverse geocoding: ${lat}, ${lng}`);

      // In real implementation, call external reverse geocoding service
      // const address = await GoogleMapsService.reverseGeocode(lat, lng);

      return null; // Placeholder
    } catch (error) {
      logger.error("Error reverse geocoding:", error);
      return null;
    }
  }

  // Private helper methods
  private toRad(value: number): number {
    return (value * Math.PI) / 180;
  }

  private buildFilterConditions(filters?: CarFilters): string {
    if (!filters) return "";

    const conditions: string[] = [];

    if (filters.brand_id) conditions.push("AND c.brand_id = ?");
    if (filters.min_price) conditions.push("AND c.price >= ?");
    if (filters.max_price) conditions.push("AND c.price <= ?");
    if (filters.min_year) conditions.push("AND c.year >= ?");
    if (filters.max_year) conditions.push("AND c.year <= ?");
    if (filters.fuel_type?.length) {
      conditions.push(
        `AND c.fuel_type IN (${filters.fuel_type.map(() => "?").join(",")})`
      );
    }

    return conditions.join(" ");
  }

  private buildFilterParams(filters?: CarFilters): any[] {
    if (!filters) return [];

    const params: any[] = [];

    if (filters.brand_id) params.push(filters.brand_id);
    if (filters.min_price) params.push(filters.min_price);
    if (filters.max_price) params.push(filters.max_price);
    if (filters.min_year) params.push(filters.min_year);
    if (filters.max_year) params.push(filters.max_year);
    if (filters.fuel_type?.length) params.push(...filters.fuel_type);

    return params;
  }

  private buildSortCondition(sortBy?: string): string {
    switch (sortBy) {
      case "distance":
        return "distance_km ASC";
      case "price":
        return "c.price ASC";
      case "newest":
        return "c.created_at DESC";
      case "rating":
        return "c.average_rating DESC";
      default:
        return "distance_km ASC, c.is_featured DESC, c.quality_score DESC";
    }
  }

  private calculateLocationCacheTTL(radius: number): number {
    // Smaller radius = more specific = longer cache
    if (radius <= 5) return 1800; // 30 minutes
    if (radius <= 15) return 900; // 15 minutes
    return 300; // 5 minutes for large radius
  }
}

import { RowDataPacket } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface Region {
  id: number;
  region_code: string;
  name: string;
  long_name?: string;
  is_active: boolean;
}

export interface Province {
  id: number;
  region_id: number;
  province_code: string;
  name: string;
  capital?: string;
  is_active: boolean;
  region_name?: string;
}

export interface City {
  id: number;
  province_id: number;
  city_code?: string;
  name: string;
  city_type: "city" | "municipality" | "district";
  is_highly_urbanized: boolean;
  latitude: number;
  longitude: number;
  postal_codes?: string[];
  is_active: boolean;
  province_name?: string;
  region_name?: string;
  region_id?: number;
}

export interface LocationHierarchy {
  region: Region;
  province: Province;
  city: City;
}

export interface NearbyLocation {
  city: City;
  distance: number; // in kilometers
}

export class LocationModel {
  // Region methods
  static async getAllRegions(): Promise<Region[]> {
    try {
      const regions = await QueryBuilder.select()
        .from("ph_regions")
        .where("is_active = ?", true)
        .orderBy("name", "ASC")
        .execute();

      return regions;
    } catch (error) {
      logger.error("Error getting all regions:", error);
      return [];
    }
  }

  static async getRegionById(id: number): Promise<Region | null> {
    try {
      const regions = await QueryBuilder.select()
        .from("ph_regions")
        .where("id = ?", id)
        .where("is_active = ?", true)
        .execute();

      return regions.length > 0 ? regions[0] : null;
    } catch (error) {
      logger.error(`Error getting region by ID ${id}:`, error);
      return null;
    }
  }

  static async getRegionByCode(regionCode: string): Promise<Region | null> {
    try {
      const regions = await QueryBuilder.select()
        .from("ph_regions")
        .where("region_code = ?", regionCode)
        .where("is_active = ?", true)
        .execute();

      return regions.length > 0 ? regions[0] : null;
    } catch (error) {
      logger.error(`Error getting region by code ${regionCode}:`, error);
      return null;
    }
  }

  // Province methods
  static async getProvincesByRegion(regionId: number): Promise<Province[]> {
    try {
      const query = `
        SELECT 
          p.*,
          r.name as region_name
        FROM ph_provinces p
        INNER JOIN ph_regions r ON p.region_id = r.id
        WHERE p.region_id = ? AND p.is_active = TRUE
        ORDER BY p.name ASC
      `;

      const provinces = await database.execute(query, [regionId]);
      return provinces;
    } catch (error) {
      logger.error(`Error getting provinces for region ${regionId}:`, error);
      return [];
    }
  }

  static async getProvinceById(id: number): Promise<Province | null> {
    try {
      const query = `
        SELECT 
          p.*,
          r.name as region_name
        FROM ph_provinces p
        INNER JOIN ph_regions r ON p.region_id = r.id
        WHERE p.id = ? AND p.is_active = TRUE
      `;

      const provinces = await database.execute(query, [id]);
      return provinces.length > 0 ? provinces[0] : null;
    } catch (error) {
      logger.error(`Error getting province by ID ${id}:`, error);
      return null;
    }
  }

  static async getProvinceByCode(
    provinceCode: string
  ): Promise<Province | null> {
    try {
      const query = `
        SELECT 
          p.*,
          r.name as region_name
        FROM ph_provinces p
        INNER JOIN ph_regions r ON p.region_id = r.id
        WHERE p.province_code = ? AND p.is_active = TRUE
      `;

      const provinces = await database.execute(query, [provinceCode]);
      return provinces.length > 0 ? provinces[0] : null;
    } catch (error) {
      logger.error(`Error getting province by code ${provinceCode}:`, error);
      return null;
    }
  }

  static async getAllProvinces(): Promise<Province[]> {
    try {
      const query = `
        SELECT 
          p.*,
          r.name as region_name
        FROM ph_provinces p
        INNER JOIN ph_regions r ON p.region_id = r.id
        WHERE p.is_active = TRUE
        ORDER BY r.name ASC, p.name ASC
      `;

      const provinces = await database.execute(query);
      return provinces;
    } catch (error) {
      logger.error("Error getting all provinces:", error);
      return [];
    }
  }

  // City methods
  static async getCitiesByProvince(provinceId: number): Promise<City[]> {
    try {
      const query = `
        SELECT 
          c.*,
          p.name as province_name,
          r.name as region_name,
          r.id as region_id
        FROM ph_cities c
        INNER JOIN ph_provinces p ON c.province_id = p.id
        INNER JOIN ph_regions r ON p.region_id = r.id
        WHERE c.province_id = ? AND c.is_active = TRUE
        ORDER BY c.is_highly_urbanized DESC, c.name ASC
      `;

      const cities = await database.execute(query, [provinceId]);
      return cities.map((city) => ({
        ...city,
        postal_codes: city.postal_codes
          ? JSON.parse(city.postal_codes)
          : undefined,
      }));
    } catch (error) {
      logger.error(`Error getting cities for province ${provinceId}:`, error);
      return [];
    }
  }

  static async getCityById(id: number): Promise<City | null> {
    try {
      const query = `
        SELECT 
          c.*,
          p.name as province_name,
          r.name as region_name,
          r.id as region_id
        FROM ph_cities c
        INNER JOIN ph_provinces p ON c.province_id = p.id
        INNER JOIN ph_regions r ON p.region_id = r.id
        WHERE c.id = ? AND c.is_active = TRUE
      `;

      const cities = await database.execute(query, [id]);

      if (cities.length === 0) {
        return null;
      }

      const city = cities[0];
      return {
        ...city,
        postal_codes: city.postal_codes
          ? JSON.parse(city.postal_codes)
          : undefined,
      };
    } catch (error) {
      logger.error(`Error getting city by ID ${id}:`, error);
      return null;
    }
  }

  static async getCityByName(
    name: string,
    provinceId?: number
  ): Promise<City | null> {
    try {
      let query = `
        SELECT 
          c.*,
          p.name as province_name,
          r.name as region_name,
          r.id as region_id
        FROM ph_cities c
        INNER JOIN ph_provinces p ON c.province_id = p.id
        INNER JOIN ph_regions r ON p.region_id = r.id
        WHERE c.name = ? AND c.is_active = TRUE
      `;

      const params = [name];

      if (provinceId) {
        query += " AND c.province_id = ?";
        params.push(provinceId);
      }

      const cities = await database.execute(query, params);

      if (cities.length === 0) {
        return null;
      }

      const city = cities[0];
      return {
        ...city,
        postal_codes: city.postal_codes
          ? JSON.parse(city.postal_codes)
          : undefined,
      };
    } catch (error) {
      logger.error(`Error getting city by name ${name}:`, error);
      return null;
    }
  }

  static async getPopularCities(limit: number = 20): Promise<City[]> {
    try {
      const query = `
        SELECT 
          c.*,
          p.name as province_name,
          r.name as region_name,
          r.id as region_id,
          COUNT(cars.id) as car_count
        FROM ph_cities c
        INNER JOIN ph_provinces p ON c.province_id = p.id
        INNER JOIN ph_regions r ON p.region_id = r.id
        LEFT JOIN cars ON c.id = cars.city_id AND cars.is_active = TRUE
        WHERE c.is_active = TRUE
        GROUP BY c.id
        ORDER BY c.is_highly_urbanized DESC, car_count DESC, c.name ASC
        LIMIT ?
      `;

      const cities = await database.execute(query, [limit]);
      return cities.map((city) => ({
        ...city,
        postal_codes: city.postal_codes
          ? JSON.parse(city.postal_codes)
          : undefined,
      }));
    } catch (error) {
      logger.error("Error getting popular cities:", error);
      return [];
    }
  }

  // Location hierarchy methods
  static async getLocationHierarchy(
    cityId: number
  ): Promise<LocationHierarchy | null> {
    try {
      const query = `
        SELECT 
          c.*,
          p.id as province_id, p.region_id, p.province_code, p.name as province_name, p.capital,
          r.id as region_id, r.region_code, r.name as region_name, r.long_name as region_long_name
        FROM ph_cities c
        INNER JOIN ph_provinces p ON c.province_id = p.id
        INNER JOIN ph_regions r ON p.region_id = r.id
        WHERE c.id = ? AND c.is_active = TRUE
      `;

      const result = await database.execute(query, [cityId]);

      if (result.length === 0) {
        return null;
      }

      const row = result[0];

      return {
        region: {
          id: row.region_id,
          region_code: row.region_code,
          name: row.region_name,
          long_name: row.region_long_name,
          is_active: true,
        },
        province: {
          id: row.province_id,
          region_id: row.region_id,
          province_code: row.province_code,
          name: row.province_name,
          capital: row.capital,
          is_active: true,
          region_name: row.region_name,
        },
        city: {
          id: row.id,
          province_id: row.province_id,
          city_code: row.city_code,
          name: row.name,
          city_type: row.city_type,
          is_highly_urbanized: row.is_highly_urbanized,
          latitude: row.latitude,
          longitude: row.longitude,
          postal_codes: row.postal_codes
            ? JSON.parse(row.postal_codes)
            : undefined,
          is_active: row.is_active,
          province_name: row.province_name,
          region_name: row.region_name,
          region_id: row.region_id,
        },
      };
    } catch (error) {
      logger.error(
        `Error getting location hierarchy for city ${cityId}:`,
        error
      );
      return null;
    }
  }

  // Spatial/geographic methods
  static async getNearByCities(
    latitude: number,
    longitude: number,
    radiusKm: number = 50,
    limit: number = 20
  ): Promise<NearbyLocation[]> {
    try {
      const query = `
        SELECT 
          c.*,
          p.name as province_name,
          r.name as region_name,
          r.id as region_id,
          ST_Distance_Sphere(
            ST_SRID(POINT(c.longitude, c.latitude), 4326),
            ST_SRID(POINT(?, ?), 4326)
          ) / 1000 as distance
        FROM ph_cities c
        INNER JOIN ph_provinces p ON c.province_id = p.id
        INNER JOIN ph_regions r ON p.region_id = r.id
        WHERE c.is_active = TRUE
        AND ST_Distance_Sphere(
          ST_SRID(POINT(c.longitude, c.latitude), 4326),
          ST_SRID(POINT(?, ?), 4326)
        ) <= ?
        ORDER BY distance ASC
        LIMIT ?
      `;

      const cities = await database.execute(query, [
        longitude,
        latitude,
        longitude,
        latitude,
        radiusKm * 1000,
        limit,
      ]);

      return cities.map((city) => ({
        city: {
          ...city,
          postal_codes: city.postal_codes
            ? JSON.parse(city.postal_codes)
            : undefined,
        },
        distance: Math.round(city.distance * 100) / 100, // Round to 2 decimal places
      }));
    } catch (error) {
      logger.error("Error getting nearby cities:", error);
      return [];
    }
  }

  static async getCitiesInRadius(
    centerCityId: number,
    radiusKm: number = 50,
    limit: number = 50
  ): Promise<NearbyLocation[]> {
    try {
      // First get the center city coordinates
      const centerCity = await this.getCityById(centerCityId);
      if (!centerCity) {
        return [];
      }

      return await this.getNearByCities(
        centerCity.latitude,
        centerCity.longitude,
        radiusKm,
        limit
      );
    } catch (error) {
      logger.error(
        `Error getting cities in radius for city ${centerCityId}:`,
        error
      );
      return [];
    }
  }

  // Geocoding methods
  static async geocodeAddress(
    address: string,
    cityId?: number
  ): Promise<{
    latitude: number;
    longitude: number;
    formatted_address: string;
  } | null> {
    try {
      // This is a placeholder for geocoding implementation
      // In a real implementation, you would integrate with Google Maps API or similar service

      if (cityId) {
        const city = await this.getCityById(cityId);
        if (city) {
          return {
            latitude: city.latitude,
            longitude: city.longitude,
            formatted_address: `${address}, ${city.name}, ${city.province_name}, Philippines`,
          };
        }
      }

      return null;
    } catch (error) {
      logger.error("Error geocoding address:", error);
      return null;
    }
  }

  static async reverseGeocode(
    latitude: number,
    longitude: number
  ): Promise<{
    city: City | null;
    formatted_address: string;
  }> {
    try {
      // Find the nearest city
      const nearestCities = await this.getNearByCities(
        latitude,
        longitude,
        50,
        1
      );

      if (nearestCities.length === 0) {
        return {
          city: null,
          formatted_address: `${latitude}, ${longitude}, Philippines`,
        };
      }

      const nearestCity = nearestCities[0].city;
      return {
        city: nearestCity,
        formatted_address: `${nearestCity.name}, ${nearestCity.province_name}, Philippines`,
      };
    } catch (error) {
      logger.error("Error reverse geocoding:", error);
      return {
        city: null,
        formatted_address: `${latitude}, ${longitude}, Philippines`,
      };
    }
  }

  // Search methods
  static async searchLocations(
    query: string,
    limit: number = 10
  ): Promise<{
    regions: Region[];
    provinces: Province[];
    cities: City[];
  }> {
    try {
      const searchTerm = `%${query}%`;

      // Search regions
      const regions = await QueryBuilder.select()
        .from("ph_regions")
        .where("is_active = ?", true)
        .where("(name LIKE ? OR long_name LIKE ?)", searchTerm, searchTerm)
        .orderBy("name", "ASC")
        .limit(limit)
        .execute();

      // Search provinces
      const provincesQuery = `
        SELECT 
          p.*,
          r.name as region_name
        FROM ph_provinces p
        INNER JOIN ph_regions r ON p.region_id = r.id
        WHERE p.is_active = TRUE AND p.name LIKE ?
        ORDER BY p.name ASC
        LIMIT ?
      `;
      const provinces = await database.execute(provincesQuery, [
        searchTerm,
        limit,
      ]);

      // Search cities
      const citiesQuery = `
        SELECT 
          c.*,
          p.name as province_name,
          r.name as region_name,
          r.id as region_id
        FROM ph_cities c
        INNER JOIN ph_provinces p ON c.province_id = p.id
        INNER JOIN ph_regions r ON p.region_id = r.id
        WHERE c.is_active = TRUE AND c.name LIKE ?
        ORDER BY c.is_highly_urbanized DESC, c.name ASC
        LIMIT ?
      `;
      const cities = await database.execute(citiesQuery, [searchTerm, limit]);

      return {
        regions,
        provinces,
        cities: cities.map((city) => ({
          ...city,
          postal_codes: city.postal_codes
            ? JSON.parse(city.postal_codes)
            : undefined,
        })),
      };
    } catch (error) {
      logger.error("Error searching locations:", error);
      return {
        regions: [],
        provinces: [],
        cities: [],
      };
    }
  }

  // Validation methods
  static async validatePhilippinesCoordinates(
    latitude: number,
    longitude: number
  ): Promise<boolean> {
    // Philippines bounding box (approximate)
    const bounds = {
      north: 21.0,
      south: 4.0,
      east: 127.0,
      west: 116.0,
    };

    return (
      latitude >= bounds.south &&
      latitude <= bounds.north &&
      longitude >= bounds.west &&
      longitude <= bounds.east
    );
  }

  static async validateLocationHierarchy(
    cityId: number,
    provinceId: number,
    regionId: number
  ): Promise<boolean> {
    try {
      const hierarchy = await this.getLocationHierarchy(cityId);

      if (!hierarchy) {
        return false;
      }

      return (
        hierarchy.city.province_id === provinceId &&
        hierarchy.province.region_id === regionId
      );
    } catch (error) {
      logger.error("Error validating location hierarchy:", error);
      return false;
    }
  }

  // Statistics methods
  static async getLocationStats(): Promise<{
    total_regions: number;
    total_provinces: number;
    total_cities: number;
    highly_urbanized_cities: number;
  }> {
    try {
      const stats = await database.execute(`
        SELECT 
          (SELECT COUNT(*) FROM ph_regions WHERE is_active = TRUE) as total_regions,
          (SELECT COUNT(*) FROM ph_provinces WHERE is_active = TRUE) as total_provinces,
          (SELECT COUNT(*) FROM ph_cities WHERE is_active = TRUE) as total_cities,
          (SELECT COUNT(*) FROM ph_cities WHERE is_active = TRUE AND is_highly_urbanized = TRUE) as highly_urbanized_cities
      `);

      return stats[0];
    } catch (error) {
      logger.error("Error getting location stats:", error);
      return {
        total_regions: 0,
        total_provinces: 0,
        total_cities: 0,
        highly_urbanized_cities: 0,
      };
    }
  }

  // Get cities with most car listings
  static async getCitiesWithMostListings(
    limit: number = 10
  ): Promise<Array<City & { listing_count: number }>> {
    try {
      const query = `
        SELECT 
          c.*,
          p.name as province_name,
          r.name as region_name,
          r.id as region_id,
          COUNT(cars.id) as listing_count
        FROM ph_cities c
        INNER JOIN ph_provinces p ON c.province_id = p.id
        INNER JOIN ph_regions r ON p.region_id = r.id
        LEFT JOIN cars ON c.id = cars.city_id 
          AND cars.is_active = TRUE 
          AND cars.status = 'approved'
        WHERE c.is_active = TRUE
        GROUP BY c.id
        HAVING listing_count > 0
        ORDER BY listing_count DESC, c.name ASC
        LIMIT ?
      `;

      const cities = await database.execute(query, [limit]);
      return cities.map((city) => ({
        ...city,
        postal_codes: city.postal_codes
          ? JSON.parse(city.postal_codes)
          : undefined,
      }));
    } catch (error) {
      logger.error("Error getting cities with most listings:", error);
      return [];
    }
  }
}

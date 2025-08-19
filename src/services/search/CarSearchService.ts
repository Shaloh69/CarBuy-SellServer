import database, { QueryBuilder } from "../../config/database";
import { carCache } from "../cache/CacheManager";
import { LocationModel } from "../../models/Location";
import logger, { performance } from "../../utils/logger";
import crypto from "crypto";

export interface SmartSearchFilters {
  // Text search
  query?: string;

  // Vehicle specifications
  brand_id?: number;
  model_id?: number;
  category_id?: number;
  min_year?: number;
  max_year?: number;
  min_price?: number;
  max_price?: number;
  max_mileage?: number;
  fuel_type?: string[];
  transmission?: string[];
  condition_rating?: string[];
  drivetrain?: string;

  // Location-based
  city_id?: number;
  province_id?: number;
  region_id?: number;
  latitude?: number;
  longitude?: number;
  radius?: number; // in kilometers

  // Features and preferences
  features?: number[];
  colors?: number[];
  seller_verified?: boolean;
  financing_available?: boolean;
  trade_in_accepted?: boolean;
  warranty_remaining?: boolean;
  casa_maintained?: boolean;
  accident_free?: boolean;
  flood_free?: boolean;

  // Quality and rating filters
  min_seller_rating?: number;
  min_quality_score?: number;
  verified_sellers_only?: boolean;

  // Date filters
  posted_after?: Date;
  posted_before?: Date;
}

export interface SearchOptions {
  sort_by?:
    | "relevance"
    | "price_asc"
    | "price_desc"
    | "year_desc"
    | "year_asc"
    | "mileage_asc"
    | "distance"
    | "newest"
    | "oldest"
    | "popular";
  page?: number;
  limit?: number;
  include_images?: boolean;
  include_features?: boolean;
  include_seller_info?: boolean;
  user_id?: number; // for personalization
}

export interface SearchResults {
  cars: CarSearchResult[];
  total: number;
  page: number;
  totalPages: number;
  facets?: SearchFacets;
  search_metadata: {
    query_time: number;
    cache_hit: boolean;
    personalized: boolean;
    total_matches: number;
  };
}

export interface CarSearchResult {
  id: number;
  title: string;
  brand_name: string;
  model_name: string;
  year: number;
  price: number;
  currency: string;
  mileage: number;
  fuel_type: string;
  transmission: string;
  condition_rating: string;
  city_name: string;
  province_name: string;
  seller_name: string;
  seller_rating: number;
  seller_verified: boolean;
  images: string[];
  features: string[];
  distance?: number;
  relevance_score: number;
  quality_score: number;
  is_featured: boolean;
  created_at: Date;
  boost_count: number;
}

export interface SearchFacets {
  brands: Array<{ id: number; name: string; count: number }>;
  price_ranges: Array<{ min: number; max: number; count: number }>;
  years: Array<{ year: number; count: number }>;
  fuel_types: Array<{ type: string; count: number }>;
  transmissions: Array<{ type: string; count: number }>;
  conditions: Array<{ condition: string; count: number }>;
  locations: Array<{ city_id: number; city_name: string; count: number }>;
}

export class CarSearchService {
  // Main smart search method
  static async smartSearch(
    filters: SmartSearchFilters,
    options: SearchOptions = {}
  ): Promise<SearchResults> {
    const startTime = performance.start("smart_search");

    try {
      const {
        sort_by = "relevance",
        page = 1,
        limit = 20,
        include_images = true,
        include_features = false,
        include_seller_info = true,
        user_id,
      } = options;

      // Generate cache key from filters and options
      const cacheKey = this.generateSearchCacheKey(filters, options);

      // Check Redis cache first
      let results = await carCache.getSearchResults(cacheKey);
      let cacheHit = false;

      if (results) {
        cacheHit = true;
        // Track search for analytics
        await this.trackSearch(filters, user_id, "cache_hit");

        performance.end("smart_search");
        return {
          ...results,
          search_metadata: {
            ...results.search_metadata,
            query_time: performance.end("smart_search"),
            cache_hit: true,
          },
        };
      }

      // Build optimized MySQL query
      const query = this.buildSearchQuery(filters, options);

      // Execute with proper indexes
      const cars = await database.execute(query.sql, query.params);

      // Apply ML-based ranking
      const rankedCars = await this.applyRankingAlgorithm(
        cars,
        filters,
        user_id
      );

      // Apply pagination
      const paginatedCars = this.paginateResults(rankedCars, page, limit);

      // Enhance with additional data
      const enhancedCars = await this.enhanceSearchResults(
        paginatedCars.cars,
        include_images,
        include_features,
        include_seller_info
      );

      // Generate facets for filtering
      const facets = await this.generateSearchFacets(filters, cars);

      // Build final results
      const searchResults: SearchResults = {
        cars: enhancedCars,
        total: rankedCars.length,
        page,
        totalPages: Math.ceil(rankedCars.length / limit),
        facets,
        search_metadata: {
          query_time: performance.end("smart_search"),
          cache_hit: false,
          personalized: !!user_id,
          total_matches: rankedCars.length,
        },
      };

      // Cache results with TTL based on specificity
      const ttl = this.calculateCacheTTL(filters);
      await carCache.setSearchResults(cacheKey, searchResults);

      // Track search for analytics
      await this.trackSearch(filters, user_id, "database_hit");

      return searchResults;
    } catch (error) {
      logger.error("Smart search error:", error);
      performance.end("smart_search");
      throw error;
    }
  }

  // Build optimized search query
  private static buildSearchQuery(
    filters: SmartSearchFilters,
    options: SearchOptions
  ): { sql: string; params: any[] } {
    const params: any[] = [];
    let sql = `
      SELECT DISTINCT
        c.*,
        b.name as brand_name,
        m.name as model_name,
        cat.name as category_name,
        city.name as city_name,
        prov.name as province_name,
        reg.name as region_name,
        CONCAT(u.first_name, ' ', u.last_name) as seller_name,
        u.average_rating as seller_rating,
        u.identity_verified as seller_verified,
        ec.name as exterior_color_name,
        ic.name as interior_color_name
    `;

    // Add distance calculation for location-based search
    if (filters.latitude && filters.longitude) {
      sql += `,
        ST_Distance_Sphere(
          c.location_point,
          ST_SRID(POINT(?, ?), 4326)
        ) / 1000 as distance
      `;
      params.push(filters.longitude, filters.latitude);
    }

    sql += `
      FROM cars c
      INNER JOIN brands b ON c.brand_id = b.id
      INNER JOIN models m ON c.model_id = m.id
      LEFT JOIN categories cat ON c.category_id = cat.id
      INNER JOIN ph_cities city ON c.city_id = city.id
      INNER JOIN ph_provinces prov ON c.province_id = prov.id
      INNER JOIN ph_regions reg ON c.region_id = reg.id
      INNER JOIN users u ON c.seller_id = u.id
      LEFT JOIN standard_colors ec ON c.exterior_color_id = ec.id
      LEFT JOIN standard_colors ic ON c.interior_color_id = ic.id
    `;

    // Add feature joins if needed
    if (filters.features && filters.features.length > 0) {
      sql += `
        INNER JOIN car_features cf ON c.id = cf.car_id
        INNER JOIN features f ON cf.feature_id = f.id
      `;
    }

    // Build WHERE conditions
    const conditions: string[] = [
      "c.is_active = TRUE",
      'c.status = "approved"',
      'c.approval_status = "approved"',
    ];

    // Text search with full-text index
    if (filters.query) {
      conditions.push(`
        (MATCH(c.title, c.description, c.keywords) AGAINST(? IN NATURAL LANGUAGE MODE)
         OR b.name LIKE ?
         OR m.name LIKE ?)
      `);
      params.push(filters.query, `%${filters.query}%`, `%${filters.query}%`);
    }

    // Vehicle specification filters
    if (filters.brand_id) {
      conditions.push("c.brand_id = ?");
      params.push(filters.brand_id);
    }

    if (filters.model_id) {
      conditions.push("c.model_id = ?");
      params.push(filters.model_id);
    }

    if (filters.category_id) {
      conditions.push("c.category_id = ?");
      params.push(filters.category_id);
    }

    if (filters.min_year) {
      conditions.push("c.year >= ?");
      params.push(filters.min_year);
    }

    if (filters.max_year) {
      conditions.push("c.year <= ?");
      params.push(filters.max_year);
    }

    if (filters.min_price) {
      conditions.push("c.price >= ?");
      params.push(filters.min_price);
    }

    if (filters.max_price) {
      conditions.push("c.price <= ?");
      params.push(filters.max_price);
    }

    if (filters.max_mileage) {
      conditions.push("c.mileage <= ?");
      params.push(filters.max_mileage);
    }

    if (filters.fuel_type && filters.fuel_type.length > 0) {
      conditions.push(
        `c.fuel_type IN (${filters.fuel_type.map(() => "?").join(", ")})`
      );
      params.push(...filters.fuel_type);
    }

    if (filters.transmission && filters.transmission.length > 0) {
      conditions.push(
        `c.transmission IN (${filters.transmission.map(() => "?").join(", ")})`
      );
      params.push(...filters.transmission);
    }

    if (filters.condition_rating && filters.condition_rating.length > 0) {
      conditions.push(
        `c.condition_rating IN (${filters.condition_rating
          .map(() => "?")
          .join(", ")})`
      );
      params.push(...filters.condition_rating);
    }

    // Location filters
    if (filters.city_id) {
      conditions.push("c.city_id = ?");
      params.push(filters.city_id);
    }

    if (filters.province_id) {
      conditions.push("c.province_id = ?");
      params.push(filters.province_id);
    }

    if (filters.region_id) {
      conditions.push("c.region_id = ?");
      params.push(filters.region_id);
    }

    // Location radius search
    if (filters.latitude && filters.longitude && filters.radius) {
      conditions.push(`
        ST_Distance_Sphere(
          c.location_point,
          ST_SRID(POINT(?, ?), 4326)
        ) <= ?
      `);
      params.push(filters.longitude, filters.latitude, filters.radius * 1000);
    }

    // Feature filters
    if (filters.features && filters.features.length > 0) {
      conditions.push(
        `f.id IN (${filters.features.map(() => "?").join(", ")})`
      );
      params.push(...filters.features);
    }

    // Preference filters
    if (filters.financing_available) {
      conditions.push("c.financing_available = TRUE");
    }

    if (filters.trade_in_accepted) {
      conditions.push("c.trade_in_accepted = TRUE");
    }

    if (filters.warranty_remaining) {
      conditions.push("c.warranty_remaining = TRUE");
    }

    if (filters.casa_maintained) {
      conditions.push("c.casa_maintained = TRUE");
    }

    if (filters.accident_free) {
      conditions.push("c.accident_history = FALSE");
    }

    if (filters.flood_free) {
      conditions.push("c.flood_history = FALSE");
    }

    if (filters.seller_verified) {
      conditions.push("u.identity_verified = TRUE");
    }

    if (filters.min_seller_rating) {
      conditions.push("u.average_rating >= ?");
      params.push(filters.min_seller_rating);
    }

    if (filters.min_quality_score) {
      conditions.push("c.quality_score >= ?");
      params.push(filters.min_quality_score);
    }

    // Date filters
    if (filters.posted_after) {
      conditions.push("c.created_at >= ?");
      params.push(filters.posted_after);
    }

    if (filters.posted_before) {
      conditions.push("c.created_at <= ?");
      params.push(filters.posted_before);
    }

    // Add WHERE clause
    sql += " WHERE " + conditions.join(" AND ");

    // Group by for feature filters
    if (filters.features && filters.features.length > 0) {
      sql += " GROUP BY c.id HAVING COUNT(DISTINCT f.id) = ?";
      params.push(filters.features.length);
    }

    return { sql, params };
  }

  // Apply ML-based ranking algorithm
  private static async applyRankingAlgorithm(
    cars: any[],
    filters: SmartSearchFilters,
    userId?: number
  ): Promise<CarSearchResult[]> {
    return cars
      .map((car) => ({
        ...car,
        relevance_score: this.calculateRelevanceScore(car, filters, userId),
      }))
      .sort((a, b) => b.relevance_score - a.relevance_score);
  }

  // Calculate relevance score for ranking
  private static calculateRelevanceScore(
    car: any,
    filters: SmartSearchFilters,
    userId?: number
  ): number {
    let score = 0;

    // Text relevance (25% weight)
    if (filters.query) {
      const titleMatch = this.calculateTextMatch(car.title, filters.query);
      const brandMatch = this.calculateTextMatch(car.brand_name, filters.query);
      const modelMatch = this.calculateTextMatch(car.model_name, filters.query);
      score += Math.max(titleMatch, brandMatch, modelMatch) * 0.25;
    }

    // Price match (20% weight)
    if (filters.min_price || filters.max_price) {
      const priceScore = this.calculatePriceMatch(
        car.price,
        filters.min_price,
        filters.max_price
      );
      score += priceScore * 0.2;
    }

    // Location proximity (20% weight)
    if (car.distance !== undefined) {
      const locationScore = this.calculateLocationScore(car.distance);
      score += locationScore * 0.2;
    }

    // Car quality & completeness (15% weight)
    score += (car.quality_score / 10) * 0.15;

    // Seller reputation (10% weight)
    score += (car.seller_rating / 5) * 0.1;

    // Car popularity (5% weight)
    score += (Math.log(car.views_count + 1) / 100) * 0.05;

    // Personal preferences (5% weight)
    if (userId) {
      score += this.calculatePersonalizationScore(car, userId) * 0.05;
    }

    // Boost featured listings
    if (car.is_featured) {
      score += 0.1;
    }

    // Boost recently boosted listings
    if (car.boost_count > 0) {
      score += Math.min(car.boost_count * 0.05, 0.2);
    }

    return Math.min(score, 1.0); // Normalize to 0-1
  }

  // Calculate text match score
  private static calculateTextMatch(text: string, query: string): number {
    if (!text || !query) return 0;

    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();

    if (textLower.includes(queryLower)) {
      return queryLower.length / textLower.length;
    }

    return 0;
  }

  // Calculate price match score
  private static calculatePriceMatch(
    price: number,
    minPrice?: number,
    maxPrice?: number
  ): number {
    if (!minPrice && !maxPrice) return 1;

    if (minPrice && maxPrice) {
      if (price >= minPrice && price <= maxPrice) return 1;
      const range = maxPrice - minPrice;
      const deviation = Math.min(
        Math.abs(price - minPrice),
        Math.abs(price - maxPrice)
      );
      return Math.max(0, 1 - deviation / range);
    }

    if (minPrice && price >= minPrice) return 1;
    if (maxPrice && price <= maxPrice) return 1;

    return 0;
  }

  // Calculate location score based on distance
  private static calculateLocationScore(distance: number): number {
    if (distance <= 5) return 1; // Within 5km = perfect score
    if (distance <= 25) return 0.8; // Within 25km = good score
    if (distance <= 100) return 0.5; // Within 100km = okay score
    return Math.max(0.1, 1 - distance / 500); // Diminishing returns
  }

  // Calculate personalization score
  private static calculatePersonalizationScore(
    car: any,
    userId: number
  ): number {
    // This would be enhanced with user behavior analysis
    // For now, return a base score
    return 0.5;
  }

  // Paginate search results
  private static paginateResults(
    cars: CarSearchResult[],
    page: number,
    limit: number
  ): { cars: CarSearchResult[]; total: number } {
    const offset = (page - 1) * limit;
    return {
      cars: cars.slice(offset, offset + limit),
      total: cars.length,
    };
  }

  // Enhance search results with additional data
  private static async enhanceSearchResults(
    cars: any[],
    includeImages: boolean,
    includeFeatures: boolean,
    includeSellerInfo: boolean
  ): Promise<CarSearchResult[]> {
    const enhanced: CarSearchResult[] = [];

    for (const car of cars) {
      let images: string[] = [];
      let features: string[] = [];

      if (includeImages) {
        const imageResults = await database.execute(
          'SELECT image_url FROM car_images WHERE car_id = ? AND processing_status = "ready" ORDER BY is_primary DESC, display_order ASC LIMIT 5',
          [car.id]
        );
        images = imageResults.map((img: any) => img.image_url);
      }

      if (includeFeatures) {
        const featureResults = await database.execute(
          "SELECT f.name FROM car_features cf INNER JOIN features f ON cf.feature_id = f.id WHERE cf.car_id = ?",
          [car.id]
        );
        features = featureResults.map((feat: any) => feat.name);
      }

      enhanced.push({
        id: car.id,
        title: car.title,
        brand_name: car.brand_name,
        model_name: car.model_name,
        year: car.year,
        price: car.price,
        currency: car.currency,
        mileage: car.mileage,
        fuel_type: car.fuel_type,
        transmission: car.transmission,
        condition_rating: car.condition_rating,
        city_name: car.city_name,
        province_name: car.province_name,
        seller_name: car.seller_name,
        seller_rating: car.seller_rating,
        seller_verified: car.seller_verified,
        images,
        features,
        distance: car.distance,
        relevance_score: car.relevance_score,
        quality_score: car.quality_score,
        is_featured: car.is_featured,
        created_at: car.created_at,
        boost_count: car.boost_count,
      });
    }

    return enhanced;
  }

  // Generate search facets for filtering
  private static async generateSearchFacets(
    filters: SmartSearchFilters,
    cars: any[]
  ): Promise<SearchFacets> {
    // This would generate facet counts based on the current search results
    return {
      brands: [],
      price_ranges: [],
      years: [],
      fuel_types: [],
      transmissions: [],
      conditions: [],
      locations: [],
    };
  }

  // Generate cache key for search
  private static generateSearchCacheKey(
    filters: SmartSearchFilters,
    options: SearchOptions
  ): string {
    const keyData = { filters, options };
    return crypto
      .createHash("md5")
      .update(JSON.stringify(keyData))
      .digest("hex");
  }

  // Calculate cache TTL based on search specificity
  private static calculateCacheTTL(filters: SmartSearchFilters): number {
    let ttl = 300; // Base 5 minutes

    // Reduce TTL for more specific searches
    const specificFields = ["brand_id", "model_id", "city_id", "query"];
    const specificityCount = specificFields.filter(
      (field) => filters[field as keyof SmartSearchFilters]
    ).length;

    ttl = Math.max(60, ttl - specificityCount * 60); // Min 1 minute

    return ttl;
  }

  // Track search for analytics
  private static async trackSearch(
    filters: SmartSearchFilters,
    userId?: number,
    resultType: "cache_hit" | "database_hit" = "database_hit"
  ): Promise<void> {
    try {
      // This would be implemented to track search analytics
      logger.debug("Search tracked", {
        userId,
        resultType,
        hasQuery: !!filters.query,
        hasLocation: !!(filters.latitude && filters.longitude),
        filterCount: Object.keys(filters).length,
      });
    } catch (error) {
      logger.error("Error tracking search:", error);
    }
  }

  // Get search suggestions based on popular queries
  static async getSearchSuggestions(
    query: string,
    limit: number = 10
  ): Promise<string[]> {
    try {
      // This would return popular search suggestions based on the query
      // For now, return basic suggestions
      const suggestions: string[] = [];

      if (query.length >= 2) {
        // Get brand suggestions
        const brands = await database.execute(
          "SELECT name FROM brands WHERE name LIKE ? AND is_popular_in_ph = TRUE ORDER BY name LIMIT ?",
          [`%${query}%`, Math.floor(limit / 2)]
        );
        suggestions.push(...brands.map((b: any) => b.name));

        // Get model suggestions
        const models = await database.execute(
          "SELECT DISTINCT m.name FROM models m INNER JOIN brands b ON m.brand_id = b.id WHERE m.name LIKE ? AND b.is_popular_in_ph = TRUE ORDER BY m.name LIMIT ?",
          [`%${query}%`, Math.floor(limit / 2)]
        );
        suggestions.push(...models.map((m: any) => m.name));
      }

      return suggestions.slice(0, limit);
    } catch (error) {
      logger.error("Error getting search suggestions:", error);
      return [];
    }
  }

  // Get trending searches
  static async getTrendingSearches(limit: number = 10): Promise<string[]> {
    try {
      // This would return trending search queries
      // For now, return static popular searches
      return [
        "Toyota Vios",
        "Honda Civic",
        "Mitsubishi Montero",
        "Nissan Navara",
        "Hyundai Accent",
        "Suzuki Swift",
        "Ford EcoSport",
        "Mazda CX-5",
      ].slice(0, limit);
    } catch (error) {
      logger.error("Error getting trending searches:", error);
      return [];
    }
  }
}

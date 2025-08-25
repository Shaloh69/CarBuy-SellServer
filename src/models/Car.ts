import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface Car {
  id: number;
  seller_id: number;
  brand_id: number;
  model_id: number;
  category_id?: number;

  // Basic Info
  title: string;
  description?: string;
  year: number;
  price: number;
  original_price?: number;
  currency: string;
  negotiable: boolean;
  financing_available: boolean;
  trade_in_accepted: boolean;

  // Technical Specifications
  mileage: number;
  fuel_type:
    | "gasoline"
    | "diesel"
    | "hybrid"
    | "electric"
    | "cng"
    | "lpg"
    | "plugin-hybrid";
  transmission: "manual" | "automatic" | "semi-automatic" | "cvt";
  engine_size?: string;
  horsepower?: number;
  drivetrain?: "fwd" | "rwd" | "awd" | "4wd";

  // Colors
  exterior_color_id?: number;
  interior_color_id?: number;
  custom_exterior_color?: string;
  custom_interior_color?: string;

  // Condition & History
  condition_rating: "excellent" | "very_good" | "good" | "fair" | "poor";
  accident_history: boolean;
  accident_details?: string;
  flood_history: boolean;
  service_history: boolean;
  service_records_available: boolean;
  number_of_owners: number;
  warranty_remaining: boolean;
  warranty_details?: string;

  // Vehicle Identification
  vin?: string;
  engine_number?: string;
  chassis_number?: string;
  plate_number?: string;
  registration_expiry?: Date;
  or_cr_available: boolean;

  // Philippines Specific
  lto_registered: boolean;
  casa_maintained: boolean;
  comprehensive_insurance: boolean;
  insurance_company?: string;
  insurance_expiry?: Date;

  // Location
  city_id: number;
  province_id: number;
  region_id: number;
  barangay?: string;
  detailed_address?: string;
  latitude: number;
  longitude: number;

  // Listing Management
  status:
    | "draft"
    | "pending"
    | "approved"
    | "rejected"
    | "sold"
    | "reserved"
    | "removed"
    | "expired"
    | "suspended";
  approval_status: "pending" | "approved" | "rejected" | "needs_revision";
  approved_by?: number;
  approved_at?: Date;
  rejection_reason?: string;
  revision_notes?: string;

  // Premium Features
  is_featured: boolean;
  featured_until?: Date;
  is_premium: boolean;
  premium_until?: Date;
  boost_count: number;
  last_boosted_at?: Date;

  // Performance Metrics
  views_count: number;
  unique_views_count: number;
  contact_count: number;
  favorite_count: number;
  average_rating: number;
  total_ratings: number;

  // Search & SEO
  search_score: number;
  seo_slug?: string;
  meta_title?: string;
  meta_description?: string;
  keywords?: string;

  // Quality Scores
  quality_score: number;
  completeness_score: number;

  // Timestamps
  is_active: boolean;
  expires_at?: Date;
  sold_at?: Date;
  last_price_update?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCarData {
  seller_id: number;
  brand_id: number;
  model_id: number;
  category_id?: number;
  title: string;
  description?: string;
  year: number;
  price: number;
  currency?: string;
  negotiable?: boolean;
  financing_available?: boolean;
  trade_in_accepted?: boolean;
  mileage: number;
  fuel_type: string;
  transmission: string;
  engine_size?: string;
  horsepower?: number;
  drivetrain?: string;
  exterior_color_id?: number;
  interior_color_id?: number;
  custom_exterior_color?: string;
  custom_interior_color?: string;
  condition_rating: string;
  accident_history?: boolean;
  accident_details?: string;
  flood_history?: boolean;
  service_history?: boolean;
  service_records_available?: boolean;
  number_of_owners?: number;
  warranty_remaining?: boolean;
  warranty_details?: string;
  vin?: string;
  engine_number?: string;
  chassis_number?: string;
  plate_number?: string;
  registration_expiry?: Date;
  or_cr_available?: boolean;
  lto_registered?: boolean;
  casa_maintained?: boolean;
  comprehensive_insurance?: boolean;
  insurance_company?: string;
  insurance_expiry?: Date;
  city_id: number;
  province_id: number;
  region_id: number;
  barangay?: string;
  detailed_address?: string;
  latitude?: number;
  longitude?: number;
}

export interface UpdateCarData {
  last_price_update: Date;
  quality_score: number;
  completeness_score: number;
  title?: string;
  description?: string;
  price?: number;
  negotiable?: boolean;
  financing_available?: boolean;
  trade_in_accepted?: boolean;
  mileage?: number;
  fuel_type?: string;
  transmission?: string;
  engine_size?: string;
  horsepower?: number;
  drivetrain?: string;
  exterior_color_id?: number;
  interior_color_id?: number;
  custom_exterior_color?: string;
  custom_interior_color?: string;
  condition_rating?: string;
  accident_history?: boolean;
  accident_details?: string;
  flood_history?: boolean;
  service_history?: boolean;
  service_records_available?: boolean;
  number_of_owners?: number;
  warranty_remaining?: boolean;
  warranty_details?: string;
  plate_number?: string;
  registration_expiry?: Date;
  or_cr_available?: boolean;
  lto_registered?: boolean;
  casa_maintained?: boolean;
  comprehensive_insurance?: boolean;
  insurance_company?: string;
  insurance_expiry?: Date;
  city_id?: number;
  province_id?: number;
  region_id?: number;
  barangay?: string;
  detailed_address?: string;
  latitude?: number;
  longitude?: number;
}

export interface CarWithDetails extends Car {
  brand_name: string;
  model_name: string;
  category_name?: string;
  city_name: string;
  province_name: string;
  region_name: string;
  seller_name: string;
  seller_rating: number;
  seller_verified: boolean;
  exterior_color_name?: string;
  interior_color_name?: string;
  images: CarImage[];
  features: CarFeature[];
  distance?: number; // For location-based searches
}

export interface CarImage {
  id: number;
  car_id: number;
  image_url: string;
  thumbnail_url?: string;
  medium_url?: string;
  large_url?: string;
  alt_text?: string;
  is_primary: boolean;
  display_order: number;
  image_type:
    | "exterior"
    | "interior"
    | "engine"
    | "documents"
    | "damage"
    | "service_records"
    | "other";
  view_angle?:
    | "front"
    | "rear"
    | "side_left"
    | "side_right"
    | "interior_dashboard"
    | "interior_seats"
    | "engine_bay"
    | "document"
    | "other";
  is_360_view: boolean;
  processing_status: "uploading" | "processing" | "ready" | "failed";
  created_at: Date;
}

export interface CarFeature {
  id: number;
  name: string;
  category:
    | "safety"
    | "comfort"
    | "technology"
    | "performance"
    | "exterior"
    | "interior"
    | "entertainment"
    | "convenience";
  is_premium: boolean;
}

export interface CarFilters {
  brand_id?: number;
  model_id?: number;
  category_id?: number;
  min_price?: number;
  max_price?: number;
  min_year?: number;
  max_year?: number;
  max_mileage?: number;
  fuel_type?: string[];
  transmission?: string[];
  condition_rating?: string[];
  city_id?: number;
  province_id?: number;
  region_id?: number;
  latitude?: number;
  longitude?: number;
  radius?: number; // in km
  features?: number[];
  seller_verified?: boolean;
  financing_available?: boolean;
  trade_in_accepted?: boolean;
  warranty_remaining?: boolean;
  casa_maintained?: boolean;
  min_rating?: number;
}

export interface SearchOptions {
  sort_by?:
    | "price_asc"
    | "price_desc"
    | "year_desc"
    | "year_asc"
    | "mileage_asc"
    | "distance"
    | "relevance"
    | "newest"
    | "oldest";
  page?: number;
  limit?: number;
  include_images?: boolean;
  include_features?: boolean;
  include_seller?: boolean;
}

export class CarModel {
  private static tableName = "cars";

  // Create new car listing
  static async create(carData: CreateCarData): Promise<Car> {
    try {
      // Set default values
      const insertData = {
        ...carData,
        currency: carData.currency || "PHP",
        negotiable: carData.negotiable ?? true,
        financing_available: carData.financing_available ?? false,
        trade_in_accepted: carData.trade_in_accepted ?? false,
        accident_history: carData.accident_history ?? false,
        flood_history: carData.flood_history ?? false,
        service_history: carData.service_history ?? true,
        service_records_available: carData.service_records_available ?? false,
        number_of_owners: carData.number_of_owners ?? 1,
        warranty_remaining: carData.warranty_remaining ?? false,
        or_cr_available: carData.or_cr_available ?? true,
        lto_registered: carData.lto_registered ?? true,
        casa_maintained: carData.casa_maintained ?? false,
        comprehensive_insurance: carData.comprehensive_insurance ?? false,
        latitude: carData.latitude ?? 14.5995, // Default to Manila
        longitude: carData.longitude ?? 120.9842,
        original_price: carData.price,
        status: "pending",
        approval_status: "pending",
        is_featured: false,
        is_premium: false,
        boost_count: 0,
        views_count: 0,
        unique_views_count: 0,
        contact_count: 0,
        favorite_count: 0,
        average_rating: 0,
        total_ratings: 0,
        search_score: 0,
        quality_score: 0,
        completeness_score: 0,
        is_active: true,
      };

      // Generate SEO slug
      insertData.seo_slug = await this.generateSeoSlug(carData.title);

      // Calculate initial scores
      insertData.completeness_score =
        this.calculateCompletenessScore(insertData);
      insertData.quality_score = this.calculateQualityScore(insertData);

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const carId = (result as ResultSetHeader).insertId;
      const car = await this.findById(carId);

      if (!car) {
        throw new Error("Failed to create car listing");
      }

      logger.info(
        `Car listing created successfully: ${car.title} (ID: ${carId})`
      );
      return car;
    } catch (error) {
      logger.error("Error creating car listing:", error);
      throw error;
    }
  }

  // Find car by ID
  static async findById(
    id: number,
    includeInactive: boolean = false
  ): Promise<Car | null> {
    try {
      let query = QueryBuilder.select()
        .from(this.tableName)
        .where("id = ?", id);

      if (!includeInactive) {
        query = query.where("is_active = ?", true);
      }

      const cars = await query.execute();
      return cars.length > 0 ? cars[0] : null;
    } catch (error) {
      logger.error(`Error finding car by ID ${id}:`, error);
      return null;
    }
  }

  // Get car with full details
  static async getWithDetails(
    id: number,
    userId?: number
  ): Promise<CarWithDetails | null> {
    try {
      const query = `
        SELECT 
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
        FROM ${this.tableName} c
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        LEFT JOIN categories cat ON c.category_id = cat.id
        INNER JOIN ph_cities city ON c.city_id = city.id
        INNER JOIN ph_provinces prov ON c.province_id = prov.id
        INNER JOIN ph_regions reg ON c.region_id = reg.id
        INNER JOIN users u ON c.seller_id = u.id
        LEFT JOIN standard_colors ec ON c.exterior_color_id = ec.id
        LEFT JOIN standard_colors ic ON c.interior_color_id = ic.id
        WHERE c.id = ? AND c.is_active = TRUE
      `;

      const cars = await database.execute(query, [id]);

      if (cars.length === 0) {
        return null;
      }

      const car = cars[0];

      // Get images
      const images = await this.getCarImages(id);

      // Get features
      const features = await this.getCarFeatures(id);

      // Track view if user is provided
      if (userId) {
        await this.trackView(id, userId);
      }

      return {
        ...car,
        images,
        features,
      };
    } catch (error) {
      logger.error(`Error getting car details for ID ${id}:`, error);
      return null;
    }
  }

  // Search cars with filters
  static async search(
    filters: CarFilters,
    options: SearchOptions = {}
  ): Promise<{
    cars: CarWithDetails[];
    total: number;
    page: number;
    totalPages: number;
    facets?: any;
  }> {
    try {
      const {
        sort_by = "relevance",
        page = 1,
        limit = 20,
        include_images = true,
        include_features = false,
        include_seller = true,
      } = options;

      let baseQuery = `
        SELECT 
          c.*,
          b.name as brand_name,
          m.name as model_name,
          cat.name as category_name,
          city.name as city_name,
          prov.name as province_name,
          reg.name as region_name
      `;

      if (include_seller) {
        baseQuery += `,
          CONCAT(u.first_name, ' ', u.last_name) as seller_name,
          u.average_rating as seller_rating,
          u.identity_verified as seller_verified
        `;
      }

      // Add distance calculation for location-based search
      if (filters.latitude && filters.longitude) {
        baseQuery += `,
          ST_Distance_Sphere(
            c.location_point,
            ST_SRID(POINT(${filters.longitude}, ${filters.latitude}), 4326)
          ) / 1000 as distance
        `;
      }

      baseQuery += `
        FROM ${this.tableName} c
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        LEFT JOIN categories cat ON c.category_id = cat.id
        INNER JOIN ph_cities city ON c.city_id = city.id
        INNER JOIN ph_provinces prov ON c.province_id = prov.id
        INNER JOIN ph_regions reg ON c.region_id = reg.id
      `;

      if (include_seller) {
        baseQuery += " INNER JOIN users u ON c.seller_id = u.id";
      }

      // Build WHERE conditions
      const conditions: string[] = [
        "c.is_active = TRUE",
        'c.status = "approved"',
        'c.approval_status = "approved"',
      ];
      const params: any[] = [];

      // Apply filters
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

      if (filters.min_price) {
        conditions.push("c.price >= ?");
        params.push(filters.min_price);
      }

      if (filters.max_price) {
        conditions.push("c.price <= ?");
        params.push(filters.max_price);
      }

      if (filters.min_year) {
        conditions.push("c.year >= ?");
        params.push(filters.min_year);
      }

      if (filters.max_year) {
        conditions.push("c.year <= ?");
        params.push(filters.max_year);
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
          `c.transmission IN (${filters.transmission
            .map(() => "?")
            .join(", ")})`
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

      if (filters.seller_verified && include_seller) {
        conditions.push("u.identity_verified = TRUE");
      }

      if (filters.min_rating) {
        conditions.push("c.average_rating >= ?");
        params.push(filters.min_rating);
      }

      // Features filter
      if (filters.features && filters.features.length > 0) {
        baseQuery += `
          INNER JOIN car_features cf ON c.id = cf.car_id
          INNER JOIN features f ON cf.feature_id = f.id
        `;
        conditions.push(
          `f.id IN (${filters.features.map(() => "?").join(", ")})`
        );
        params.push(...filters.features);
      }

      // Build final query
      let finalQuery = baseQuery + " WHERE " + conditions.join(" AND ");

      // Group by for features filter
      if (filters.features && filters.features.length > 0) {
        finalQuery += " GROUP BY c.id HAVING COUNT(DISTINCT f.id) = ?";
        params.push(filters.features.length);
      }

      // Get total count
      const countQuery = finalQuery.replace(
        /SELECT.*?FROM/,
        "SELECT COUNT(DISTINCT c.id) as total FROM"
      );
      const countResult = await database.execute(countQuery, params);
      const total = countResult[0].total;

      // Add sorting
      let orderBy = "";
      switch (sort_by) {
        case "price_asc":
          orderBy = "c.price ASC";
          break;
        case "price_desc":
          orderBy = "c.price DESC";
          break;
        case "year_desc":
          orderBy = "c.year DESC";
          break;
        case "year_asc":
          orderBy = "c.year ASC";
          break;
        case "mileage_asc":
          orderBy = "c.mileage ASC";
          break;
        case "distance":
          if (filters.latitude && filters.longitude) {
            orderBy = "distance ASC";
          } else {
            orderBy = "c.created_at DESC";
          }
          break;
        case "newest":
          orderBy = "c.created_at DESC";
          break;
        case "oldest":
          orderBy = "c.created_at ASC";
          break;
        case "relevance":
        default:
          orderBy =
            "c.is_featured DESC, c.quality_score DESC, c.created_at DESC";
          break;
      }

      finalQuery += ` ORDER BY ${orderBy}`;

      // Add pagination
      const offset = (page - 1) * limit;
      finalQuery += ` LIMIT ${limit} OFFSET ${offset}`;

      const cars = await database.execute(finalQuery, params);

      // Get additional data if requested
      const enrichedCars: CarWithDetails[] = [];
      for (const car of cars) {
        const enrichedCar: CarWithDetails = { ...car };

        if (include_images) {
          enrichedCar.images = await this.getCarImages(car.id);
        } else {
          enrichedCar.images = [];
        }

        if (include_features) {
          enrichedCar.features = await this.getCarFeatures(car.id);
        } else {
          enrichedCar.features = [];
        }

        enrichedCars.push(enrichedCar);
      }

      return {
        cars: enrichedCars,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Error searching cars:", error);
      throw error;
    }
  }

  // Update car
  static async update(
    id: number,
    updateData: UpdateCarData
  ): Promise<Car | null> {
    try {
      // Track price changes
      if (updateData.price) {
        const currentCar = await this.findById(id);
        if (currentCar && currentCar.price !== updateData.price) {
          // Log price change
          await this.logPriceChange(
            id,
            currentCar.price,
            updateData.price,
            currentCar.seller_id
          );
          updateData.last_price_update = new Date();
        }
      }

      // Recalculate scores if relevant fields are updated
      const fieldsAffectingScore = [
        "description",
        "engine_size",
        "horsepower",
        "warranty_details",
        "accident_details",
        "service_records_available",
      ];

      if (fieldsAffectingScore.some((field) => field in updateData)) {
        const updatedCarData = { ...(await this.findById(id)), ...updateData };
        updateData.completeness_score =
          this.calculateCompletenessScore(updatedCarData);
        updateData.quality_score = this.calculateQualityScore(updatedCarData);
      }

      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      return await this.findById(id);
    } catch (error) {
      logger.error(`Error updating car ${id}:`, error);
      throw error;
    }
  }

  // Car approval methods
  static async approve(id: number, approvedBy: number): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({
          status: "approved",
          approval_status: "approved",
          approved_by: approvedBy,
          approved_at: new Date(),
        })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error approving car ${id}:`, error);
      return false;
    }
  }

  static async reject(id: number, reason: string): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({
          status: "rejected",
          approval_status: "rejected",
          rejection_reason: reason,
        })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error rejecting car ${id}:`, error);
      return false;
    }
  }

  static async markAsSold(id: number, buyerId?: number): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({
          status: "sold",
          sold_at: new Date(),
        })
        .where("id = ?", id)
        .execute();

      if (buyerId) {
        // Update seller's sales count
        const car = await this.findById(id);
        if (car) {
          await database.execute(
            "UPDATE users SET total_sales = total_sales + 1 WHERE id = ?",
            [car.seller_id]
          );

          // Update buyer's purchase count
          await database.execute(
            "UPDATE users SET total_purchases = total_purchases + 1 WHERE id = ?",
            [buyerId]
          );
        }
      }

      return true;
    } catch (error) {
      logger.error(`Error marking car as sold ${id}:`, error);
      return false;
    }
  }

  // View tracking
  static async trackView(
    carId: number,
    userId?: number,
    sessionId?: string,
    ipAddress?: string
  ): Promise<void> {
    try {
      // Insert view record
      await database.execute(
        `
        INSERT INTO car_views (car_id, user_id, session_id, ip_address, viewed_at)
        VALUES (?, ?, ?, ?, NOW())
      `,
        [carId, userId, sessionId, ipAddress]
      );

      // Update view counts
      await database.execute(
        `
        UPDATE ${this.tableName} 
        SET views_count = views_count + 1
        WHERE id = ?
      `,
        [carId]
      );

      // Update unique view count if it's a new unique view
      if (userId) {
        const existingView = await database.execute(
          `
          SELECT COUNT(*) as count FROM car_views 
          WHERE car_id = ? AND user_id = ? AND DATE(viewed_at) = CURDATE()
        `,
          [carId, userId]
        );

        if (existingView[0].count === 1) {
          // First view today
          await database.execute(
            `
            UPDATE ${this.tableName} 
            SET unique_views_count = unique_views_count + 1
            WHERE id = ?
          `,
            [carId]
          );
        }
      }
    } catch (error) {
      logger.error("Error tracking car view:", error);
    }
  }

  // Get car images
  static async getCarImages(carId: number): Promise<CarImage[]> {
    try {
      const images = await database.execute(
        `
        SELECT * FROM car_images 
        WHERE car_id = ? AND processing_status = 'ready'
        ORDER BY is_primary DESC, display_order ASC, created_at ASC
      `,
        [carId]
      );

      return images;
    } catch (error) {
      logger.error(`Error getting car images for car ${carId}:`, error);
      return [];
    }
  }

  // Get car features
  static async getCarFeatures(carId: number): Promise<CarFeature[]> {
    try {
      const features = await database.execute(
        `
        SELECT f.id, f.name, f.category, f.is_premium
        FROM car_features cf
        INNER JOIN features f ON cf.feature_id = f.id
        WHERE cf.car_id = ?
        ORDER BY f.category, f.name
      `,
        [carId]
      );

      return features;
    } catch (error) {
      logger.error(`Error getting car features for car ${carId}:`, error);
      return [];
    }
  }

  // Helper methods
  private static async generateSeoSlug(title: string): Promise<string> {
    const baseSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();

    let slug = baseSlug;
    let counter = 1;

    while (await this.slugExists(slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  private static async slugExists(slug: string): Promise<boolean> {
    const result = await database.execute(
      `SELECT COUNT(*) as count FROM ${this.tableName} WHERE seo_slug = ?`,
      [slug]
    );
    return result[0].count > 0;
  }

  private static calculateCompletenessScore(carData: any): number {
    const fields = [
      "description",
      "engine_size",
      "horsepower",
      "drivetrain",
      "exterior_color_id",
      "interior_color_id",
      "warranty_details",
      "vin",
      "engine_number",
      "chassis_number",
      "plate_number",
      "insurance_company",
      "detailed_address",
    ];

    let filledFields = 0;
    fields.forEach((field) => {
      if (carData[field] && carData[field].toString().trim().length > 0) {
        filledFields++;
      }
    });

    return Math.round((filledFields / fields.length) * 100);
  }

  private static calculateQualityScore(carData: any): number {
    let score = 5; // Base score

    // Description quality
    if (carData.description && carData.description.length > 100) score += 1;
    if (carData.description && carData.description.length > 300) score += 1;

    // Technical details
    if (carData.engine_size) score += 0.5;
    if (carData.horsepower) score += 0.5;
    if (carData.drivetrain) score += 0.5;

    // Vehicle history transparency
    if (carData.service_records_available) score += 1;
    if (!carData.accident_history && !carData.flood_history) score += 0.5;

    // Verification documents
    if (carData.vin) score += 0.5;
    if (carData.or_cr_available) score += 0.5;

    return Math.min(10, Math.max(0, score));
  }

  private static async logPriceChange(
    carId: number,
    oldPrice: number,
    newPrice: number,
    userId: number
  ): Promise<void> {
    try {
      await database.execute(
        `
        INSERT INTO price_history (car_id, old_price, new_price, changed_by, change_reason)
        VALUES (?, ?, ?, ?, 'manual')
      `,
        [carId, oldPrice, newPrice, userId]
      );
    } catch (error) {
      logger.error("Error logging price change:", error);
    }
  }

  // Soft delete
  static async softDelete(id: number): Promise<boolean> {
    try {
      await QueryBuilder.update(this.tableName)
        .set({
          is_active: false,
          status: "removed",
        })
        .where("id = ?", id)
        .execute();

      return true;
    } catch (error) {
      logger.error(`Error soft deleting car ${id}:`, error);
      return false;
    }
  }

  // Get seller's cars
  static async getSellerCars(
    sellerId: number,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    cars: CarWithDetails[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      return await this.search(
        {
          /* seller filter would go here but it's not in the current filters interface */
        },
        {
          page,
          limit,
          include_images: true,
          include_features: false,
          include_seller: false,
        }
      );
    } catch (error) {
      logger.error(`Error getting seller cars for seller ${sellerId}:`, error);
      throw error;
    }
  }
}

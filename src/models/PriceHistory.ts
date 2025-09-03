// src/models/PriceHistory.ts
import { RowDataPacket, ResultSetHeader } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface PriceHistory {
  id: number;
  car_id: number;
  old_price: number;
  new_price: number;
  currency: string;
  price_change: number;
  price_change_percentage: number;
  change_type: "increase" | "decrease" | "same";
  changed_by: number;
  change_reason?: string;
  notes?: string;
  created_at: Date;

  // Additional fields from joins
  car_title?: string;
  car_brand?: string;
  car_model?: string;
  car_year?: number;
  changed_by_name?: string;
  days_since_last_change?: number;
}

export interface CreatePriceHistoryData {
  car_id: number;
  old_price: number;
  new_price: number;
  currency?: string;
  changed_by: number;
  change_reason?: string;
  notes?: string;
}

export interface PriceHistoryFilters {
  car_id?: number;
  changed_by?: number;
  change_type?: "increase" | "decrease" | "same";
  currency?: string;
  price_min?: number;
  price_max?: number;
  date_from?: Date;
  date_to?: Date;
  change_percentage_min?: number;
  change_percentage_max?: number;
}

export interface PriceHistorySearchOptions {
  page?: number;
  limit?: number;
  sort_by?: "created_at" | "price_change" | "price_change_percentage" | "new_price";
  sort_order?: "ASC" | "DESC";
  include_car_details?: boolean;
}

export interface PriceTrend {
  period: string;
  average_price: number;
  min_price: number;
  max_price: number;
  price_changes: number;
  price_increases: number;
  price_decreases: number;
}

export class PriceHistoryModel {
  private static tableName = "price_history";

  // Create price history entry
  static async create(priceData: CreatePriceHistoryData): Promise<PriceHistory> {
    try {
      // Validate car exists
      const car = await database.execute(
        "SELECT id, price, currency FROM cars WHERE id = ? AND is_active = TRUE",
        [priceData.car_id]
      );

      if (car.length === 0) {
        throw new Error("Car not found or inactive");
      }

      // Validate user exists
      const user = await database.execute(
        "SELECT id FROM users WHERE id = ?",
        [priceData.changed_by]
      );

      if (user.length === 0) {
        throw new Error("User not found");
      }

      // Calculate price change and percentage
      const priceChange = priceData.new_price - priceData.old_price;
      const priceChangePercentage = priceData.old_price > 0 
        ? Math.round((priceChange / priceData.old_price) * 10000) / 100 
        : 0;

      // Determine change type
      let changeType: "increase" | "decrease" | "same";
      if (priceChange > 0) {
        changeType = "increase";
      } else if (priceChange < 0) {
        changeType = "decrease";
      } else {
        changeType = "same";
      }

      const insertData = {
        ...priceData,
        currency: priceData.currency || car[0].currency || "PHP",
        price_change: priceChange,
        price_change_percentage: priceChangePercentage,
        change_type: changeType,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const historyId = (result as ResultSetHeader).insertId;

      // Update car's current price and last price update timestamp
      await database.execute(
        "UPDATE cars SET price = ?, last_price_update = NOW() WHERE id = ?",
        [priceData.new_price, priceData.car_id]
      );

      const priceHistory = await this.findById(historyId);

      if (!priceHistory) {
        throw new Error("Failed to create price history");
      }

      logger.info(`Price history created: Car ${priceData.car_id}, ${priceData.old_price} → ${priceData.new_price}`);
      return priceHistory;
    } catch (error) {
      logger.error("Error creating price history:", error);
      throw error;
    }
  }

  // Find price history by ID
  static async findById(id: number, includeCarDetails: boolean = true): Promise<PriceHistory | null> {
    try {
      let selectFields = ["ph.*"];

      if (includeCarDetails) {
        selectFields.push(
          "c.title as car_title",
          "c.year as car_year",
          "b.name as car_brand",
          "m.name as car_model",
          'CONCAT(u.first_name, " ", u.last_name) as changed_by_name'
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} ph`);

      if (includeCarDetails) {
        query = query
          .join("cars c", "ph.car_id = c.id")
          .join("brands b", "c.brand_id = b.id")
          .join("models m", "c.model_id = m.id")
          .join("users u", "ph.changed_by = u.id");
      }

      const histories = await query
        .where("ph.id = ?", id)
        .execute();

      return histories.length > 0 ? histories[0] : null;
    } catch (error) {
      logger.error(`Error finding price history by ID ${id}:`, error);
      return null;
    }
  }

  // Get price history for a car
  static async getCarPriceHistory(
    carId: number,
    options: PriceHistorySearchOptions = {}
  ): Promise<{
    history: PriceHistory[];
    total: number;
    page: number;
    totalPages: number;
    price_trend: "increasing" | "decreasing" | "stable";
    total_change: number;
    total_change_percentage: number;
  }> {
    try {
      const {
        page = 1,
        limit = 20,
        sort_by = "created_at",
        sort_order = "DESC",
        include_car_details = false,
      } = options;

      let selectFields = ["ph.*"];

      if (include_car_details) {
        selectFields.push('CONCAT(u.first_name, " ", u.last_name) as changed_by_name');
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} ph`);

      if (include_car_details) {
        query = query.join("users u", "ph.changed_by = u.id");
      }

      query = query.where("ph.car_id = ?", carId);

      // Get total count for pagination
      const countResult = await database.execute(
        `SELECT COUNT(*) as total FROM ${this.tableName} WHERE car_id = ?`,
        [carId]
      );
      const total = countResult[0].total;

      // Apply sorting and pagination
      let orderByColumn = "ph.created_at";
      switch (sort_by) {
        case "price_change":
          orderByColumn = "ph.price_change";
          break;
        case "price_change_percentage":
          orderByColumn = "ph.price_change_percentage";
          break;
        case "new_price":
          orderByColumn = "ph.new_price";
          break;
        default:
          orderByColumn = "ph.created_at";
      }

      const offset = (page - 1) * limit;
      query = query.orderBy(orderByColumn, sort_order).limit(limit, offset);

      const history = await query.execute();

      // Calculate days since last change
      for (const entry of history) {
        const daysSince = Math.floor((Date.now() - new Date(entry.created_at).getTime()) / (1000 * 60 * 60 * 24));
        entry.days_since_last_change = daysSince;
      }

      // Calculate price trend and total change
      const trendData = await this.calculatePriceTrend(carId);

      return {
        history,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        price_trend: trendData.trend,
        total_change: trendData.total_change,
        total_change_percentage: trendData.total_change_percentage,
      };
    } catch (error) {
      logger.error(`Error getting price history for car ${carId}:`, error);
      throw error;
    }
  }

  // Get recent price changes across all cars
  static async getRecentPriceChanges(
    filters: PriceHistoryFilters = {},
    options: PriceHistorySearchOptions = {}
  ): Promise<{
    changes: PriceHistory[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const {
        page = 1,
        limit = 50,
        sort_by = "created_at",
        sort_order = "DESC",
        include_car_details = true,
      } = options;

      let selectFields = ["ph.*"];

      if (include_car_details) {
        selectFields.push(
          "c.title as car_title",
          "c.year as car_year",
          "b.name as car_brand",
          "m.name as car_model",
          'CONCAT(u.first_name, " ", u.last_name) as changed_by_name'
        );
      }

      let query = QueryBuilder.select(selectFields)
        .from(`${this.tableName} ph`);

      if (include_car_details) {
        query = query
          .join("cars c", "ph.car_id = c.id")
          .join("brands b", "c.brand_id = b.id")
          .join("models m", "c.model_id = m.id")
          .join("users u", "ph.changed_by = u.id")
          .where("c.is_active = ?", true);
      }

      // Apply filters
      if (filters.car_id) {
        query = query.where("ph.car_id = ?", filters.car_id);
      }

      if (filters.changed_by) {
        query = query.where("ph.changed_by = ?", filters.changed_by);
      }

      if (filters.change_type) {
        query = query.where("ph.change_type = ?", filters.change_type);
      }

      if (filters.currency) {
        query = query.where("ph.currency = ?", filters.currency);
      }

      if (filters.price_min) {
        query = query.where("ph.new_price >= ?", filters.price_min);
      }

      if (filters.price_max) {
        query = query.where("ph.new_price <= ?", filters.price_max);
      }

      if (filters.date_from) {
        query = query.where("ph.created_at >= ?", filters.date_from);
      }

      if (filters.date_to) {
        query = query.where("ph.created_at <= ?", filters.date_to);
      }

      if (filters.change_percentage_min) {
        query = query.where("ph.price_change_percentage >= ?", filters.change_percentage_min);
      }

      if (filters.change_percentage_max) {
        query = query.where("ph.price_change_percentage <= ?", filters.change_percentage_max);
      }

      // Get total count for pagination
      const countQuery = query.build();
      const countResult = await database.execute(
        countQuery.query.replace(/SELECT .+ FROM/, "SELECT COUNT(*) as total FROM"),
        countQuery.params
      );
      const total = countResult[0].total;

      // Apply sorting and pagination
      let orderByColumn = "ph.created_at";
      switch (sort_by) {
        case "price_change":
          orderByColumn = "ph.price_change";
          break;
        case "price_change_percentage":
          orderByColumn = "ph.price_change_percentage";
          break;
        case "new_price":
          orderByColumn = "ph.new_price";
          break;
        default:
          orderByColumn = "ph.created_at";
      }

      const offset = (page - 1) * limit;
      query = query.orderBy(orderByColumn, sort_order).limit(limit, offset);

      const changes = await query.execute();

      // Calculate days since change
      for (const change of changes) {
        const daysSince = Math.floor((Date.now() - new Date(change.created_at).getTime()) / (1000 * 60 * 60 * 24));
        change.days_since_last_change = daysSince;
      }

      return {
        changes,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Error getting recent price changes:", error);
      throw error;
    }
  }

  // Get price statistics for a car
  static async getCarPriceStatistics(carId: number): Promise<{
    current_price: number;
    original_price: number;
    lowest_price: number;
    highest_price: number;
    average_price: number;
    total_changes: number;
    price_increases: number;
    price_decreases: number;
    total_change: number;
    total_change_percentage: number;
    last_change_date?: Date;
    days_at_current_price: number;
    volatility_score: number;
  } | null> {
    try {
      const stats = await database.execute(`
        SELECT 
          c.price as current_price,
          MIN(ph.old_price) as original_price,
          MIN(ph.new_price) as lowest_price,
          MAX(ph.new_price) as highest_price,
          AVG(ph.new_price) as average_price,
          COUNT(*) as total_changes,
          COUNT(CASE WHEN ph.change_type = 'increase' THEN 1 END) as price_increases,
          COUNT(CASE WHEN ph.change_type = 'decrease' THEN 1 END) as price_decreases,
          MAX(ph.created_at) as last_change_date
        FROM cars c
        LEFT JOIN ${this.tableName} ph ON c.id = ph.car_id
        WHERE c.id = ?
        GROUP BY c.id, c.price
      `, [carId]);

      if (stats.length === 0) {
        return null;
      }

      const stat = stats[0];

      // Calculate total change from original to current
      const totalChange = stat.current_price - (stat.original_price || stat.current_price);
      const totalChangePercentage = stat.original_price > 0 
        ? Math.round((totalChange / stat.original_price) * 10000) / 100 
        : 0;

      // Calculate days at current price
      const daysAtCurrentPrice = stat.last_change_date
        ? Math.floor((Date.now() - new Date(stat.last_change_date).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      // Calculate volatility score (standard deviation of price changes)
      const volatilityScore = await this.calculateVolatilityScore(carId);

      return {
        current_price: stat.current_price,
        original_price: stat.original_price || stat.current_price,
        lowest_price: stat.lowest_price || stat.current_price,
        highest_price: stat.highest_price || stat.current_price,
        average_price: Math.round((stat.average_price || stat.current_price) * 100) / 100,
        total_changes: stat.total_changes,
        price_increases: stat.price_increases,
        price_decreases: stat.price_decreases,
        total_change: totalChange,
        total_change_percentage: totalChangePercentage,
        last_change_date: stat.last_change_date,
        days_at_current_price: daysAtCurrentPrice,
        volatility_score: volatilityScore,
      };
    } catch (error) {
      logger.error(`Error getting price statistics for car ${carId}:`, error);
      return null;
    }
  }

  // Get market price trends by brand/model
  static async getMarketTrends(
    brandId?: number,
    modelId?: number,
    timeframe: "week" | "month" | "quarter" | "year" = "month"
  ): Promise<PriceTrend[]> {
    try {
      let interval: string;
      let dateFormat: string;

      switch (timeframe) {
        case "week":
          interval = "7 DAY";
          dateFormat = "%Y-%m-%d";
          break;
        case "month":
          interval = "30 DAY";
          dateFormat = "%Y-%m-%d";
          break;
        case "quarter":
          interval = "90 DAY";
          dateFormat = "%Y-%u"; // Year-Week
          break;
        case "year":
          interval = "365 DAY";
          dateFormat = "%Y-%m";
          break;
        default:
          interval = "30 DAY";
          dateFormat = "%Y-%m-%d";
      }

      let query = `
        SELECT 
          DATE_FORMAT(ph.created_at, '${dateFormat}') as period,
          AVG(ph.new_price) as average_price,
          MIN(ph.new_price) as min_price,
          MAX(ph.new_price) as max_price,
          COUNT(*) as price_changes,
          COUNT(CASE WHEN ph.change_type = 'increase' THEN 1 END) as price_increases,
          COUNT(CASE WHEN ph.change_type = 'decrease' THEN 1 END) as price_decreases
        FROM ${this.tableName} ph
        INNER JOIN cars c ON ph.car_id = c.id
      `;

      const params: any[] = [];

      if (brandId || modelId) {
        query += " INNER JOIN brands b ON c.brand_id = b.id";
        if (modelId) {
          query += " INNER JOIN models m ON c.model_id = m.id";
        }
      }

      query += ` WHERE ph.created_at >= DATE_SUB(NOW(), INTERVAL ${interval}) AND c.is_active = TRUE`;

      if (brandId) {
        query += " AND c.brand_id = ?";
        params.push(brandId);
      }

      if (modelId) {
        query += " AND c.model_id = ?";
        params.push(modelId);
      }

      query += ` GROUP BY period ORDER BY period DESC`;

      const trends = await database.execute(query, params);

      return trends.map(trend => ({
        ...trend,
        average_price: Math.round(trend.average_price * 100) / 100,
      }));
    } catch (error) {
      logger.error("Error getting market price trends:", error);
      return [];
    }
  }

  // Get cars with recent price drops
  static async getCarsWithPriceDrops(
    minDropPercentage: number = 5,
    days: number = 30,
    limit: number = 20
  ): Promise<Array<{
    car_id: number;
    car_title: string;
    car_brand: string;
    car_model: string;
    current_price: number;
    old_price: number;
    price_drop: number;
    price_drop_percentage: number;
    days_ago: number;
    car_image?: string;
  }>> {
    try {
      const cars = await database.execute(`
        SELECT 
          c.id as car_id,
          c.title as car_title,
          c.price as current_price,
          b.name as car_brand,
          m.name as car_model,
          ph.old_price,
          ph.price_change as price_drop,
          ph.price_change_percentage as price_drop_percentage,
          DATEDIFF(NOW(), ph.created_at) as days_ago,
          ci.image_url as car_image
        FROM cars c
        INNER JOIN ${this.tableName} ph ON c.id = ph.car_id
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        LEFT JOIN car_images ci ON c.id = ci.car_id AND ci.is_primary = TRUE
        WHERE c.is_active = TRUE 
        AND c.status = 'active'
        AND ph.change_type = 'decrease'
        AND ph.price_change_percentage <= -?
        AND ph.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ORDER BY ph.price_change_percentage ASC, ph.created_at DESC
        LIMIT ?
      `, [minDropPercentage, days, limit]);

      return cars;
    } catch (error) {
      logger.error("Error getting cars with price drops:", error);
      return [];
    }
  }

  // Get cars with recent price increases
  static async getCarsWithPriceIncreases(
    minIncreasePercentage: number = 5,
    days: number = 30,
    limit: number = 20
  ): Promise<Array<{
    car_id: number;
    car_title: string;
    car_brand: string;
    car_model: string;
    current_price: number;
    old_price: number;
    price_increase: number;
    price_increase_percentage: number;
    days_ago: number;
    car_image?: string;
  }>> {
    try {
      const cars = await database.execute(`
        SELECT 
          c.id as car_id,
          c.title as car_title,
          c.price as current_price,
          b.name as car_brand,
          m.name as car_model,
          ph.old_price,
          ph.price_change as price_increase,
          ph.price_change_percentage as price_increase_percentage,
          DATEDIFF(NOW(), ph.created_at) as days_ago,
          ci.image_url as car_image
        FROM cars c
        INNER JOIN ${this.tableName} ph ON c.id = ph.car_id
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        LEFT JOIN car_images ci ON c.id = ci.car_id AND ci.is_primary = TRUE
        WHERE c.is_active = TRUE 
        AND c.status = 'active'
        AND ph.change_type = 'increase'
        AND ph.price_change_percentage >= ?
        AND ph.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ORDER BY ph.price_change_percentage DESC, ph.created_at DESC
        LIMIT ?
      `, [minIncreasePercentage, days, limit]);

      return cars;
    } catch (error) {
      logger.error("Error getting cars with price increases:", error);
      return [];
    }
  }

  // Get price volatility report
  static async getPriceVolatilityReport(
    brandId?: number,
    modelId?: number,
    days: number = 90
  ): Promise<Array<{
    car_id: number;
    car_title: string;
    car_brand: string;
    car_model: string;
    current_price: number;
    price_changes: number;
    volatility_score: number;
    price_range: { min: number; max: number };
    average_change_percentage: number;
  }>> {
    try {
      let query = `
        SELECT 
          c.id as car_id,
          c.title as car_title,
          c.price as current_price,
          b.name as car_brand,
          m.name as car_model,
          COUNT(ph.id) as price_changes,
          MIN(ph.new_price) as min_price,
          MAX(ph.new_price) as max_price,
          AVG(ABS(ph.price_change_percentage)) as average_change_percentage,
          STDDEV(ph.price_change_percentage) as volatility_score
        FROM cars c
        INNER JOIN ${this.tableName} ph ON c.id = ph.car_id
        INNER JOIN brands b ON c.brand_id = b.id
        INNER JOIN models m ON c.model_id = m.id
        WHERE c.is_active = TRUE 
        AND ph.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      `;

      const params = [days];

      if (brandId) {
        query += " AND c.brand_id = ?";
        params.push(brandId);
      }

      if (modelId) {
        query += " AND c.model_id = ?";
        params.push(modelId);
      }

      query += `
        GROUP BY c.id
        HAVING price_changes > 1
        ORDER BY volatility_score DESC, price_changes DESC
        LIMIT 50
      `;

      const report = await database.execute(query, params);

      return report.map(item => ({
        ...item,
        volatility_score: Math.round((item.volatility_score || 0) * 100) / 100,
        price_range: {
          min: item.min_price,
          max: item.max_price,
        },
        average_change_percentage: Math.round((item.average_change_percentage || 0) * 100) / 100,
      }));
    } catch (error) {
      logger.error("Error getting price volatility report:", error);
      return [];
    }
  }

  // Utility methods
  private static async calculatePriceTrend(carId: number): Promise<{
    trend: "increasing" | "decreasing" | "stable";
    total_change: number;
    total_change_percentage: number;
  }> {
    try {
      const trendData = await database.execute(`
        SELECT 
          (SELECT price FROM cars WHERE id = ?) as current_price,
          (SELECT old_price FROM ${this.tableName} WHERE car_id = ? ORDER BY created_at ASC LIMIT 1) as first_price,
          COUNT(CASE WHEN change_type = 'increase' THEN 1 END) as increases,
          COUNT(CASE WHEN change_type = 'decrease' THEN 1 END) as decreases
        FROM ${this.tableName}
        WHERE car_id = ?
      `, [carId, carId, carId]);

      if (trendData.length === 0) {
        return { trend: "stable", total_change: 0, total_change_percentage: 0 };
      }

      const data = trendData[0];
      const totalChange = data.current_price - (data.first_price || data.current_price);
      const totalChangePercentage = data.first_price > 0 
        ? Math.round((totalChange / data.first_price) * 10000) / 100 
        : 0;

      let trend: "increasing" | "decreasing" | "stable";
      if (data.increases > data.decreases) {
        trend = "increasing";
      } else if (data.decreases > data.increases) {
        trend = "decreasing";
      } else {
        trend = "stable";
      }

      return {
        trend,
        total_change: totalChange,
        total_change_percentage: totalChangePercentage,
      };
    } catch (error) {
      logger.error(`Error calculating price trend for car ${carId}:`, error);
      return { trend: "stable", total_change: 0, total_change_percentage: 0 };
    }
  }

  private static async calculateVolatilityScore(carId: number): Promise<number> {
    try {
      const volatility = await database.execute(`
        SELECT STDDEV(price_change_percentage) as volatility
        FROM ${this.tableName}
        WHERE car_id = ?
      `, [carId]);

      return Math.round((volatility[0]?.volatility || 0) * 100) / 100;
    } catch (error) {
      logger.error(`Error calculating volatility score for car ${carId}:`, error);
      return 0;
    }
  }

  // Get cars needing price alerts (for favorites with price alerts)
  static async getCarsNeedingPriceAlerts(): Promise<Array<{
    car_id: number;
    current_price: number;
    user_id: number;
    alert_threshold: number;
    price_drop: number;
    price_drop_percentage: number;
  }>> {
    try {
      const alerts = await database.execute(`
        SELECT 
          c.id as car_id,
          c.price as current_price,
          f.user_id,
          f.price_alert_threshold as alert_threshold,
          (f.price_alert_threshold - c.price) as price_drop,
          ((f.price_alert_threshold - c.price) / f.price_alert_threshold * 100) as price_drop_percentage
        FROM cars c
        INNER JOIN favorites f ON c.id = f.car_id
        WHERE f.price_alert_enabled = TRUE
        AND c.price < f.price_alert_threshold
        AND c.is_active = TRUE
        AND c.status = 'active'
        ORDER BY price_drop_percentage DESC
      `);

      return alerts;
    } catch (error) {
      logger.error("Error getting cars needing price alerts:", error);
      return [];
    }
  }

  // Get average market prices by brand/model/year
  static async getMarketAverages(
    brandId?: number,
    modelId?: number,
    year?: number,
    days: number = 90
  ): Promise<{
    average_price: number;
    median_price: number;
    price_range: { min: number; max: number };
    sample_size: number;
    last_updated: Date;
  } | null> {
    try {
      let query = `
        SELECT 
          AVG(c.price) as average_price,
          MIN(c.price) as min_price,
          MAX(c.price) as max_price,
          COUNT(*) as sample_size,
          MAX(c.updated_at) as last_updated
        FROM cars c
        WHERE c.is_active = TRUE 
        AND c.status = 'active'
        AND c.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      `;

      const params = [days];

      if (brandId) {
        query += " AND c.brand_id = ?";
        params.push(brandId);
      }

      if (modelId) {
        query += " AND c.model_id = ?";
        params.push(modelId);
      }

      if (year) {
        query += " AND c.year = ?";
        params.push(year);
      }

      const averages = await database.execute(query, params);

      if (averages.length === 0 || averages[0].sample_size === 0) {
        return null;
      }

      const data = averages[0];

      // Get median price
      let medianQuery = `
        SELECT c.price
        FROM cars c
        WHERE c.is_active = TRUE 
        AND c.status = 'active'
        AND c.updated_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      `;

      const medianParams = [days];

      if (brandId) {
        medianQuery += " AND c.brand_id = ?";
        medianParams.push(brandId);
      }

      if (modelId) {
        medianQuery += " AND c.model_id = ?";
        medianParams.push(modelId);
      }

      if (year) {
        medianQuery += " AND c.year = ?";
        medianParams.push(year);
      }

      medianQuery += " ORDER BY c.price";

      const medianData = await database.execute(medianQuery, medianParams);
      
      let medianPrice = data.average_price;
      if (medianData.length > 0) {
        const middleIndex = Math.floor(medianData.length / 2);
        medianPrice = medianData.length % 2 === 0
          ? (medianData[middleIndex - 1].price + medianData[middleIndex].price) / 2
          : medianData[middleIndex].price;
      }

      return {
        average_price: Math.round(data.average_price * 100) / 100,
        median_price: Math.round(medianPrice * 100) / 100,
        price_range: {
          min: data.min_price,
          max: data.max_price,
        },
        sample_size: data.sample_size,
        last_updated: data.last_updated,
      };
    } catch (error) {
      logger.error("Error getting market averages:", error);
      return null;
    }
  }

  // Validate price history data
  static validatePriceHistoryData(data: CreatePriceHistoryData): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (data.old_price <= 0) {
      errors.push("Old price must be greater than 0");
    }

    if (data.new_price <= 0) {
      errors.push("New price must be greater than 0");
    }

    if (data.old_price > 100000000) {
      errors.push("Old price cannot exceed 100,000,000");
    }

    if (data.new_price > 100000000) {
      errors.push("New price cannot exceed 100,000,000");
    }

    if (data.notes && data.notes.length > 500) {
      errors.push("Notes cannot exceed 500 characters");
    }

    if (data.change_reason && data.change_reason.length > 255) {
      errors.push("Change reason cannot exceed 255 characters");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // Cleanup old price history (keep last 100 entries per car)
  static async cleanup(keepLastEntries: number = 100): Promise<number> {
    try {
      const result = await database.execute(`
        DELETE ph1 FROM ${this.tableName} ph1
        INNER JOIN (
          SELECT car_id, 
                 ROW_NUMBER() OVER (PARTITION BY car_id ORDER BY created_at DESC) as rn
          FROM ${this.tableName}
        ) ph2 ON ph1.car_id = ph2.car_id
        WHERE ph2.rn > ?
      `, [keepLastEntries]);

      const deletedCount = (result as ResultSetHeader).affectedRows;
      
      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} old price history entries`);
      }

      return deletedCount;
    } catch (error) {
      logger.error("Error cleaning up price history:", error);
      return 0;
    }
  }

  // Get price change frequency by user
  static async getUserPriceChangeFrequency(
    userId: number,
    days: number = 30
  ): Promise<{
    total_changes: number;
    average_changes_per_car: number;
    most_changed_car: { car_id: number; car_title: string; changes: number } | null;
    change_pattern: Array<{ date: string; changes: number }>;
  }> {
    try {
      const stats = await database.execute(`
        SELECT 
          COUNT(*) as total_changes,
          COUNT(DISTINCT ph.car_id) as unique_cars,
          AVG(changes_per_car) as average_changes_per_car
        FROM ${this.tableName} ph
        INNER JOIN (
          SELECT car_id, COUNT(*) as changes_per_car
          FROM ${this.tableName}
          WHERE changed_by = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
          GROUP BY car_id
        ) car_changes ON ph.car_id = car_changes.car_id
        WHERE ph.changed_by = ? AND ph.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      `, [userId, days, userId, days]);

      // Get most changed car
      const mostChanged = await database.execute(`
        SELECT 
          c.id as car_id,
          c.title as car_title,
          COUNT(ph.id) as changes
        FROM ${this.tableName} ph
        INNER JOIN cars c ON ph.car_id = c.id
        WHERE ph.changed_by = ? AND ph.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY c.id, c.title
        ORDER BY changes DESC
        LIMIT 1
      `, [userId, days]);

      // Get daily change pattern
      const pattern = await database.execute(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as changes
        FROM ${this.tableName}
        WHERE changed_by = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `, [userId, days]);

      const result = stats[0] || { total_changes: 0, unique_cars: 0, average_changes_per_car: 0 };

      return {
        total_changes: result.total_changes,
        average_changes_per_car: Math.round((result.average_changes_per_car || 0) * 100) / 100,
        most_changed_car: mostChanged.length > 0 ? mostChanged[0] : null,
        change_pattern: pattern,
      };
    } catch (error) {
      logger.error(`Error getting price change frequency for user ${userId}:`, error);
      return {
        total_changes: 0,
        average_changes_per_car: 0,
        most_changed_car: null,
        change_pattern: [],
      };
    }
  }
}

export default PriceHistoryModel;
// src/services/analytics/ViewTrackingService.ts
import { DatabaseManager } from "../../config/database";
import redis from "../../config/redis";
import logger from "../../utils/logger";
import { UserAction, AnalyticsData } from "../../types";

export class AnalyticsService {
  private static instance: AnalyticsService;
  private db: DatabaseManager;

  private constructor() {
    this.db = DatabaseManager.getInstance();
  }

  public static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  /**
   * Track user action for analytics
   */
  async trackUserAction(action: UserAction): Promise<void> {
    try {
      // Store in database for long-term analytics
      await this.db.execute(
        `INSERT INTO user_actions (user_id, session_id, action_type, target_type, target_id, metadata, ip_address, user_agent, referrer, page_url, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          action.user_id || null,
          action.session_id || null,
          action.action_type,
          action.target_type,
          action.target_id || null,
          action.metadata ? JSON.stringify(action.metadata) : null,
          action.ip_address || null,
          action.user_agent || null,
          action.referrer || null,
          action.page_url || null,
        ]
      );

      // Update real-time counters in Redis
      await this.updateRealTimeCounters(action);

      // Update trending data
      await this.updateTrendingData(action);
    } catch (error) {
      logger.error("Error tracking user action:", error);
    }
  }

  /**
   * Track car view with detailed analytics
   */
  async trackCarView(
    carId: number,
    userId?: number,
    sessionId?: string,
    metadata?: any
  ): Promise<void> {
    try {
      // Record view in database
      await this.db.execute(
        "INSERT INTO car_views (car_id, user_id, session_id, viewed_at, metadata) VALUES (?, ?, ?, NOW(), ?)",
        [
          carId,
          userId || null,
          sessionId || null,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );

      // Update car view count
      await this.db.execute(
        "UPDATE cars SET views_count = views_count + 1, last_viewed_at = NOW() WHERE id = ?",
        [carId]
      );

      // Update daily view counter in Redis
      const dateKey = new Date().toISOString().split("T")[0];
      await redis.incr(`car_views:${carId}:${dateKey}`);
      await redis.incr(`total_views:${dateKey}`);

      // Set TTL for daily counters (30 days)
      await redis.expire(`car_views:${carId}:${dateKey}`, 30 * 24 * 60 * 60);
      await redis.expire(`total_views:${dateKey}`, 30 * 24 * 60 * 60);

      // Update popular cars list
      await redis.zincrby("popular_cars", 1, carId.toString());
    } catch (error) {
      logger.error("Error tracking car view:", error);
    }
  }

  /**
   * Track search query for analytics and trending
   */
  async trackSearch(
    query: string,
    filters: any,
    userId?: number,
    resultCount?: number
  ): Promise<void> {
    try {
      // Store search in database
      await this.db.execute(
        "INSERT INTO search_analytics (user_id, search_query, filters, result_count, created_at) VALUES (?, ?, ?, ?, NOW())",
        [
          userId || null,
          query || null,
          JSON.stringify(filters),
          resultCount || 0,
        ]
      );

      // Update search trends
      if (query) {
        await redis.zincrby("search_trends", 1, query);
        await redis.zincrby(
          `search_trends:${new Date().toISOString().split("T")[0]}`,
          1,
          query
        );
      }

      // Track filter usage
      for (const [filterKey, filterValue] of Object.entries(filters)) {
        if (filterValue) {
          await redis.zincrby("filter_usage", 1, filterKey);
        }
      }
    } catch (error) {
      logger.error("Error tracking search:", error);
    }
  }

  /**
   * Get car performance statistics
   */
  async getCarStats(carId: number, days: number = 30): Promise<any> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [viewStats, inquiryStats, favoriteStats] = await Promise.all([
        this.getCarViewStats(carId, startDate),
        this.getCarInquiryStats(carId, startDate),
        this.getCarFavoriteStats(carId, startDate),
      ]);

      return {
        car_id: carId,
        period_days: days,
        views: viewStats,
        inquiries: inquiryStats,
        favorites: favoriteStats,
        generated_at: new Date(),
      };
    } catch (error) {
      logger.error("Error getting car stats:", error);
      throw error;
    }
  }

  /**
   * Get daily analytics data
   */
  async getDailyStats(date?: string): Promise<any> {
    const targetDate = date || new Date().toISOString().split("T")[0];

    try {
      const [
        totalViews,
        uniqueVisitors,
        newListings,
        newInquiries,
        newUsers,
        topSearches,
        topCars,
        conversionRate,
      ] = await Promise.all([
        this.getDailyViews(targetDate),
        this.getDailyUniqueVisitors(targetDate),
        this.getDailyNewListings(targetDate),
        this.getDailyNewInquiries(targetDate),
        this.getDailyNewUsers(targetDate),
        this.getDailyTopSearches(targetDate),
        this.getDailyTopCars(targetDate),
        this.getDailyConversionRate(targetDate),
      ]);

      return {
        date: targetDate,
        total_views: totalViews,
        unique_visitors: uniqueVisitors,
        new_listings: newListings,
        new_inquiries: newInquiries,
        new_users: newUsers,
        top_searches: topSearches,
        top_cars: topCars,
        conversion_rate: conversionRate,
      };
    } catch (error) {
      logger.error("Error getting daily stats:", error);
      throw error;
    }
  }

  /**
   * Get user behavior analytics
   */
  async getUserBehaviorStats(userId: number, days: number = 30): Promise<any> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const userStats = await this.db.execute(
        `
        SELECT 
          COUNT(CASE WHEN action_type = 'view_car' THEN 1 END) as car_views,
          COUNT(CASE WHEN action_type = 'search' THEN 1 END) as searches,
          COUNT(CASE WHEN action_type = 'contact_seller' THEN 1 END) as inquiries,
          COUNT(CASE WHEN action_type = 'favorite' THEN 1 END) as favorites,
          COUNT(CASE WHEN action_type = 'share' THEN 1 END) as shares,
          COUNT(DISTINCT DATE(created_at)) as active_days,
          MIN(created_at) as first_activity,
          MAX(created_at) as last_activity
        FROM user_actions 
        WHERE user_id = ? AND created_at >= ?
      `,
        [userId, startDate]
      );

      const preferenceStats = await this.getUserPreferences(userId);

      return {
        user_id: userId,
        period_days: days,
        activity: userStats[0],
        preferences: preferenceStats,
        generated_at: new Date(),
      };
    } catch (error) {
      logger.error("Error getting user behavior stats:", error);
      throw error;
    }
  }

  /**
   * Get market insights and trends
   */
  async getMarketInsights(days: number = 30): Promise<any> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [
        brandTrends,
        priceTrends,
        locationTrends,
        searchTrends,
        demandSupply,
      ] = await Promise.all([
        this.getBrandTrends(startDate),
        this.getPriceTrends(startDate),
        this.getLocationTrends(startDate),
        this.getSearchTrends(startDate),
        this.getDemandSupplyData(startDate),
      ]);

      return {
        period_days: days,
        brand_trends: brandTrends,
        price_trends: priceTrends,
        location_trends: locationTrends,
        search_trends: searchTrends,
        demand_supply: demandSupply,
        generated_at: new Date(),
      };
    } catch (error) {
      logger.error("Error getting market insights:", error);
      throw error;
    }
  }

  // Private helper methods

  private async updateRealTimeCounters(action: UserAction): Promise<void> {
    const dateKey = new Date().toISOString().split("T")[0];
    const hourKey = new Date().toISOString().substring(0, 13);

    // Update daily counters
    await redis.incr(`actions:${action.action_type}:${dateKey}`);
    await redis.incr(`total_actions:${dateKey}`);

    // Update hourly counters
    await redis.incr(`actions:${action.action_type}:${hourKey}`);

    // Set TTL for counters
    await redis.expire(
      `actions:${action.action_type}:${dateKey}`,
      30 * 24 * 60 * 60
    );
    await redis.expire(
      `actions:${action.action_type}:${hourKey}`,
      24 * 60 * 60
    );
  }

  private async updateTrendingData(action: UserAction): Promise<void> {
    if (action.action_type === "view_car" && action.target_id) {
      await redis.zincrby("trending_cars", 1, action.target_id.toString());
    }

    if (action.action_type === "search" && action.metadata?.query) {
      await redis.zincrby("trending_searches", 1, action.metadata.query);
    }
  }

  private async getCarViewStats(carId: number, startDate: Date): Promise<any> {
    const viewStats = await this.db.execute(
      `
      SELECT 
        COUNT(*) as total_views,
        COUNT(DISTINCT user_id) as unique_viewers,
        COUNT(DISTINCT DATE(viewed_at)) as active_days,
        AVG(CASE WHEN duration IS NOT NULL THEN duration END) as avg_duration
      FROM car_views 
      WHERE car_id = ? AND viewed_at >= ?
    `,
      [carId, startDate]
    );

    return viewStats[0];
  }

  private async getCarInquiryStats(
    carId: number,
    startDate: Date
  ): Promise<any> {
    const inquiryStats = await this.db.execute(
      `
      SELECT 
        COUNT(*) as total_inquiries,
        COUNT(DISTINCT buyer_id) as unique_inquirers,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_inquiries,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_inquiries
      FROM inquiries 
      WHERE car_id = ? AND created_at >= ?
    `,
      [carId, startDate]
    );

    return inquiryStats[0];
  }

  private async getCarFavoriteStats(
    carId: number,
    startDate: Date
  ): Promise<any> {
    const favoriteStats = await this.db.execute(
      `
      SELECT 
        COUNT(*) as total_favorites,
        COUNT(DISTINCT user_id) as unique_users
      FROM user_favorites 
      WHERE car_id = ? AND created_at >= ?
    `,
      [carId, startDate]
    );

    return favoriteStats[0];
  }

  private async getDailyViews(date: string): Promise<number> {
    const result = await redis.get(`total_views:${date}`);
    return parseInt(result || "0");
  }

  private async getDailyUniqueVisitors(date: string): Promise<number> {
    const visitors = await this.db.execute(
      "SELECT COUNT(DISTINCT COALESCE(user_id, session_id)) as count FROM user_actions WHERE DATE(created_at) = ?",
      [date]
    );
    return visitors[0].count;
  }

  private async getDailyNewListings(date: string): Promise<number> {
    const listings = await this.db.execute(
      "SELECT COUNT(*) as count FROM cars WHERE DATE(created_at) = ?",
      [date]
    );
    return listings[0].count;
  }

  private async getDailyNewInquiries(date: string): Promise<number> {
    const inquiries = await this.db.execute(
      "SELECT COUNT(*) as count FROM inquiries WHERE DATE(created_at) = ?",
      [date]
    );
    return inquiries[0].count;
  }

  private async getDailyNewUsers(date: string): Promise<number> {
    const users = await this.db.execute(
      "SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = ?",
      [date]
    );
    return users[0].count;
  }

  private async getDailyTopSearches(date: string): Promise<any[]> {
    const searches = await redis.zrevrange(
      `search_trends:${date}`,
      0,
      9,
      "WITHSCORES"
    );
    const result = [];
    for (let i = 0; i < searches.length; i += 2) {
      result.push({
        query: searches[i],
        count: parseInt(searches[i + 1]),
      });
    }
    return result;
  }

  private async getDailyTopCars(date: string): Promise<any[]> {
    const topCars = await this.db.execute(
      `
      SELECT 
        c.id,
        c.title,
        b.name as brand_name,
        COUNT(cv.id) as views
      FROM cars c
      INNER JOIN brands b ON c.brand_id = b.id
      INNER JOIN car_views cv ON c.id = cv.car_id
      WHERE DATE(cv.viewed_at) = ?
      GROUP BY c.id
      ORDER BY views DESC
      LIMIT 10
    `,
      [date]
    );

    return topCars;
  }

  private async getDailyConversionRate(date: string): Promise<number> {
    const [views, inquiries] = await Promise.all([
      this.getDailyViews(date),
      this.getDailyNewInquiries(date),
    ]);

    return views > 0 ? (inquiries / views) * 100 : 0;
  }

  private async getUserPreferences(userId: number): Promise<any> {
    // Analyze user's viewing and search patterns
    const preferences = await this.db.execute(
      `
      SELECT 
        COUNT(CASE WHEN ua.action_type = 'view_car' THEN 1 END) as total_views,
        (SELECT brand_id FROM cars c 
         INNER JOIN user_actions ua2 ON c.id = ua2.target_id 
         WHERE ua2.user_id = ? AND ua2.action_type = 'view_car' 
         GROUP BY brand_id 
         ORDER BY COUNT(*) DESC 
         LIMIT 1) as preferred_brand_id,
        (SELECT AVG(price) FROM cars c 
         INNER JOIN user_actions ua3 ON c.id = ua3.target_id 
         WHERE ua3.user_id = ? AND ua3.action_type = 'view_car') as avg_price_interest
      FROM user_actions ua
      WHERE ua.user_id = ?
    `,
      [userId, userId, userId]
    );

    return preferences[0];
  }

  private async getBrandTrends(startDate: Date): Promise<any[]> {
    return await this.db.execute(
      `
      SELECT 
        b.id,
        b.name,
        COUNT(c.id) as new_listings,
        COUNT(cv.id) as total_views,
        AVG(c.price) as avg_price
      FROM brands b
      LEFT JOIN cars c ON b.id = c.brand_id AND c.created_at >= ?
      LEFT JOIN car_views cv ON c.id = cv.car_id AND cv.viewed_at >= ?
      GROUP BY b.id, b.name
      HAVING new_listings > 0 OR total_views > 0
      ORDER BY total_views DESC
      LIMIT 20
    `,
      [startDate, startDate]
    );
  }

  private async getPriceTrends(startDate: Date): Promise<any[]> {
    return await this.db.execute(
      `
      SELECT 
        DATE(created_at) as date,
        AVG(price) as avg_price,
        COUNT(*) as listing_count,
        MIN(price) as min_price,
        MAX(price) as max_price
      FROM cars 
      WHERE created_at >= ? AND approval_status = 'approved'
      GROUP BY DATE(created_at)
      ORDER BY date
    `,
      [startDate]
    );
  }

  private async getLocationTrends(startDate: Date): Promise<any[]> {
    return await this.db.execute(
      `
      SELECT 
        ct.id,
        ct.name,
        pr.name as province_name,
        COUNT(c.id) as new_listings,
        COUNT(cv.id) as total_views
      FROM ph_cities ct
      INNER JOIN ph_provinces pr ON ct.province_id = pr.id
      LEFT JOIN cars c ON ct.id = c.city_id AND c.created_at >= ?
      LEFT JOIN car_views cv ON c.id = cv.car_id AND cv.viewed_at >= ?
      GROUP BY ct.id, ct.name, pr.name
      HAVING new_listings > 0 OR total_views > 0
      ORDER BY total_views DESC
      LIMIT 20
    `,
      [startDate, startDate]
    );
  }

  private async getSearchTrends(startDate: Date): Promise<any[]> {
    const trends = await redis.zrevrange(
      "trending_searches",
      0,
      19,
      "WITHSCORES"
    );
    const result = [];
    for (let i = 0; i < trends.length; i += 2) {
      result.push({
        query: trends[i],
        count: parseInt(trends[i + 1]),
      });
    }
    return result;
  }

  private async getDemandSupplyData(startDate: Date): Promise<any> {
    const [demandData, supplyData] = await Promise.all([
      this.db.execute(
        `
        SELECT 
          COUNT(*) as total_searches,
          COUNT(DISTINCT user_id) as unique_searchers
        FROM search_analytics 
        WHERE created_at >= ?
      `,
        [startDate]
      ),

      this.db.execute(
        `
        SELECT 
          COUNT(*) as new_listings,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_listings
        FROM cars 
        WHERE created_at >= ?
      `,
        [startDate]
      ),
    ]);

    return {
      demand: demandData[0],
      supply: supplyData[0],
      demand_supply_ratio:
        supplyData[0].active_listings > 0
          ? demandData[0].total_searches / supplyData[0].active_listings
          : 0,
    };
  }

  /**
   * Generate analytics report for admin dashboard
   */
  async generateAnalyticsReport(
    startDate: Date,
    endDate: Date
  ): Promise<AnalyticsData> {
    try {
      const [dailyStats, popularSearches, popularBrands, performanceMetrics] =
        await Promise.all([
          this.getDateRangeStats(startDate, endDate),
          this.getPopularSearches(startDate, endDate),
          this.getPopularBrands(startDate, endDate),
          this.getPerformanceMetrics(startDate, endDate),
        ]);

      return {
        daily_stats: dailyStats,
        popular_searches: popularSearches,
        popular_brands: popularBrands,
        performance_metrics: performanceMetrics,
      };
    } catch (error) {
      logger.error("Error generating analytics report:", error);
      throw error;
    }
  }

  private async getDateRangeStats(
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    return await this.db.execute(
      `
      SELECT 
        DATE(created_at) as date,
        COUNT(CASE WHEN action_type = 'view_car' THEN 1 END) as views,
        COUNT(DISTINCT COALESCE(user_id, session_id)) as unique_visitors,
        COUNT(CASE WHEN action_type = 'contact_seller' THEN 1 END) as inquiries,
        (SELECT COUNT(*) FROM cars WHERE DATE(created_at) = DATE(ua.created_at)) as new_listings,
        (SELECT COUNT(*) FROM inquiries WHERE DATE(created_at) = DATE(ua.created_at)) as total_inquiries
      FROM user_actions ua
      WHERE DATE(created_at) BETWEEN ? AND ?
      GROUP BY DATE(created_at)
      ORDER BY date
    `,
      [startDate, endDate]
    );
  }

  private async getPopularSearches(
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    return await this.db.execute(
      `
      SELECT 
        search_query as query,
        COUNT(*) as count
      FROM search_analytics
      WHERE created_at BETWEEN ? AND ? AND search_query IS NOT NULL
      GROUP BY search_query
      ORDER BY count DESC
      LIMIT 50
    `,
      [startDate, endDate]
    );
  }

  private async getPopularBrands(
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    return await this.db.execute(
      `
      SELECT 
        b.id as brand_id,
        b.name as brand_name,
        COUNT(c.id) as listing_count,
        COUNT(cv.id) as view_count
      FROM brands b
      LEFT JOIN cars c ON b.id = c.brand_id AND c.created_at BETWEEN ? AND ?
      LEFT JOIN car_views cv ON c.id = cv.car_id AND cv.viewed_at BETWEEN ? AND ?
      GROUP BY b.id, b.name
      ORDER BY view_count DESC
      LIMIT 20
    `,
      [startDate, endDate, startDate, endDate]
    );
  }

  private async getPerformanceMetrics(
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    const metrics = await this.db.execute(
      `
      SELECT 
        AVG(CASE WHEN action_type = 'view_car' THEN 1 ELSE 0 END) * 1000 as average_response_time,
        (COUNT(CASE WHEN action_type = 'contact_seller' THEN 1 END) / 
         COUNT(CASE WHEN action_type = 'view_car' THEN 1 END)) * 100 as conversion_rate,
        (COUNT(CASE WHEN action_type = 'view_car' AND target_id IS NOT NULL THEN 1 END) /
         COUNT(CASE WHEN action_type = 'search' THEN 1 END)) * 100 as search_to_view_rate
      FROM user_actions
      WHERE created_at BETWEEN ? AND ?
    `,
      [startDate, endDate]
    );

    return {
      average_response_time: metrics[0].average_response_time || 0,
      conversion_rate: metrics[0].conversion_rate || 0,
      bounce_rate: 100 - (metrics[0].search_to_view_rate || 0),
    };
  }
}

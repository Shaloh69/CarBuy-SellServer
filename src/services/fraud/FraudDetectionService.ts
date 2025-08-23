// src/services/fraud/FraudDetectionService.ts
import  DatabaseManager from "../../config/database";
import redis from "../../config/redis";
import logger from "../../utils/logger";
import { FraudAnalysisResult, FraudIndicator } from "../../types";

interface PriceRisk {
  score: number;
  suspicious: boolean;
  marketPrice: number;
  deviation: number;
}

interface ImageRisk {
  score: number;
  duplicates: boolean;
  duplicateCount?: number;
  suspiciousPatterns?: string[];
}

interface SellerRisk {
  score: number;
  suspicious: boolean;
  indicators: string[];
}

interface LocationRisk {
  score: number;
  suspicious: boolean;
  issues: string[];
}

interface ContentRisk {
  score: number;
  suspicious: boolean;
  flags: string[];
}

export class FraudDetectionService {
  private static instance: FraudDetectionService;
  private db: DatabaseManager;

  private constructor() {
    this.db = DatabaseManager.getInstance();
  }

  public static getInstance(): FraudDetectionService {
    if (!FraudDetectionService.instance) {
      FraudDetectionService.instance = new FraudDetectionService();
    }
    return FraudDetectionService.instance;
  }

  /**
   * Comprehensive fraud analysis for car listing
   */
  async analyzeListing(carId: number): Promise<FraudAnalysisResult> {
    try {
      logger.info(`Starting fraud analysis for car ${carId}`);

      // Get car and seller data
      const car = await this.getCarData(carId);
      if (!car) {
        throw new Error(`Car ${carId} not found`);
      }

      const seller = await this.getSellerData(car.seller_id);

      let riskScore = 0;
      const indicators: FraudIndicator[] = [];

      // 1. Price Analysis (30% weight)
      const priceRisk = await this.analyzePriceAnomalies(car);
      riskScore += priceRisk.score * 0.30;
      if (priceRisk.suspicious) {
        indicators.push({
          indicator_type: "suspicious_price",
          severity: this.calculateSeverity(priceRisk.score),
          description: `Price deviates ${(priceRisk.deviation * 100).toFixed(1)}% from market average`,
          confidence_score: Math.min(100, priceRisk.score * 10),
          evidence: {
            listed_price: car.price,
            market_price: priceRisk.marketPrice,
            deviation_percent: priceRisk.deviation * 100
          }
        });
      }

      // 2. Image Analysis (25% weight)
      const imageRisk = await this.analyzeImages(carId);
      riskScore += imageRisk.score * 0.25;
      if (imageRisk.duplicates) {
        indicators.push({
          indicator_type: "duplicate_images",
          severity: this.calculateSeverity(imageRisk.score),
          description: `Found ${imageRisk.duplicateCount} duplicate images from other listings`,
          confidence_score: Math.min(100, imageRisk.score * 10),
          evidence: {
            duplicate_count: imageRisk.duplicateCount,
            suspicious_patterns: imageRisk.suspiciousPatterns
          }
        });
      }

      // 3. Seller Behavior Analysis (20% weight)
      const sellerRisk = await this.analyzeSellerBehavior(seller);
      riskScore += sellerRisk.score * 0.20;
      if (sellerRisk.suspicious) {
        indicators.push({
          indicator_type: "unusual_activity",
          severity: this.calculateSeverity(sellerRisk.score),
          description: "Suspicious seller activity patterns detected",
          confidence_score: Math.min(100, sellerRisk.score * 10),
          evidence: {
            indicators: sellerRisk.indicators
          }
        });
      }

      // 4. Location Verification (15% weight)
      const locationRisk = await this.analyzeLocation(car);
      riskScore += locationRisk.score * 0.15;
      if (locationRisk.suspicious) {
        indicators.push({
          indicator_type: "fake_location",
          severity: this.calculateSeverity(locationRisk.score),
          description: "Location inconsistencies detected",
          confidence_score: Math.min(100, locationRisk.score * 10),
          evidence: {
            issues: locationRisk.issues
          }
        });
      }

      // 5. Content Analysis (10% weight)
      const contentRisk = await this.analyzeContent(car);
      riskScore += contentRisk.score * 0.10;
      if (contentRisk.suspicious) {
        indicators.push({
          indicator_type: "fake_documents",
          severity: this.calculateSeverity(contentRisk.score),
          description: "Suspicious content patterns detected",
          confidence_score: Math.min(100, contentRisk.score * 10),
          evidence: {
            flags: contentRisk.flags
          }
        });
      }

      const finalRiskScore = Math.min(10, riskScore);
      const riskLevel = this.categorizeRisk(finalRiskScore);

      // Store fraud analysis result
      await this.storeFraudAnalysis(carId, finalRiskScore, indicators);

      // Auto-action based on risk level
      const autoAction = this.determineAutoAction(finalRiskScore, indicators);

      const result: FraudAnalysisResult = {
        car_id: carId,
        risk_score: finalRiskScore,
        risk_level: riskLevel,
        indicators,
        recommendations: this.generateRecommendations(finalRiskScore, indicators),
        auto_action: autoAction
      };

      logger.info(`Fraud analysis completed for car ${carId}: Risk ${finalRiskScore}/10 (${riskLevel})`);
      return result;

    } catch (error) {
      logger.error("Error analyzing seller behavior:", error);
      return { score: 5, suspicious: false, indicators: ["analysis_error"] };
    }
  }

  /**
   * Analyze location inconsistencies
   */
  private async analyzeLocation(car: any): Promise<LocationRisk> {
    try {
      const issues: string[] = [];
      let score = 0;

      // Check if coordinates match declared city
      if (car.latitude && car.longitude && car.city_id) {
        const nearestCity = await this.db.execute(
          `SELECT id, name, 
           ST_Distance_Sphere(location_point, ST_SRID(POINT(?, ?), 4326)) / 1000 as distance_km
           FROM ph_cities 
           ORDER BY distance_km ASC 
           LIMIT 1`,
          [car.longitude, car.latitude]
        );

        if (nearestCity.length > 0) {
          const distance = nearestCity[0].distance_km;
          if (distance > 50) { // More than 50km from declared city
            issues.push("coordinates_city_mismatch");
            score += 6;
          } else if (distance > 20) {
            issues.push("coordinates_city_distant");
            score += 3;
          }
        }
      }

      // Check for impossible coordinates
      if (car.latitude && car.longitude) {
        if (car.latitude < 4.0 || car.latitude > 21.0 || 
            car.longitude < 116.0 || car.longitude > 127.0) {
          issues.push("coordinates_outside_philippines");
          score += 10;
        }
      }

      // Check seller location vs car location
      const sellerLocation = await this.db.execute(
        "SELECT city_id, province_id FROM users WHERE id = ?",
        [car.seller_id]
      );

      if (sellerLocation.length > 0) {
        const seller = sellerLocation[0];
        if (seller.province_id !== car.province_id) {
          issues.push("seller_car_location_mismatch");
          score += 2;
        }
      }

      return {
        score: Math.min(10, score),
        suspicious: score > 5,
        issues
      };

    } catch (error) {
      logger.error("Error analyzing location:", error);
      return { score: 0, suspicious: false, issues: ["analysis_error"] };
    }
  }

  /**
   * Analyze content for suspicious patterns
   */
  private async analyzeContent(car: any): Promise<ContentRisk> {
    try {
      const flags: string[] = [];
      let score = 0;

      // Check for suspicious keywords
      const suspiciousKeywords = [
        'urgent', 'must sell', 'leaving country', 'military', 'divorce',
        'cash only', 'no checks', 'no inspection', 'sold as is'
      ];

      const content = `${car.title} ${car.description}`.toLowerCase();
      const foundKeywords = suspiciousKeywords.filter(keyword => 
        content.includes(keyword)
      );

      if (foundKeywords.length > 0) {
        flags.push("suspicious_keywords");
        score += foundKeywords.length * 1.5;
      }

      // Check for excessive capitalization
      const capsCount = (car.title.match(/[A-Z]/g) || []).length;
      if (capsCount > car.title.length * 0.7) {
        flags.push("excessive_caps");
        score += 2;
      }

      // Check for minimal description
      if (!car.description || car.description.length < 50) {
        flags.push("minimal_description");
        score += 3;
      }

      // Check for phone numbers in description (against policy)
      const phonePattern = /(\+?63|0)[0-9]{10}/g;
      if (phonePattern.test(content)) {
        flags.push("phone_in_description");
        score += 4;
      }

      // Check for external links
      const urlPattern = /(https?:\/\/[^\s]+)/g;
      if (urlPattern.test(content)) {
        flags.push("external_links");
        score += 3;
      }

      return {
        score: Math.min(10, score),
        suspicious: score > 5,
        flags
      };

    } catch (error) {
      logger.error("Error analyzing content:", error);
      return { score: 0, suspicious: false, flags: ["analysis_error"] };
    }
  }

  // Helper methods
  private async getCarData(carId: number): Promise<any> {
    const cars = await this.db.execute(
      `SELECT c.*, b.name as brand_name, m.name as model_name 
       FROM cars c 
       INNER JOIN brands b ON c.brand_id = b.id 
       INNER JOIN models m ON c.model_id = m.id 
       WHERE c.id = ?`,
      [carId]
    );
    return cars.length > 0 ? cars[0] : null;
  }

  private async getSellerData(sellerId: number): Promise<any> {
    const sellers = await this.db.execute(
      "SELECT * FROM users WHERE id = ?",
      [sellerId]
    );
    return sellers.length > 0 ? sellers[0] : null;
  }

  private calculateMedian(numbers: number[]): number {
    const sorted = numbers.sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 
      ? (sorted[middle - 1] + sorted[middle]) / 2 
      : sorted[middle];
  }

  private calculateSeverity(score: number): "low" | "medium" | "high" | "critical" {
    if (score >= 8) return "critical";
    if (score >= 6) return "high";
    if (score >= 3) return "medium";
    return "low";
  }

  private categorizeRisk(score: number): "low" | "medium" | "high" | "critical" {
    if (score >= 8) return "critical";
    if (score >= 6) return "high";
    if (score >= 4) return "medium";
    return "low";
  }

  private determineAutoAction(score: number, indicators: FraudIndicator[]): "approve" | "flag" | "suspend" {
    const criticalIndicators = indicators.filter(i => i.severity === "critical");
    
    if (score >= 8 || criticalIndicators.length > 0) return "suspend";
    if (score >= 6) return "flag";
    return "approve";
  }

  private generateRecommendations(score: number, indicators: FraudIndicator[]): string[] {
    const recommendations: string[] = [];

    if (score >= 8) {
      recommendations.push("Suspend listing immediately");
      recommendations.push("Conduct manual investigation");
      recommendations.push("Contact seller for verification");
    } else if (score >= 6) {
      recommendations.push("Flag for manual review");
      recommendations.push("Request additional documentation");
    } else if (score >= 4) {
      recommendations.push("Monitor seller activity");
      recommendations.push("Request verification if not already verified");
    } else {
      recommendations.push("Approved - continue monitoring");
    }

    // Specific recommendations based on indicators
    indicators.forEach(indicator => {
      switch (indicator.indicator_type) {
        case "suspicious_price":
          recommendations.push("Verify market research and pricing justification");
          break;
        case "duplicate_images":
          recommendations.push("Request original photos with timestamp");
          break;
        case "unusual_activity":
          recommendations.push("Review seller's recent activity patterns");
          break;
        case "fake_location":
          recommendations.push("Verify actual vehicle location");
          break;
      }
    });

    return [...new Set(recommendations)]; // Remove duplicates
  }

  private async storeFraudAnalysis(carId: number, riskScore: number, indicators: FraudIndicator[]): Promise<void> {
    try {
      // Store in fraud_reports table
      await this.db.execute(
        `INSERT INTO fraud_reports (car_id, risk_score, risk_level, indicators, analysis_date) 
         VALUES (?, ?, ?, ?, NOW())`,
        [carId, riskScore, this.categorizeRisk(riskScore), JSON.stringify(indicators)]
      );

      // Cache the result for quick access
      await redis.setex(`fraud_analysis:${carId}`, 3600, JSON.stringify({
        risk_score: riskScore,
        risk_level: this.categorizeRisk(riskScore),
        indicators,
        analyzed_at: new Date()
      }));

    } catch (error) {
      logger.error("Error storing fraud analysis:", error);
    }
  }

  /**
   * Quick fraud check from cache
   */
  async getQuickFraudCheck(carId: number): Promise<any> {
    try {
      const cached = await redis.get(`fraud_analysis:${carId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error("Error getting quick fraud check:", error);
      return null;
    }
  }

  /**
   * Bulk fraud analysis for multiple cars
   */
  async bulkAnalyzeCars(carIds: number[]): Promise<FraudAnalysisResult[]> {
    const results: FraudAnalysisResult[] = [];
    
    for (const carId of carIds) {
      try {
        const result = await this.analyzeListing(carId);
        results.push(result);
        
        // Small delay to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        logger.error(`Error in bulk analysis for car ${carId}:`, error);
      }
    }

    return results;
  }
}
      logger.error(`Error analyzing car ${carId} for fraud:`, error);
      throw error;
    }
  }

  /**
   * Analyze price anomalies compared to market data
   */
  private async analyzePriceAnomalies(car: any): Promise<PriceRisk> {
    try {
      // Get market data for similar cars
      const marketQuery = `
        SELECT price 
        FROM cars 
        WHERE brand_id = ? 
          AND model_id = ? 
          AND year BETWEEN ? AND ?
          AND approval_status = 'approved'
          AND status = 'active'
          AND id != ?
        ORDER BY created_at DESC 
        LIMIT 50
      `;

      const marketData = await this.db.execute(marketQuery, [
        car.brand_id,
        car.model_id,
        car.year - 1,
        car.year + 1,
        car.id
      ]);

      if (marketData.length < 3) {
        // Not enough market data for comparison
        return { score: 0, suspicious: false, marketPrice: car.price, deviation: 0 };
      }

      const prices = marketData.map((item: any) => item.price);
      const medianPrice = this.calculateMedian(prices);
      const priceDeviation = Math.abs(car.price - medianPrice) / medianPrice;

      // Suspicious if price is >40% below market or >200% above
      const suspicious = (priceDeviation > 0.4 && car.price < medianPrice) || 
                        (priceDeviation > 2.0 && car.price > medianPrice);

      return {
        score: Math.min(10, priceDeviation * 5),
        suspicious,
        marketPrice: medianPrice,
        deviation: priceDeviation
      };

    } catch (error) {
      logger.error("Error analyzing price anomalies:", error);
      return { score: 0, suspicious: false, marketPrice: car.price, deviation: 0 };
    }
  }

  /**
   * Analyze images for duplicates and suspicious patterns
   */
  private async analyzeImages(carId: number): Promise<ImageRisk> {
    try {
      // Get car images
      const images = await this.db.execute(
        "SELECT image_url FROM car_images WHERE car_id = ? AND processing_status = 'ready'",
        [carId]
      );

      if (images.length === 0) {
        return { score: 8, duplicates: true }; // High risk if no images
      }

      // Check for duplicate images across other listings
      // This would use image hashing/comparison in real implementation
      const duplicateQuery = `
        SELECT DISTINCT ci2.car_id, COUNT(*) as duplicate_count
        FROM car_images ci1
        INNER JOIN car_images ci2 ON ci1.image_url = ci2.image_url
        WHERE ci1.car_id = ? AND ci2.car_id != ?
        GROUP BY ci2.car_id
      `;

      const duplicates = await this.db.execute(duplicateQuery, [carId, carId]);
      
      if (duplicates.length > 0) {
        const totalDuplicates = duplicates.reduce((sum: number, dup: any) => sum + dup.duplicate_count, 0);
        return {
          score: Math.min(10, totalDuplicates * 2),
          duplicates: true,
          duplicateCount: totalDuplicates,
          suspiciousPatterns: ["identical_images_from_other_listings"]
        };
      }

      // Check for other suspicious patterns
      const suspiciousPatterns: string[] = [];
      
      // Too few images
      if (images.length < 3) {
        suspiciousPatterns.push("insufficient_images");
      }

      // All images from same angle (would need image analysis)
      // This is a placeholder for actual image analysis

      return {
        score: suspiciousPatterns.length * 2,
        duplicates: false,
        suspiciousPatterns
      };

    } catch (error) {
      logger.error("Error analyzing images:", error);
      return { score: 5, duplicates: false };
    }
  }

  /**
   * Analyze seller behavior patterns
   */
  private async analyzeSellerBehavior(seller: any): Promise<SellerRisk> {
    try {
      const indicators: string[] = [];
      let score = 0;

      // Check account age
      const accountAge = Date.now() - new Date(seller.created_at).getTime();
      const daysOld = accountAge / (1000 * 60 * 60 * 24);
      
      if (daysOld < 7) {
        indicators.push("very_new_account");
        score += 3;
      } else if (daysOld < 30) {
        indicators.push("new_account");
        score += 1;
      }

      // Check listing frequency
      const recentListings = await this.db.execute(
        "SELECT COUNT(*) as count FROM cars WHERE seller_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAYS)",
        [seller.id]
      );

      if (recentListings[0].count > 10) {
        indicators.push("excessive_listing_frequency");
        score += 4;
      } else if (recentListings[0].count > 5) {
        indicators.push("high_listing_frequency");
        score += 2;
      }

      // Check verification status
      if (!seller.is_verified) {
        indicators.push("unverified_seller");
        score += 2;
      }

      // Check fraud score
      if (seller.fraud_score > 5) {
        indicators.push("high_fraud_score");
        score += seller.fraud_score;
      }

      // Check warning count
      if (seller.warning_count > 0) {
        indicators.push("previous_warnings");
        score += seller.warning_count * 2;
      }

      return {
        score: Math.min(10, score),
        suspicious: score > 5,
        indicators
      };

    } catch (error) {
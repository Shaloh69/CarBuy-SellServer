// src/models/Currency.ts
import { RowDataPacket } from "mysql2";
import database, { QueryBuilder } from "../config/database";
import logger from "../utils/logger";

export interface Currency {
  id: number;
  code: string;
  name: string;
  symbol: string;
  exchange_rate_to_php: number;
  is_active: boolean;
  updated_at: Date;
}

export interface CreateCurrencyData {
  code: string;
  name: string;
  symbol: string;
  exchange_rate_to_php?: number;
  is_active?: boolean;
}

export interface UpdateCurrencyData {
  name?: string;
  symbol?: string;
  exchange_rate_to_php?: number;
  is_active?: boolean;
}

export interface CurrencyConversion {
  from_currency: string;
  to_currency: string;
  amount: number;
  converted_amount: number;
  exchange_rate: number;
  conversion_date: Date;
}

export class CurrencyModel {
  private static tableName = "currencies";

  // Create new currency
  static async create(currencyData: CreateCurrencyData): Promise<Currency> {
    try {
      const insertData = {
        ...currencyData,
        exchange_rate_to_php: currencyData.exchange_rate_to_php || 1.0,
        is_active: currencyData.is_active ?? true,
      };

      const result = await QueryBuilder.insert(this.tableName)
        .values(insertData)
        .execute();

      const currencyId = (result as any).insertId;
      const currency = await this.findById(currencyId);

      if (!currency) {
        throw new Error("Failed to create currency");
      }

      logger.info(`Currency created: ${currency.code} - ${currency.name}`);
      return currency;
    } catch (error) {
      logger.error("Error creating currency:", error);
      throw error;
    }
  }

  // Find by ID
  static async findById(id: number): Promise<Currency | null> {
    try {
      const currencies = await QueryBuilder.select()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      return currencies.length > 0 ? currencies[0] : null;
    } catch (error) {
      logger.error(`Error finding currency by ID ${id}:`, error);
      return null;
    }
  }

  // Find by code
  static async findByCode(code: string): Promise<Currency | null> {
    try {
      const currencies = await QueryBuilder.select()
        .from(this.tableName)
        .where("code = ?", code.toUpperCase())
        .execute();

      return currencies.length > 0 ? currencies[0] : null;
    } catch (error) {
      logger.error(`Error finding currency by code ${code}:`, error);
      return null;
    }
  }

  // Get all active currencies
  static async getAllActive(): Promise<Currency[]> {
    try {
      const currencies = await QueryBuilder.select()
        .from(this.tableName)
        .where("is_active = ?", true)
        .orderBy("code", "ASC")
        .execute();

      return currencies;
    } catch (error) {
      logger.error("Error getting all active currencies:", error);
      return [];
    }
  }

  // Get all currencies with pagination
  static async getAll(
    page: number = 1,
    limit: number = 20,
    includeInactive: boolean = false
  ): Promise<{
    currencies: Currency[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      let query = QueryBuilder.select().from(this.tableName);

      if (!includeInactive) {
        query = query.where("is_active = ?", true);
      }

      // Get total count
      const totalQuery = query.clone().select(["COUNT(*) as total"]);
      const totalResult = await totalQuery.execute();
      const total = totalResult[0].total;

      // Get paginated results
      const currencies = await query
        .orderBy("code", "ASC")
        .limit(limit)
        .offset((page - 1) * limit)
        .execute();

      return {
        currencies,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error("Error getting all currencies:", error);
      return {
        currencies: [],
        total: 0,
        page,
        totalPages: 0,
      };
    }
  }

  // Update currency
  static async update(
    id: number,
    updateData: UpdateCurrencyData
  ): Promise<Currency | null> {
    try {
      await QueryBuilder.update(this.tableName)
        .set(updateData)
        .where("id = ?", id)
        .execute();

      const currency = await this.findById(id);
      
      if (currency) {
        logger.info(`Currency updated: ${currency.code} - ${currency.name}`);
      }

      return currency;
    } catch (error) {
      logger.error(`Error updating currency ${id}:`, error);
      return null;
    }
  }

  // Update exchange rate
  static async updateExchangeRate(
    code: string,
    newRate: number
  ): Promise<boolean> {
    try {
      const result = await QueryBuilder.update(this.tableName)
        .set({ exchange_rate_to_php: newRate })
        .where("code = ?", code.toUpperCase())
        .execute();

      const affectedRows = (result as any).affectedRows;
      
      if (affectedRows > 0) {
        logger.info(`Exchange rate updated for ${code}: ${newRate} PHP`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Error updating exchange rate for ${code}:`, error);
      return false;
    }
  }

  // Bulk update exchange rates
  static async bulkUpdateExchangeRates(
    rates: Array<{ code: string; rate: number }>
  ): Promise<{ updated: number; failed: string[] }> {
    const result = { updated: 0, failed: [] };

    for (const { code, rate } of rates) {
      try {
        const success = await this.updateExchangeRate(code, rate);
        if (success) {
          result.updated++;
        } else {
          result.failed.push(code);
        }
      } catch (error) {
        result.failed.push(code);
        logger.error(`Failed to update exchange rate for ${code}:`, error);
      }
    }

    return result;
  }

  // Convert amount between currencies
  static async convertCurrency(
    fromCode: string,
    toCode: string,
    amount: number
  ): Promise<CurrencyConversion | null> {
    try {
      const fromCurrency = await this.findByCode(fromCode);
      const toCurrency = await this.findByCode(toCode);

      if (!fromCurrency || !toCurrency) {
        throw new Error("Invalid currency code");
      }

      if (!fromCurrency.is_active || !toCurrency.is_active) {
        throw new Error("Currency is not active");
      }

      // Convert to PHP first, then to target currency
      const amountInPHP = amount * fromCurrency.exchange_rate_to_php;
      const convertedAmount = amountInPHP / toCurrency.exchange_rate_to_php;
      const exchangeRate = fromCurrency.exchange_rate_to_php / toCurrency.exchange_rate_to_php;

      return {
        from_currency: fromCode.toUpperCase(),
        to_currency: toCode.toUpperCase(),
        amount,
        converted_amount: Math.round(convertedAmount * 100) / 100, // Round to 2 decimal places
        exchange_rate: Math.round(exchangeRate * 10000) / 10000, // Round to 4 decimal places
        conversion_date: new Date(),
      };
    } catch (error) {
      logger.error(`Error converting currency ${fromCode} to ${toCode}:`, error);
      return null;
    }
  }

  // Get exchange rate between two currencies
  static async getExchangeRate(
    fromCode: string,
    toCode: string
  ): Promise<number | null> {
    try {
      const conversion = await this.convertCurrency(fromCode, toCode, 1);
      return conversion ? conversion.exchange_rate : null;
    } catch (error) {
      logger.error(`Error getting exchange rate ${fromCode} to ${toCode}:`, error);
      return null;
    }
  }

  // Convert amount to PHP
  static async toPHP(code: string, amount: number): Promise<number | null> {
    try {
      const currency = await this.findByCode(code);
      
      if (!currency || !currency.is_active) {
        return null;
      }

      return Math.round(amount * currency.exchange_rate_to_php * 100) / 100;
    } catch (error) {
      logger.error(`Error converting ${code} to PHP:`, error);
      return null;
    }
  }

  // Convert amount from PHP
  static async fromPHP(code: string, phpAmount: number): Promise<number | null> {
    try {
      const currency = await this.findByCode(code);
      
      if (!currency || !currency.is_active) {
        return null;
      }

      return Math.round((phpAmount / currency.exchange_rate_to_php) * 100) / 100;
    } catch (error) {
      logger.error(`Error converting PHP to ${code}:`, error);
      return null;
    }
  }

  // Activate/Deactivate currency
  static async setActive(id: number, isActive: boolean): Promise<boolean> {
    try {
      const result = await QueryBuilder.update(this.tableName)
        .set({ is_active: isActive })
        .where("id = ?", id)
        .execute();

      const affectedRows = (result as any).affectedRows;
      
      if (affectedRows > 0) {
        const currency = await this.findById(id);
        if (currency) {
          logger.info(`Currency ${currency.code} ${isActive ? 'activated' : 'deactivated'}`);
        }
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Error setting currency active status ${id}:`, error);
      return false;
    }
  }

  // Delete currency (soft delete by deactivating)
  static async delete(id: number): Promise<boolean> {
    try {
      // Check if currency is being used in any car listings
      const carsUsingCurrency = await database.execute(
        "SELECT COUNT(*) as count FROM cars WHERE currency = (SELECT code FROM currencies WHERE id = ?)",
        [id]
      );

      if (carsUsingCurrency[0].count > 0) {
        // Soft delete - just deactivate
        return await this.setActive(id, false);
      }

      // Hard delete if not being used
      const result = await QueryBuilder.delete()
        .from(this.tableName)
        .where("id = ?", id)
        .execute();

      const affectedRows = (result as any).affectedRows;
      
      if (affectedRows > 0) {
        logger.info(`Currency deleted: ID ${id}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Error deleting currency ${id}:`, error);
      return false;
    }
  }

  // Get supported currency codes
  static async getSupportedCodes(): Promise<string[]> {
    try {
      const currencies = await QueryBuilder.select(["code"])
        .from(this.tableName)
        .where("is_active = ?", true)
        .execute();

      return currencies.map(c => c.code);
    } catch (error) {
      logger.error("Error getting supported currency codes:", error);
      return [];
    }
  }

  // Format amount with currency symbol
  static async formatAmount(
    amount: number,
    currencyCode: string,
    locale: string = "en-PH"
  ): Promise<string> {
    try {
      const currency = await this.findByCode(currencyCode);
      
      if (!currency) {
        return `${amount} ${currencyCode}`;
      }

      // Use Intl.NumberFormat for proper formatting
      try {
        const formatter = new Intl.NumberFormat(locale, {
          style: "currency",
          currency: currencyCode === "PHP" ? "PHP" : "USD", // Fallback for unsupported currencies
          minimumFractionDigits: currencyCode === "JPY" ? 0 : 2,
        });

        return formatter.format(amount);
      } catch {
        // Fallback formatting
        const formattedAmount = amount.toLocaleString(locale, {
          minimumFractionDigits: currencyCode === "JPY" ? 0 : 2,
          maximumFractionDigits: currencyCode === "JPY" ? 0 : 2,
        });
        
        return `${currency.symbol}${formattedAmount}`;
      }
    } catch (error) {
      logger.error(`Error formatting amount ${amount} ${currencyCode}:`, error);
      return `${amount} ${currencyCode}`;
    }
  }

  // Get currency statistics
  static async getStatistics(): Promise<{
    total_currencies: number;
    active_currencies: number;
    most_used_currency: string | null;
    average_exchange_rate: number;
  }> {
    try {
      const stats = await database.execute(`
        SELECT 
          COUNT(*) as total_currencies,
          SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active_currencies,
          AVG(exchange_rate_to_php) as average_exchange_rate
        FROM ${this.tableName}
      `);

      // Get most used currency
      const mostUsed = await database.execute(`
        SELECT 
          c.code,
          COUNT(cars.id) as usage_count
        FROM ${this.tableName} c
        LEFT JOIN cars ON c.code = cars.currency
        WHERE c.is_active = TRUE
        GROUP BY c.code
        ORDER BY usage_count DESC
        LIMIT 1
      `);

      return {
        total_currencies: stats[0].total_currencies || 0,
        active_currencies: stats[0].active_currencies || 0,
        most_used_currency: mostUsed.length > 0 ? mostUsed[0].code : null,
        average_exchange_rate: Math.round((stats[0].average_exchange_rate || 0) * 100) / 100,
      };
    } catch (error) {
      logger.error("Error getting currency statistics:", error);
      return {
        total_currencies: 0,
        active_currencies: 0,
        most_used_currency: null,
        average_exchange_rate: 0,
      };
    }
  }
}
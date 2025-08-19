import mysql from "mysql2/promise";
import { config } from "./env";
import logger from "../utils/logger";

class DatabaseManager {
  private static instance: DatabaseManager;
  private pool: mysql.Pool;

  private constructor() {
    this.pool = mysql.createPool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.username,
      password: config.database.password,
      database: config.database.database,
      timezone: config.database.timezone,
      connectionLimit: config.database.connectionLimit,
      acquireTimeout: config.database.acquireTimeout,
      timeout: config.database.timeout,
      supportBigNumbers: true,
      bigNumberStrings: true,
      multipleStatements: false,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      namedPlaceholders: true,
    });

    this.setupEventListeners();
  }

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  private setupEventListeners(): void {
    this.pool.on("connection", (connection) => {
      logger.info(
        `New database connection established as id ${connection.threadId}`
      );
    });

    this.pool.on("error", (err) => {
      logger.error("Database pool error:", err);
      if (err.code === "PROTOCOL_CONNECTION_LOST") {
        logger.info("Attempting to reconnect to database...");
      }
    });
  }

  public getPool(): mysql.Pool {
    return this.pool;
  }

  // Execute single query
  public async execute(query: string, params?: any[]): Promise<any> {
    const start = Date.now();
    try {
      const [rows] = await this.pool.execute(query, params);
      const duration = Date.now() - start;

      if (duration > 1000) {
        logger.warn(`Slow query detected (${duration}ms):`, { query, params });
      }

      return rows;
    } catch (error) {
      logger.error("Database query error:", { error, query, params });
      throw error;
    }
  }

  // Execute multiple queries in transaction
  public async transaction<T>(
    callback: (connection: mysql.PoolConnection) => Promise<T>
  ): Promise<T> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      logger.error("Transaction error:", error);
      throw error;
    } finally {
      connection.release();
    }
  }

  // Get database health status
  public async getHealthStatus(): Promise<{
    status: "healthy" | "unhealthy";
    connectionCount: number;
    uptime: number;
  }> {
    try {
      const [statusRows] = await this.pool.execute(
        'SHOW STATUS WHERE Variable_name = "Threads_connected"'
      );
      const [uptimeRows] = await this.pool.execute(
        'SHOW STATUS WHERE Variable_name = "Uptime"'
      );

      return {
        status: "healthy",
        connectionCount: (statusRows as any)[0]?.Value || 0,
        uptime: (uptimeRows as any)[0]?.Value || 0,
      };
    } catch (error) {
      logger.error("Database health check failed:", error);
      return {
        status: "unhealthy",
        connectionCount: 0,
        uptime: 0,
      };
    }
  }

  // Close all connections
  public async close(): Promise<void> {
    try {
      await this.pool.end();
      logger.info("Database connections closed");
    } catch (error) {
      logger.error("Error closing database connections:", error);
    }
  }
}

// Database query builder helpers
export class QueryBuilder {
  private query: string = "";
  private params: any[] = [];

  static select(columns: string | string[] = "*"): QueryBuilder {
    const qb = new QueryBuilder();
    const cols = Array.isArray(columns) ? columns.join(", ") : columns;
    qb.query = `SELECT ${cols}`;
    return qb;
  }

  static insert(table: string): QueryBuilder {
    const qb = new QueryBuilder();
    qb.query = `INSERT INTO ${table}`;
    return qb;
  }

  static update(table: string): QueryBuilder {
    const qb = new QueryBuilder();
    qb.query = `UPDATE ${table}`;
    return qb;
  }

  static delete(): QueryBuilder {
    const qb = new QueryBuilder();
    qb.query = "DELETE";
    return qb;
  }

  from(table: string): QueryBuilder {
    this.query += ` FROM ${table}`;
    return this;
  }

  join(table: string, condition: string): QueryBuilder {
    this.query += ` JOIN ${table} ON ${condition}`;
    return this;
  }

  leftJoin(table: string, condition: string): QueryBuilder {
    this.query += ` LEFT JOIN ${table} ON ${condition}`;
    return this;
  }

  where(condition: string, value?: any): QueryBuilder {
    const hasWhere = this.query.includes("WHERE");
    this.query += hasWhere ? ` AND ${condition}` : ` WHERE ${condition}`;
    if (value !== undefined) {
      this.params.push(value);
    }
    return this;
  }

  orWhere(condition: string, value?: any): QueryBuilder {
    this.query += ` OR ${condition}`;
    if (value !== undefined) {
      this.params.push(value);
    }
    return this;
  }

  groupBy(columns: string | string[]): QueryBuilder {
    const cols = Array.isArray(columns) ? columns.join(", ") : columns;
    this.query += ` GROUP BY ${cols}`;
    return this;
  }

  orderBy(column: string, direction: "ASC" | "DESC" = "ASC"): QueryBuilder {
    this.query += ` ORDER BY ${column} ${direction}`;
    return this;
  }

  limit(count: number, offset?: number): QueryBuilder {
    this.query += ` LIMIT ${count}`;
    if (offset !== undefined) {
      this.query += ` OFFSET ${offset}`;
    }
    return this;
  }

  values(data: Record<string, any>): QueryBuilder {
    const columns = Object.keys(data);
    const placeholders = columns.map(() => "?").join(", ");
    this.query += ` (${columns.join(", ")}) VALUES (${placeholders})`;
    this.params.push(...Object.values(data));
    return this;
  }

  set(data: Record<string, any>): QueryBuilder {
    const setParts = Object.keys(data).map((key) => `${key} = ?`);
    this.query += ` SET ${setParts.join(", ")}`;
    this.params.push(...Object.values(data));
    return this;
  }

  build(): { query: string; params: any[] } {
    return { query: this.query, params: this.params };
  }

  async execute(
    db: DatabaseManager = DatabaseManager.getInstance()
  ): Promise<any> {
    return await db.execute(this.query, this.params);
  }
}

// Common database utilities
export class DatabaseUtils {
  static async checkTableExists(tableName: string): Promise<boolean> {
    const db = DatabaseManager.getInstance();
    const [rows] = await db.execute(
      "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
      [config.database.database, tableName]
    );
    return (rows as any)[0].count > 0;
  }

  static async getTableRowCount(tableName: string): Promise<number> {
    const db = DatabaseManager.getInstance();
    const [rows] = await db.execute(
      `SELECT COUNT(*) as count FROM ${tableName}`
    );
    return (rows as any)[0].count;
  }

  static escapeId(identifier: string): string {
    return mysql.escapeId(identifier);
  }

  static escape(value: any): string {
    return mysql.escape(value);
  }

  static formatInsertData(data: Record<string, any>): {
    columns: string;
    placeholders: string;
    values: any[];
  } {
    const keys = Object.keys(data);
    return {
      columns: keys.join(", "),
      placeholders: keys.map(() => "?").join(", "),
      values: Object.values(data),
    };
  }

  static formatUpdateData(data: Record<string, any>): {
    setClause: string;
    values: any[];
  } {
    const keys = Object.keys(data);
    return {
      setClause: keys.map((key) => `${key} = ?`).join(", "),
      values: Object.values(data),
    };
  }
}

const database = DatabaseManager.getInstance();
export default database;

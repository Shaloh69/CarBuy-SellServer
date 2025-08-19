#!/usr/bin/env node

/**
 * Car Marketplace Philippines API Server
 *
 * A comprehensive Node.js TypeScript server for a car marketplace
 * specifically designed for the Philippines market with real-time features,
 * advanced search, fraud detection, and location-based services.
 *
 * Features:
 * - JWT Authentication & Authorization
 * - Multi-level Caching (Redis + Memory)
 * - Real-time Updates via Socket.IO
 * - Advanced Car Search with ML-based Ranking
 * - Philippines Location Services
 * - Fraud Detection System
 * - Rate Limiting & Security
 * - Image Processing & Storage
 * - Email & SMS Notifications
 * - Analytics & Reporting
 */

import "dotenv/config";
import App from "./src/app";
import logger from "./src/utils/logger";

// Banner
const displayBanner = (): void => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║            🚗 CAR MARKETPLACE PHILIPPINES API 🇵🇭            ║
║                                                              ║
║  ⚡ Node.js + TypeScript + Redis + Socket.IO + MySQL        ║
║  🔍 Smart Search • 📍 Location Services • 🔒 Security      ║
║  📊 Analytics • 💬 Real-time • 🛡️ Fraud Detection          ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
};

// Main server startup function
async function startServer(): Promise<void> {
  try {
    displayBanner();

    logger.info("Starting Car Marketplace Philippines API Server...");

    // Create and start the application
    const app = new App();
    await app.start();
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Handle uncaught exceptions and unhandled rejections
process.on("uncaughtException", (error: Error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Start the server
if (require.main === module) {
  startServer();
}

export default startServer;

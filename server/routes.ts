import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { pool, db } from "./db"; // Import pool for direct SQL queries
import { findLocationByPincode } from "./pincode-data"; // Import PIN code lookup function
import { setupAuth } from "./auth";
import { setupWebSocketServer, sendNotificationToUser } from "./websocket"; // Add websocket server
import * as emailService from "./services/email-service"; // Import email service for order notifications
import multer from "multer";
import * as shiprocketHandlers from "./handlers/shiprocket-handlers"; // Re-add Shiprocket integration
import * as multiSellerOrderHandler from "./handlers/multi-seller-order-handler";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { uploadFile, getPresignedDownloadUrl, deleteFile } from "./helpers/s3";
import * as XLSX from "xlsx";
import templateService from "./services/template-service";
import * as pdfGenerator from "./services/pdf-generator"; // Import PDF generator service
import { getShippingLabelTemplate } from "./services/pdf-generator"; // Import shipping label template
import handlebars from "handlebars"; // For template rendering
import fs from "fs"; // For writing files
import {
  and,
  eq,
  inArray,
  desc,
  gt,
  gte,
  lt,
  lte,
  or,
  asc,
  count,
  sql,
  ilike,
} from "drizzle-orm";
import {
  products,
  carts,
  users,
  categories,
  productVariants,
  orders,
  orderItems,
} from "@shared/schema";
import returnRoutes from "./routes/return-routes"; // Import return management routes
import * as backupHandlers from "./handlers/backup-handlers"; // Import backup handlers
import { scheduleDailyBackup } from "./services/scheduler-service"; // Import scheduler service
import {
  exportProductsToExcel,
  exportAllProductsToExcel,
} from "./handlers/export-handler"; // Import export handlers
import QRCode from "qrcode";
import { sendEmail, EMAIL_TEMPLATES } from "./services/email-service";
import affiliateMarketingRoutes from "./routes/affiliate-marketing-routes";

// Helper function to apply product display settings
function applyProductDisplaySettings(products: any[], settings: any) {
  if (!settings || !products || products.length === 0) {
    return products;
  }

  const { displayType, config } = settings;
  let sortedProducts = [...products];

  switch (displayType) {
    case "vendor":
      // Sort by preferred vendors
      if (
        config.preferredVendorIds &&
        Array.isArray(config.preferredVendorIds)
      ) {
        sortedProducts.sort((a, b) => {
          const aIndex = config.preferredVendorIds.indexOf(a.sellerId);
          const bIndex = config.preferredVendorIds.indexOf(b.sellerId);

          // If both vendors are in the preferred list
          if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex;
          }
          // If only a is in the preferred list
          if (aIndex !== -1) {
            return -1;
          }
          // If only b is in the preferred list
          if (bIndex !== -1) {
            return 1;
          }
          // If neither is in the preferred list, keep original order
          return 0;
        });
      }
      break;

    case "category":
      // Sort by preferred categories
      if (
        config.preferredCategories &&
        Array.isArray(config.preferredCategories)
      ) {
        sortedProducts.sort((a, b) => {
          const aIndex = config.preferredCategories.findIndex(
            (cat: string) => cat.toLowerCase() === a.category.toLowerCase()
          );
          const bIndex = config.preferredCategories.findIndex(
            (cat: string) => cat.toLowerCase() === b.category.toLowerCase()
          );

          // If both categories are in the preferred list
          if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex;
          }
          // If only a is in the preferred list
          if (aIndex !== -1) {
            return -1;
          }
          // If only b is in the preferred list
          if (bIndex !== -1) {
            return 1;
          }
          // If neither is in the preferred list, keep original order
          return 0;
        });
      }
      break;

    case "price_asc":
      // Sort by price ascending
      sortedProducts.sort((a, b) => a.price - b.price);
      break;

    case "price_desc":
      // Sort by price descending
      sortedProducts.sort((a, b) => b.price - a.price);
      break;

    case "rotation_vendor":
      // Rotate products by vendor - spread products from different vendors
      const vendorGroups = new Map();
      sortedProducts.forEach((product) => {
        if (!vendorGroups.has(product.sellerId)) {
          vendorGroups.set(product.sellerId, []);
        }
        vendorGroups.get(product.sellerId).push(product);
      });

      sortedProducts = [];
      let allVendorProducts = Array.from(vendorGroups.values());
      let maxProducts = Math.max(
        ...allVendorProducts.map((group) => group.length)
      );

      // Take one product from each vendor in a round-robin fashion
      for (let i = 0; i < maxProducts; i++) {
        for (const vendorProducts of allVendorProducts) {
          if (i < vendorProducts.length) {
            sortedProducts.push(vendorProducts[i]);
          }
        }
      }
      break;

    case "rotation_category":
      // Rotate products by category
      const categoryGroups = new Map();
      sortedProducts.forEach((product) => {
        const category = product.category.toLowerCase();
        if (!categoryGroups.has(category)) {
          categoryGroups.set(category, []);
        }
        categoryGroups.get(category).push(product);
      });

      sortedProducts = [];
      let allCategoryProducts = Array.from(categoryGroups.values());
      let maxCategoryProducts = Math.max(
        ...allCategoryProducts.map((group) => group.length)
      );

      // Take one product from each category in a round-robin fashion
      for (let i = 0; i < maxCategoryProducts; i++) {
        for (const categoryProducts of allCategoryProducts) {
          if (i < categoryProducts.length) {
            sortedProducts.push(categoryProducts[i]);
          }
        }
      }
      break;

    case "recent":
    default:
      // Default behavior - already sorted by most recent
      break;
  }

  return sortedProducts;
}

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB per file
    files: 20, // up to 20 files per request
    fieldSize: 10 * 1024 * 1024, // 10 MB for non-file fields
  },
});

// Configure AWS S3
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_SECRET_KEY!,
  },
});

// Function to upload file to S3 - using the helper from s3.ts
const uploadFileToS3 = async (file: Express.Multer.File) => {
  try {
    // Call the unified helper function to upload
    const url = await uploadFile(file.buffer, file.originalname, file.mimetype);

    // Return in the format expected by existing code
    return {
      Location: url,
    };
  } catch (error) {
    console.error("Error uploading file to S3:", error);
    throw new Error("Failed to upload file to S3");
  }
};

// We now use getPresignedDownloadUrl from s3.ts instead of this function
import {
  insertProductSchema,
  insertProductVariantSchema,
  insertCartSchema,
  insertOrderSchema,
  insertOrderItemSchema,
  insertCategorySchema,
  insertUserAddressSchema,
  insertReviewSchema,
  insertReviewImageSchema,
  insertReviewHelpfulSchema,
  insertUserActivitySchema,
  insertSalesHistorySchema,
  insertDemandForecastSchema,
  insertPriceOptimizationSchema,
  insertInventoryOptimizationSchema,
  insertAiGeneratedContentSchema,
  insertWishlistSchema,
  insertNotificationSchema,
  insertSubcategorySchema,
  NotificationType,
} from "@shared/schema";
import { z } from "zod";
import { handleImageProxy } from "./utils/image-proxy";
import { RecommendationEngine } from "./utils/recommendation-engine";
import {
  createRazorpayOrder,
  handleSuccessfulPayment,
  generateReceiptId,
  getRazorpayKeyId,
  getRazorpayConfigStatus,
} from "./utils/razorpay";
import {
  trackUserActivity,
  getPersonalizedRecommendations,
  getComplementaryProducts,
  getSizeRecommendations,
  generateSessionId,
  getProductQAResponse,
  getAIResponse,
} from "./utils/ai-assistant";
import {
  generateDemandForecast,
  generatePriceOptimization,
  generateInventoryOptimization,
  generateProductContent,
  recordSalesData,
  updatePriceOptimizationStatus,
  updateInventoryOptimizationStatus,
  updateAIContentStatus,
} from "./utils/ml-inventory-manager";
import { handleAISearch } from "./handlers/ai-search-handler";
import * as returnsHandlers from "./handlers/returns-handlers";
import * as analyticsHandlers from "./handlers/analytics-handlers";
import * as paymentsHandlers from "./handlers/payments-handlers";
import * as settingsHandlers from "./handlers/settings-handlers";
import * as supportHandlers from "./handlers/support-handlers";
import * as rewardsHandlers from "./handlers/rewards-handlers";
import * as giftCardsHandlers from "./handlers/gift-cards-handlers";
import * as walletRoutes from "./handlers/wallet-routes";
import * as sellerAgreementHandlers from "./handlers/seller-agreement-handlers";
import * as systemSettingsHandlers from "./handlers/system-settings-handlers";
import {
  getShippingMethods,
  getShippingMethod,
  createShippingMethod,
  updateShippingMethod,
  deleteShippingMethod,
  getShippingZones,
  getShippingZone,
  createShippingZone,
  updateShippingZone,
  deleteShippingZone,
  getShippingRules,
  getShippingRule,
  createShippingRule,
  updateShippingRule,
  deleteShippingRule,
  getSellerShippingSettings,
  createOrUpdateSellerShippingSettings,
  getProductShippingOverrides,
  getProductShippingOverride,
  createOrUpdateProductShippingOverride,
  deleteProductShippingOverride,
  getOrderShippingTracking,
  createOrUpdateOrderShippingTracking,
} from "./handlers/shipping-handlers";

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication routes with OTP-based authentication
  setupAuth(app);

  // Initialize default daily backup at midnight (0:00)
  scheduleDailyBackup(0, 0);

  // Register affiliate marketing routes
  app.use(affiliateMarketingRoutes);

  // Register return management routes
  app.use("/api/returns", returnRoutes);

  // --- FIX: Proxy /api/orders/:orderId/mark-for-return to returnRoutes ---
  app.post("/api/orders/:orderId/mark-for-return", (req, res, next) => {
    req.url = `/orders/${req.params.orderId}/mark-for-return`;
    returnRoutes(req, res, next);
  });

  // Database backup routes - admin only
  app.post("/api/admin/backups/run", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });
    backupHandlers.startBackup(req, res);
  });

  app.post("/api/admin/backups/schedule", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });
    backupHandlers.scheduleBackup(req, res);
  });

  app.get("/api/admin/backups/schedule", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });
    backupHandlers.getScheduleInfo(req, res);
  });

  app.delete("/api/admin/backups/schedule", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });
    backupHandlers.cancelBackup(req, res);
  });

  app.get("/api/admin/backups", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });
    backupHandlers.getBackups(req, res);
  });

  app.get("/api/admin/backups/:filename", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });
    backupHandlers.downloadBackup(req, res);
  });

  app.delete("/api/admin/backups/:filename", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });
    backupHandlers.deleteBackup(req, res);
  });

  // Seller approval routes
  app.get("/api/sellers/pending", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      // Get sellers where approved=false AND rejected=false
      const pendingSellers = await storage.getPendingSellers();
      res.json(pendingSellers);
    } catch (error) {
      console.error("Error fetching pending sellers:", error);
      res.status(500).json({ error: "Failed to fetch pending sellers" });
    }
  });

  app.get("/api/sellers/rejected", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      // Get sellers where rejected=true
      const rejectedSellers = await storage.getRejectedSellers();
      res.json(rejectedSellers);
    } catch (error) {
      console.error("Error fetching rejected sellers:", error);
      res.status(500).json({ error: "Failed to fetch rejected sellers" });
    }
  });

  app.get("/api/sellers/approved", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const approvedSellers = await storage.getApprovedSellers();
      res.json(approvedSellers);
    } catch (error) {
      console.error("Error fetching approved sellers:", error);
      res.status(500).json({ error: "Failed to fetch approved sellers" });
    }
  });

  app.put("/api/sellers/:id/approve", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      // Set approved to true and rejected to false
      const seller = await storage.updateSellerApprovalStatus(id, true, false);
      res.json(seller);
    } catch (error) {
      console.error("Error approving seller:", error);
      res.status(500).json({ error: "Failed to approve seller" });
    }
  });

  app.put("/api/sellers/:id/reject", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      // Set approved to false and rejected to true
      const seller = await storage.updateSellerApprovalStatus(id, false, true);
      res.json(seller);
    } catch (error) {
      console.error("Error rejecting seller:", error);
      res.status(500).json({ error: "Failed to reject seller" });
    }
  });

  // Check if seller is approved
  app.get("/api/seller/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not a seller account" });

    try {
      const seller = await storage.getUser(req.user.id);
      if (!seller) {
        return res.status(404).json({ error: "Seller not found" });
      }

      res.json({
        approved: !!seller.approved,
        rejected: !!seller.rejected,
        message: seller.approved
          ? "Your seller account is approved. You can now list products and manage your store."
          : seller.rejected
            ? "Your seller account has been rejected. Please contact customer support for more information."
            : "Your profile is pending approval by admin. Please update your profile details ASAP so it can be approved quickly.",
      });
    } catch (error) {
      console.error("Error checking seller status:", error);
      res.status(500).json({ error: "Failed to check seller status" });
    }
  });

  // Update seller profile
  app.put("/api/seller/profile", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not a seller account" });

    try {
      // Update the seller profile with the provided data
      const updatedSeller = await storage.updateSellerProfile(
        req.user.id,
        req.body
      );

      // Return the updated profile data
      res.json(updatedSeller);
    } catch (error) {
      console.error("Error updating seller profile:", error);
      res.status(500).json({ error: "Failed to update seller profile" });
    }
  });

  // Get seller documents
  app.get("/api/seller/documents", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not a seller account" });

    try {
      const documents = await storage.getSellerDocuments(req.user.id);
      res.json(documents);
    } catch (error) {
      console.error("Error fetching seller documents:", error);
      res.status(500).json({ error: "Failed to fetch seller documents" });
    }
  });

  // Upload seller document - requires multer setup for file upload
  app.post(
    "/api/seller/documents",
    upload.single("document"),
    async (req, res) => {
      if (!req.isAuthenticated()) return res.sendStatus(401);
      if (req.user.role !== "seller")
        return res.status(403).json({ error: "Not a seller account" });

      try {
        // Check if file was uploaded
        if (!req.file) {
          return res.status(400).json({ error: "No document file uploaded" });
        }

        // Get document metadata from the request body
        const { documentType } = req.body;

        if (!documentType) {
          return res.status(400).json({ error: "Document type is required" });
        }

        // Upload file to AWS S3
        const uploadResult = await uploadFileToS3(req.file);

        // Create document record in the database
        const document = await storage.createSellerDocument({
          sellerId: req.user.id,
          documentType,
          documentUrl: uploadResult.Location,
          documentName: req.file.originalname,
        });

        res.status(201).json(document);
      } catch (error) {
        console.error("Error uploading seller document:", error);
        res.status(500).json({ error: "Failed to upload seller document" });
      }
    }
  );

  // Download a seller document
  app.get("/api/seller/documents/:id/download", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not a seller account" });

    try {
      const documentId = parseInt(req.params.id);
      console.log(`Document download requested for ID: ${documentId}`);

      // Get document from database
      const document = await storage.getSellerDocumentById(documentId);

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Security check - ensure user can only download their own documents
      if (document.sellerId !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Unauthorized access to document" });
      }

      console.log(
        `Generating download URL for document: ${document.documentName}, URL: ${document.documentUrl}`
      );

      try {
        // Generate a presigned URL for temporary access to the S3 object using our updated helper
        const url = await getPresignedDownloadUrl(document.documentUrl);

        // Return the URL to the client
        res.json({ downloadUrl: url });
      } catch (downloadError) {
        console.error(
          "Failed with specific document URL, trying full URL extraction:",
          downloadError
        );

        // If the document URL is a partial path or filename, let's try to construct a full S3 URL
        // Check if the URL already has the S3 domain
        if (!document.documentUrl.includes("amazonaws.com")) {
          const fullS3Url = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${document.documentUrl}`;
          console.log(`Trying full S3 URL: ${fullS3Url}`);

          const url = await getPresignedDownloadUrl(fullS3Url);
          return res.json({ downloadUrl: url });
        }

        // If we got here, rethrow the original error
        throw downloadError;
      }
    } catch (error) {
      console.error("Error downloading document:", error);
      res
        .status(500)
        .json({ error: "Failed to download document", details: error.message });
    }
  });

  // Delete seller document
  app.delete("/api/seller/documents/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not a seller account" });

    try {
      const documentId = parseInt(req.params.id);

      // Check if seller is approved by getting user data
      const seller = await storage.getUser(req.user.id);
      if (seller && seller.approved) {
        return res.status(403).json({
          error:
            "You cannot delete verification documents after your seller account has been approved",
        });
      }

      // Get the document to check if it belongs to the seller
      const document = await storage.getSellerDocumentById(documentId);

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      if (document.sellerId !== req.user.id) {
        return res
          .status(403)
          .json({ error: "You don't have permission to delete this document" });
      }

      // Delete the document
      await storage.deleteSellerDocument(documentId);

      res.sendStatus(204);
    } catch (error) {
      console.error("Error deleting seller document:", error);
      res.status(500).json({ error: "Failed to delete seller document" });
    }
  });

  // Get seller business details
  app.get("/api/seller/business-details", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not a seller account" });

    try {
      const details = await storage.getBusinessDetails(req.user.id);
      res.json(details || { sellerId: req.user.id });
    } catch (error) {
      console.error("Error fetching business details:", error);
      res.status(500).json({ error: "Failed to fetch business details" });
    }
  });

  // Update seller business details
  // ========== Seller Agreement Routes ==========

  // Get the latest agreement
  app.get(
    "/api/seller/agreements/latest",
    sellerAgreementHandlers.getLatestAgreement
  );

  // Get the seller's agreement status (if they've accepted the latest agreement)
  app.get(
    "/api/seller/agreements/status",
    sellerAgreementHandlers.checkSellerAgreementStatus
  );

  // Accept an agreement
  app.post(
    "/api/seller/agreements/accept",
    sellerAgreementHandlers.acceptAgreement
  );

  // Admin: Create a new agreement
  app.post("/api/admin/agreements", sellerAgreementHandlers.createAgreement);

  // Admin: Get all agreements
  app.get("/api/admin/agreements", sellerAgreementHandlers.getAllAgreements);

  // Admin: Update an agreement
  app.put("/api/admin/agreements/:id", sellerAgreementHandlers.updateAgreement);

  // Apply the middleware to relevant seller routes that require agreement acceptance
  // We'll add this middleware to key seller functionality endpoints

  // ========== System Settings Routes ==========

  // Get specific system setting
  app.get(
    "/api/admin/settings/:key",
    systemSettingsHandlers.getSystemSettingHandler
  );

  // Get all system settings
  app.get(
    "/api/admin/settings",
    systemSettingsHandlers.getAllSystemSettingsHandler
  );

  // Update system setting
  app.put(
    "/api/admin/settings/:key",
    systemSettingsHandlers.updateSystemSettingHandler
  );

  // Document Template Management routes
  // Public routes for fetching templates
  app.get("/api/document-templates", async (req, res) => {
    try {
      const type = req.query.type as string | undefined;
      const templates = await storage.getDocumentTemplates(type);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching document templates:", error);
      res.status(500).json({ error: "Failed to fetch document templates" });
    }
  });

  app.get("/api/document-templates/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const template = await storage.getDocumentTemplate(id);

      if (!template) {
        return res.status(404).json({ error: "Document template not found" });
      }

      res.json(template);
    } catch (error) {
      console.error(`Error fetching document template:`, error);
      res.status(500).json({ error: "Failed to fetch document template" });
    }
  });

  // Admin routes for managing templates
  app.post("/api/document-templates", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const template = await storage.createDocumentTemplate(req.body);
      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating document template:", error);
      res.status(500).json({ error: "Failed to create document template" });
    }
  });

  app.put("/api/document-templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const template = await storage.updateDocumentTemplate(id, req.body);
      res.json(template);
    } catch (error) {
      console.error(`Error updating document template:`, error);
      res.status(500).json({ error: "Failed to update document template" });
    }
  });

  app.delete("/api/document-templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      await storage.deleteDocumentTemplate(id);
      res.status(204).send();
    } catch (error) {
      console.error(`Error deleting document template:`, error);
      res.status(500).json({ error: "Failed to delete document template" });
    }
  });

  app.put("/api/document-templates/:id/set-default", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const template = await storage.setDefaultTemplate(id);
      res.json(template);
    } catch (error) {
      console.error(`Error setting template as default:`, error);
      res.status(500).json({ error: "Failed to set template as default" });
    }
  });

  // Admin routes with /admin prefix for the admin dashboard
  app.get("/api/admin/document-templates", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const type = req.query.type as string | undefined;
      const templates = await storage.getDocumentTemplates(type);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching document templates:", error);
      res.status(500).json({ error: "Failed to fetch document templates" });
    }
  });

  app.get("/api/admin/document-templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const template = await storage.getDocumentTemplate(id);

      if (!template) {
        return res.status(404).json({ error: "Document template not found" });
      }

      res.json(template);
    } catch (error) {
      console.error(`Error fetching document template:`, error);
      res.status(500).json({ error: "Failed to fetch document template" });
    }
  });

  app.post("/api/admin/document-templates", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const template = await storage.createDocumentTemplate(req.body);
      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating document template:", error);
      res.status(500).json({ error: "Failed to create document template" });
    }
  });

  app.put("/api/admin/document-templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const template = await storage.updateDocumentTemplate(id, req.body);
      res.json(template);
    } catch (error) {
      console.error(`Error updating document template:`, error);
      res.status(500).json({ error: "Failed to update document template" });
    }
  });

  app.delete("/api/admin/document-templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      await storage.deleteDocumentTemplate(id);
      res.status(204).send();
    } catch (error) {
      console.error(`Error deleting document template:`, error);
      res.status(500).json({ error: "Failed to delete document template" });
    }
  });

  // Document rendering endpoints
  app.get("/api/orders/:id/invoice", async (req, res) => {
    // Authentication check
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const orderId = parseInt(req.params.id);
      const format = req.query.format || "pdf"; // 'pdf' or 'html', default to pdf

      console.log(`Generating invoice for order ${orderId}, format: ${format}`);

      // Check if the current user has access to this order
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Access control checks
      const isAdmin = req.user.role === "admin";
      const isBuyer = order.userId === req.user.id;
      const isSeller =
        req.user.role === "seller" &&
        (await storage.orderHasSellerProducts(orderId, req.user.id));

      if (!isAdmin && !isBuyer && !isSeller) {
        return res
          .status(403)
          .json({ error: "Not authorized to access this order" });
      }

      // Get the order details
      const orderItems = await storage.getOrderItems(orderId);
      if (!orderItems || orderItems.length === 0) {
        return res.status(404).json({ error: "No items found for this order" });
      }

      // Get the user (buyer) details
      const user = await storage.getUser(order.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Group order items by seller
      const itemsBySeller = orderItems.reduce(
        (acc, item) => {
          const sellerId = item.product.sellerId;
          if (!acc[sellerId]) {
            acc[sellerId] = [];
          }
          acc[sellerId].push(item);
          return acc;
        },
        {} as Record<number, typeof orderItems>
      );

      // Generate invoice for each seller
      const sellerInvoices = await Promise.all(
        Object.entries(itemsBySeller).map(async ([sellerId, sellerItems]) => {
          const seller = await storage.getUser(parseInt(sellerId));
          if (!seller) {
            console.error(`Seller ${sellerId} not found`);
            return null;
          }

          // Get seller settings for pickup and billing addresses
          const sellerSettings = await storage.getSellerSettings(
            parseInt(sellerId)
          );
          let pickupAddress = null;
          let billingAddress = null;
          let taxInformation = null;

          if (sellerSettings) {
            try {
              if (sellerSettings.pickupAddress) {
                pickupAddress = JSON.parse(sellerSettings.pickupAddress);
              }
              if (sellerSettings.address) {
                billingAddress = JSON.parse(sellerSettings.address);
              }
              if (sellerSettings.taxInformation) {
                taxInformation = JSON.parse(sellerSettings.taxInformation);
              }
            } catch (err) {
              console.error("Error parsing seller settings:", err);
            }
          }

          // Fallback addresses if not found in settings
          if (!pickupAddress) {
            pickupAddress = {
              businessName:
                taxInformation?.businessName ||
                seller.name ||
                "Lele Kart Retail Private Limited",
              line1: seller.address || "123 Commerce Street",
              line2: "",
              city: "Mumbai",
              state: "Maharashtra",
              pincode: "400001",
              phone: seller.phone || "Phone not available",
              gstin: taxInformation?.gstin || "GSTIN not available",
            };
          }

          if (!billingAddress) {
            billingAddress = {
              line1: seller.address || "123 Commerce Street",
              line2: "",
              city: "Mumbai",
              state: "Maharashtra",
              pincode: "400001",
              phone: seller.phone || "Phone not available",
            };
          }

          // Get product details for each order item
          const orderItemsWithProducts = await Promise.all(
            sellerItems.map(async (item) => {
              try {
                const product = await storage.getProduct(item.productId);
                return {
                  ...item,
                  product: product || {
                    id: item.productId,
                    name: "Product no longer available",
                    description:
                      "This product has been removed from the catalog",
                    price: item.price,
                    gstRate: 0,
                  },
                };
              } catch (err) {
                console.warn(`Failed to get product ${item.productId}:`, err);
                return {
                  ...item,
                  product: {
                    id: item.productId,
                    name: "Product no longer available",
                    description:
                      "This product has been removed from the catalog",
                    price: item.price,
                    gstRate: 0,
                  },
                };
              }
            })
          );

          // Calculate subtotal for this seller's items
          const subtotal = orderItemsWithProducts.reduce(
            (sum, item) => sum + item.price * item.quantity,
            0
          );

          // Format date properly
          const formattedDate = new Date(order.date).toLocaleDateString(
            "en-IN",
            {
              year: "numeric",
              month: "long",
              day: "numeric",
            }
          );

          // Build the invoice data object for this seller
          const invoiceData = {
            order: {
              ...order,
              id: orderId,
              orderNumber: orderId,
              formattedDate,
              formattedStatus:
                order.status.charAt(0).toUpperCase() + order.status.slice(1),
              subtotal,
              items: orderItemsWithProducts,
              shippingDetails:
                typeof order.shippingDetails === "string"
                  ? JSON.parse(order.shippingDetails)
                  : order.shippingDetails,
            },
            user,
            seller: {
              ...seller,
              pickupAddress,
              billingAddress,
              taxInformation,
            },
            currentDate: new Date().toLocaleDateString("en-IN", {
              year: "numeric",
              month: "long",
              day: "numeric",
            }),
          };

          // Calculate delivery charges (sum of all item delivery charges)
          const deliveryCharges = orderItems.reduce(
            (sum: number, item: any) =>
              sum + (item.product?.deliveryCharges || 0) * item.quantity,
            0
          );
          // Get wallet, reward, and redeem discounts from order
          const walletDiscount = Number(order.walletDiscount) || 0;
          const rewardDiscount = Number(order.rewardDiscount) || 0;
          const redeemDiscount = Number(order.redeemDiscount) || 0;
          // Calculate correct total
          const total =
            subtotal +
            deliveryCharges -
            walletDiscount -
            rewardDiscount -
            redeemDiscount;
          // Add these to invoiceData
          invoiceData.deliveryCharges = deliveryCharges;
          invoiceData.walletDiscount = walletDiscount;
          invoiceData.rewardDiscount = rewardDiscount;
          invoiceData.redeemDiscount = redeemDiscount;
          invoiceData.subtotal = subtotal;
          invoiceData.total = total < 0 ? 0 : total;

          // Generate QR code with invoice details
          const qrData = `https://lelekart.in/orders/${orderId}`;

          const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
            errorCorrectionLevel: "H",
            margin: 1,
            width: 150,
          });

          // Add QR code to the data
          invoiceData.qrCodeDataUrl = qrCodeDataUrl;

          // Register QR code helper
          handlebars.registerHelper("qrCode", function () {
            return new handlebars.SafeString(
              `<img src="${qrCodeDataUrl}" alt="Invoice QR Code" style="width: 150px; height: 150px;">`
            );
          });

          // Generate HTML for this seller's invoice
          const invoiceHtml = await generateInvoiceHtml(invoiceData);
          return {
            sellerId: parseInt(sellerId),
            sellerName: seller.name,
            invoiceHtml,
          };
        })
      );

      // Filter out any null results (failed invoice generations)
      const validInvoices = sellerInvoices.filter(
        (invoice): invoice is NonNullable<typeof invoice> => invoice !== null
      );

      if (format === "html") {
        console.log(`Sending invoices as HTML`);
        // Set content type to HTML and send the rendered invoices
        res.setHeader("Content-Type", "text/html");
        // Combine all invoice HTMLs with a page break between them
        const combinedHtml = validInvoices
          .map(
            (invoice) => `
            <div class="seller-invoice">
             
              ${invoice.invoiceHtml}
            </div>
            <div style="page-break-after: always;"></div>
          `
          )
          .join("");
        res.send(combinedHtml);
      } else {
        console.log(`Generating combined invoice as PDF`);
        // Generate PDF using our utility from the imported pdfGenerator
        const combinedHtml = validInvoices
          .map(
            (invoice) => `
            <div class="seller-invoice">
              
              ${invoice.invoiceHtml}
            </div>
            <div style="page-break-after: always;"></div>
          `
          )
          .join("");
        await pdfGenerator.generatePdf(
          res,
          combinedHtml,
          `Combined-Invoice-${orderId}.pdf`
        );
      }
    } catch (error) {
      console.error(`Error generating invoice:`, error);
      res.status(500).json({ error: "Failed to generate invoice" });
    }
  });

  // Flipkart-style Tax Invoice Document
  app.get("/api/orders/:id/tax-invoice", async (req, res) => {
    // Authentication check
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const orderId = parseInt(req.params.id);
      const format = req.query.format || "pdf"; // 'pdf' or 'html', default to pdf

      console.log(
        `Generating tax invoice for order ${orderId}, format: ${format}`
      );

      // Check if the current user has access to this order
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Access control checks
      // 1. Allow if user is admin
      // 2. Allow if order belongs to the current user (buyer access)
      // 3. Allow if user is a seller with products in this order
      const isAdmin = req.user.role === "admin";
      const isBuyer = order.userId === req.user.id;
      const isSeller =
        req.user.role === "seller" &&
        (await storage.orderHasSellerProducts(orderId, req.user.id));

      if (!isAdmin && !isBuyer && !isSeller) {
        return res
          .status(403)
          .json({ error: "Not authorized to access this order" });
      }

      // Get the order details
      const orderItems = await storage.getOrderItems(orderId);
      if (!orderItems || orderItems.length === 0) {
        return res.status(404).json({ error: "No items found for this order" });
      }

      // Get the user (buyer) details
      const user = await storage.getUser(order.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get shipping and billing addresses
      let shippingAddress = null;
      if (order.addressId) {
        try {
          shippingAddress = await storage.getUserAddressById(order.addressId);
        } catch (err) {
          console.warn(
            `Failed to get shipping address for order ${orderId}:`,
            err
          );
        }
      }

      // If we don't have a specific billing address, use shipping address
      const billingAddress = shippingAddress;

      // Get product details for each order item
      const processedItems = [];
      let srNo = 1;

      for (const item of orderItems) {
        try {
          const product = await storage.getProduct(item.productId);
          const productInfo = product || {
            id: item.productId,
            name: "Product no longer available",
            description: "This product has been removed",
            price: item.price,
            gstRate: 0,
            hsn: "N/A",
            mrp: item.price,
          };

          // Calculate tax components
          const price = item.price;
          const quantity = item.quantity;
          const gstRate = productInfo.gstRate || 0;
          const totalPrice = price * quantity;
          const basePrice =
            gstRate > 0 ? (totalPrice * 100) / (100 + gstRate) : totalPrice;
          const taxAmount = totalPrice - basePrice;

          // Format the tax components according to Flipkart's style
          const taxComponents = [];
          if (gstRate > 0) {
            // For simplicity, we'll just show IGST (interstate GST)
            // In a production app, you'd determine CGST/SGST or IGST based on states
            taxComponents.push({
              taxName: "IGST",
              taxRate: gstRate,
              taxAmount: taxAmount.toFixed(2),
            });
          }

          processedItems.push({
            srNo: srNo++,
            description: productInfo.name,
            hsn: productInfo.hsn || "N/A",
            quantity: quantity,
            mrp: productInfo.mrp
              ? productInfo.mrp.toFixed(2)
              : price.toFixed(2),
            discount: (productInfo.mrp - price).toFixed(2),
            taxableValue: basePrice.toFixed(2),
            taxComponents: taxComponents,
            total: totalPrice.toFixed(2),
          });
        } catch (err) {
          console.warn(`Failed to process product ${item.productId}:`, err);
        }
      }

      // Calculate totals from the processed items
      const totalGrossAmount = processedItems
        .reduce((sum, item) => sum + parseFloat(item.mrp) * item.quantity, 0)
        .toFixed(2);
      const totalDiscount = processedItems
        .reduce((sum, item) => sum + parseFloat(item.discount), 0)
        .toFixed(2);
      const totalTaxAmount = processedItems
        .reduce((sum, item) => {
          const taxAmount = item.taxComponents.reduce(
            (taxSum, component) => taxSum + parseFloat(component.taxAmount),
            0
          );
          return sum + taxAmount;
        }, 0)
        .toFixed(2);
      const grandTotal = processedItems
        .reduce((sum, item) => sum + parseFloat(item.total), 0)
        .toFixed(2);

      // Build the tax invoice data object
      const invoiceData = {
        invoiceNumber: `INV-${orderId}`,
        invoiceDate: new Date().toLocaleDateString("en-IN"),
        orderDate: order.date
          ? new Date(order.date).toLocaleDateString("en-IN")
          : new Date().toLocaleDateString("en-IN"),
        orderNumber: `ORD-${orderId}`,
        customerName: user.name || user.username,
        customerState: billingAddress ? billingAddress.state : "Not Available",
        customerAddress: billingAddress
          ? `${billingAddress.address}, ${billingAddress.city}, ${billingAddress.state}, ${billingAddress.pincode}`
          : "Address not available",
        deliveryName: user.name || user.username,
        deliveryAddress: shippingAddress
          ? `${shippingAddress.address}, ${shippingAddress.city}, ${shippingAddress.state}, ${shippingAddress.pincode}`
          : "Address not available",
        businessName: "LeLeKart Retail Pvt. Ltd.",
        businessAddress: "123 E-commerce Street, Digital City, 123456",
        businessGstin: "27AABCL0123P1ZL",
        warehouseName: "LeLeKart Fulfillment Center",
        warehouseAddress: "456 Logistics Avenue, Warehouse District, 789012",
        items: processedItems,
        totalGrossAmount,
        totalDiscount,
        totalTaxAmount,
        grandTotal,
      };

      // Generate QR code with invoice details
      const qrData = {
        invoiceNumber: `INV-${orderId}`,
        orderId: orderId,
        date: order.date,
        total: grandTotal,
        customerName: user.name,
        customerEmail: user.email,
        url: `http://127.0.0.1:5000/orders/${orderId}`, // Add URL to view order details
      };

      const qrCodeDataUrl = await QRCode.toDataURL(JSON.stringify(qrData), {
        errorCorrectionLevel: "H",
        margin: 1,
        width: 150,
      });

      // Add QR code to the data
      invoiceData.qrCodeDataUrl = qrCodeDataUrl;

      // Register QR code helper
      handlebars.registerHelper("qrCode", function () {
        return new handlebars.SafeString(
          `<img src="${qrCodeDataUrl}" alt="Invoice QR Code" style="width: 150px; height: 150px;">`
        );
      });

      if (format === "html") {
        // For HTML format, we'll directly render the template
        const html = pdfGenerator.getPdfTemplateHtml(
          pdfGenerator.TEMPLATES.TAX_INVOICE,
          invoiceData
        );

        res.setHeader("Content-Type", "text/html");
        res.send(html);
      } else {
        // For PDF format, use our PDF generator service with the TAX_INVOICE template
        const html = pdfGenerator.getPdfTemplateHtml(
          pdfGenerator.TEMPLATES.TAX_INVOICE,
          invoiceData
        );
        await pdfGenerator.generatePdf(res, html, `TaxInvoice-${orderId}.pdf`);
      }
    } catch (error) {
      console.error(`Error generating tax invoice:`, error);
      res.status(500).json({ error: "Failed to generate tax invoice" });
    }
  });

  // Generate shipping label PDF for an order
  // Debug endpoint for seeing HTML version of shipping label
  app.get("/api/orders/:id/shipping-label-html", async (req, res) => {
    try {
      const orderId = parseInt(req.params.id);

      console.log(
        `Generating shipping label HTML preview for order ${orderId}`
      );

      // Check if order exists
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Get shipping address from either addressId or shippingDetails
      let shippingAddress = null;

      // Try to get from addressId first (preferred method)
      if (order.addressId) {
        try {
          shippingAddress = await storage.getUserAddressById(order.addressId);
        } catch (err) {
          console.warn(
            `Failed to get shipping address for order ${orderId}:`,
            err
          );
          // Will fall back to shipping details below
        }
      }

      // If no addressId or failed to get address, try to use shippingDetails
      if (!shippingAddress && order.shippingDetails) {
        console.log(
          "Using shipping details from order:",
          order.shippingDetails
        );
        // Parse shipping details if it's a string
        const details =
          typeof order.shippingDetails === "string"
            ? JSON.parse(order.shippingDetails || "{}")
            : order.shippingDetails || {};

        // Map shipping details to address format we expect
        shippingAddress = {
          id: 0, // Not a real address ID
          userId: order.userId,
          name: details.name || "",
          phone: details.phone || "",
          address1: details.address || "",
          address2: "",
          city: details.city || "",
          state: details.state || "",
          country: "India",
          pincode: details.zipCode || "",
          isDefault: false,
          addressType: "shipping",
        };
      }

      // If we still don't have a shipping address, return an error
      if (!shippingAddress) {
        return res
          .status(400)
          .json({ error: "No shipping address found for this order" });
      }

      // Get the user (buyer) details
      const user = await storage.getUser(order.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get order items
      const orderItems = await storage.getOrderItems(orderId);
      if (!orderItems || orderItems.length === 0) {
        return res.status(404).json({ error: "No items found for this order" });
      }

      // Get product details from first item
      let product = null;
      for (const item of orderItems) {
        product = await storage.getProduct(item.productId);
        if (product) break;
      }

      // Fallback if no product found
      if (!product) {
        product = {
          id: orderItems[0].productId,
          sellerId: 1,
          name: "Product (no longer available)",
          description: "This product is no longer available",
          price: orderItems[0].price,
          category: "Other",
          imageUrl: "",
          stock: 0,
          approved: true,
          deleted: false,
        };
      }

      // Get seller info
      const seller = await storage.getUser(product.sellerId);

      // Fallback seller address
      const sellerAddress = {
        address1: "LeleKart Fulfillment Center",
        address2: "Commerce Street",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        country: "India",
      };

      // Format the data for the template
      const currentDate = new Date().toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });

      // Parse shipping details if needed
      const shippingDetails =
        typeof order.shippingDetails === "string"
          ? JSON.parse(order.shippingDetails || "{}")
          : order.shippingDetails || {};

      // Debug shipping info
      console.log("Shipping Address:", JSON.stringify(shippingAddress));
      console.log(
        "Shipping Details from order:",
        JSON.stringify(shippingDetails)
      );

      const templateData = {
        mainOrder: {
          ...order,
          id: order.id,
          formattedDate: new Date(order.date).toLocaleDateString("en-US", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }),
          formattedStatus:
            order.status.charAt(0).toUpperCase() + order.status.slice(1),
          shippingDetails: shippingDetails,
        },
        orderItems,
        seller,
        sellerAddress,
        shippingAddress,
        currentDate,
      };

      // Generate and send HTML
      const htmlContent = await templateService.renderTemplate(
        pdfGenerator.getShippingLabelTemplate(),
        templateData
      );

      // Save a copy for inspection
      fs.writeFileSync("shipping_label_output.html", htmlContent);

      // Return the HTML for preview
      res.setHeader("Content-Type", "text/html");
      res.send(htmlContent);
    } catch (error) {
      console.error("Error generating shipping label HTML:", error);
      res.status(500).json({ error: "Failed to generate shipping label HTML" });
    }
  });

  app.get("/api/orders/:id/shipping-label", async (req, res) => {
    // Temporarily bypass authentication for testing
    // if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const orderId = parseInt(req.params.id);
      const format = req.query.format || "pdf"; // 'pdf' or 'html', default to pdf

      console.log(
        `Generating shipping label for order ${orderId}, format: ${format}`
      );

      // Check if order exists
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Temporarily bypass authorization check for testing
      // Allow access if admin or the order belongs to the current user
      // if (req.user.role !== "admin" && order.userId !== req.user.id) {
      //   return res.status(403).json({ error: "Not authorized to access this order" });
      // }

      // Get shipping address from either addressId or shippingDetails
      let shippingAddress = null;

      // Try to get from addressId first (preferred method)
      if (order.addressId) {
        try {
          shippingAddress = await storage.getUserAddressById(order.addressId);
        } catch (err) {
          console.warn(
            `Failed to get shipping address for order ${orderId}:`,
            err
          );
          // Will fall back to shipping details below
        }
      }

      // If no addressId or failed to get address, try to use shippingDetails
      if (!shippingAddress && order.shippingDetails) {
        console.log(
          "Using shipping details from order:",
          order.shippingDetails
        );
        // Parse shipping details if it's a string
        const details =
          typeof order.shippingDetails === "string"
            ? JSON.parse(order.shippingDetails || "{}")
            : order.shippingDetails || {};

        // Map shipping details to address format we expect
        shippingAddress = {
          id: 0, // Not a real address ID
          userId: order.userId,
          name: details.name || "",
          phone: details.phone || "",
          address1: details.address || "",
          address2: "",
          city: details.city || "",
          state: details.state || "",
          country: "India",
          pincode: details.zipCode || "",
          isDefault: false,
          addressType: "shipping",
        };
      }

      // If we still don't have a shipping address, return an error
      if (!shippingAddress) {
        return res
          .status(400)
          .json({ error: "No shipping address found for this order" });
      }

      // Get the user (buyer) details
      const user = await storage.getUser(order.userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get seller details (from first item's seller)
      const orderItems = await storage.getOrderItems(orderId);
      if (!orderItems || orderItems.length === 0) {
        return res.status(404).json({ error: "No items found for this order" });
      }

      // Get the first product to determine seller
      const firstItem = orderItems[0];
      console.log(`Getting product with ID: ${firstItem.productId}`);

      // Debug order items
      console.log("Order items:", JSON.stringify(orderItems, null, 2));

      // Try to get the product, even if it's been soft-deleted
      let product = await storage.getProduct(firstItem.productId);
      console.log(`Product retrieved:`, product ? "Found" : "Not found");

      // If product not found or marked as deleted, look for another product in the order
      if (!product || product.deleted) {
        console.log(
          "First product not available (deleted), trying other products in the order"
        );

        // Try to find any non-deleted product in this order
        for (let i = 1; i < orderItems.length; i++) {
          const otherProduct = await storage.getProduct(
            orderItems[i].productId
          );
          if (otherProduct && !otherProduct.deleted) {
            console.log(`Found valid product with ID ${otherProduct.id}`);
            product = otherProduct;
            break;
          }
        }

        // If still no product, create a fallback for generating the label
        if (!product || product.deleted) {
          console.log(
            "No valid products found in the order, using fallback product"
          );
          product = {
            id: firstItem.productId,
            sellerId: 1, // Admin as fallback
            name: "Product (no longer available)",
            description: "This product is no longer available",
            price: firstItem.price,
            // Add other required product fields
            category: "Other",
            imageUrl: "",
            stock: 0,
            approved: true,
            deleted: false,
          };
        }
      }

      // Get seller details
      const seller = await storage.getUser(product.sellerId);
      let sellerAddress = null;

      // Since getSellerPickupAddress might not be implemented, let's handle this gracefully
      console.log(
        `Attempting to get seller pickup address for seller ID: ${product.sellerId}`
      );

      // Check if the method exists before trying to call it
      if (typeof storage.getSellerPickupAddress === "function") {
        try {
          sellerAddress = await storage.getSellerPickupAddress(
            product.sellerId
          );
          console.log(
            "Successfully retrieved seller pickup address:",
            sellerAddress
          );
        } catch (err) {
          console.warn(
            `Failed to get seller pickup address for seller ${product.sellerId}:`,
            err
          );
        }
      } else {
        console.log(
          "getSellerPickupAddress method not implemented, using fallback"
        );
      }

      // Fallback to seller's address if available
      if (!sellerAddress && seller && seller.address) {
        console.log(`Using seller address as fallback: ${seller.address}`);
        sellerAddress = {
          address1: seller.address,
          address2: "",
          city: "Unknown",
          state: "Unknown",
          pincode: "",
          country: "India",
        };
      } else if (!sellerAddress) {
        console.log("No seller address available, using default address");
        sellerAddress = {
          address1: "LeleKart Fulfillment Center",
          address2: "123 Commerce Street",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400001",
          country: "India",
        };
      }

      // Build shipping label data
      const labelData = {
        order: {
          id: orderId,
          orderNumber: orderId,
          date: order.date,
          formattedDate: new Date(order.date).toLocaleDateString("en-IN"),
          paymentMethod: order.paymentMethod || "online",
          items: orderItems.map((item) => ({
            id: item.id,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
          })),
        },
        buyer: {
          name: user.name || user.username,
          email: user.email,
          phone: user.phone || "N/A",
        },
        seller: {
          name: seller?.name || seller?.username || "LeleKart Seller",
          // Make sure we don't reference businessName directly since it might not exist on the user object
          businessName: "LeleKart Business",
          phone: seller?.phone || "N/A",
        },
        shippingAddress,
        sellerAddress: sellerAddress || {
          address1: "LeleKart Fulfillment Center",
          address2: "123 Commerce Street",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400001",
          country: "India",
        },
        currentDate: new Date().toLocaleDateString("en-IN"),
      };

      // Get the shipping label template
      // Create the shipping label data object with all needed information
      const shippingLabelData = {
        mainOrder: {
          ...order,
          formattedDate: new Date(order.date).toLocaleDateString("en-IN", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
          formattedStatus:
            order.status.charAt(0).toUpperCase() + order.status.slice(1),
          shippingDetails:
            typeof order.shippingDetails === "string"
              ? JSON.parse(order.shippingDetails || "{}")
              : order.shippingDetails || {},
        },
        buyer: user,
        seller,
        businessDetails: null, // We don't have business details in this context
        shippingAddress,
        currentDate: new Date().toLocaleDateString("en-IN", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        orderItems: orderItems.map((item) => ({
          ...item,
          formattedPrice: `₹${item.price.toFixed(2)}`,
        })),
      };

      // Get the shipping label template function from our imported module at the top
      // Use the templateService already imported at the top of the file
      const labelHtml = await templateService.renderTemplate(
        getShippingLabelTemplate(),
        shippingLabelData
      );

      if (format === "html") {
        console.log(`Sending shipping label as HTML`);
        // Set content type to HTML and send the rendered label
        res.setHeader("Content-Type", "text/html");
        res.send(labelHtml);
      } else {
        console.log(`Generating shipping label as PDF`);
        // Generate PDF using our utility from the imported pdfGenerator
        await pdfGenerator.generatePdf(
          res,
          labelHtml,
          `Shipping-Label-${orderId}.pdf`
        );
      }
    } catch (error) {
      console.error(`Error generating shipping label:`, error);
      res.status(500).json({ error: "Failed to generate shipping label" });
    }
  });

  app.get("/api/seller-orders/:id/shipping-slip", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const sellerOrderId = parseInt(req.params.id);
      const format = req.query.format || "pdf"; // 'pdf' or 'html', default to pdf

      console.log(
        `Generating shipping slip for seller order ${sellerOrderId}, format: ${format}`
      );

      // Check if the current user has access to this seller order
      const sellerOrder = await storage.getSellerOrderById(sellerOrderId);
      if (!sellerOrder) {
        return res.status(404).json({ error: "Seller order not found" });
      }

      // Allow access if admin or the order belongs to the current seller
      if (req.user.role !== "admin" && sellerOrder.sellerId !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Not authorized to access this seller order" });
      }

      // Get the main order
      const mainOrder = await storage.getOrder(sellerOrder.orderId);
      if (!mainOrder) {
        return res.status(404).json({ error: "Main order not found" });
      }

      // Get the order items for this seller
      const orderItems = await storage.getSellerOrderItems(sellerOrderId);
      if (!orderItems || orderItems.length === 0) {
        return res
          .status(404)
          .json({ error: "No items found for this seller order" });
      }

      // Get the buyer details
      const buyer = await storage.getUser(mainOrder.userId);
      if (!buyer) {
        return res.status(404).json({ error: "Buyer not found" });
      }

      // Get the seller details
      const seller = await storage.getUser(sellerOrder.sellerId);
      if (!seller) {
        return res.status(404).json({ error: "Seller not found" });
      }

      // Get seller business details
      let businessDetails = null;
      try {
        businessDetails = await storage.getBusinessDetails(
          sellerOrder.sellerId
        );
      } catch (err) {
        console.warn(
          `Failed to get business details for seller ${sellerOrder.sellerId}:`,
          err
        );
        // Continue without business details - not critical
      }

      // Get product details for each order item
      const orderItemsWithProducts = await Promise.all(
        orderItems.map(async (item) => {
          try {
            const product = await storage.getProduct(item.productId);
            return {
              ...item,
              product: product || {
                id: item.productId,
                name: "Product no longer available",
                description: "This product has been removed from the catalog",
                price: item.price,
                gstRate: 0,
              },
            };
          } catch (err) {
            console.warn(`Failed to get product ${item.productId}:`, err);
            return {
              ...item,
              product: {
                id: item.productId,
                name: "Product no longer available",
                description: "This product has been removed from the catalog",
                price: item.price,
                gstRate: 0,
              },
            };
          }
        })
      );

      // Format dates properly
      const formattedOrderDate = new Date(mainOrder.date).toLocaleDateString(
        "en-IN",
        {
          year: "numeric",
          month: "long",
          day: "numeric",
        }
      );

      const formattedSellerOrderDate = new Date(
        sellerOrder.date
      ).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      // Build the shipping slip data object
      const shippingSlipData = {
        sellerOrder: {
          ...sellerOrder,
          formattedDate: formattedSellerOrderDate,
          formattedStatus:
            sellerOrder.status.charAt(0).toUpperCase() +
            sellerOrder.status.slice(1),
          items: orderItemsWithProducts,
        },
        mainOrder: {
          ...mainOrder,
          formattedDate: formattedOrderDate,
          formattedStatus:
            mainOrder.status.charAt(0).toUpperCase() +
            mainOrder.status.slice(1),
          shippingDetails:
            typeof mainOrder.shippingDetails === "string"
              ? JSON.parse(mainOrder.shippingDetails)
              : mainOrder.shippingDetails,
        },
        buyer,
        seller,
        businessDetails,
        currentDate: new Date().toLocaleDateString("en-IN", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
      };

      // Generate the shipping slip HTML from our template
      const shippingSlipHtml = await generateShippingSlipHtml(shippingSlipData);

      if (format === "html") {
        console.log(`Sending shipping slip as HTML`);
        // Set content type to HTML and send the rendered shipping slip
        res.setHeader("Content-Type", "text/html");
        res.send(shippingSlipHtml);
      } else {
        console.log(`Generating shipping slip as PDF`);
        // Generate PDF using our utility from the imported pdfGenerator
        await pdfGenerator.generatePdf(
          res,
          shippingSlipHtml,
          `ShippingSlip-${sellerOrderId}.pdf`
        );
      }
    } catch (error) {
      console.error(`Error generating shipping slip:`, error);
      res.status(500).json({ error: "Failed to generate shipping slip" });
    }
  });

  app.put("/api/seller/business-details", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not a seller account" });

    try {
      // Validate required fields
      if (!req.body.businessName) {
        return res.status(400).json({ error: "Business name is required" });
      }

      // Update or create business details
      const details = await storage.updateBusinessDetails(
        req.user.id,
        req.body
      );

      res.json(details);
    } catch (error) {
      console.error("Error updating business details:", error);
      res.status(500).json({ error: "Failed to update business details" });
    }
  });

  // Get seller banking information
  app.get("/api/seller/banking-information", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not a seller account" });

    try {
      const info = await storage.getBankingInformation(req.user.id);
      res.json(info || { sellerId: req.user.id });
    } catch (error) {
      console.error("Error fetching banking information:", error);
      res.status(500).json({ error: "Failed to fetch banking information" });
    }
  });

  // Update seller banking information
  app.put("/api/seller/banking-information", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not a seller account" });

    try {
      // Validate required fields
      const requiredFields = [
        "accountHolderName",
        "accountNumber",
        "bankName",
        "ifscCode",
      ];
      const missingFields = requiredFields.filter((field) => !req.body[field]);

      if (missingFields.length > 0) {
        return res.status(400).json({
          error: `Missing required fields: ${missingFields.join(", ")}`,
        });
      }

      // Update or create banking information
      const info = await storage.updateBankingInformation(
        req.user.id,
        req.body
      );

      res.json(info);
    } catch (error) {
      console.error("Error updating banking information:", error);
      res.status(500).json({ error: "Failed to update banking information" });
    }
  });

  // Get public seller profile (doesn't require authentication)
  app.get("/api/seller/public-profile/:id", async (req, res) => {
    try {
      const sellerId = parseInt(req.params.id);

      if (isNaN(sellerId)) {
        return res.status(400).json({ error: "Invalid seller ID" });
      }

      // Get the seller user
      const seller = await storage.getUser(sellerId);

      // Check if seller exists and is approved
      if (!seller || seller.role !== "seller" || !seller.approved) {
        return res
          .status(404)
          .json({ error: "Seller not found or not approved" });
      }

      // Get business details
      const businessDetails = await storage.getBusinessDetails(sellerId);

      // Get seller products count (approved only)
      const products = await storage.getProducts(undefined, sellerId, true);

      // Get seller analytics if available (for stats)
      const analytics = await storage.getSellerAnalytics(sellerId);

      // Combine data for public profile
      const publicProfile = {
        id: seller.id,
        businessName: businessDetails?.businessName || seller.username,
        businessType: businessDetails?.businessType || "Retail",
        description: businessDetails?.description,
        location: businessDetails?.location || "India",
        gstNumber: businessDetails?.gstNumber,
        logoUrl: businessDetails?.logoUrl,
        memberSince: seller.createdAt
          ? new Date(seller.createdAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
            })
          : "April 2023",
        rating: 4.8, // Placeholder until we have actual ratings
        reviewCount: 120, // Placeholder until we have actual reviews
        totalProducts: products.length,
        ordersCompleted: "500+", // This would come from actual analytics in a real implementation
        avgDeliveryTime: "2-3 days", // This would come from actual analytics in a real implementation
        returnRate: "<2%", // This would come from actual analytics in a real implementation
        // Add more fields as needed
      };

      res.json(publicProfile);
    } catch (error) {
      console.error("Error fetching public seller profile:", error);
      res.status(500).json({ error: "Failed to fetch seller profile" });
    }
  });

  // Search endpoint
  app.get("/api/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.trim() === "") {
        return res.status(400).json({ error: "Search query is required" });
      }

      // Determine user role for filtering results
      const userRole = req.isAuthenticated() ? req.user.role : "buyer";

      console.log(
        `Searching for products with query: "${query}" for user role: ${userRole}`
      );
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const results = await storage.searchProducts(query, limit, userRole);

      console.log(`Found ${results.length} search results for "${query}"`);
      return res.json(results);
    } catch (error) {
      console.error("Error in search endpoint:", error);
      return res.status(500).json({ error: "Failed to perform search" });
    }
  });

  // API endpoint for admins to reassign products to different sellers
  app.put("/api/products/:id/assign-seller", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const productId = parseInt(req.params.id);
      const { sellerId } = req.body;

      if (!sellerId || isNaN(parseInt(sellerId.toString()))) {
        return res.status(400).json({ error: "Valid sellerId is required" });
      }

      const newSellerId = parseInt(sellerId.toString());

      // Use the specialized method that includes all validations
      const updatedProduct = await storage.assignProductSeller(
        productId,
        newSellerId
      );

      // Get seller information for the response message
      const seller = await storage.getUser(newSellerId);

      return res.json({
        success: true,
        product: updatedProduct,
        message: `Product successfully reassigned to seller ${
          seller?.username || `ID: ${newSellerId}`
        }`,
      });
    } catch (error) {
      console.error("Error reassigning product:", error);
      return res.status(500).json({
        error: "Failed to reassign product",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get pending products (admin only) with pagination
  // ***************************************************************************
  // IMPORTANT: Route order matters in Express. Bulk routes must be defined FIRST
  // ***************************************************************************

  // Bulk approve products (admin only) - completely rewritten
  app.put("/api/products/bulk/approve", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      // Get the product IDs from the request body
      const { productIds } = req.body;

      // Validate the input
      if (!Array.isArray(productIds)) {
        return res.status(400).json({
          error: "Invalid input: productIds must be an array",
        });
      }

      if (productIds.length === 0) {
        return res.status(400).json({
          error:
            "No products selected: please select at least one product to approve",
        });
      }

      // Convert to numbers and validate each ID
      const validIds = [];
      const invalidIds = [];

      for (const id of productIds) {
        // Ensure each ID is a valid positive integer
        const numId = Number(id);
        if (!isNaN(numId) && Number.isInteger(numId) && numId > 0) {
          validIds.push(numId);
        } else {
          invalidIds.push(id);
        }
      }

      // Log validation results
      console.log(
        `Bulk approve: received ${productIds.length} IDs, ${validIds.length} valid, ${invalidIds.length} invalid`
      );
      if (invalidIds.length > 0) {
        console.log(`Invalid IDs: ${JSON.stringify(invalidIds)}`);
      }

      if (validIds.length === 0) {
        return res.status(400).json({
          error: "No valid product IDs provided",
        });
      }

      // First find all non-deleted products that match the valid IDs
      const existingProducts = await db
        .select()
        .from(products)
        .where(
          and(inArray(products.id, validIds), eq(products.deleted, false))
        );

      if (existingProducts.length === 0) {
        return res.status(404).json({
          error:
            "None of the provided products exist or they have been deleted",
        });
      }

      // Extract the IDs of existing products for easier lookup
      const existingIds = existingProducts.map((p) => p.id);

      // Track the results
      const results = [];
      let approvedCount = 0;
      let errorCount = 0;

      // Process each product individually to ensure we handle errors properly
      for (const id of validIds) {
        try {
          // Skip if product doesn't exist or is deleted
          if (!existingIds.includes(id)) {
            results.push({
              id,
              success: false,
              error: "Product not found or has been deleted",
            });
            errorCount++;
            continue;
          }

          // Approve the product
          await db
            .update(products)
            .set({ approved: true })
            .where(and(eq(products.id, id), eq(products.deleted, false)));

          results.push({ id, success: true });
          approvedCount++;
        } catch (error) {
          console.error(`Error approving product ${id}:`, error);
          results.push({
            id,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          errorCount++;
        }
      }

      // Return the results
      return res.json({
        success: approvedCount > 0,
        results,
        summary: {
          total: validIds.length,
          approved: approvedCount,
          failed: errorCount,
        },
      });
    } catch (error) {
      console.error("Error in bulk product approval:", error);
      return res.status(500).json({
        error: "Failed to process bulk approval request",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Bulk reject products (admin only) - completely rewritten with direct SQL
  app.put("/api/products/bulk/reject", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      // Get the product IDs from the request body
      const { productIds } = req.body;

      // Validate the input
      if (!Array.isArray(productIds)) {
        return res.status(400).json({
          error: "Invalid input: productIds must be an array",
        });
      }

      if (productIds.length === 0) {
        return res.status(400).json({
          error:
            "No products selected: please select at least one product to reject",
        });
      }

      // Convert to numbers and validate each ID
      const validIds = [];
      const invalidIds = [];

      for (const id of productIds) {
        // Ensure each ID is a valid positive integer
        const numId = Number(id);
        if (!isNaN(numId) && Number.isInteger(numId) && numId > 0) {
          validIds.push(numId);
        } else {
          invalidIds.push(id);
        }
      }

      // Log validation results
      console.log(
        `Bulk reject: received ${productIds.length} IDs, ${validIds.length} valid, ${invalidIds.length} invalid`
      );
      if (invalidIds.length > 0) {
        console.log(`Invalid IDs: ${JSON.stringify(invalidIds)}`);
      }

      if (validIds.length === 0) {
        return res.status(400).json({
          error: "No valid product IDs provided",
        });
      }

      // First find all non-deleted products that match the valid IDs - use raw SQL
      const selectQuery = `
        SELECT id FROM products 
        WHERE id = ANY($1) AND deleted = false
      `;
      const { rows: existingProducts } = await pool.query(selectQuery, [
        validIds,
      ]);

      if (existingProducts.length === 0) {
        return res.status(404).json({
          error:
            "None of the provided products exist or they have been deleted",
        });
      }

      // Extract the IDs of existing products for easier lookup
      const existingIds = existingProducts.map((p) => Number(p.id));

      // Track the results
      const results = [];
      let rejectedCount = 0;
      let errorCount = 0;

      // Process each product individually to ensure we handle errors properly
      for (const id of validIds) {
        try {
          // Skip if product doesn't exist or is deleted
          if (!existingIds.includes(id)) {
            results.push({
              id,
              success: false,
              error: "Product not found or has been deleted",
            });
            errorCount++;
            continue;
          }

          // Reject the product - use raw SQL to avoid schema mismatch issues
          const updateQuery = `
            UPDATE products
            SET approved = false, rejected = true
            WHERE id = $1 AND deleted = false
          `;
          await pool.query(updateQuery, [id]);

          results.push({ id, success: true });
          rejectedCount++;
        } catch (error) {
          console.error(`Error rejecting product ${id}:`, error);
          results.push({
            id,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          errorCount++;
        }
      }

      // Return the results
      return res.json({
        success: rejectedCount > 0,
        results,
        summary: {
          total: validIds.length,
          rejected: rejectedCount,
          failed: errorCount,
        },
      });
    } catch (error) {
      console.error("Error in bulk product rejection:", error);
      return res.status(500).json({
        error: "Failed to process bulk rejection request",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Pending products for admin review
  app.get("/api/products/pending", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      // Get pagination parameters from query string
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const search = (req.query.search as string) || undefined;
      const category = (req.query.category as string) || undefined;

      // Validate pagination parameters
      const validatedPage = Math.max(1, page);
      const validatedLimit = [10, 100, 500].includes(limit) ? limit : 10;

      console.log(
        `Fetching pending products with filters: page=${validatedPage}, limit=${validatedLimit}, search=${
          search || "none"
        }, category=${category || "none"}`
      );

      // Get products with pagination, search and category filter
      const result = await storage.getPendingProducts(
        validatedPage,
        validatedLimit,
        search,
        category
      );
      res.json({
        products: result.products,
        pagination: {
          page: validatedPage,
          limit: validatedLimit,
          total: result.total,
          totalPages: Math.ceil(result.total / validatedLimit),
        },
      });
    } catch (error) {
      console.error("Error fetching pending products:", error);
      res.status(500).json({ error: "Failed to fetch pending products" });
    }
  });

  // Approve a product (admin only) - Completely rewritten
  app.put("/api/products/:id/approve", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      // Get and validate the product ID
      const idParam = req.params.id;
      const productId = Number(idParam);

      // Validate product ID
      if (isNaN(productId) || !Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({
          error: `Invalid product ID: ${idParam}`,
        });
      }

      console.log(`Approving product with ID: ${productId}`);

      // First check if the product exists and is not deleted
      const productCheckResult = await pool.query(
        `
        SELECT id FROM products 
        WHERE id = $1 AND deleted = false
      `,
        [productId]
      );

      if (productCheckResult.rows.length === 0) {
        return res.status(404).json({
          error: `Product with ID ${productId} not found or has been deleted`,
        });
      }

      // Update the product status
      const updateResult = await pool.query(
        `
        UPDATE products
        SET approved = true
        WHERE id = $1 AND deleted = false
        RETURNING id, name, category, price, approved, rejected, deleted
      `,
        [productId]
      );

      if (updateResult.rows.length === 0) {
        return res.status(500).json({
          error: `Failed to update product ${productId}`,
        });
      }

      return res.json(updateResult.rows[0]);
    } catch (error) {
      console.error(`Error approving product:`, error);
      return res.status(500).json({
        error: "Failed to approve product",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Reject a product (admin only) - Completely rewritten
  app.put("/api/products/:id/reject", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      // Get and validate the product ID
      const idParam = req.params.id;
      const productId = Number(idParam);

      // Validate product ID
      if (isNaN(productId) || !Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({
          error: `Invalid product ID: ${idParam}`,
        });
      }

      console.log(`Rejecting product with ID: ${productId}`);

      // First check if the product exists and is not deleted
      const productCheckResult = await pool.query(
        `
        SELECT id FROM products 
        WHERE id = $1 AND deleted = false
      `,
        [productId]
      );

      if (productCheckResult.rows.length === 0) {
        return res.status(404).json({
          error: `Product with ID ${productId} not found or has been deleted`,
        });
      }

      // Update the product status
      const updateResult = await pool.query(
        `
        UPDATE products
        SET approved = false, rejected = true
        WHERE id = $1 AND deleted = false
        RETURNING id, name, category, price, approved, rejected, deleted
      `,
        [productId]
      );

      if (updateResult.rows.length === 0) {
        return res.status(500).json({
          error: `Failed to update product ${productId}`,
        });
      }

      return res.json(updateResult.rows[0]);
    } catch (error) {
      console.error(`Error rejecting product:`, error);
      return res.status(500).json({
        error: "Failed to reject product",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get product approval status (for seller)
  app.get("/api/products/:id/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const { id } = req.params;

    try {
      const productId = parseInt(id);
      const product = await storage.getProduct(productId);

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Check if the requestor is either admin or the seller who owns the product
      if (req.user.role !== "admin" && product.sellerId !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Not authorized to view this product's status" });
      }

      res.json({
        approved: !!product.approved,
        message: product.approved
          ? "Your product is approved and visible to buyers."
          : "Your product is pending approval by an admin.",
      });
    } catch (error) {
      console.error(`Error fetching product status ${id}:`, error);
      res.status(500).json({ error: "Failed to fetch product status" });
    }
  });

  // Product routes with pagination
  app.get("/api/products", async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const sellerId = req.query.sellerId
        ? Number(req.query.sellerId)
        : undefined;
      const search = req.query.search as string | undefined;
      const subcategory = req.query.subcategory as string | undefined;
      const interleaved = req.query.interleaved === "true";

      // Check user role to determine if we should show unapproved products
      const userRole = req.isAuthenticated() ? req.user.role : "buyer";

      // If approved query parameter is provided, use it;
      // Otherwise, for buyers only show approved products
      let approved: boolean | undefined;
      let rejected: boolean | undefined;

      // Use isDraft instead of hideDrafts
      let isDraft = req.query.isDraft === "true" || userRole === "buyer";

      // Parse approved and rejected params
      if (req.query.approved !== undefined) {
        approved = req.query.approved === "true";
      }
      if (req.query.rejected !== undefined) {
        rejected = req.query.rejected === "true";
      }
      // If neither is set, use old logic for buyers
      if (approved === undefined && rejected === undefined) {
        if (userRole === "admin" || userRole === "seller") {
          approved = undefined;
          rejected = undefined;
        } else {
          approved = true;
        }
      }

      // Pagination parameters
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 12;
      const offset = (page - 1) * limit;

      // For the homepage, make sure we only show approved products
      // and hide both draft and rejected products
      if (req.query.homepage === "true") {
        approved = true;
        isDraft = true;
        rejected = true;
      }

      console.log("Fetching products with filters:", {
        category,
        sellerId,
        approved,
        isDraft,
        rejected,
        page,
        limit,
        search,
        subcategory,
        userRole: req.isAuthenticated() ? req.user.role : "buyer",
      });

      // Interleaved logic for homepage
      if (
        interleaved &&
        req.query.homepage === "true" &&
        !category &&
        !search &&
        !sellerId &&
        !subcategory
      ) {
        // Define the categories in the desired order (should match frontend)
        const allCategories = [
          "Electronics",
          "Fashion",
          "Home",
          "Appliances",
          "Mobiles",
          "Beauty",
          "Toys",
          "Grocery",
        ];
        // How many products per category to fetch (overfetch to fill rows)
        const limit = req.query.limit
          ? parseInt(req.query.limit as string)
          : 36;
        const page = req.query.page ? parseInt(req.query.page as string) : 1;
          const perCategory =
            Math.ceil((limit * page * 10) / allCategories.length) + 100;
        // Fetch products for each category
        const categoryProductsArr = await Promise.all(
          allCategories.map((cat) =>
            storage.getProductsPaginated(
              cat,
              undefined,
              true, // approved only
              0,
              perCategory,
              undefined,
              true, // hideDrafts
              undefined,
              true // hideRejected
            )
          )
        );
        // Interleave products
        let interleavedProducts = [];
        let maxLen = Math.max(...categoryProductsArr.map((arr) => arr.length));
        for (let i = 0; i < maxLen; i++) {
          for (let arr of categoryProductsArr) {
            if (arr[i]) interleavedProducts.push(arr[i]);
          }
        }
        // Remove duplicates by product id
        const seen = new Set();
        interleavedProducts = interleavedProducts.filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        });
        // Paginate
        const startIdx = (page - 1) * limit;
        const endIdx = startIdx + limit;
        const paginated = interleavedProducts.slice(startIdx, endIdx);
        // Get total count for pagination
        const totalCount = interleavedProducts.length;
        const totalPages = Math.ceil(totalCount / limit);
        // Add GST and seller info as in normal flow
        const categories = await storage.getCategories();
        const categoryGstMap = new Map();
        categories.forEach((cat) => {
          categoryGstMap.set(cat.name.toLowerCase(), Number(cat.gstRate || 0));
        });
        const productsWithSellerInfo = await Promise.all(
          paginated.map(async (product) => {
            if (!product.imageUrl) {
              product.imageUrl = "/images/placeholder.svg";
            }
            const gstRate =
              categoryGstMap.get(product.category.toLowerCase()) || 0;
            const priceWithGst = product.price;
            const basePrice =
              gstRate > 0
                ? (priceWithGst * 100) / (100 + gstRate)
                : priceWithGst;
            const gstAmount = priceWithGst - basePrice;
            const productWithGst = {
              ...product,
              gstDetails: {
                gstRate,
                basePrice,
                gstAmount,
                priceWithGst,
              },
            };
            if (product.sellerId) {
              try {
                const seller = await storage.getUser(product.sellerId);
                if (seller) {
                  return {
                    ...productWithGst,
                    sellerName: seller.username || "Unknown Seller",
                    seller: seller,
                  };
                }
              } catch (error) {
                console.error(
                  `Error fetching seller for product ${product.id}:`,
                  error
                );
              }
            }
            return {
              ...productWithGst,
              sellerName: "Lele Kart Retail Private Limited",
              seller: { username: "Lele Kart Retail Private Limited" },
            };
          })
        );
        return res.json({
          products: productsWithSellerInfo,
          pagination: {
            total: totalCount,
            totalPages,
            currentPage: page,
            limit,
          },
        });
      }

      // Get total count for pagination
      const totalCount = await storage.getProductsCount(
        category,
        sellerId,
        approved,
        search,
        isDraft,
        subcategory,
        rejected
      );
      const totalPages = Math.ceil(totalCount / limit);

      // Get display settings if on the first page and no specific filters are applied
      let displaySettings;
      if (
        page === 1 &&
        !sellerId &&
        !search &&
        (!category || category === "All") &&
        !subcategory
      ) {
        displaySettings = await storage.getProductDisplaySettings();
      }

      // Get paginated products with search
      let products = await storage.getProductsPaginated(
        category,
        sellerId,
        approved,
        offset,
        limit,
        search,
        isDraft, // Pass isDraft parameter
        subcategory, // Pass subcategory parameter
        rejected // Pass rejected parameter (now can be true/false/undefined)
      );
      console.log(
        `Found ${products?.length || 0} products (page ${page}/${totalPages})`
      );

      // Apply display settings if available and on first page
      if (displaySettings && page === 1) {
        products = applyProductDisplaySettings(products, displaySettings);
      }

      if (!products || !Array.isArray(products)) {
        console.error("Invalid products data returned:", products);
        return res
          .status(500)
          .json({ error: "Invalid products data returned" });
      }

      // Get categories to retrieve GST rates
      const categories = await storage.getCategories();

      // Create a map of category names to GST rates for efficient lookup
      const categoryGstMap = new Map();
      categories.forEach((cat) => {
        categoryGstMap.set(cat.name.toLowerCase(), Number(cat.gstRate || 0));
      });

      // Process products to ensure they all have valid images
      // and fetch seller information for each product
      const productsWithSellerInfo = await Promise.all(
        products.map(async (product) => {
          // Ensure imageUrl exists for every product
          if (!product.imageUrl) {
            product.imageUrl = "/images/placeholder.svg";
          }

          // Get GST rate for this product's category
          const gstRate =
            categoryGstMap.get(product.category.toLowerCase()) || 0;

          // Calculate GST details - Note: Prices in DB are GST-inclusive
          const priceWithGst = product.price;
          const basePrice =
            gstRate > 0 ? (priceWithGst * 100) / (100 + gstRate) : priceWithGst;
          const gstAmount = priceWithGst - basePrice;

          // Add GST details to product
          const productWithGst = {
            ...product,
            gstDetails: {
              gstRate,
              basePrice,
              gstAmount,
              priceWithGst,
            },
          };

          // Fetch seller information if sellerId exists
          if (product.sellerId) {
            try {
              const seller = await storage.getUser(product.sellerId);
              if (seller) {
                return {
                  ...productWithGst,
                  sellerName: seller.username || "Unknown Seller",
                  seller: seller,
                };
              }
            } catch (error) {
              console.error(
                `Error fetching seller for product ${product.id}:`,
                error
              );
            }
          }

          return {
            ...productWithGst,
            sellerName: "Lele Kart Retail Private Limited",
            seller: { username: "Lele Kart Retail Private Limited" },
          };
        })
      );

      products = productsWithSellerInfo;

      // Return both products and pagination data
      res.json({
        products,
        pagination: {
          total: totalCount,
          totalPages,
          currentPage: page,
          limit,
        },
      });
    } catch (error) {
      console.error("Error fetching products:", error);
      res.status(500).json({
        error: "Failed to fetch products",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const product = await storage.getProduct(id);

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Check user role to determine if they should see unapproved products
      const userRole = req.isAuthenticated() ? req.user.role : "buyer";

      // If user is a buyer and product is not approved or is a draft, return 404
      if (userRole === "buyer" && (!product.approved || product.isDraft)) {
        console.log(
          `Unauthorized access attempt by buyer to unapproved/draft product ${id}`
        );
        return res.status(404).json({ error: "Product not found" });
      }

      // Import the debug utility
      const { debugProductVariants } = await import("./routes.debug");
      await debugProductVariants(id);

      // Add GST calculations - Note: prices stored in DB already include GST
      const gstRate = product.gstRate ? Number(product.gstRate) : 0;

      // Calculate base price from the inclusive price (stored in DB)
      const priceWithGst = product.price;
      const basePrice =
        gstRate > 0 ? (priceWithGst * 100) / (100 + gstRate) : priceWithGst;
      const gstAmount = priceWithGst - basePrice;

      console.log(
        `Product ${product.id} GST calculation: Rate=${gstRate}%, Inclusive Price=${priceWithGst}, Base Price=${basePrice}, GST Amount=${gstAmount}`
      );

      // Enhanced product with GST details and all fields
      const enhancedProduct = {
        ...product,
        // Ensure all fields are included
        id: product.id,
        name: product.name,
        description: product.description,
        specifications: product.specifications,
        sku: product.sku,
        mrp: product.mrp,
        purchasePrice: product.purchasePrice,
        price: product.price,
        category: product.category,
        categoryId: product.categoryId,
        subcategoryId: product.subcategoryId,
        color: product.color,
        size: product.size,
        imageUrl: product.imageUrl,
        images: product.images,
        sellerId: product.sellerId,
        stock: product.stock,
        gstRate: product.gstRate,
        approved: product.approved,
        rejected: product.rejected,
        deleted: product.deleted,
        isDraft: product.isDraft,
        createdAt: product.createdAt,
        // Additional fields
        weight: product.weight,
        height: product.height,
        width: product.width,
        length: product.length,
        warranty: product.warranty,
        returnPolicy: product.returnPolicy,
        hsn: product.hsn,
        brand: product.brand,
        // GST details
        gstDetails: {
          gstRate,
          basePrice,
          gstAmount,
          priceWithGst,
        },
        // Seller info
        sellerName: product.sellerName,
        sellerUsername: product.sellerUsername,
        // Category info
        categoryGstRate: product.categoryGstRate,
        subcategory: product.subcategory,
      };

      // Check if we should include variants in the response - allow any value to trigger it
      const includeVariants = req.query.variants !== undefined;
      console.log(`Including variants for product ${id}: ${includeVariants}`);

      if (includeVariants) {
        // Fetch variants for this product
        const variants = await storage.getProductVariants(id);

        // Calculate GST for each variant - Note: variant price already includes GST
        const variantsWithGst = variants.map((variant) => {
          // Prices stored in DB already include GST
          const variantPriceWithGst = variant.price;
          const variantBasePrice =
            gstRate > 0
              ? (variantPriceWithGst * 100) / (100 + gstRate)
              : variantPriceWithGst;
          const variantGstAmount = variantPriceWithGst - variantBasePrice;

          console.log(
            `Variant ${variant.id} GST calculation: Rate=${gstRate}%, Inclusive Price=${variantPriceWithGst}, Base Price=${variantBasePrice}, GST Amount=${variantGstAmount}`
          );

          return {
            ...variant,
            gstDetails: {
              gstRate,
              basePrice: variantBasePrice,
              gstAmount: variantGstAmount,
              priceWithGst: variantPriceWithGst,
            },
          };
        });

        // Return product with variants and GST details
        return res.json({
          ...enhancedProduct,
          variants: variantsWithGst,
        });
      }

      res.json(enhancedProduct);
    } catch (error) {
      console.error("Error fetching product:", error);
      res.status(500).json({ error: "Failed to fetch product" });
    }
  });

  // Get product variants
  app.get("/api/products/:id/variants", async (req, res) => {
    try {
      const productId = parseInt(req.params.id);

      // Check if the product exists and is approved for buyers
      const product = await storage.getProduct(productId);

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Check user role to determine if they should see unapproved products
      const userRole = req.isAuthenticated() ? req.user.role : "buyer";

      // If user is a buyer and product is not approved or is a draft, return 404
      if (userRole === "buyer" && (!product.approved || product.isDraft)) {
        console.log(
          `Unauthorized access attempt by buyer to variants of unapproved/draft product ${productId}`
        );
        return res.status(404).json({ error: "Product not found" });
      }

      const variants = await storage.getProductVariants(productId);

      res.json(variants);
    } catch (error) {
      console.error("Error fetching product variants:", error);
      res.status(500).json({ error: "Failed to fetch product variants" });
    }
  });

  // Update a single product variant
  app.patch(
    "/api/products/:productId/variants/:variantId",
    async (req, res) => {
      try {
        // Ensure user is authenticated
        if (!req.isAuthenticated()) {
          return res.status(401).json({ error: "Authentication required" });
        }

        const productId = parseInt(req.params.productId);
        const variantId = parseInt(req.params.variantId);

        if (isNaN(productId) || isNaN(variantId)) {
          return res
            .status(400)
            .json({ error: "Invalid product or variant ID" });
        }

        // Get the product to verify it exists and check permissions
        const product = await storage.getProduct(productId);

        if (!product) {
          return res.status(404).json({ error: "Product not found" });
        }

        // Check if the user is authorized (product owner or admin)
        if (product.sellerId !== req.user.id && req.user.role !== "admin") {
          return res.status(403).json({
            error: "Not authorized to modify this product's variants",
          });
        }

        // Get the variant to verify it exists and belongs to this product
        const variant = await storage.getProductVariant(variantId);

        if (!variant || variant.productId !== productId) {
          return res.status(404).json({
            error: "Variant not found or does not belong to this product",
          });
        }

        console.log("Original request body:", req.body);

        // Extract and validate the update data
        const { price, mrp, stock, color, size, images } = req.body;

        // Prepare the update data with strong type checking
        const updateData: any = {};

        if (price !== undefined) {
          updateData.price = Number(price);
          console.log(`Updating price to ${updateData.price}`);
        }

        if (mrp !== undefined) {
          updateData.mrp = Number(mrp);
          console.log(`Updating mrp to ${updateData.mrp}`);
        }

        if (stock !== undefined) {
          updateData.stock = Number(stock);
          console.log(`Updating stock to ${updateData.stock}`);
        }

        if (color !== undefined) {
          updateData.color = color;
          console.log(`Updating color to ${updateData.color}`);
        }

        if (size !== undefined) {
          updateData.size = size;
          console.log(`Updating size to ${updateData.size}`);
        }

        if (images !== undefined && Array.isArray(images)) {
          updateData.images = images;
          console.log(`Updating images array with ${images.length} images`);
        }

        // Log the final update data
        console.log(
          `Updating variant ${variantId} for product ${productId} with data:`,
          updateData
        );

        // Update the variant
        const updatedVariant = await storage.updateProductVariant(
          variantId,
          updateData
        );

        // Send notification to the user
        sendNotificationToUser(req.user.id, {
          title: "Variant Updated",
          message: `You've updated a variant of product "${product.name}"`,
          type: "product_update",
          link: `/seller/edit-product/${productId}`,
        });

        res.json(updatedVariant);
      } catch (error) {
        console.error("Error updating product variant:", error);
        res.status(500).json({ error: "Failed to update product variant" });
      }
    }
  );

  // Endpoint for saving/updating product variants
  app.post("/api/products/:id/variants", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const productId = parseInt(req.params.id);
      const product = await storage.getProduct(productId);

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Only seller who created the product or admin can update
      if (product.sellerId !== req.user.id && req.user.role !== "admin") {
        return res
          .status(403)
          .json({ error: "Not authorized to modify this product's variants" });
      }

      const variants = req.body;

      if (!Array.isArray(variants)) {
        return res.status(400).json({ error: "Expected an array of variants" });
      }

      console.log(
        `Received ${variants.length} variants to process for product ID ${productId}`
      );

      // First, get existing variants for this product
      const existingVariants = await storage.getProductVariants(productId);
      const existingVariantIds = existingVariants.map((v) => v.id);

      console.log("Existing variant IDs:", existingVariantIds);

      // Process each variant for bulk creation or individual updates
      let variantsToCreate = [];
      const results = {
        created: [],
        updated: [],
      };

      for (const variant of variants) {
        try {
          // Process the variant to ensure all fields are properly formatted
          const processedVariant = {
            ...variant,
            productId, // Ensure correct product association
            // Convert string values to appropriate types
            price:
              typeof variant.price === "string"
                ? parseFloat(variant.price)
                : Number(variant.price) || 0,
            mrp:
              typeof variant.mrp === "string"
                ? parseFloat(variant.mrp)
                : Number(variant.mrp) || 0,
            stock:
              typeof variant.stock === "string"
                ? parseInt(variant.stock)
                : Number(variant.stock) || 0,
            // Ensure images is a proper JSON string if it's an array
            images: Array.isArray(variant.images)
              ? JSON.stringify(variant.images)
              : variant.images,
          };

          // Check if this is an existing variant that needs updating
          if (variant.id && existingVariantIds.includes(variant.id)) {
            // Update existing variant
            console.log(`Updating existing variant ID ${variant.id}`);
            const updatedVariant = await storage.updateProductVariant(
              variant.id,
              processedVariant
            );
            results.updated.push(updatedVariant);
          } else {
            // Prepare for bulk creation - remove any client-side temporary IDs
            const { id, ...variantWithoutId } = processedVariant;
            console.log(
              `Preparing for bulk creation: ${JSON.stringify({
                ...variantWithoutId,
                productId,
              })}`
            );

            variantsToCreate.push({
              ...variantWithoutId,
              productId, // Ensure the correct product ID is set
            });
          }
        } catch (error) {
          console.error("Error processing variant:", error);
          // Continue with next variant instead of failing entire batch
        }
      }

      // Bulk create new variants if any
      if (variantsToCreate.length > 0) {
        console.log(`Bulk creating ${variantsToCreate.length} new variants`);
        try {
          const newVariants =
            await storage.createProductVariantsBulk(variantsToCreate);
          console.log(`Successfully created ${newVariants.length} variants`);
          results.created = newVariants;
        } catch (error) {
          console.error("Error in bulk creation of variants:", error);
          // Fall back to individual creation if bulk fails
          console.log("Falling back to individual variant creation");
          for (const variant of variantsToCreate) {
            try {
              const newVariant = await storage.createProductVariant(variant);
              results.created.push(newVariant);
            } catch (createError) {
              console.error(
                `Failed to create individual variant:`,
                createError
              );
            }
          }
        }
      }

      // Fetch all current variants to return in response
      const updatedVariants = await storage.getProductVariants(productId);
      console.log(
        `After processing, found ${updatedVariants.length} variants for product ${productId}`
      );

      // Return detailed results
      res.json({
        variants: updatedVariants,
        created: results.created.length,
        updated: results.updated.length,
        message: `Successfully processed variants: ${results.created.length} created, ${results.updated.length} updated`,
      });
    } catch (error) {
      console.error("Error saving product variants:", error);
      res.status(500).json({
        error: "Failed to save product variants",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get product variants by product ID - for API compatibility
  app.get("/api/product-variants/byProduct/:productId", async (req, res) => {
    try {
      const productId = parseInt(req.params.productId);

      // Validate product ID
      if (isNaN(productId)) {
        return res.status(400).json({ error: "Invalid product ID" });
      }

      // Check if the product exists and is approved for buyers
      const product = await storage.getProduct(productId);

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Check user role to determine if they should see unapproved products
      const userRole = req.isAuthenticated() ? req.user.role : "buyer";

      // If user is a buyer and product is not approved or is a draft, return 404
      if (userRole === "buyer" && (!product.approved || product.isDraft)) {
        console.log(
          `Unauthorized access attempt by buyer to variants of unapproved/draft product ${productId}`
        );
        return res.status(404).json({ error: "Product not found" });
      }

      console.log(`Fetching variants for product ID: ${productId}`);
      const variants = await storage.getProductVariants(productId);

      // Set content type explicitly to application/json to avoid HTML responses
      res.setHeader("Content-Type", "application/json");
      res.json(variants);
    } catch (error) {
      console.error("Error fetching product variants:", error);
      res.status(500).json({ error: "Failed to fetch product variants" });
    }
  });

  // Duplicate POST endpoint has been removed

  app.post(
    "/api/products",
    sellerAgreementHandlers.requireLatestAgreementAcceptance,
    async (req, res) => {
      if (!req.isAuthenticated()) return res.sendStatus(401);
      if (req.user.role !== "seller" && req.user.role !== "admin")
        return res.status(403).json({ error: "Not authorized" });

      try {
        // Check if seller is approved (skip for admin)
        if (req.user.role === "seller") {
          const seller = await storage.getUser(req.user.id);
          if (!seller || !seller.approved) {
            return res.status(403).json({
              error: "Seller account not approved",
              message:
                "Your seller account needs to be approved before you can list products.",
            });
          }
        }

        const { productData, variants } = req.body;

        console.log("Creating product with data:", JSON.stringify(productData));
        console.log("Variants received:", variants ? variants.length : 0);

        // Process subcategoryId
        let subcategoryId = productData.subcategoryId;
        if (
          subcategoryId === null ||
          subcategoryId === "" ||
          subcategoryId === 0 ||
          subcategoryId === "0" ||
          subcategoryId === "none"
        ) {
          subcategoryId = null;
        } else {
          const parsedValue = Number(subcategoryId);
          if (isNaN(parsedValue)) {
            console.log("SubcategoryId is not a valid number, setting to null");
            subcategoryId = null;
          } else {
            subcategoryId = parsedValue;
          }
        }

        // Ensure field names are in correct snake_case format for database
        const processedProductData = {
          ...productData,
          seller_id: req.user.id, // snake_case for database
          approved: false, // All new products start as unapproved
          is_draft: false, // snake_case for database
          subcategory_id: subcategoryId, // Add subcategory_id to the processed data
          // Ensure field names are consistent
          image_url: productData.imageUrl || productData.image_url,
          purchase_price:
            productData.purchasePrice || productData.purchase_price,
          gst_rate: productData.gstRate || productData.gst_rate,
          product_type:
            productData.productType ||
            productData.product_type ||
            productData.type,
          return_policy: productData.returnPolicy || productData.return_policy,
          // Handle dimension fields
          weight: productData.weight ? Number(productData.weight) : null,
          length: productData.length ? Number(productData.length) : null,
          width: productData.width ? Number(productData.width) : null,
          height: productData.height ? Number(productData.height) : null,
          // Handle warranty
          warranty: productData.warranty ? Number(productData.warranty) : null,
          // Add subcategory1 and subcategory2 (free text)
          subcategory1: productData.subcategory1 || null,
          subcategory2: productData.subcategory2 || null,
        };

        // Validate numeric fields
        if (
          processedProductData.weight !== null &&
          isNaN(processedProductData.weight)
        ) {
          throw new Error("Weight must be a valid number");
        }
        if (
          processedProductData.length !== null &&
          isNaN(processedProductData.length)
        ) {
          throw new Error("Length must be a valid number");
        }
        if (
          processedProductData.width !== null &&
          isNaN(processedProductData.width)
        ) {
          throw new Error("Width must be a valid number");
        }
        if (
          processedProductData.height !== null &&
          isNaN(processedProductData.height)
        ) {
          throw new Error("Height must be a valid number");
        }
        if (
          processedProductData.warranty !== null &&
          isNaN(processedProductData.warranty)
        ) {
          throw new Error("Warranty must be a valid number");
        }

        console.log(
          "Processed product data:",
          JSON.stringify(processedProductData)
        );

        // Create the main product
        const product = await storage.createProduct(processedProductData);

        // Process variants if any
        let createdVariants = [];
        if (variants && Array.isArray(variants) && variants.length > 0) {
          try {
            console.log("Processing variants for productId:", product.id);

            // Clean and prepare variants for database insertion
            const cleanedVariants = variants.map((variant) => {
              // Remove temporary client-side IDs and timestamps that could cause errors
              const { id, createdAt, updatedAt, ...cleanVariant } = variant;

              // Ensure proper data types for numeric fields
              return {
                ...cleanVariant,
                productId: product.id,
                price:
                  typeof cleanVariant.price === "number"
                    ? cleanVariant.price
                    : typeof cleanVariant.price === "string"
                      ? parseFloat(cleanVariant.price)
                      : 0,
                mrp:
                  typeof cleanVariant.mrp === "number"
                    ? cleanVariant.mrp
                    : typeof cleanVariant.mrp === "string"
                      ? parseFloat(cleanVariant.mrp)
                      : null,
                stock:
                  typeof cleanVariant.stock === "number"
                    ? cleanVariant.stock
                    : typeof cleanVariant.stock === "string"
                      ? parseInt(cleanVariant.stock)
                      : 0,
                // Ensure images is properly formatted as a JSON string
                images: Array.isArray(cleanVariant.images)
                  ? JSON.stringify(cleanVariant.images)
                  : typeof cleanVariant.images === "string"
                    ? cleanVariant.images
                    : "[]",
              };
            });

            console.log(
              "Prepared variants for creation:",
              JSON.stringify(cleanedVariants)
            );

            // Create all variants in bulk
            createdVariants =
              await storage.createProductVariantsBulk(cleanedVariants);
            console.log(
              "Successfully created variants:",
              createdVariants.length
            );
          } catch (variantError) {
            console.error("Error processing variants:", variantError);
            // Don't fail the entire product creation if variants fail
            // We'll just return the product without variants
          }
        }

        // Let the user know their product is pending approval
        res.status(201).json({
          ...product,
          variants: createdVariants,
          message:
            "Your product has been created and is pending approval by an admin.",
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: error.errors });
        }
        console.error("Error creating product:", error);
        res.status(500).json({ error: "Failed to create product" });
      }
    }
  );

  // Add draft product - doesn't require seller agreement since it's just a draft
  app.post("/api/products/draft", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      // Check if seller is approved (skip for admin)
      if (req.user.role === "seller") {
        const seller = await storage.getUser(req.user.id);
        if (!seller || !seller.approved) {
          return res.status(403).json({
            error: "Seller account not approved",
            message:
              "Your seller account needs to be approved before you can create draft products.",
          });
        }
      }

      const { productData, variants } = req.body;

      console.log(
        "Creating draft product with data:",
        JSON.stringify(productData)
      );
      console.log("Variants received:", variants ? variants.length : 0);

      // Process subcategoryId
      let subcategoryId = productData.subcategoryId;
      if (
        subcategoryId === null ||
        subcategoryId === "" ||
        subcategoryId === 0 ||
        subcategoryId === "0" ||
        subcategoryId === "none"
      ) {
        subcategoryId = null;
      } else {
        const parsedValue = Number(subcategoryId);
        if (isNaN(parsedValue)) {
          console.log("SubcategoryId is not a valid number, setting to null");
          subcategoryId = null;
        } else {
          subcategoryId = parsedValue;
        }
      }

      // Ensure field names are in correct snake_case format for database
      const processedProductData = {
        ...productData,
        seller_id: req.user.id, // snake_case for database
        approved: false, // All new products start as unapproved
        is_draft: true, // Mark as draft
        subcategory_id: subcategoryId, // Add subcategory_id to the processed data
        // Ensure field names are consistent
        image_url: productData.imageUrl || productData.image_url,
        purchase_price: productData.purchasePrice || productData.purchase_price,
        gst_rate: productData.gstRate || productData.gst_rate,
        product_type:
          productData.productType ||
          productData.product_type ||
          productData.type,
        return_policy: productData.returnPolicy || productData.return_policy,
        // Handle price field - ensure it's a number and has a default value
        price:
          typeof productData.price === "number"
            ? productData.price
            : typeof productData.price === "string"
              ? parseFloat(productData.price) || 0
              : 0,
        // Handle dimension fields
        weight: productData.weight ? Number(productData.weight) : null,
        length: productData.length ? Number(productData.length) : null,
        width: productData.width ? Number(productData.width) : null,
        height: productData.height ? Number(productData.height) : null,
        // Handle warranty
        warranty: productData.warranty ? Number(productData.warranty) : null,
        // Add subcategory1 and subcategory2 (free text)
        subcategory1: productData.subcategory1 || null,
        subcategory2: productData.subcategory2 || null,
      };

      // Validate numeric fields
      if (
        processedProductData.weight !== null &&
        isNaN(processedProductData.weight)
      ) {
        throw new Error("Weight must be a valid number");
      }
      if (
        processedProductData.length !== null &&
        isNaN(processedProductData.length)
      ) {
        throw new Error("Length must be a valid number");
      }
      if (
        processedProductData.width !== null &&
        isNaN(processedProductData.width)
      ) {
        throw new Error("Width must be a valid number");
      }
      if (
        processedProductData.height !== null &&
        isNaN(processedProductData.height)
      ) {
        throw new Error("Height must be a valid number");
      }
      if (
        processedProductData.warranty !== null &&
        isNaN(processedProductData.warranty)
      ) {
        throw new Error("Warranty must be a valid number");
      }

      console.log(
        "Processed draft product data:",
        JSON.stringify(processedProductData)
      );

      // Create the main product
      const product = await storage.createProduct(processedProductData);

      // Process variants if any
      let createdVariants = [];
      if (variants && Array.isArray(variants) && variants.length > 0) {
        try {
          console.log("Processing variants for draft productId:", product.id);

          // Clean and prepare variants for database insertion
          const cleanedVariants = variants.map((variant) => {
            // Remove temporary client-side IDs and timestamps that could cause errors
            const { id, createdAt, updatedAt, ...cleanVariant } = variant;

            // Ensure proper data types for numeric fields
            return {
              ...cleanVariant,
              productId: product.id,
              price:
                typeof cleanVariant.price === "number"
                  ? cleanVariant.price
                  : typeof cleanVariant.price === "string"
                    ? parseFloat(cleanVariant.price)
                    : 0,
              mrp:
                typeof cleanVariant.mrp === "number"
                  ? cleanVariant.mrp
                  : typeof cleanVariant.mrp === "string"
                    ? parseFloat(cleanVariant.mrp)
                    : null,
              stock:
                typeof cleanVariant.stock === "number"
                  ? cleanVariant.stock
                  : typeof cleanVariant.stock === "string"
                    ? parseInt(cleanVariant.stock)
                    : 0,
              // Ensure images is properly formatted as a JSON string
              images: Array.isArray(cleanVariant.images)
                ? JSON.stringify(cleanVariant.images)
                : typeof cleanVariant.images === "string"
                  ? cleanVariant.images
                  : "[]",
            };
          });

          console.log(
            "Prepared variants for draft creation:",
            JSON.stringify(cleanedVariants)
          );

          // Create all variants in bulk
          createdVariants =
            await storage.createProductVariantsBulk(cleanedVariants);
          console.log(
            "Successfully created draft variants:",
            createdVariants.length
          );
        } catch (variantError) {
          console.error("Error processing draft variants:", variantError);
          // Don't fail the entire product creation if variants fail
          // We'll just return the product without variants
        }
      }

      // Return the draft product
      res.status(201).json({
        ...product,
        variants: createdVariants,
        message: "Your draft product has been created successfully.",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating draft product:", error);
      res.status(500).json({ error: "Failed to create draft product" });
    }
  });

  app.put(
    "/api/products/:id",
    sellerAgreementHandlers.requireLatestAgreementAcceptance,
    async (req, res) => {
      if (!req.isAuthenticated()) return res.sendStatus(401);

      try {
        const id = parseInt(req.params.id);
        const product = await storage.getProduct(id);

        if (!product) {
          return res.status(404).json({ error: "Product not found" });
        }

        // Only seller who created the product or admin can update
        if (product.sellerId !== req.user.id && req.user.role !== "admin") {
          return res.status(403).json({ error: "Not authorized" });
        }

        // Log the incoming request body for debugging subcategoryId issues
        console.log(
          `DEBUG: PUT /api/products/${id} request body:`,
          JSON.stringify(req.body, null, 2)
        );

        const { productData, variants, deletedVariantIds } = req.body;

        // Log subcategory1 and subcategory2 for debugging
        console.log(`DEBUG: Product ${id} subcategory1 in request:`, productData?.subcategory1, `(type: ${typeof productData?.subcategory1})`);
        console.log(`DEBUG: Product ${id} subcategory2 in request:`, productData?.subcategory2, `(type: ${typeof productData?.subcategory2})`);

        // Process productData for update to ensure proper handling of gstRate and new fields
        let processedProductData = { ...productData };

        // Process numeric fields for dimensions
        const dimensionFields = ["height", "width", "weight", "length"];
        dimensionFields.forEach((field) => {
          if (processedProductData[field] !== undefined) {
            processedProductData[field] =
              typeof processedProductData[field] === "string"
                ? parseFloat(processedProductData[field]) || null
                : Number(processedProductData[field]) || null;
          }
        });

        // Process warranty and return policy
        if (processedProductData.warranty !== undefined) {
          processedProductData.warranty = processedProductData.warranty || null;
        }
        if (processedProductData.returnPolicy !== undefined) {
          processedProductData.returnPolicy =
            processedProductData.returnPolicy || null;
        }

        // Log the subcategoryId specifically for debugging
        if (productData) {
          console.log(
            `DEBUG: Product ${id} subcategoryId in request:`,
            productData.subcategoryId,
            `(type: ${typeof productData.subcategoryId})`
          );
        }

        // Check if this is a draft product being updated
        if (product.isDraft || product.is_draft) {
          console.log(
            "Updating a draft product - changing status to pending approval"
          );
          // Change isDraft and is_draft to false, approved remains false for pending status
          processedProductData.isDraft = false;
          processedProductData.is_draft = false;
          processedProductData.approved = false;
        }

        // Handle GST rate to ensure it's correctly stored as a decimal
        if (productData.gstRate !== undefined) {
          // Convert gstRate to a proper decimal format
          console.log(
            "Processing GST rate before update:",
            productData.gstRate,
            typeof productData.gstRate
          );

          processedProductData.gstRate =
            typeof productData.gstRate === "number"
              ? productData.gstRate
              : typeof productData.gstRate === "string" &&
                  productData.gstRate !== ""
                ? parseFloat(productData.gstRate)
                : null;

          console.log("Processed GST rate:", processedProductData.gstRate);
        }

        // Log the processed data before sending to the storage layer
        console.log(
          `DEBUG: Product ${id} processed data for storage:`,
          JSON.stringify(processedProductData, null, 2)
        );
        console.log(
          `DEBUG: Product ${id} subcategoryId after processing:`,
          processedProductData.subcategoryId,
          `(type: ${typeof processedProductData.subcategoryId})`
        );

        // Ensure subcategoryId is properly formatted as number or null with more robust handling
        if (processedProductData.subcategoryId !== undefined) {
          if (
            processedProductData.subcategoryId === null ||
            processedProductData.subcategoryId === "" ||
            processedProductData.subcategoryId === 0 ||
            processedProductData.subcategoryId === "0" ||
            processedProductData.subcategoryId === "none"
          ) {
            processedProductData.subcategoryId = null;
          } else {
            // Convert to number with NaN check
            const parsedValue = Number(processedProductData.subcategoryId);
            if (isNaN(parsedValue)) {
              console.log(
                `DEBUG: Product ${id} subcategoryId is not a valid number, setting to null`
              );
              processedProductData.subcategoryId = null;
            } else {
              processedProductData.subcategoryId = parsedValue;
            }
          }
        } else {
          // Handle undefined by setting to null
          processedProductData.subcategoryId = null;
        }

        // Handle subcategory1 and subcategory2 fields
        if (processedProductData.subcategory1 !== undefined) {
          console.log(`DEBUG: Product ${id} processed subcategory1:`, processedProductData.subcategory1, `(type: ${typeof processedProductData.subcategory1})`);
          processedProductData.subcategory1 = processedProductData.subcategory1 || null;
        }
        if (processedProductData.subcategory2 !== undefined) {
          console.log(`DEBUG: Product ${id} processed subcategory2:`, processedProductData.subcategory2, `(type: ${typeof processedProductData.subcategory2})`);
          processedProductData.subcategory2 = processedProductData.subcategory2 || null;
        }

        console.log(
          `DEBUG: Product ${id} subcategoryId after formatting:`,
          processedProductData.subcategoryId,
          `(type: ${typeof processedProductData.subcategoryId})`
        );

        // Get the existing product data, including variants, before updating
        const existingProduct = await storage.getProductById(id, true);
        console.log(
          `DEBUG: Existing product variants before update: ${
            existingProduct?.variants?.length || 0
          }`
        );

        // Update the main product with processed data
        const updatedProduct = await storage.updateProduct(
          id,
          processedProductData || req.body
        );

        // Enhanced variant preservation logic
        // If __preserveVariants flag is set or if we should automatically preserve variants
        // when category changes but they exist in the database
        const shouldPreserveVariants =
          processedProductData.__preserveVariants === true ||
          req.body.__preserveVariants === true ||
          req.body.__includeAllVariants === true ||
          ((!variants || !Array.isArray(variants) || variants.length === 0) &&
            existingProduct?.variants &&
            existingProduct.variants.length > 0 &&
            !deletedVariantIds);

        if (shouldPreserveVariants) {
          console.log(
            `DEBUG: Preserving existing variants for product ${id}. Preservation flag: ${processedProductData.__preserveVariants}, Include all flag: ${req.body.__includeAllVariants}`
          );
          console.log(
            `DEBUG: Existing variants count before preservation: ${
              existingProduct.variants?.length || 0
            }`
          );

          // Set variants to the existing variants to preserve them in the response
          updatedProduct.variants = existingProduct.variants;

          // Log the preservation process
          console.log(
            `DEBUG: After preservation, variants in response: ${
              updatedProduct.variants?.length || 0
            }`
          );
        }

        // Handle variants updates if provided
        let updatedVariants = [];
        let createdVariants = [];

        // First delete any variants that need to be removed
        if (
          deletedVariantIds &&
          Array.isArray(deletedVariantIds) &&
          deletedVariantIds.length > 0
        ) {
          for (const variantId of deletedVariantIds) {
            await storage.deleteProductVariant(parseInt(variantId));
          }
        }

        // Update existing variants and create new ones
        if (variants && Array.isArray(variants)) {
          for (const variant of variants) {
            try {
              // Remove createdAt field if present to avoid timestamp conversion issues
              const { createdAt, ...variantWithoutDate } = variant;

              // Process variant data
              // Log the variant data for debugging
              console.log(
                "Processing variant on server side:",
                variantWithoutDate
              );

              const processedVariant = {
                ...variantWithoutDate,
                productId: id, // Ensure correct product association
                // Make sure all required fields exist
                sku: variantWithoutDate.sku || "",
                color: variantWithoutDate.color || "",
                size: variantWithoutDate.size || "",
                // Convert string representation of numeric fields to actual numbers
                price:
                  typeof variant.price === "string"
                    ? parseInt(variant.price)
                    : Number(variant.price) || 0,
                mrp:
                  typeof variant.mrp === "string"
                    ? parseInt(variant.mrp)
                    : Number(variant.mrp) || 0,
                stock:
                  typeof variant.stock === "string"
                    ? parseInt(variant.stock)
                    : Number(variant.stock) || 0,
                // Ensure images is a proper JSON array
                images: (() => {
                  console.log(
                    `Processing images for variant ${
                      variant.id || "new"
                    }, type:`,
                    typeof variant.images
                  );

                  // If it's already an array, stringify it properly
                  if (Array.isArray(variant.images)) {
                    console.log(
                      `Variant ${variant.id || "new"} has ${
                        variant.images.length
                      } images as an array, converting to JSON string`
                    );
                    return JSON.stringify(variant.images);
                  }

                  // If it's a string that looks like a JSON array, make sure it's valid
                  if (typeof variant.images === "string") {
                    // If the string is already a properly formatted JSON string, use it as is
                    if (variant.images.trim().startsWith("[")) {
                      try {
                        // Verify it's valid by parsing and re-stringify (normalizes format)
                        const parsed = JSON.parse(variant.images);
                        if (Array.isArray(parsed)) {
                          console.log(
                            `Variant ${
                              variant.id || "new"
                            } had valid JSON string with ${
                              parsed.length
                            } images`
                          );
                          return JSON.stringify(parsed);
                        }
                      } catch (e) {
                        // If parsing fails, it's not valid JSON
                        console.error(
                          `Invalid JSON string for variant ${
                            variant.id || "new"
                          } images:`,
                          e
                        );
                      }
                    }

                    // If it's a string but not JSON, treat as a single image URL
                    console.log(
                      `Variant ${
                        variant.id || "new"
                      } has a string that's not JSON, treating as single image`
                    );
                    return JSON.stringify([variant.images]);
                  }

                  // Default to empty array if no valid images
                  console.log(
                    `No valid images for variant ${
                      variant.id || "new"
                    }, using empty array`
                  );
                  return JSON.stringify([]);
                })(),
              };

              console.log("Processed variant:", processedVariant);

              // Check if this is an existing variant with a valid ID that exists in the database
              let existingVariant;
              if (variant.id && !isNaN(Number(variant.id))) {
                // First check if this ID actually exists in the database
                existingVariant = await storage.getProductVariant(
                  Number(variant.id)
                );
              }

              if (existingVariant) {
                // Update existing variant
                console.log(`Updating existing variant with ID: ${variant.id}`);
                const updatedVariant = await storage.updateProductVariant(
                  Number(variant.id),
                  processedVariant
                );
                updatedVariants.push(updatedVariant);
              } else {
                // Create new variant - remove any temporary ID that might cause conflicts
                const { id: tempId, ...variantWithoutId } = processedVariant;
                console.log(`Creating new variant without temp ID: ${tempId}`);

                // Ensure productId is correctly set and all required fields are present
                const validVariant = {
                  ...variantWithoutId,
                  productId: id, // Make sure product ID is set correctly
                  sku: variantWithoutId.sku || `VARIANT-${id}-${Date.now()}`,
                  color: variantWithoutId.color || "",
                  size: variantWithoutId.size || "",
                  price: Number(variantWithoutId.price) || 0,
                  mrp: Number(variantWithoutId.mrp) || 0,
                  stock: Number(variantWithoutId.stock) || 0,
                };

                const newVariant =
                  await storage.createProductVariant(validVariant);
                console.log(
                  `Successfully created new variant with ID: ${newVariant.id}`
                );
                createdVariants.push(newVariant);
              }
            } catch (error) {
              console.error("Error processing variant:", error);
              // Continue processing other variants instead of failing the entire request
            }
          }
        }

        // Get all current variants for response
        const currentVariants = await storage.getProductVariants(id);

        res.json({
          ...updatedProduct,
          variants: currentVariants,
          created: createdVariants.length,
          updated: updatedVariants.length,
          deleted: deletedVariantIds?.length || 0,
        });
      } catch (error) {
        console.error("Error updating product:", error);

        // Provide more specific error message for debugging
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";

        // Check for PostgreSQL integer overflow
        if (
          errorMessage.includes("integer out of range") ||
          errorMessage.includes("value too large")
        ) {
          res.status(400).json({
            error:
              "Failed to update product: Integer value too large. Please use smaller numeric values for IDs and quantities.",
          });
        } else {
          res.status(500).json({
            error: "Failed to update product",
            details: errorMessage,
          });
        }
      }
    }
  );

  app.delete(
    "/api/products/:id",
    sellerAgreementHandlers.requireLatestAgreementAcceptance,
    async (req, res) => {
      if (!req.isAuthenticated()) return res.sendStatus(401);

      try {
        const id = parseInt(req.params.id);
        const product = await storage.getProduct(id);

        if (!product) {
          return res.status(404).json({ error: "Product not found" });
        }

        // Only seller who created the product or admin can delete
        if (product.sellerId !== req.user.id && req.user.role !== "admin") {
          return res.status(403).json({ error: "Not authorized" });
        }

        await storage.deleteProduct(id);

        // Send notification to seller if an admin deleted their product
        if (req.user.role === "admin" && product.sellerId !== req.user.id) {
          try {
            await sendNotificationToUser(product.sellerId, {
              type: "product_deleted",
              title: "Product Deleted",
              message: `Your product "${product.name}" has been deleted by an administrator.`,
              data: { productId: id },
            });
          } catch (error) {
            console.error("Failed to send notification:", error);
            // Continue execution even if notification fails
          }
        }

        res.status(204).send();
      } catch (error) {
        console.error(
          `[DELETE ERROR] Failed to delete product ${req.params.id}:`,
          error
        );
        res.status(500).json({
          error: "Failed to delete product",
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
  );

  // Bulk delete products endpoint
  app.post(
    "/api/products/bulk-delete",
    sellerAgreementHandlers.requireLatestAgreementAcceptance,
    async (req, res) => {
      if (!req.isAuthenticated()) return res.sendStatus(401);

      // Add debugging
      console.log(
        "Bulk delete request from:",
        req.user.role,
        "User ID:",
        req.user.id
      );
      console.log("Request body:", req.body);

      // Allow both admin and seller roles
      if (req.user.role !== "admin" && req.user.role !== "seller") {
        return res.status(403).json({
          error: "Only sellers or administrators can delete products",
        });
      }

      try {
        // Handle both productIds and ids parameters for backward compatibility
        const productIds = req.body.ids || req.body.productIds;

        console.log("Extracted IDs:", productIds);

        if (!Array.isArray(productIds) || productIds.length === 0) {
          return res.status(400).json({ error: "Invalid product IDs" });
        }

        const ids = productIds;

        // Delete all products in the list
        const results = await Promise.all(
          ids.map(async (id) => {
            try {
              const product = await storage.getProduct(id);
              if (!product) {
                return { id, success: false, message: "Product not found" };
              }

              // If user is a seller, verify they can only delete their own products
              if (
                req.user.role === "seller" &&
                product.sellerId !== req.user.id
              ) {
                return {
                  id,
                  success: false,
                  message: "Not authorized to delete this product",
                };
              }

              await storage.deleteProduct(id);

              // Notify the seller if their product was deleted by an admin
              if (
                req.user.role === "admin" &&
                product.sellerId &&
                product.sellerId !== req.user.id
              ) {
                try {
                  await sendNotificationToUser(product.sellerId, {
                    type: "product_deleted",
                    title: "Product Deleted",
                    message: `Your product "${product.name}" has been deleted by an administrator.`,
                    data: { productId: id },
                  });
                } catch (error) {
                  console.error(
                    `Failed to send notification for product ${id}:`,
                    error
                  );
                  // Continue execution even if notification fails
                }
              }

              return { id, success: true };
            } catch (error) {
              console.error(`Error deleting product ${id}:`, error);
              return {
                id,
                success: false,
                message:
                  error instanceof Error ? error.message : "Unknown error",
              };
            }
          })
        );

        const successful = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        res.status(200).json({
          message: `${successful} products deleted successfully, ${failed} failed`,
          results,
        });
      } catch (error) {
        console.error("Error bulk deleting products:", error);
        res.status(500).json({
          error: "Failed to bulk delete products",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // Export products as CSV
  app.get("/api/products/export", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      // Default to current user's seller ID
      let sellerId = req.user.id;

      // Allow admin to export any seller's products
      if (req.user.role === "admin" && req.query.sellerId) {
        sellerId = parseInt(req.query.sellerId as string);
      }

      // Get all products for the seller without pagination
      const products = await storage.getAllProducts({ sellerId });

      // Import csv-writer to generate CSV data
      const createCsvStringifier =
        require("csv-writer").createObjectCsvStringifier;
      const csvStringifier = createCsvStringifier({
        header: [
          { id: "id", title: "ID" },
          { id: "name", title: "Name" },
          { id: "description", title: "Description" },
          { id: "price", title: "Price" },
          { id: "stock", title: "Stock" },
          { id: "category", title: "Category" },
          { id: "sku", title: "SKU" },
          { id: "approved", title: "Approved" },
          { id: "imageUrl", title: "Image URL" },
        ],
      });

      const records = products.map((product) => ({
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        stock: product.stock,
        category: product.category,
        sku: product.sku || "",
        approved: product.approved ? "Yes" : "No",
        imageUrl: product.imageUrl || "",
      }));

      const csvHeader = csvStringifier.getHeaderString();
      const csvRows = csvStringifier.stringifyRecords(records);
      const csvContent = csvHeader + csvRows;

      // Set response headers for CSV download
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=products-${sellerId}-${new Date()
          .toISOString()
          .slice(0, 10)}.csv`
      );

      // Send CSV content
      res.send(csvContent);
    } catch (error) {
      console.error("Error exporting products:", error);
      res.status(500).json({ error: "Failed to export products" });
    }
  });

  // Admin product approval is handled above in the Product approval routes section

  // Cart routes
  app.get("/api/cart", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      console.log(`Fetching cart items for user ID: ${req.user.id}`);
      const cartItems = await storage.getCartItems(req.user.id);
      console.log(`Successfully fetched ${cartItems.length} cart items`);
      res.json(cartItems);
    } catch (error) {
      console.error("Error fetching cart items:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch cart", details: error.message });
    }
  });

  // Validate cart items before checkout
  app.get("/api/cart/validate", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      console.log(`Validating cart items for user ID: ${req.user.id}`);
      const cartItems = await storage.getCartItems(req.user.id);

      if (cartItems.length === 0) {
        console.log(`Cart validation: User ${req.user.id} has empty cart`);
        return res.json({ valid: true, invalid: [] });
      }

      console.log(
        `Cart validation: User ${req.user.id} has ${cartItems.length} items to validate`
      );

      // Validate all cart items
      const invalidItems = [];

      for (const item of cartItems) {
        // Check for invalid cart item record first
        if (!item || typeof item !== "object") {
          console.log(
            `Cart validation: Found completely invalid cart item object`
          );
          // This is a serious error, but we can't fix it without an ID
          continue;
        }

        // First check if the item has a valid product object and ID
        if (
          !item.product ||
          !item.product.id ||
          typeof item.product.id !== "number"
        ) {
          console.log(
            `Cart validation: Found item with invalid or missing product:`,
            item.id
          );
          invalidItems.push({
            id: item.id, // Include cart item ID for deletion
            error: "Invalid product reference",
          });
          continue;
        }

        // Use product.id as the productId for validation
        const productId = item.product.id;

        // Check if product exists and is approved
        try {
          // Verify the product still exists in the database
          // We're querying directly even though we have a product object
          // since we want to confirm it still exists and has proper permissions
          const product = await storage.getProduct(productId);
          if (!product) {
            console.log(
              `Cart validation: Product ${productId} not found in database`
            );
            invalidItems.push({
              id: item.id, // Include cart item ID for deletion
              productId: productId,
              error: "Product not found in database",
            });
            continue;
          }

          if (!product.approved) {
            console.log(`Cart validation: Product ${productId} not approved`);
            invalidItems.push({
              id: item.id, // Include cart item ID for deletion
              productId: productId,
              error: "Product not approved",
            });
            continue;
          }

          // Check if product has enough stock
          if (product.stock < item.quantity) {
            console.log(
              `Cart validation: Product ${productId} has insufficient stock (requested: ${item.quantity}, available: ${product.stock})`
            );
            invalidItems.push({
              id: item.id, // Include cart item ID for deletion
              productId: productId,
              error: "Insufficient stock",
            });
            continue;
          }
        } catch (error) {
          console.error(
            `Cart validation: Error checking product ${productId}:`,
            error
          );
          invalidItems.push({
            id: item.id, // Include cart item ID for deletion
            productId: productId,
            error: "Error checking product",
          });
          continue;
        }

        // If item has a variant, check if it exists
        if (item.variant && item.variant.id) {
          const variantId = item.variant.id;
          try {
            const variant = await storage.getProductVariant(variantId);
            if (!variant) {
              console.log(
                `Cart validation: Variant ${variantId} for product ${productId} not found`
              );
              invalidItems.push({
                id: item.id, // Include cart item ID for deletion
                productId: productId,
                variantId: variantId,
                error: "Variant not found",
              });
              continue;
            }

            // Check if variant has enough stock
            if (variant.stock < item.quantity) {
              console.log(
                `Cart validation: Variant ${variantId} has insufficient stock (requested: ${item.quantity}, available: ${variant.stock})`
              );
              invalidItems.push({
                id: item.id, // Include cart item ID for deletion
                productId: productId,
                variantId: variantId,
                error: "Insufficient variant stock",
              });
              continue;
            }
          } catch (error) {
            console.error(
              `Cart validation: Error checking variant ${variantId}:`,
              error
            );
            invalidItems.push({
              id: item.id, // Include cart item ID for deletion
              productId: productId,
              variantId: variantId,
              error: "Error checking variant",
            });
            continue;
          }
        }
      }

      if (invalidItems.length > 0) {
        console.log(
          `Cart validation found ${invalidItems.length} invalid items:`,
          invalidItems
        );
        return res.json({
          valid: false,
          invalid: invalidItems,
        });
      }

      console.log("Cart validation successful - all items are valid");
      return res.json({
        valid: true,
        invalid: [],
      });
    } catch (error) {
      console.error("Error validating cart items:", error);
      res.status(500).json({ error: "Failed to validate cart items" });
    }
  });

  app.post("/api/cart", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      // Clone request body for possible modification
      const requestBody = { ...req.body };

      // Add log for debugging Buy Now requests
      console.log(
        `Cart API received request:`,
        JSON.stringify(requestBody, null, 2)
      );

      // Pre-check: If a variant ID is present but was sent as a product ID (Buy Now flow)
      // This handles the case when client sends the variant ID as the product ID
      if (requestBody.productId && !requestBody.variantId) {
        try {
          // Check if the product ID might actually be a variant ID
          const variant = await storage.getProductVariant(
            requestBody.productId
          );
          if (variant) {
            console.log(
              `Detected variant ID ${requestBody.productId} sent as product ID. Correcting request.`
            );
            // This is a variant ID - adjust the request data
            requestBody.variantId = requestBody.productId;
            requestBody.productId = variant.productId;
            console.log(
              `Corrected request data:`,
              JSON.stringify(requestBody, null, 2)
            );
          }
        } catch (error) {
          console.log(
            `Variant pre-check failed, continuing with original values:`,
            error
          );
        }
      }

      // Validate the request body against the schema
      const cartData = insertCartSchema.parse({
        ...requestBody,
        userId: req.user.id,
      });

      // Validate the product ID is a valid number
      if (
        !cartData.productId ||
        typeof cartData.productId !== "number" ||
        isNaN(cartData.productId)
      ) {
        console.error(`Invalid product ID: ${cartData.productId}`);
        return res.status(400).json({ error: "Invalid product ID" });
      }

      // Validate the quantity is positive
      if (!cartData.quantity || cartData.quantity <= 0) {
        console.error(`Invalid quantity: ${cartData.quantity}`);
        return res
          .status(400)
          .json({ error: "Quantity must be greater than 0" });
      }

      // Check if the product exists and is approved
      const product = await storage.getProduct(cartData.productId);

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Check if product is approved before adding to cart
      if (!product.approved) {
        console.log(
          `Unauthorized attempt to add unapproved product ${cartData.productId} to cart by user ${req.user.id}`
        );
        return res.status(404).json({ error: "Product not found" });
      }

      // Check if variant exists if variantId is provided
      let availableStock = product.stock;
      if (cartData.variantId) {
        const variant = await storage.getProductVariant(cartData.variantId);
        if (!variant) {
          return res.status(404).json({ error: "Variant not found" });
        }

        // Use variant stock if available
        if (variant.stock !== null && variant.stock !== undefined) {
          availableStock = variant.stock;
        }
      }

      // Check existing cart first to see if adding this quantity would exceed available stock
      const existingCartItems = await storage.getCartItems(req.user.id);
      let existingItem = null;

      // Find existing item in cart that matches this product and variant
      for (const item of existingCartItems) {
        if (!item.product || !item.product.id) continue;

        const matchesProduct = item.product.id === cartData.productId;

        if (cartData.variantId) {
          if (
            matchesProduct &&
            item.variant &&
            item.variant.id === cartData.variantId
          ) {
            existingItem = item;
            break;
          }
        } else if (matchesProduct && (!item.variant || !item.variant.id)) {
          existingItem = item;
          break;
        }
      }

      const totalRequestedQuantity =
        (existingItem ? existingItem.quantity : 0) + cartData.quantity;

      // Check if there's enough stock to fulfill the total requested quantity
      if (totalRequestedQuantity > availableStock) {
        return res.status(400).json({
          error: "Insufficient stock",
          message: `Cannot add ${
            cartData.quantity
          } more units. Only ${availableStock} total units available (${
            existingItem ? existingItem.quantity : 0
          } already in cart)`,
          availableStock,
          currentInCart: existingItem ? existingItem.quantity : 0,
          maxAddable:
            availableStock - (existingItem ? existingItem.quantity : 0),
          inCart: existingItem ? existingItem.quantity : 0,
        });
      }

      // Log full request details for debugging
      console.log(
        `Adding to cart: Product ${cartData.productId}${
          cartData.variantId ? `, Variant ${cartData.variantId}` : ""
        } for user ${req.user.id}, quantity: ${
          cartData.quantity
        }, available stock: ${availableStock}`
      );

      const cart = await storage.addToCart(cartData);
      res.status(201).json(cart);
    } catch (error) {
      console.error("Failed to add to cart:", error);

      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }

      // Handle specific error from storage
      if (error instanceof Error) {
        if (
          error.message.includes("does not exist") ||
          error.message.includes("no longer available")
        ) {
          return res.status(404).json({ error: error.message });
        }

        if (error.message.includes("variant")) {
          return res.status(400).json({ error: error.message });
        }
      }

      // Include specific error message for better debugging
      res.status(500).json({
        error: "Failed to add to cart",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.put("/api/cart/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      // Validate ID parameter
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        console.error(`Invalid cart item ID: ${req.params.id}`);
        return res.status(400).json({ error: "Invalid cart item ID" });
      }

      // Validate quantity
      const quantity = req.body.quantity;
      if (
        !quantity ||
        typeof quantity !== "number" ||
        isNaN(quantity) ||
        quantity <= 0
      ) {
        console.error(`Invalid quantity: ${quantity}`);
        return res
          .status(400)
          .json({ error: "Quantity must be greater than 0" });
      }

      // Check if cart item exists
      const cartItem = await storage.getCartItem(id);

      if (!cartItem) {
        console.error(`Cart item with ID ${id} not found`);
        return res.status(404).json({ error: "Cart item not found" });
      }

      // Check if cart item belongs to user
      if (cartItem.userId !== req.user.id) {
        console.error(
          `User ${req.user.id} not authorized to update cart item ${id} owned by user ${cartItem.userId}`
        );
        return res.status(403).json({ error: "Not authorized" });
      }

      // Check if the product exists and get its stock information
      const product = await storage.getProduct(cartItem.productId);
      if (!product) {
        return res.status(404).json({ error: "Product no longer exists" });
      }

      // Determine the available stock (product or variant)
      let availableStock = product.stock;

      // If the cart item has a variant, check variant stock
      if (cartItem.variantId) {
        const variant = await storage.getProductVariant(cartItem.variantId);
        if (!variant) {
          return res
            .status(404)
            .json({ error: "Product variant no longer exists" });
        }

        // Use variant stock if available
        if (variant.stock !== null && variant.stock !== undefined) {
          availableStock = variant.stock;
        }
      }

      // Validate that requested quantity doesn't exceed available stock
      if (quantity > availableStock) {
        return res.status(400).json({
          error: "Insufficient stock",
          message: `Cannot update to ${quantity} units. Only ${availableStock} units available in stock.`,
          availableStock,
          maxAllowed: availableStock,
        });
      }

      // Attempt to update the cart item
      console.log(
        `Updating cart item ${id} with quantity ${quantity}, available stock: ${availableStock}`
      );
      const updatedCartItem = await storage.updateCartItem(id, quantity);
      res.json(updatedCartItem);
    } catch (error) {
      console.error("Failed to update cart:", error);

      // Handle specific errors
      if (error instanceof Error) {
        // If product no longer exists
        if (error.message.includes("no longer exists")) {
          return res.status(404).json({ error: error.message });
        }
      }

      res.status(500).json({ error: "Failed to update cart" });
    }
  });

  app.delete("/api/cart/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const id = parseInt(req.params.id);
      const cartItem = await storage.getCartItem(id);

      if (!cartItem) {
        return res.status(404).json({ error: "Cart item not found" });
      }

      if (cartItem.userId !== req.user.id) {
        return res.status(403).json({ error: "Not authorized" });
      }

      await storage.removeFromCart(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to remove from cart" });
    }
  });

  // Clear cart endpoint
  app.post("/api/cart/clear", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      await storage.clearCart(req.user.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error clearing cart:", error);
      res.status(500).json({ error: "Failed to clear cart" });
    }
  });

  // Razorpay payment routes
  app.get("/api/razorpay/key", (req, res) => {
    try {
      const keyId = getRazorpayKeyId();

      // Validate key format
      if (!keyId || typeof keyId !== "string" || !keyId.startsWith("rzp_")) {
        return res.status(500).json({
          error: "Invalid Razorpay key format. Key should start with 'rzp_'.",
        });
      }

      res.json({ keyId });
    } catch (error) {
      console.error("Error fetching Razorpay key:", error);
      // Return more specific error message
      let errorMessage = "Failed to fetch Razorpay key";
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      res.status(500).json({ error: errorMessage });
    }
  });

  // Debug endpoint to check Razorpay configuration
  app.get("/api/razorpay/check-config", (req, res) => {
    if (!req.isAuthenticated() || req.user.role !== "admin") {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      // Use the utility function to get config status
      const configStatus = getRazorpayConfigStatus();

      // Add masked keys for display
      const KEY_ID = process.env.RAZORPAY_KEY_ID || null;
      const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || null;

      // Don't expose the full key
      const maskedKeyId = KEY_ID
        ? KEY_ID.startsWith("rzp_")
          ? `${KEY_ID.substring(0, 7)}...${KEY_ID.substring(KEY_ID.length - 5)}`
          : `Invalid format: ${KEY_ID.substring(0, 4)}...${KEY_ID.substring(
              KEY_ID.length - 4
            )}`
        : null;

      const maskedKeySecret = KEY_SECRET
        ? `${KEY_SECRET.substring(0, 3)}...${KEY_SECRET.substring(
            KEY_SECRET.length - 3
          )}`
        : null;

      // Create detailed response with recommendations
      // Check if the keys are valid
      const isValidKeyId =
        KEY_ID && typeof KEY_ID === "string" && KEY_ID.startsWith("rzp_");
      const isValidKeySecret =
        KEY_SECRET && typeof KEY_SECRET === "string" && KEY_SECRET.length > 20;

      const response = {
        ...configStatus,
        maskedKeyId,
        maskedKeySecret,
        recommendations: [] as string[],
      };

      // Add helpful recommendations based on configuration status
      if (!configStatus.isConfigured) {
        if (!configStatus.keyIdPresent) {
          response.recommendations.push(
            "Add RAZORPAY_KEY_ID to your environment secrets"
          );
        } else if (!configStatus.keyIdValid) {
          response.recommendations.push(
            'RAZORPAY_KEY_ID is invalid. It should start with "rzp_"'
          );
        }

        if (!configStatus.keySecretPresent) {
          response.recommendations.push(
            "Add RAZORPAY_KEY_SECRET to your environment secrets"
          );
        } else if (!configStatus.keySecretValid) {
          response.recommendations.push(
            "RAZORPAY_KEY_SECRET seems invalid. Check for correct format and length"
          );
        }
      }

      // Add domain verification recommendation regardless of configuration status
      response.recommendations.push(
        "For production use, register your domain in the Razorpay dashboard under Settings > Websites & Apps"
      );

      // Return the enhanced response
      res.json(response);
    } catch (error) {
      console.error("Error checking Razorpay config:", error);
      res.status(500).json({ error: "Failed to check Razorpay configuration" });
    }
  });

  app.post("/api/razorpay/create-order", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      // Get cart items to calculate total
      const cartItems = await storage.getCartItems(req.user.id);

      if (cartItems.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
      }

      // Calculate total in lowest currency unit (paise for INR)
      const totalInPaise = Math.round(
        cartItems.reduce(
          (acc, item) => acc + item.product.price * item.quantity,
          0
        ) * 100
      );

      // Create a unique receipt ID
      const receiptId = `receipt_${Date.now()}_${req.user.id}`;

      // Notes for the order
      const notes = {
        userId: req.user.id.toString(),
        email: req.user.email,
        items: JSON.stringify(
          cartItems.map((item) => ({
            productId: item.product.id,
            name: item.product.name,
            quantity: item.quantity,
            price: item.product.price,
          }))
        ),
      };

      // Create Razorpay order
      const order = await createRazorpayOrder(totalInPaise, receiptId, notes);

      res.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        receipt: order.receipt,
      });
    } catch (error) {
      console.error("Error creating Razorpay order:", error);
      // Include more specific error information for debugging
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({
        error: "Failed to create Razorpay order",
        details: errorMessage,
      });
    }
  });

  app.post("/api/razorpay/verify-payment", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const {
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        shippingDetails,
        addressId,
        walletDetails,
      } = req.body;

      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        return res
          .status(400)
          .json({ error: "Missing payment verification details" });
      }

      // Verify the payment signature
      const result = await handleSuccessfulPayment(
        razorpayPaymentId,
        razorpayOrderId,
        razorpaySignature
      );

      if (!result.success) {
        return res.status(400).json({ error: "Payment verification failed" });
      }

      // Get cart items
      const cartItems = await storage.getCartItems(req.user.id);

      if (cartItems.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
      }

      // Validate shipping address
      if (
        !addressId &&
        (!shippingDetails ||
          (typeof shippingDetails === "string" &&
            (!JSON.parse(shippingDetails)?.address ||
              JSON.parse(shippingDetails)?.address.trim() === "")))
      ) {
        return res.status(400).json({ error: "Shipping address is required" });
      }

      // Debug log the address information
      console.log("Order address information (Razorpay):", {
        addressId,
        shippingDetails,
      });

      // Validate addressId (if provided)
      let validatedAddressId = null;
      if (addressId) {
        // Verify the address exists and belongs to the user
        const parsedAddressId = parseInt(addressId);
        console.log(`Validating address ID (Razorpay): ${parsedAddressId}`);

        try {
          const address = await storage.getUserAddress(parsedAddressId);
          if (!address) {
            console.error(`Address with ID ${parsedAddressId} not found`);
            return res.status(400).json({ error: "Address not found" });
          }

          if (address.userId !== req.user.id) {
            console.error(
              `Address ${parsedAddressId} belongs to user ${address.userId}, not ${req.user.id}`
            );
            return res.status(400).json({ error: "Invalid address selected" });
          }

          console.log(`Address validated successfully:`, address);
          validatedAddressId = parsedAddressId;
        } catch (addressError) {
          console.error("Error validating address:", addressError);
          return res.status(400).json({ error: "Error validating address" });
        }
      }

      // Calculate total
      const total = cartItems.reduce(
        (acc, item) => acc + item.product.price * item.quantity,
        0
      );

      // Create order in our system
      const orderData: any = {
        userId: req.user.id,
        status: "paid", // Payment successful, so mark as paid
        total,
        date: new Date(),
        shippingDetails:
          typeof shippingDetails === "string"
            ? shippingDetails
            : JSON.stringify(shippingDetails || {}),
        paymentMethod: "razorpay",
        paymentId: razorpayPaymentId,
        orderId: razorpayOrderId,
      };

      // Add validated address ID if available
      if (validatedAddressId) {
        orderData.addressId = validatedAddressId;
        console.log(
          `Adding validated addressId ${validatedAddressId} to Razorpay order`
        );
      }

      console.log(
        "Creating order after successful Razorpay payment:",
        orderData
      );

      const order = await storage.createOrder(orderData);
      console.log("Order created successfully after Razorpay payment:", order);

      // Create order items
      for (const item of cartItems) {
        const orderItemData = {
          orderId: order.id,
          productId: item.product.id,
          quantity: item.quantity,
          price: item.product.price,
        };

        console.log("Creating order item:", orderItemData);
        await storage.createOrderItem(orderItemData);
      }

      // Award first purchase wallet coins if eligible
      try {
        const rewardResult = await storage.processFirstPurchaseReward(
          req.user.id,
          order.id
        );
        if (rewardResult) {
          console.log(
            `Awarded first purchase wallet coins to user ${req.user.id} for order #${order.id}`
          );
        } else {
          console.log(
            `No first purchase reward given (already awarded or not eligible) for user ${req.user.id} and order #${order.id}`
          );
        }
      } catch (rewardError) {
        console.error(
          `Error awarding first purchase wallet coins for user ${req.user.id} and order #${order.id}:`,
          rewardError
        );
      }

      // Always process order for admin/seller notifications (single or multi-seller)
      try {
        await multiSellerOrderHandler.processMultiSellerOrder(order.id);
        console.log(
          "Order processing for notifications completed successfully"
        );
      } catch (multiSellerError) {
        console.error(
          "Error processing order for notifications:",
          multiSellerError
        );
        // Continue with the order even if notification processing fails
      }

      // Process wallet redemption if needed
      if (
        walletDetails &&
        walletDetails.walletId &&
        walletDetails.coinsUsed > 0
      ) {
        try {
          // Deduct coins from wallet
          console.log(
            `Deducting ${walletDetails.coinsUsed} coins from wallet ${walletDetails.walletId}`
          );

          // Import the redeemCoinsFromWallet function from wallet-handlers
          const { redeemCoinsFromWallet } = await import(
            "./handlers/wallet-handlers"
          );

          // Process the redemption
          await redeemCoinsFromWallet(
            req.user.id,
            walletDetails.coinsUsed,
            "ORDER",
            order.id,
            `Order #${order.id} coin redemption (Razorpay payment)`
          );

          console.log(
            "Wallet transaction created successfully for Razorpay payment"
          );
        } catch (walletError) {
          console.error(
            "Error processing wallet redemption for Razorpay payment:",
            walletError
          );
          // We don't want to fail the order if wallet processing fails at this point
          // Just log the error and continue
        }
      }

      // Clear cart
      await storage.clearCart(req.user.id);

      res.status(201).json({
        success: true,
        order: {
          ...order,
          razorpayPaymentId,
          razorpayOrderId,
        },
      });
    } catch (error) {
      console.error("Error verifying Razorpay payment:", error);
      res.status(500).json({ error: "Payment verification failed" });
    }
  });

  // Order routes
  app.post("/api/orders", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    console.log("==== CREATING NEW ORDER ====");
    console.log("User:", req.user.id);
    console.log("Request body:", JSON.stringify(req.body));

    try {
      // Get cart items
      const cartItems = await storage.getCartItems(req.user.id);

      if (cartItems.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
      }

      // Validate stock levels for all items in the cart
      const stockValidationErrors = [];

      for (const item of cartItems) {
        // First check if the item has a valid product object and ID
        if (!item.product || !item.product.id) {
          stockValidationErrors.push({
            id: item.id,
            error: "Product not found",
          });
          continue;
        }

        const productId = item.product.id;

        // Verify the product still exists in the database and is approved
        const product = await storage.getProduct(productId);
        if (!product) {
          stockValidationErrors.push({
            id: item.id,
            productId: productId,
            error: "Product not found in database",
          });
          continue;
        }

        if (!product.approved) {
          stockValidationErrors.push({
            id: item.id,
            productId: productId,
            error: "Product not approved",
          });
          continue;
        }

        // Determine available stock
        let availableStock = product.stock;

        // If the item has a variant, check variant stock
        if (item.variant && item.variant.id) {
          const variantId = item.variant.id;
          const variant = await storage.getProductVariant(variantId);
          if (!variant) {
            stockValidationErrors.push({
              id: item.id,
              productId: productId,
              variantId: variantId,
              error: "Variant not found",
            });
            continue;
          }

          // Use variant stock if available
          if (variant.stock !== null && variant.stock !== undefined) {
            availableStock = variant.stock;
          }
        }

        // Validate available stock against requested quantity
        if (item.quantity > availableStock) {
          stockValidationErrors.push({
            id: item.id,
            productId: productId,
            variantId: item.variant?.id,
            productName: product.name,
            requestedQuantity: item.quantity,
            availableStock: availableStock,
            error: `Insufficient stock. Only ${availableStock} units available.`,
          });
        }
      }

      // If there are any stock validation errors, return them
      if (stockValidationErrors.length > 0) {
        console.log(
          "Stock validation errors during checkout:",
          JSON.stringify(stockValidationErrors)
        );
        return res.status(400).json({
          error: "Insufficient stock for some items",
          details: stockValidationErrors,
        });
      }

      // Validate shipping address - check if we have a valid address
      const { shippingDetails, addressId } = req.body;

      if (
        !addressId &&
        (!shippingDetails ||
          (typeof shippingDetails === "string" &&
            (!JSON.parse(shippingDetails)?.address ||
              JSON.parse(shippingDetails)?.address.trim() === "")))
      ) {
        return res.status(400).json({ error: "Shipping address is required" });
      }

      // Debug log the address information
      console.log("Order address information:", { addressId, shippingDetails });

      // Validate addressId (if provided)
      let validatedAddressId = null;
      if (addressId) {
        // Verify the address exists and belongs to the user
        const parsedAddressId = parseInt(addressId);
        console.log(`Validating address ID: ${parsedAddressId}`);

        try {
          const address = await storage.getUserAddress(parsedAddressId);
          if (!address) {
            console.error(`Address with ID ${parsedAddressId} not found`);
            return res.status(400).json({ error: "Address not found" });
          }

          if (address.userId !== req.user.id) {
            console.error(
              `Address ${parsedAddressId} belongs to user ${address.userId}, not ${req.user.id}`
            );
            return res.status(400).json({ error: "Invalid address selected" });
          }

          console.log(`Address validated successfully:`, address);
          validatedAddressId = parsedAddressId;
        } catch (addressError) {
          console.error("Error validating address:", addressError);
          return res.status(400).json({ error: "Error validating address" });
        }
      }

      // Group cart items by seller
      const itemsBySeller = cartItems.reduce(
        (acc, item) => {
          const sellerId = item.product.sellerId;
          if (!acc[sellerId]) {
            acc[sellerId] = [];
          }
          acc[sellerId].push(item);
          return acc as Record<number, typeof cartItems>;
        },
        {} as Record<number, typeof cartItems>
      );

      console.log(
        `Cart items grouped by seller: ${
          Object.keys(itemsBySeller).length
        } sellers found`
      );

      // Calculate subtotal per seller
      const sellerSubtotals = Object.entries(itemsBySeller).map(
        ([sellerId, items]) => {
          const subtotal = items.reduce(
            (acc, item) => acc + item.product.price * item.quantity,
            0
          );
          return {
            sellerId: parseInt(sellerId),
            items,
            subtotal,
          };
        }
      );

      // Free delivery for all orders
      console.log("Applying free delivery for all orders");

      // Calculate subtotal from all cart items
      const subtotal = sellerSubtotals.reduce(
        (acc, seller) => acc + seller.subtotal,
        0
      );
      console.log(`Total subtotal from all cart items: ₹${subtotal}`);

      // Always set delivery charges to zero (free delivery)
      let totalDeliveryCharges = 0;

      // Check if wallet discount was applied
      let walletDiscount = 0;
      let walletCoinsUsed = 0;

      // Redeem coins logic
      let redeemDiscount = 0;
      let redeemCoinsUsed = 0;
      // Reward points logic
      let rewardDiscount = 0;
      let rewardPointsUsed = 0;
      if (req.body.redeemDiscount && req.body.redeemCoinsUsed) {
        redeemDiscount = Number(req.body.redeemDiscount) || 0;
        redeemCoinsUsed = Number(req.body.redeemCoinsUsed) || 0;
        // Validate redeem usage if coins were provided
        if (redeemCoinsUsed > 0) {
          try {
            // Get user's wallet
            const wallet = await storage.getWalletByUserId(req.user.id);
            if (!wallet) {
              console.error(`Wallet for user ${req.user.id} not found`);
              return res.status(400).json({ error: "Wallet not found" });
            }
            // Validate: cannot use more than redeemed balance or order total
            const orderTotal = Number(subtotal) + Number(totalDeliveryCharges);
            const redeemedBalanceNum = Number(wallet.redeemedBalance) || 0;
            const redeemCoinsUsedNum = Number(redeemCoinsUsed) || 0;
            if (redeemedBalanceNum < redeemCoinsUsedNum) {
              return res
                .status(400)
                .json({ error: "Insufficient redeemed coins" });
            }
            if (redeemCoinsUsedNum > orderTotal) {
              return res.status(400).json({
                error: "Cannot use more redeemed coins than order total",
              });
            }
            // Deduct redeemed coins after order creation (see below)
          } catch (redeemError) {
            console.error("Error validating redeemed coins:", redeemError);
            return res
              .status(400)
              .json({ error: "Error validating redeemed coins" });
          }
        }
      }

      // Check if the request contains wallet discount information
      if (req.body.walletDiscount && req.body.walletCoinsUsed) {
        console.log("Processing order with wallet redemption:", {
          walletDiscount: req.body.walletDiscount,
          walletCoinsUsed: req.body.walletCoinsUsed,
        });

        walletDiscount = Number(req.body.walletDiscount) || 0;
        walletCoinsUsed = Number(req.body.walletCoinsUsed) || 0;

        // Validate wallet usage if coins were provided
        if (walletCoinsUsed > 0) {
          try {
            // Get user's wallet
            const wallet = await storage.getWalletByUserId(req.user.id);
            console.log(
              `Validating wallet for user ${req.user.id} with balance ${wallet?.balance} against required ${walletCoinsUsed} coins`
            );

            if (!wallet) {
              console.error(`Wallet for user ${req.user.id} not found`);
              return res.status(400).json({ error: "Wallet not found" });
            }

            // Validate: cannot use more than wallet balance or order total
            const orderTotal = Number(subtotal) + Number(totalDeliveryCharges);
            const walletBalanceNum = Number(wallet.balance) || 0;
            const walletCoinsUsedNum = Number(walletCoinsUsed) || 0;
            if (walletBalanceNum < walletCoinsUsedNum) {
              console.error(
                `Insufficient wallet balance: ${walletBalanceNum} < ${walletCoinsUsedNum}`
              );
              return res
                .status(400)
                .json({ error: "Insufficient wallet balance" });
            }
            if (walletCoinsUsedNum > orderTotal) {
              console.error(
                `Cannot use more wallet coins than order total: ${walletCoinsUsedNum} > ${orderTotal}`
              );
              return res.status(400).json({
                error: "Cannot use more wallet coins than order total",
              });
            }

            // Deduct coins from wallet and record transaction
            await storage.redeemCoinsFromWallet(
              req.user.id,
              walletCoinsUsed,
              "ORDER",
              null,
              `Used for order at checkout`
            );
          } catch (walletError) {
            console.error("Error validating wallet:", walletError);
            return res.status(400).json({ error: "Error validating wallet" });
          }
        }
      }

      // Ensure all variables are numbers before arithmetic
      walletDiscount = Number(walletDiscount) || 0;
      walletCoinsUsed = Number(walletCoinsUsed) || 0;
      redeemDiscount = Number(redeemDiscount) || 0;
      redeemCoinsUsed = Number(redeemCoinsUsed) || 0;
      rewardDiscount = Number(rewardDiscount) || 0;
      rewardPointsUsed = Number(rewardPointsUsed) || 0;
      const couponDiscount = Number(req.body.couponDiscount) || 0;
      const subtotalNum = Number(subtotal) || 0;
      const totalDeliveryChargesNum = Number(totalDeliveryCharges) || 0;
      // When calculating total:
      const total =
        subtotalNum +
        totalDeliveryChargesNum -
        walletDiscount -
        rewardDiscount -
        redeemDiscount -
        couponDiscount;
      console.log(
        `Final order total: ₹${total} (subtotal: ₹${subtotalNum} + delivery: ₹${totalDeliveryChargesNum} - wallet: ₹${walletDiscount} - reward: ₹${rewardDiscount} - redeem: ₹${redeemDiscount} - coupon: ₹${couponDiscount})`
      );

      // Create order with payment method from request body
      const { paymentMethod } = req.body;

      // Prepare base order data
      const orderData: any = {
        userId: req.user.id,
        status: "pending",
        total,
        date: new Date(),
        shippingDetails:
          typeof shippingDetails === "string"
            ? shippingDetails
            : JSON.stringify(shippingDetails || {}),
        paymentMethod: paymentMethod || "cod",
        walletDiscount: Number(walletDiscount) || 0,
        walletCoinsUsed: Number(walletCoinsUsed) || 0,
        redeemDiscount: Number(redeemDiscount) || 0,
        redeemCoinsUsed: Number(redeemCoinsUsed) || 0,
        rewardDiscount: Number(rewardDiscount) || 0,
        rewardPointsUsed: Number(rewardPointsUsed) || 0,
        couponCode: req.body.couponCode || null,
        couponDiscount: couponDiscount,
      };

      // Add validated address ID if available
      if (validatedAddressId) {
        orderData.addressId = validatedAddressId;
        console.log(
          `Adding validated addressId ${validatedAddressId} to order`
        );
      }

      // Add multi-seller flag
      if (sellerSubtotals.length > 1) {
        orderData.multiSeller = true;
        console.log(
          `Setting multiSeller flag to true (order has ${sellerSubtotals.length} sellers)`
        );
      }

      // Log the order data for debugging
      console.log("Creating order with data:", orderData);

      const order = await storage.createOrder(orderData);
      console.log("Order created successfully:", order);

      // Create order items
      for (const item of cartItems) {
        const orderItemData = {
          orderId: order.id,
          productId: item.product.id,
          quantity: item.quantity,
          price: item.product.price,
        };

        console.log("Creating order item:", orderItemData);
        await storage.createOrderItem(orderItemData);
      }

      // Award first purchase wallet coins if eligible
      try {
        const rewardResult = await storage.processFirstPurchaseReward(
          req.user.id,
          order.id
        );
        if (rewardResult) {
          console.log(
            `Awarded first purchase wallet coins to user ${req.user.id} for order #${order.id}`
          );
        } else {
          console.log(
            `No first purchase reward given (already awarded or not eligible) for user ${req.user.id} and order #${order.id}`
          );
        }
      } catch (rewardError) {
        console.error(
          `Error awarding first purchase wallet coins for user ${req.user.id} and order #${order.id}:`,
          rewardError
        );
      }

      // Create seller-specific sub-orders
      console.log(
        `Creating ${sellerSubtotals.length} seller-specific sub-orders`
      );

      // Create a seller order for each seller
      const sellerOrders = await Promise.all(
        sellerSubtotals.map(async (sellerData) => {
          const { sellerId, subtotal } = sellerData;

          // Free delivery for all orders and sellers
          const deliveryCharge = 0;

          const sellerOrderData = {
            orderId: order.id,
            sellerId: sellerId,
            subtotal: subtotal,
            deliveryCharge: deliveryCharge,
            status: "pending",
          };

          console.log(
            `Creating seller order for seller ${sellerId}:`,
            sellerOrderData
          );

          try {
            const sellerOrder =
              await storage.createSellerOrder(sellerOrderData);
            console.log(
              `Created seller order ${sellerOrder.id} for seller ${sellerId}`
            );
            return sellerOrder;
          } catch (error) {
            console.error(
              `Error creating seller order for seller ${sellerId}:`,
              error
            );
            throw error;
          }
        })
      );

      console.log(`Created ${sellerOrders.length} seller orders successfully`);

      // Process seller-specific order items
      if (sellerOrders.length > 1) {
        console.log(
          "This is a multi-seller order. Processing order items linking..."
        );
        try {
          await multiSellerOrderHandler.processMultiSellerOrder(order.id);
          console.log(
            "Multi-seller order items linked to seller orders successfully"
          );
        } catch (multiSellerError) {
          console.error(
            "Error processing multi-seller order items:",
            multiSellerError
          );
          // Continue with the order even if multi-seller processing fails
        }
      }

      // Clear cart
      await storage.clearCart(req.user.id);

      // Send order confirmation emails asynchronously
      try {
        console.log(
          `Sending order confirmation emails for order ID ${order.id}`
        );
        // Send emails asynchronously to avoid delaying the response
        emailService.sendOrderPlacedEmails(order.id).catch((emailError) => {
          console.error(
            `Error sending order confirmation emails: ${emailError}`
          );
        });
        // Send wallet/redeem notification emails if used
        const buyer = await storage.getUser(order.userId);
        const buyerEmail = buyer?.email;
        if (buyerEmail) {
          if (
            typeof order.walletDiscount === "number" &&
            order.walletDiscount > 0
          ) {
            emailService.sendWalletUsedEmail(order, buyerEmail).catch((err) => {
              console.error("Error sending wallet used email:", err);
            });
          }
          if (
            typeof order.redeemDiscount === "number" &&
            order.redeemDiscount > 0
          ) {
            emailService.sendRedeemUsedEmail(order, buyerEmail).catch((err) => {
              console.error("Error sending redeem used email:", err);
            });
          }
        }
      } catch (emailError) {
        console.error(
          `Error initiating order confirmation emails: ${emailError}`
        );
        // Don't fail the order creation if email sending fails
      }

      // Process order for notifications (single or multi-seller)
      try {
        await multiSellerOrderHandler.processMultiSellerOrder(order.id);
        console.log(
          "Order processing for notifications completed successfully"
        );
      } catch (multiSellerError) {
        console.error(
          "Error processing order for notifications:",
          multiSellerError
        );
        // Continue with the order even if notification processing fails
      }

      // After order creation, deduct redeemed coins if used
      if (redeemCoinsUsed > 0) {
        try {
          await storage.spendRedeemedCoinsAtCheckout(
            req.user.id,
            redeemCoinsUsed,
            order.id,
            `Used for order at checkout`
          );
        } catch (err) {
          console.error("Error spending redeemed coins at checkout:", err);
        }
      }

      res.status(201).json(order);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Order creation error:", error);
      res.status(500).json({ error: "Failed to create order" });
    }
  });

  // Get order items for an order
  app.get("/api/orders/:id/items", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const orderId = parseInt(req.params.id);
      const order = await storage.getOrder(orderId);

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Check if user is authorized to view this order
      if (
        req.user.role !== "admin" &&
        order.userId !== req.user.id &&
        !(
          req.user.role === "seller" &&
          (await storage.orderHasSellerProducts(orderId, req.user.id))
        )
      ) {
        return res
          .status(403)
          .json({ error: "Not authorized to view this order" });
      }

      // Get filtered order items - apply database-level filtering for sellers
      const sellerId = req.user.role === "seller" ? req.user.id : undefined;
      const orderItems = await storage.getOrderItems(orderId, sellerId);

      if (req.user.role === "seller") {
        console.log(
          `Retrieved ${orderItems.length} order items for seller ${sellerId} from order #${orderId}`
        );
      }

      res.json(orderItems);
    } catch (error) {
      console.error("Error fetching order items:", error);
      res.status(500).json({ error: "Failed to fetch order items" });
    }
  });

  app.get("/api/orders", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      // If admin, can see all orders
      // If seller, can see orders containing their products
      // If buyer, can see only their orders
      const sellerId = req.user.role === "seller" ? req.user.id : undefined;
      const userId = req.user.role === "buyer" ? req.user.id : undefined;

      const orders = await storage.getOrders(userId, sellerId);
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  app.get("/api/orders/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const id = parseInt(req.params.id);
      const order = await storage.getOrder(id);

      // Special case for order confirmation page - handle any missing order on confirmation page
      if (!order) {
        try {
          // Get order items if they exist (this might throw an error if order doesn't exist at all)
          const orderItems = await storage.getOrderItems(id).catch(() => []);

          // If we have order items, create a virtual order
          if (orderItems && orderItems.length > 0) {
            // Return a successful response with order data
            return res.json({
              id: id,
              userId: req.user.id,
              status: "pending",
              total: orderItems.reduce(
                (sum, item) => sum + item.price * item.quantity,
                0
              ),
              date: new Date().toISOString(),
              shippingDetails: JSON.stringify({
                name: req.user.name || req.user.username,
                address: "Shipping address",
                city: "City",
                state: "State",
                zipCode: "Pincode",
              }),
              paymentMethod: "cod",
              items: orderItems,
            });
          }
        } catch (err) {
          console.log("Couldn't get order items for missing order:", err);
        }

        // If we get here, the order truly doesn't exist and we couldn't reconstruct it
        return res.status(404).json({ error: "Order not found" });
      }

      // Check permissions
      if (req.user.role === "buyer" && order.userId !== req.user.id) {
        return res.status(403).json({ error: "Not authorized" });
      }

      if (req.user.role === "seller") {
        // Check if order contains products from this seller
        console.log(
          `Checking if order ${id} has products from seller ${req.user.id}...`
        );
        try {
          const hasSellerProduct = await storage.orderHasSellerProducts(
            id,
            req.user.id
          );
          console.log(
            `Result of orderHasSellerProducts for order ${id}, seller ${req.user.id}: ${hasSellerProduct}`
          );

          if (!hasSellerProduct) {
            console.log(
              `Access denied to order ${id} for seller ${req.user.id} - no products found`
            );

            // TEMPORARY FIX: Allow access for testing if it's an impersonated admin
            // (Admin impersonates seller but keeps most admin permissions)
            const isImpersonatedAdmin =
              req.user.isImpersonating === true ||
              req.session?.originalUser?.role === "admin";
            if (isImpersonatedAdmin) {
              console.log(
                `Allowing access to order ${id} for impersonated admin (as seller ${req.user.id})`
              );
            } else {
              return res.status(403).json({ error: "Not authorized" });
            }
          }
        } catch (error) {
          console.error(`Error checking if order has seller products:`, error);
          // TEMPORARY: Don't reject based on error, allow access for now
          console.log(
            `Allowing access to order ${id} due to error in orderHasSellerProducts check`
          );
        }
      }

      // Fetch order items to include with the response - filter at database level for sellers
      const sellerId = req.user.role === "seller" ? req.user.id : undefined;
      const orderItems = await storage.getOrderItems(id, sellerId);

      if (req.user.role === "seller") {
        console.log(
          `Filtered order items for seller ${sellerId}: showing ${orderItems.length} items`
        );
      }

      // Fetch seller orders if this is a multi-seller order
      let sellerOrders = [];
      if (order.multiSeller) {
        try {
          // If the user is a seller, only return their seller order
          if (req.user.role === "seller") {
            const allSellerOrders = await storage.getSellerOrdersByOrderId(id);
            sellerOrders = allSellerOrders.filter(
              (so) => so.sellerId === req.user.id
            );
          } else {
            // For admin and buyer, return all seller orders
            sellerOrders = await storage.getSellerOrdersByOrderId(id);
          }
          console.log(
            `Found ${sellerOrders.length} seller orders for order #${id}`
          );
        } catch (sellerOrderError) {
          console.error(
            `Error fetching seller orders for order #${id}:`,
            sellerOrderError
          );
          // Continue even if we can't get seller orders
        }
      }

      // Create a privacy-aware order response
      const orderWithDetails = {
        ...order,
        items: orderItems,
        sellerOrders: sellerOrders.length > 0 ? sellerOrders : undefined,
      };

      res.json(orderWithDetails);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch order" });
    }
  });

  // Buyer order cancellation endpoint
  app.post("/api/orders/:id/cancel", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const orderId = parseInt(req.params.id);
      const order = await storage.getOrder(orderId);

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Only allow the buyer who placed the order to cancel it
      if (req.user.role !== "buyer" || order.userId !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Not authorized to cancel this order" });
      }

      // Verify the order is in a status that can be cancelled
      const cancelableStatuses = ["pending", "processing"];
      if (!cancelableStatuses.includes(order.status)) {
        return res.status(400).json({
          error: "This order cannot be cancelled",
          message: "Orders can only be cancelled before they are shipped.",
        });
      }

      // Import order status handler to process the cancellation
      const { handleOrderStatusChange } = await import(
        "./handlers/order-status-handler"
      );

      // Process order cancellation (includes wallet refund logic)
      const updatedOrder = await handleOrderStatusChange(orderId, "cancelled");

      // If this is a multi-seller order, update all seller orders to cancelled
      if (order.multiSeller) {
        console.log(
          `Order #${orderId} is a multi-seller order, cancelling all seller orders`
        );

        // Get all seller orders
        const sellerOrders = await storage.getSellerOrders(orderId);

        // Update each seller order
        for (const sellerOrder of sellerOrders) {
          await storage.updateSellerOrderStatus(sellerOrder.id, "cancelled");
          console.log(`Cancelled seller order #${sellerOrder.id}`);
        }
      }

      // Send cancellation email notifications
      try {
        console.log(`Sending cancellation emails for order ${orderId}`);
        emailService.sendOrderCancelledEmails(orderId).catch((emailError) => {
          console.error(`Error sending cancellation emails: ${emailError}`);
        });
      } catch (emailError) {
        console.error(`Error initiating cancellation emails: ${emailError}`);
        // Don't fail the cancellation if email sending fails
      }

      // Create a notification for the buyer
      try {
        await storage.createNotification({
          userId: order.userId,
          title: "Order Cancelled",
          message: `Your order #${orderId} has been cancelled. Any payment will be refunded according to the payment method used.`,
          type: "order_update",
          link: `/order/${orderId}`,
        });
      } catch (notificationError) {
        console.error(
          "Error creating cancellation notification:",
          notificationError
        );
      }

      res.json({
        message: "Order cancelled successfully",
        order: updatedOrder,
      });
    } catch (error) {
      console.error("Error cancelling order:", error);
      res.status(500).json({ error: "Failed to cancel order" });
    }
  });

  // Update order status endpoint
  app.put("/api/orders/:id/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin" && req.user.role !== "seller") {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;

      // Validate status
      const validStatuses = [
        "pending",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        // Add return-related statuses
        "approve_return",
        "reject_return",
        "process_return",
        "completed_return",
      ];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      // Get the order to check permissions
      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Sellers can only update orders that contain their products
      if (req.user.role === "seller") {
        console.log(
          `Checking if order ${id} has products from seller ${req.user.id} for status update...`
        );
        try {
          const hasSellerProduct = await storage.orderHasSellerProducts(
            id,
            req.user.id
          );
          console.log(
            `Result of orderHasSellerProducts for order ${id}, seller ${req.user.id}: ${hasSellerProduct}`
          );

          if (!hasSellerProduct) {
            console.log(
              `Access denied to update order ${id} for seller ${req.user.id} - no products found`
            );

            // TEMPORARY FIX: Allow access for testing if it's an impersonated admin
            // (Admin impersonates seller but keeps most admin permissions)
            const isImpersonatedAdmin =
              req.user.isImpersonating === true ||
              req.session?.originalUser?.role === "admin";
            if (isImpersonatedAdmin) {
              console.log(
                `Allowing access to update order ${id} for impersonated admin (as seller ${req.user.id})`
              );
            } else {
              return res.status(403).json({ error: "Not authorized" });
            }
          }
        } catch (error) {
          console.error(`Error checking if order has seller products:`, error);
          // TEMPORARY: Don't reject based on error, allow access for now
          console.log(
            `Allowing access to update order ${id} due to error in orderHasSellerProducts check`
          );
        }
      }

      // If this is a multi-seller order, handle it differently
      if (order.multiSeller) {
        console.log(
          `Order #${id} is a multi-seller order, updating all seller orders to ${status}`
        );

        // Get all seller orders
        const sellerOrders = await storage.getSellerOrders(id);

        // Update each seller order
        for (const sellerOrder of sellerOrders) {
          // If this is a seller, only update their own seller order
          if (
            req.user.role === "seller" &&
            sellerOrder.sellerId !== req.user.id
          ) {
            continue;
          }

          await storage.updateSellerOrderStatus(sellerOrder.id, status);
          console.log(
            `Updated seller order #${sellerOrder.id} status to ${status}`
          );
        }
      }

      // Import order status handler to process additional actions like wallet refunds
      const { handleOrderStatusChange } = await import(
        "./handlers/order-status-handler"
      );

      // Process order status change with the handler (includes wallet refund logic)
      const updatedOrder = await handleOrderStatusChange(id, status);
      console.log(`Updated main order #${id} status to ${status}`);

      // Send appropriate email notifications based on the new status
      try {
        console.log(
          `Sending email notifications for order ${id} status update to: ${status}`
        );
        if (status === "shipped") {
          // Send shipping notifications asynchronously
          emailService.sendOrderShippedEmails(id).catch((emailError) => {
            console.error(`Error sending shipped order emails: ${emailError}`);
          });
        } else if (status === "cancelled") {
          // Send cancellation notifications asynchronously
          emailService.sendOrderCancelledEmails(id).catch((emailError) => {
            console.error(
              `Error sending cancelled order emails: ${emailError}`
            );
          });
        }
      } catch (emailError) {
        console.error(
          `Error initiating order status update emails: ${emailError}`
        );
        // Don't fail the order status update if email sending fails
      }

      res.json(updatedOrder);
    } catch (error) {
      console.error("Error updating order status:", error);
      res.status(500).json({ error: "Failed to update order status" });
    }
  });

  // Get seller orders for a main order
  app.get("/api/orders/:id/seller-orders", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const orderId = parseInt(req.params.id);
      const order = await storage.getOrder(orderId);

      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Check permissions
      if (req.user.role === "buyer" && order.userId !== req.user.id) {
        return res.status(403).json({ error: "Not authorized" });
      }

      if (req.user.role === "seller") {
        // Sellers can only view seller orders for orders that contain their products
        console.log(
          `Checking if order ${orderId} has products from seller ${req.user.id} for seller-orders endpoint...`
        );
        try {
          const hasSellerProduct = await storage.orderHasSellerProducts(
            orderId,
            req.user.id
          );
          console.log(
            `Result of orderHasSellerProducts for order ${orderId}, seller ${req.user.id}: ${hasSellerProduct}`
          );

          if (!hasSellerProduct) {
            console.log(
              `Access denied to seller-orders for order ${orderId} for seller ${req.user.id} - no products found`
            );

            // TEMPORARY FIX: Allow access for testing if it's an impersonated admin
            // (Admin impersonates seller but keeps most admin permissions)
            const isImpersonatedAdmin =
              req.user.isImpersonating === true ||
              req.session?.originalUser?.role === "admin";
            if (isImpersonatedAdmin) {
              console.log(
                `Allowing access to seller-orders for order ${orderId} for impersonated admin (as seller ${req.user.id})`
              );
            } else {
              return res.status(403).json({ error: "Not authorized" });
            }
          }
        } catch (error) {
          console.error(`Error checking if order has seller products:`, error);
          // TEMPORARY: Don't reject based on error, allow access for now
          console.log(
            `Allowing access to seller-orders for order ${orderId} due to error in orderHasSellerProducts check`
          );
        }
      }

      // If seller, only return their seller order
      if (req.user.role === "seller") {
        const sellerOrders = await storage.getSellerOrdersByOrderId(orderId);
        const sellerOrder = sellerOrders.find(
          (so) => so.sellerId === req.user.id
        );

        if (!sellerOrder) {
          return res.status(404).json({ error: "Seller order not found" });
        }

        return res.json([sellerOrder]);
      }

      // For buyers and admins, return all seller orders
      const sellerOrders = await storage.getSellerOrdersByOrderId(orderId);
      res.json(sellerOrders);
    } catch (error) {
      console.error("Error fetching seller orders:", error);
      res.status(500).json({ error: "Failed to fetch seller orders" });
    }
  });

  // Update seller order status
  app.put("/api/seller-orders/:id/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin" && req.user.role !== "seller") {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;

      // Validate status
      const validStatuses = [
        "pending",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        // Add return-related statuses
        "approve_return",
        "reject_return",
        "process_return",
        "completed_return",
      ];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      // Get the seller order
      const sellerOrder = await storage.getSellerOrder(id);
      if (!sellerOrder) {
        return res.status(404).json({ error: "Seller order not found" });
      }

      // Sellers can only update their own seller orders
      if (req.user.role === "seller" && sellerOrder.sellerId !== req.user.id) {
        return res.status(403).json({ error: "Not authorized" });
      }

      // Update the seller order status
      const updatedSellerOrder = await storage.updateSellerOrderStatus(
        id,
        status
      );

      // Get the main order to check if all seller orders have the same status
      const mainOrder = await storage.getOrder(sellerOrder.orderId);
      const allSellerOrders = await storage.getSellerOrders(
        sellerOrder.orderId
      );

      // Check if all seller orders have the same status
      const allSameStatus = allSellerOrders.every((so) => so.status === status);

      // If all seller orders have the same status, update the main order status
      if (allSameStatus && mainOrder) {
        // Import order status handler to process additional actions like wallet refunds
        const { handleOrderStatusChange } = await import(
          "./handlers/order-status-handler"
        );

        // Process order status change with the handler (includes wallet refund logic)
        await handleOrderStatusChange(mainOrder.id, status);
        console.log(
          `All seller orders for order ${mainOrder.id} now have status '${status}', updated main order status`
        );
      }

      res.json(updatedSellerOrder);
    } catch (error) {
      console.error("Error updating seller order status:", error);
      res.status(500).json({ error: "Failed to update seller order status" });
    }
  });

  // Cancel order endpoint (for buyers)
  app.post("/api/orders/:id/cancel", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const id = parseInt(req.params.id);

      // Get the order to check permissions
      const order = await storage.getOrder(id);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Only the buyer who placed the order can cancel it
      if (req.user.role === "buyer" && order.userId !== req.user.id) {
        return res
          .status(403)
          .json({ error: "Not authorized to cancel this order" });
      }

      // Check if order is already delivered or cancelled
      if (order.status === "delivered" || order.status === "cancelled") {
        return res.status(400).json({
          error: `Cannot cancel order. Order is already ${order.status}.`,
        });
      }

      // Import order status handler to process additional actions like wallet refunds
      const { handleOrderStatusChange } = await import(
        "./handlers/order-status-handler"
      );

      // Process order status change with the handler (includes wallet refund logic)
      const updatedOrder = await handleOrderStatusChange(id, "cancelled");

      // Cancel all seller orders associated with this order
      try {
        const sellerOrders = await storage.getSellerOrders(id);
        console.log(
          `Cancelling ${sellerOrders.length} seller orders for order #${id}`
        );

        for (const sellerOrder of sellerOrders) {
          await storage.updateSellerOrderStatus(sellerOrder.id, "cancelled");
          console.log(
            `Seller order #${sellerOrder.id} for seller ${sellerOrder.sellerId} cancelled`
          );
        }
      } catch (sellerOrderError) {
        console.error(
          `Error cancelling seller orders for order #${id}:`,
          sellerOrderError
        );
        // Continue with the main order cancellation even if seller order updates fail
      }

      // Log the cancellation
      console.log(`Order #${id} cancelled by user ${req.user.id}`);

      // Send cancellation emails asynchronously
      try {
        console.log(`Sending cancellation emails for order ID ${id}`);
        emailService.sendOrderCancelledEmails(id).catch((emailError) => {
          console.error(
            `Error sending order cancellation emails: ${emailError}`
          );
        });
      } catch (emailError) {
        console.error(
          `Error initiating order cancellation emails: ${emailError}`
        );
        // Don't fail the order cancellation if email sending fails
      }

      res.json(updatedOrder);
    } catch (error) {
      console.error("Error cancelling order:", error);
      res.status(500).json({ error: "Failed to cancel order" });
    }
  });

  // User roles management (admin only)
  app.get("/api/users", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const users = await storage.getUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.put("/api/users/:id/role", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const role = req.body.role;

      if (!role || !["admin", "seller", "buyer"].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }

      const user = await storage.updateUserRole(id, role);
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Failed to update user role" });
    }
  });

  // Delete a user (admin only)
  app.delete("/api/users/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);

      // Don't allow admins to delete themselves
      if (id === req.user.id) {
        return res
          .status(400)
          .json({ error: "You cannot delete your own account" });
      }

      // Special case for user ID 10 which has complex foreign key relations
      if (id === 10) {
        try {
          console.log(
            "Special handling for user 10 (MKAY/ambi.mohit09@gmail.com)"
          );

          // 1. Check if user exists
          const { rows: userRows } = await pool.query(
            "SELECT * FROM users WHERE id = $1",
            [id]
          );
          if (userRows.length === 0) {
            return res.status(404).json({ error: "User not found" });
          }

          // 2. Delete all product relationships first
          console.log("Deleting product relationships...");
          await pool.query(
            `
            DELETE FROM product_relationships 
            WHERE source_product_id IN (SELECT id FROM products WHERE seller_id = $1)
            OR related_product_id IN (SELECT id FROM products WHERE seller_id = $1)
          `,
            [id]
          );

          // 3. Delete carts referencing user's products
          console.log("Deleting carts with user's products...");
          await pool.query(
            `
            DELETE FROM carts 
            WHERE product_id IN (SELECT id FROM products WHERE seller_id = $1)
          `,
            [id]
          );

          // 4. Delete order_items referencing user's products
          console.log("Deleting order items with user's products...");
          await pool.query(
            `
            DELETE FROM order_items 
            WHERE product_id IN (SELECT id FROM products WHERE seller_id = $1)
          `,
            [id]
          );

          // 5. Find and delete review-related data
          console.log("Handling reviews for user's products...");
          const { rows: reviewRows } = await pool.query(
            `
            SELECT id FROM reviews 
            WHERE product_id IN (SELECT id FROM products WHERE seller_id = $1)
          `,
            [id]
          );

          // Delete review images and helpful marks
          for (const review of reviewRows) {
            await pool.query("DELETE FROM review_images WHERE review_id = $1", [
              review.id,
            ]);
            await pool.query(
              "DELETE FROM review_helpful WHERE review_id = $1",
              [review.id]
            );
          }

          // Delete reviews for products
          await pool.query(
            `
            DELETE FROM reviews 
            WHERE product_id IN (SELECT id FROM products WHERE seller_id = $1)
          `,
            [id]
          );

          // 6. Delete AI assistant conversations for products
          console.log("Deleting AI assistant conversations for products...");
          await pool.query(
            `
            DELETE FROM ai_assistant_conversations 
            WHERE product_id IN (SELECT id FROM products WHERE seller_id = $1)
          `,
            [id]
          );

          // 7. Delete user activities related to products
          console.log("Deleting user activities for products...");
          await pool.query(
            `
            DELETE FROM user_activities 
            WHERE product_id IN (SELECT id FROM products WHERE seller_id = $1)
          `,
            [id]
          );

          // 8. Now it's safe to delete the products
          console.log("Deleting products...");
          await pool.query("DELETE FROM products WHERE seller_id = $1", [id]);

          // 9. Delete user's own data (standard cleanup)
          console.log("Standard user cleanup...");
          await pool.query("DELETE FROM user_activities WHERE user_id = $1", [
            id,
          ]);
          await pool.query("DELETE FROM carts WHERE user_id = $1", [id]);
          await pool.query("DELETE FROM user_addresses WHERE user_id = $1", [
            id,
          ]);
          await pool.query(
            "DELETE FROM ai_assistant_conversations WHERE user_id = $1",
            [id]
          );
          await pool.query(
            "DELETE FROM user_size_preferences WHERE user_id = $1",
            [id]
          );
          await pool.query(
            "DELETE FROM seller_documents WHERE seller_id = $1",
            [id]
          );
          await pool.query(
            "DELETE FROM business_details WHERE seller_id = $1",
            [id]
          );
          await pool.query(
            "DELETE FROM banking_information WHERE seller_id = $1",
            [id]
          );

          // 10. Finally, delete the user
          console.log("Deleting user...");
          await pool.query("DELETE FROM users WHERE id = $1", [id]);

          console.log("Successfully deleted user 10");
          return res.sendStatus(204);
        } catch (error) {
          console.error(
            "Error in special deletion process for user 10:",
            error
          );
          return res
            .status(500)
            .json({ error: "Failed to delete user with special handling" });
        }
      }

      // Regular user deletion for other users
      await storage.deleteUser(id);
      res.sendStatus(204); // No content (successful deletion)
    } catch (error) {
      if ((error as Error).message.includes("special admin user")) {
        return res.status(403).json({ error: (error as Error).message });
      }
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // Co-Admin Management

  // Get all co-admins
  app.get("/api/co-admins", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const coAdmins = await storage.getCoAdmins();
      res.json(coAdmins);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch co-admins" });
    }
  });

  // Get a single co-admin
  app.get("/api/co-admins/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const id = parseInt(req.params.id);
      const coAdmin = await storage.getCoAdminById(id);

      if (!coAdmin) {
        return res.status(404).json({ error: "Co-admin not found" });
      }

      res.json(coAdmin);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch co-admin" });
    }
  });

  // Create a new co-admin
  app.post("/api/co-admins", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const { email, username, permissions } = req.body;

      if (!email || !username) {
        return res
          .status(400)
          .json({ error: "Email and username are required" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res
          .status(400)
          .json({ error: "User with this email already exists" });
      }

      // Create the co-admin with a random password since we're using OTP
      const randomPassword = Array.from(Array(20), () =>
        Math.floor(Math.random() * 36).toString(36)
      ).join("");

      // Create the co-admin
      const newCoAdmin = await storage.createUser({
        email,
        username,
        password: randomPassword, // Use random password since authentication is via OTP
        role: "admin",
        isCoAdmin: true,
        permissions: permissions || {},
        approved: true,
        rejected: false,
      });

      res.status(201).json(newCoAdmin);
    } catch (error) {
      console.error("Error creating co-admin:", error);
      res.status(500).json({ error: "Failed to create co-admin" });
    }
  });

  // Create a new user (buyer or seller)
  app.post("/api/users", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const { email, username, role } = req.body;

      if (!email || !username || !role) {
        return res
          .status(400)
          .json({ error: "Email, username, and role are required" });
      }

      if (role !== "buyer" && role !== "seller") {
        return res
          .status(400)
          .json({ error: "Role must be either 'buyer' or 'seller'" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res
          .status(400)
          .json({ error: "User with this email already exists" });
      }

      // Create a random password since we're using OTP authentication
      const randomPassword = Array.from(Array(20), () =>
        Math.floor(Math.random() * 36).toString(36)
      ).join("");

      // Create the user
      const newUser = await storage.createUser({
        email,
        username,
        password: randomPassword, // Use random password since authentication is via OTP
        role,
        isCoAdmin: false,
        permissions: {},
        approved: role === "buyer", // Buyers are auto-approved, sellers need approval
        rejected: false,
      });

      res.status(201).json(newUser);
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  // Update co-admin permissions
  app.put("/api/co-admins/:id/permissions", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const id = parseInt(req.params.id);
      const { permissions } = req.body;

      if (!permissions) {
        return res.status(400).json({ error: "Permissions are required" });
      }

      const updatedCoAdmin = await storage.updateCoAdminPermissions(
        id,
        permissions
      );

      if (!updatedCoAdmin) {
        return res.status(404).json({ error: "Co-admin not found" });
      }

      res.json(updatedCoAdmin);
    } catch (error) {
      res.status(500).json({ error: "Failed to update co-admin permissions" });
    }
  });

  // Delete a co-admin
  app.delete("/api/co-admins/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const id = parseInt(req.params.id);

      await storage.deleteCoAdmin(id);
      res.sendStatus(204);
    } catch (error) {
      res.status(500).json({ error: "Failed to delete co-admin" });
    }
  });

  // File Upload endpoint for images
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 50 * 1024 * 1024, // 50 MB per file
      files: 20, // up to 20 files per request
      fieldSize: 10 * 1024 * 1024, // 10 MB for non-file fields
    },
    fileFilter: (req, file, cb) => {
      // Accept images only
      if (file.mimetype.startsWith("image/")) {
        cb(null, true);
      } else {
        cb(null, false);
        return cb(
          new Error(
            `Unsupported file type: ${file.mimetype}. Only images are allowed.`
          )
        );
      }
    },
  });

  // Single file upload endpoint
  app.post(
    "/api/upload",
    (req, res, next) => {
      // Custom error handler to catch multer errors
      imageUpload.single("file")(req, res, function (err) {
        if (err instanceof multer.MulterError) {
          // A Multer error occurred when uploading
          console.error("Multer error:", err);
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
              error: `File too large. Maximum file size is 100MB.`,
            });
          }
          return res.status(400).json({
            error: `Upload error: ${err.message}`,
          });
        } else if (err) {
          // An unknown error occurred
          console.error("Upload error:", err);
          return res.status(400).json({
            error: err.message || "File upload failed",
          });
        }
        // Everything went fine, proceed
        next();
      });
    },
    async (req, res) => {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }

      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        console.log(
          `Processing upload: ${req.file.originalname}, size: ${req.file.size}, mimetype: ${req.file.mimetype}`
        );

        const fileBuffer = req.file.buffer;
        const fileName = req.file.originalname;
        const fileType = req.file.mimetype;

        // Using the common uploadFile function from s3.ts helper
        const fileUrl = await uploadFile(fileBuffer, fileName, fileType);
        console.log(`File uploaded successfully to S3: ${fileUrl}`);

        res.json({ url: fileUrl });
      } catch (error) {
        console.error("File upload error:", error);
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to upload file to storage",
        });
      }
    }
  );

  // Multiple files upload endpoint
  app.post(
    "/api/upload-multiple",
    (req, res, next) => {
      // Custom error handler to catch multer errors - handle array of files
      imageUpload.array("file", 10)(req, res, function (err) {
        if (err instanceof multer.MulterError) {
          // A Multer error occurred when uploading
          console.error("Multer error:", err);
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
              error: `File too large. Maximum file size is 100MB.`,
            });
          }
          if (err.code === "LIMIT_FILE_COUNT") {
            return res.status(400).json({
              error: `Too many files. Maximum is 10 files per upload.`,
            });
          }
          return res.status(400).json({
            error: `Upload error: ${err.message}`,
          });
        } else if (err) {
          // An unknown error occurred
          console.error("Upload error:", err);
          return res.status(400).json({
            error: err.message || "File upload failed",
          });
        }
        // Everything went fine, proceed
        next();
      });
    },
    async (req, res) => {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }

      try {
        if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
          return res.status(400).json({ error: "No files uploaded" });
        }

        console.log(
          `Processing multiple file upload: ${req.files.length} files`
        );

        // Upload all files in parallel
        const uploadPromises = req.files.map(async (file) => {
          console.log(
            `Processing file: ${file.originalname}, size: ${file.size}, mimetype: ${file.mimetype}`
          );
          return uploadFile(file.buffer, file.originalname, file.mimetype);
        });

        // Wait for all uploads to complete
        const urls = await Promise.all(uploadPromises);
        console.log(`Successfully uploaded ${urls.length} files to S3`);

        // Return all URLs
        res.json({ urls });
      } catch (error) {
        console.error("Multiple file upload error:", error);
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to upload files to storage",
        });
      }
    }
  );

  // Get seller products with filtering and pagination
  app.get("/api/seller/products", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (req.user.role !== "seller" && req.user.role !== "admin") {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const sellerId = req.user.id;
      const category = req.query.category as string | undefined;
      const search = req.query.search as string | undefined;
      const stockFilter = req.query.stock as string | undefined;
      const includeDrafts = req.query.includeDrafts !== "false"; // Include drafts by default unless explicitly disabled

      console.log(
        `Fetching products for seller ${sellerId} (${req.user.username}), includeDrafts=${includeDrafts}`
      );

      // Pagination parameters
      const page = req.query.page ? parseInt(req.query.page as string) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const offset = (page - 1) * limit;

      // Get total count for pagination
      const totalCount = await storage.getProductsCount(
        category,
        sellerId,
        undefined,
        search
      );
      console.log(`Found ${totalCount} total products for seller ${sellerId}`);
      const totalPages = Math.ceil(totalCount / limit);

      // Get the products with applied filters - explicitly include draft products
      const query = `
        SELECT p.*, u.username as seller_username, u.name as seller_name
        FROM products p
        LEFT JOIN users u ON p.seller_id = u.id
        WHERE p.deleted = false AND p.seller_id = $1
        ${category ? "AND LOWER(p.category) = LOWER($2)" : ""}
        ${
          search
            ? `AND (
          LOWER(p.name) LIKE LOWER($${category ? 3 : 2}) OR 
          LOWER(p.description) LIKE LOWER($${category ? 3 : 2}) OR
          LOWER(p.category) LIKE LOWER($${category ? 3 : 2}) OR
          LOWER(p.sku) LIKE LOWER($${category ? 3 : 2})
        )`
            : ""
        }
        ORDER BY p.id DESC LIMIT $${
          search ? (category ? 4 : 3) : category ? 3 : 2
        } OFFSET $${search ? (category ? 5 : 4) : category ? 4 : 3}
      `;

      const queryParams = [sellerId];
      if (category) queryParams.push(category);
      if (search) queryParams.push(`%${search}%`);
      queryParams.push(limit, offset);

      console.log(
        "Executing custom seller products query with params:",
        queryParams
      );
      const { rows } = await pool.query(query, queryParams);

      console.log(`Query returned ${rows.length} total products`);

      // Debug - check for draft products
      const draftProducts = rows.filter((p) => p.is_draft);
      console.log(`Found ${draftProducts.length} draft products in results`);

      // Map properties correctly - ensure isDraft is properly set from is_draft database column
      let products = rows.map((p) => ({
        ...p,
        isDraft: p.is_draft, // Make sure the client gets the correct property name
      }));

      // Apply stock filtering if required
      if (stockFilter && stockFilter !== "all") {
        products = products.filter((product) => {
          const stock = product.stockQuantity || 0;

          if (stockFilter === "in-stock") {
            return stock > 10;
          } else if (stockFilter === "low-stock") {
            return stock > 0 && stock <= 10;
          } else if (stockFilter === "out-of-stock") {
            return stock <= 0;
          }

          return true;
        });
      }

      res.json({
        products,
        currentPage: page,
        totalPages,
        total: totalCount,
      });
    } catch (error) {
      console.error("Error fetching seller products:", error);
      res.status(500).json({ error: "Failed to fetch products" });
    }
  });

  // Export all seller products to Excel
  app.get("/api/seller/products/export", exportProductsToExcel);

  // Admin route to export all products across all sellers
  app.get("/api/admin/products/export", exportAllProductsToExcel);

  // Bulk import - template download
  app.get("/api/seller/products/bulk-import/template", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      // Get categories for the template dropdown
      const categories = await storage.getCategories();

      // Use the XLSX library we imported at the top of the file

      // Define the template structure with exact fields matching the provided screenshots
      // We include both lowercase and uppercase versions of dimensions fields
      // to maximize compatibility with different Excel and CSV processing tools
      const templateData = [
        [
          "name",
          "description",
          "price",
          "purchasePrice",
          "mrp",
          "gst", // This will be read as row['gst']
          "category",
          "subCategory",
          "brand",
          "color",
          "size",
          "imageUrl1",
          "imageUrl2",
          "imageUrl3",
          "imageUrl4",
          "stock", // Can also be read as 'inventory' or 'INVENTORY'
          "sku",
          "hsn",
          "weight", // Can also be read as 'Weight'
          "length", // Can also be read as 'Length'
          "width", // Can also be read as 'Width'
          "height", // Can also be read as 'Height'
          "warranty_",
          "returnPolicy",
          "tax",
          "specifications",
          "productType",
        ],
        [
          "Example Product",
          "This is a sample product description.",
          "999.99",
          "899.99",
          "1199.99",
          "12",
          categories[0]?.name || "Electronics",
          "Smartphones",
          "SampleBrand",
          "Red",
          "Medium",
          "https://example.com/image1.jpg",
          "https://example.com/image2.jpg",
          "https://example.com/image3.jpg",
          "https://example.com/image4.jpg",
          "100",
          "SKU-12345",
          "12345678",
          "500",
          "10",
          "5",
          "2",
          "1 Year",
          "7 Days",
          "18",
          "Material: Metal, Type: Premium",
          "Regular",
        ],
      ];

      // Create a worksheet from the data
      const ws = XLSX.utils.aoa_to_sheet(templateData);

      // Create a workbook and add the worksheet
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Products");

      // Generate the CSV content
      const csvContent = XLSX.utils.sheet_to_csv(ws);

      // Set the content type and attachment header for CSV
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=product-import-template.csv"
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");

      // Send the CSV data
      res.send(csvContent);
    } catch (error) {
      console.error("Error generating bulk import template:", error);
      res.status(500).json({ error: "Failed to generate import template" });
    }
  });

  // Bulk import - process upload
  app.post(
    "/api/seller/products/bulk-import",
    upload.single("file"),
    async (req, res) => {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      try {
        const sellerId = req.user.id;

        // Get categories for validation
        const categories = await storage.getCategories();
        const categoryNames = categories.map((c) => c.name);

        // Get subcategories for validation
        const subcategories = await storage.getSubcategories();
        const subcategoryNames = subcategories.map((s) => s.name);

        // Parse the uploaded file (Excel or CSV) using the imported XLSX
        // Set raw: true to handle quoted CSV fields properly
        const workbook = XLSX.read(req.file.buffer, {
          type: "buffer",
          raw: true,
          cellDates: true,
          cellNF: false,
          cellText: false,
        });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        if (data.length === 0) {
          return res.status(400).json({ message: "Empty file uploaded" });
        }

        // Initialize results tracking
        const results = {
          successful: 0,
          failed: 0,
          errors: [],
          products: [],
        };

        // Process each row
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const rowNum = i + 2; // +2 because of 0-indexing and header row

          try {
            // Validate required fields
            if (
              !row["name"] ||
              row["price"] === undefined ||
              row["stock"] === undefined ||
              !row["category"]
            ) {
              const missingFields = [];
              if (!row["name"]) missingFields.push("name");
              if (row["price"] === undefined) missingFields.push("price");
              if (row["stock"] === undefined) missingFields.push("stock");
              if (!row["category"]) missingFields.push("category");

              results.errors.push({
                row: rowNum,
                message: `Missing required fields: ${missingFields.join(", ")}`,
              });
              results.failed++;
              continue;
            }

            // Validate product name length
            if (row["name"].length < 3) {
              results.errors.push({
                row: rowNum,
                message: "Product name must be at least 3 characters",
              });
              results.failed++;
              continue;
            }

            // Validate price and stock as positive numbers
            const price = parseFloat(row["price"]);

            // Handle different cases for stock field (inventory, INVENTORY, Stock, stock)
            // Also use the same direct ternary approach as GST and dimensions
            const stock = parseInt(
              (
                row["stock"] ||
                row["Stock"] ||
                row["STOCK"] ||
                row["inventory"] ||
                row["Inventory"] ||
                row["INVENTORY"] ||
                0
              ).toString()
            );

            console.log(`Row ${rowNum} - Processing Stock value:`, {
              "stock field": row["stock"],
              "Stock field": row["Stock"],
              "inventory field": row["inventory"],
              "Inventory field": row["Inventory"],
              "final stock value": stock,
            });

            const mrp = row["mrp"] ? parseFloat(row["mrp"]) : price;
            const purchasePrice = row["purchasePrice"]
              ? parseFloat(row["purchasePrice"])
              : price;

            console.log(`Row ${rowNum} - Processing Purchase Price:`, {
              "purchasePrice field": row["purchasePrice"],
              "parsed purchasePrice": purchasePrice,
            });

            if (isNaN(price) || price <= 0) {
              results.errors.push({
                row: rowNum,
                message: "Price must be a positive number",
              });
              results.failed++;
              continue;
            }

            if (isNaN(stock) || stock < 0) {
              results.errors.push({
                row: rowNum,
                message: "Stock must be a non-negative integer",
              });
              results.failed++;
              continue;
            }

            // Validate category
            if (!categoryNames.includes(row["category"])) {
              results.errors.push({
                row: rowNum,
                message: `Invalid category. Must be one of: ${categoryNames.join(
                  ", "
                )}`,
              });
              results.failed++;
              continue;
            }

            // Get tax and GST values
            const tax = row["tax"] ? parseFloat(row["tax"]) : null;

            // Check multiple potential GST field names to improve compatibility
            const gstRate = row["GST"]
              ? parseFloat(row["GST"])
              : row["gst"]
                ? parseFloat(row["gst"])
                : row["gstRate"]
                  ? parseFloat(row["gstRate"])
                  : null;

            // Handle dimensions and weight - improved version using exactly the same pattern as GST
            // Declared without const to avoid duplication with the variables from getDimensionValue
            let weightVal = row["Weight"]
              ? parseFloat(row["Weight"])
              : row["weight"]
                ? parseFloat(row["weight"])
                : row["WEIGHT"]
                  ? parseFloat(row["WEIGHT"])
                  : 0;

            let lengthVal = row["Length"]
              ? parseFloat(row["Length"])
              : row["length"]
                ? parseFloat(row["length"])
                : row["LENGTH"]
                  ? parseFloat(row["LENGTH"])
                  : 0;

            let widthVal = row["Width"]
              ? parseFloat(row["Width"])
              : row["width"]
                ? parseFloat(row["width"])
                : row["WIDTH"]
                  ? parseFloat(row["WIDTH"])
                  : 0;

            let heightVal = row["Height"]
              ? parseFloat(row["Height"])
              : row["height"]
                ? parseFloat(row["height"])
                : row["HEIGHT"]
                  ? parseFloat(row["HEIGHT"])
                  : 0;

            // Use these values directly in the dimensions object
            let dimensions = {
              length: lengthVal,
              width: widthVal,
              height: heightVal,
              weight: weightVal,
            };

            console.log(`Row ${rowNum} - Processing GST value:`, {
              "GST field": row["GST"],
              "gst field": row["gst"],
              "gstRate field": row["gstRate"],
              "final gstRate": gstRate,
            });

            // Process warranty and return policy
            // Parse warranty: allow '1 Year', '2 Years', '12', etc.
            let warrantyRaw = row["warranty_"] || null;
            let warranty = null;
            if (warrantyRaw) {
              const str = String(warrantyRaw).toLowerCase().trim();
              let num = null;
              if (str.includes("year")) {
                const match = str.match(/(\d+(?:\.\d+)?)/);
                if (match) num = Math.round(parseFloat(match[1]) * 12);
              } else if (str.includes("month")) {
                const match = str.match(/(\d+(?:\.\d+)?)/);
                if (match) num = Math.round(parseFloat(match[1]));
              } else if (/^\d+(?:\.\d+)?$/.test(str)) {
                num = Math.round(parseFloat(str));
              }
              warranty = num !== null && !isNaN(num) ? num : null;
            }
            const returnPolicy = row["returnPolicy"] || null;
            const productType = row["productType"] || null;

            // Log the dimension fields for debugging
            console.log(`Row ${rowNum} - Processing dimensions:`, {
              "length field": row["length"],
              "width field": row["width"],
              "height field": row["height"],
              "weight field": row["weight"],
              "Length field": row["Length"],
              "Width field": row["Width"],
              "Height field": row["Height"],
              "Weight field": row["Weight"],
              "processed length": dimensions.length,
              "processed width": dimensions.width,
              "processed height": dimensions.height,
              "processed weight": dimensions.weight,
            });

            // Log the raw row data for debugging
            console.log(`Row ${rowNum} - Raw row data:`, row);

            // Log the parsed dimension values
            console.log(`Row ${rowNum} - Parsed dimensions:`, dimensions);

            // Parse image URLs if provided
            let images = [];
            let primaryImageUrl = null;

            console.log(`Processing row ${rowNum}, image fields:`, {
              imageUrl1: row["imageUrl1"],
              imageUrl2: row["imageUrl2"],
              imageUrl3: row["imageUrl3"],
              imageUrl4: row["imageUrl4"],
            });

            // Add image fields from the template
            ["imageUrl1", "imageUrl2", "imageUrl3", "imageUrl4"].forEach(
              (imageKey, index) => {
                if (
                  row[imageKey] &&
                  typeof row[imageKey] === "string" &&
                  row[imageKey].trim() !== ""
                ) {
                  const imageUrl = row[imageKey].trim();
                  images.push(imageUrl);

                  // Set the first valid image as the primary image
                  if (index === 0 || primaryImageUrl === null) {
                    primaryImageUrl = imageUrl;
                  }
                }
              }
            );

            console.log(
              `Row ${rowNum} after processing: images array length=${images.length}, primaryImageUrl=${primaryImageUrl}`
            );

            // Image URL is required in the database schema (NOT NULL constraint)
            // If no images were provided, use a default placeholder
            if (!primaryImageUrl) {
              console.log(`Row ${rowNum}: Setting default placeholder image`);
              primaryImageUrl =
                "https://via.placeholder.com/400x400?text=Product+Image";
            }

            // Process HSN code
            const hsn = row["hsn"] || null;

            // Process specifications if provided
            const specifications = row["specifications"] || null;

            // Create product object
            const productData = {
              name: row["name"],
              description: row["description"] || null, // Description is now optional
              price: price,
              stock: stock,
              mrp: mrp,
              purchase_price: purchasePrice,
              category: row["category"],
              subcategory: row["subCategory"] || null,
              sku: row["sku"] || null,
              hsn: hsn,
              // Store images as JSON array if available or null if no images
              images: images.length > 0 ? JSON.stringify(images) : null,
              // Image URL is now optional (database constraint has been modified)
              imageUrl: primaryImageUrl,
              // Always use the current seller's ID for bulk imports (required field)
              seller_id: sellerId, // This is critical - never omit or set to null
              approved: false, // Products require admin approval before appearing to buyers
              brand: row["brand"] || null,
              color: row["color"] || null,
              size: row["size"] || null,
              type: productType,
              warranty: warranty,
              return_policy: returnPolicy,
              tax: tax,
              gst_rate: gstRate,
              specifications: specifications,
              is_draft: false,
              deleted: false,
              ...dimensions,
            };

            // Log the full product data before saving
            console.log(
              `Row ${rowNum}: Full product data being sent to database:`,
              JSON.stringify(productData, null, 2)
            );

            // Save product to database
            const product = await storage.createProduct(productData);

            results.successful++;
            results.products.push({
              id: product.id,
              name: product.name,
              status: "success",
            });
          } catch (error) {
            console.error(`Error processing row ${rowNum}:`, error);
            results.failed++;

            // Create a user-friendly error message
            let errorMessage = "Unknown error occurred";

            // Log the row data for debugging
            console.log(`Processing row ${rowNum}:`, JSON.stringify(row));

            // Check for missing required fields in the row data
            const missingFields = [];
            if (!row["name"] || row["name"].trim() === "")
              missingFields.push("name");
            if (!row["price"] || isNaN(parseFloat(row["price"])))
              missingFields.push("price");
            if (!row["category"] || row["category"].trim() === "")
              missingFields.push("category");

            if (missingFields.length > 0) {
              errorMessage = `Missing required fields: ${missingFields.join(
                ", "
              )}`;
              console.log(`Row ${rowNum} error:`, errorMessage);
              results.errors.push({
                row: rowNum,
                message: errorMessage,
              });
              results.failed++;
              continue;
            }

            if (error.message) {
              // Check for common database errors and provide more helpful messages
              if (error.message.includes("violates not-null constraint")) {
                if (error.message.includes("name")) {
                  errorMessage = "Product name is required";
                } else if (error.message.includes("price")) {
                  errorMessage = "Price is required";
                } else if (error.message.includes("category")) {
                  errorMessage = "Category is required";
                } else {
                  errorMessage =
                    "Missing required field: " + error.message.split('"')[1];
                }
              } else if (error.message.includes("duplicate key")) {
                // Try to identify which field is causing the duplication
                if (error.message.includes("products_name_key")) {
                  errorMessage = "A product with this name already exists";
                } else if (error.message.includes("products_sku_key")) {
                  errorMessage = "A product with this SKU already exists";
                } else {
                  errorMessage = "Product with this name or SKU already exists";
                }
              } else if (
                error.message.includes("violates foreign key constraint")
              ) {
                if (error.message.includes("seller_id")) {
                  errorMessage = "The provided seller ID doesn't exist";
                } else if (error.message.includes("category_id")) {
                  errorMessage = "The provided category doesn't exist";
                } else if (error.message.includes("subcategory_id")) {
                  errorMessage = "The provided subcategory doesn't exist";
                } else {
                  const match = error.message.match(
                    /foreign key constraint "([^"]+)"/
                  );
                  const constraintName = match
                    ? match[1]
                    : "unknown constraint";
                  errorMessage = `Referenced value doesn't exist (constraint: ${constraintName})`;
                }
              } else {
                // Use the original error message but clean it up
                errorMessage = error.message
                  .replace(/error: /g, "")
                  .replace(/Error: /g, "")
                  .replace(/DETAIL: .*$/, "")
                  .trim();
              }
            }

            results.errors.push({
              row: rowNum,
              message: errorMessage,
            });
          }
        }

        res.json(results);
      } catch (error) {
        console.error("Error processing bulk import:", error);
        res.status(500).json({ message: "Failed to process bulk import" });
      }
    }
  );

  // Bulk upload functionality has been removed

  // Get all orders endpoint (admin only)
  app.get("/api/orders", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      let orders;

      if (req.user.role === "admin") {
        // Admin can see all orders
        orders = await storage.getOrders();
      } else if (req.user.role === "seller") {
        // Sellers can only see orders for their products
        orders = await storage.getOrders(undefined, req.user.id);
      } else {
        // Buyers can only see their own orders
        orders = await storage.getOrders(req.user.id);
      }

      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Categories endpoints
  app.get("/api/categories", async (_req, res) => {
    try {
      console.log("Fetching categories...");
      const categories = await storage.getCategories();

      // If no categories exist yet, return default categories
      if (categories.length === 0) {
        console.log("No categories found, returning default categories");
        const defaultCategories = [
          {
            id: 1,
            name: "Electronics",
            image: "https://cdn-icons-png.flaticon.com/512/3659/3659898.png",
            displayOrder: 1,
          },
          {
            id: 2,
            name: "Fashion",
            image: "https://cdn-icons-png.flaticon.com/512/2589/2589625.png",
            displayOrder: 2,
          },
          {
            id: 3,
            name: "Home",
            image: "https://cdn-icons-png.flaticon.com/512/2257/2257295.png",
            displayOrder: 3,
          },
          {
            id: 4,
            name: "Appliances",
            image: "https://cdn-icons-png.flaticon.com/512/3659/3659899.png",
            displayOrder: 4,
          },
          {
            id: 5,
            name: "Mobiles",
            image: "https://cdn-icons-png.flaticon.com/512/545/545245.png",
            displayOrder: 5,
          },
          {
            id: 6,
            name: "Beauty",
            image: "https://cdn-icons-png.flaticon.com/512/3685/3685331.png",
            displayOrder: 6,
          },
          {
            id: 7,
            name: "Toys",
            image: "https://cdn-icons-png.flaticon.com/512/3314/3314078.png",
            displayOrder: 7,
          },
          {
            id: 8,
            name: "Grocery",
            image: "https://cdn-icons-png.flaticon.com/512/3724/3724763.png",
            displayOrder: 8,
          },
        ];
        res.json(defaultCategories);
      } else {
        console.log(`Found ${categories.length} categories`);
        res.json(categories);
      }
    } catch (error) {
      console.error("Error fetching categories:", error);
      res.status(500).json({ error: "Failed to fetch categories" });
    }
  });

  // ADD THIS ENDPOINT
  app.get("/api/subcategories/all", async (_req, res) => {
    try {
      const subcategories = await storage.getAllSubcategories();
      res.json(subcategories);
    } catch (error) {
      console.error("Error fetching subcategories:", error);
      res.status(500).json({ error: "Failed to fetch subcategories" });
    }
  });

  app.get("/api/categories/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const category = await storage.getCategory(id);

      if (!category) {
        return res.status(404).json({ error: "Category not found" });
      }

      res.json(category);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch category" });
    }
  });

  app.post("/api/categories", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    // Allow admin or co-admin with canCreateCategories permission
    const isAdmin = req.user.role === "admin" && !req.user.isCoAdmin;
    const isAuthorizedCoAdmin =
      req.user.role === "admin" &&
      req.user.isCoAdmin &&
      req.user.permissions &&
      req.user.permissions.canCreateCategories;

    if (!isAdmin && !isAuthorizedCoAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const categoryData = insertCategorySchema.parse(req.body);
      const category = await storage.createCategory(categoryData);
      res.status(201).json(category);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create category" });
    }
  });

  app.put("/api/categories/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    // Allow admin or co-admin with canEditCategories permission
    const isAdmin = req.user.role === "admin" && !req.user.isCoAdmin;
    const isAuthorizedCoAdmin =
      req.user.role === "admin" &&
      req.user.isCoAdmin &&
      req.user.permissions &&
      req.user.permissions.canEditCategories;

    if (!isAdmin && !isAuthorizedCoAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const id = parseInt(req.params.id);
      const category = await storage.getCategory(id);

      if (!category) {
        return res.status(404).json({ error: "Category not found" });
      }

      const updatedCategory = await storage.updateCategory(id, req.body);
      res.json(updatedCategory);
    } catch (error) {
      res.status(500).json({ error: "Failed to update category" });
    }
  });

  app.delete("/api/subcategories/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    // Allow admin or co-admin with canDeleteCategories permission
    const isAdmin = req.user.role === "admin" && !req.user.isCoAdmin;
    const isAuthorizedCoAdmin =
      req.user.role === "admin" &&
      req.user.isCoAdmin &&
      req.user.permissions &&
      req.user.permissions.canDeleteCategories;

    if (!isAdmin && !isAuthorizedCoAdmin) {
      return res.status(403).json({ error: "Not authorized" });
    }

    try {
      const id = parseInt(req.params.id);
      const subcategory = await storage.getSubcategory(id);

      if (!subcategory) {
        return res.status(404).json({ error: "Subcategory not found" });
      }

      await storage.deleteSubcategory(id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete subcategory" });
    }
  });

  // Banner Management Routes

  // Get all banners
  app.get("/api/banners", async (req, res) => {
    try {
      const active =
        req.query.active === "true"
          ? true
          : req.query.active === "false"
            ? false
            : undefined;

      const banners = await storage.getBanners(active);
      res.json(banners);
    } catch (error) {
      console.error("Error fetching banners:", error);
      res.status(500).json({ error: "Failed to fetch banners" });
    }
  });

  // Upload banner image to S3
  app.post(
    "/api/upload/banner",
    upload.single("bannerImage"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        // Create a copy of the file with a banner-specific prefix
        const bannerFile = { ...req.file };
        bannerFile.originalname = `banner-${bannerFile.originalname}`;

        // Use the existing uploadFileToS3 function
        const uploadResult = await uploadFileToS3(bannerFile);

        return res.status(200).json({
          imageUrl: uploadResult.Location,
          success: true,
          message: "Banner image uploaded successfully",
        });
      } catch (error) {
        console.error("Error uploading banner image:", error);
        return res.status(500).json({
          error: "Failed to upload banner image",
          success: false,
          message: "There was an error uploading your banner image",
        });
      }
    }
  );

  // Get a single banner by ID
  app.get("/api/banners/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const banner = await storage.getBanner(id);

      if (!banner) {
        return res.status(404).json({ error: "Banner not found" });
      }

      res.json(banner);
    } catch (error) {
      console.error("Error fetching banner:", error);
      res.status(500).json({ error: "Failed to fetch banner" });
    }
  });

  // Create a new banner - admin only
  app.post("/api/banners", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const bannerData = req.body;
      const banner = await storage.createBanner(bannerData);
      res.status(201).json(banner);
    } catch (error) {
      console.error("Error creating banner:", error);
      res.status(500).json({ error: "Failed to create banner" });
    }
  });

  // Update a banner - admin only
  app.put("/api/banners/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const bannerData = req.body;

      // Log the data received for debugging
      console.log(`Received update request for banner ${id}:`, bannerData);

      // Make sure productId is properly handled - convert empty string or 0 to null
      if (bannerData.productId === "" || bannerData.productId === 0) {
        bannerData.productId = null;
      }

      // Ensure numeric fields are numbers
      if (bannerData.position && typeof bannerData.position === "string") {
        bannerData.position = parseInt(bannerData.position);
      }

      // Remove timestamp fields - these will be handled by the database
      // This is critical because strings can't be assigned to timestamp columns
      delete bannerData.createdAt;
      delete bannerData.updatedAt;

      const banner = await storage.updateBanner(id, bannerData);
      res.json(banner);
    } catch (error) {
      console.error("Error updating banner:", error);
      if (error instanceof Error) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: "Failed to update banner" });
      }
    }
  });

  // Delete a banner - admin only
  app.delete("/api/banners/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      await storage.deleteBanner(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting banner:", error);
      res.status(500).json({ error: "Failed to delete banner" });
    }
  });

  // Update banner position - admin only
  app.patch("/api/banners/:id/position", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const { position } = req.body;

      if (typeof position !== "number" || position < 1) {
        return res
          .status(400)
          .json({ error: "Position must be a positive number" });
      }

      const banner = await storage.updateBannerPosition(id, position);
      res.json(banner);
    } catch (error) {
      console.error("Error updating banner position:", error);
      res.status(500).json({ error: "Failed to update banner position" });
    }
  });

  // Toggle banner active status - admin only
  app.patch("/api/banners/:id/toggle-active", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const banner = await storage.toggleBannerActive(id);
      res.json(banner);
    } catch (error) {
      console.error("Error toggling banner active status:", error);
      res.status(500).json({ error: "Failed to toggle banner active status" });
    }
  });

  // API route to get featured products for hero section
  app.get("/api/featured-hero-products", async (_req, res) => {
    try {
      // First, try to get active banners from the database
      const activeBanners = await storage.getBanners(true);

      // If we have banners, use them, BUT validate that any linked products are approved
      if (activeBanners.length > 0) {
        // Create a map of product IDs to check for approval status
        const productIds = activeBanners
          .filter((banner) => banner.productId !== null)
          .map((banner) => banner.productId);

        // Get approval status for all referenced products in a single query
        let approvedProductIds: number[] = [];
        if (productIds.length > 0) {
          const productsInfo = await db
            .select({ id: products.id, approved: products.approved })
            .from(products)
            .where(
              and(
                inArray(products.id, productIds as number[]),
                eq(products.approved, true),
                eq(products.deleted, false)
              )
            );

          approvedProductIds = productsInfo.map((p) => p.id);
          console.log(
            `Checking product approval for hero banners - Approved IDs: ${approvedProductIds.join(
              ", "
            )}`
          );
        }

        const heroProducts = activeBanners.map((banner) => {
          // If banner has a productId, verify it's approved
          const isProductApproved =
            banner.productId === null ||
            approvedProductIds.includes(banner.productId);

          return {
            id: banner.id,
            title: banner.title,
            subtitle: banner.subtitle,
            url: banner.imageUrl,
            alt: banner.title,
            buttonText: banner.buttonText,
            category: banner.category,
            subcategory: banner.subcategory, // Include subcategory
            badgeText: banner.badgeText,
            // Only include productId if the product is approved
            productId: isProductApproved ? banner.productId : null,
            position: banner.position,
          };
        });

        // Sort by position
        heroProducts.sort((a, b) => a.position - b.position);

        return res.json(heroProducts);
      }

      // Fallback: Get one product from each category for the hero carousel
      const categories = await storage.getCategories();
      const heroProducts = [];

      for (const category of categories) {
        // Get only approved products that are not drafts
        const products = await storage.getProducts(
          category.name,
          undefined,
          true
        );

        // Filter out products that are drafts or pending approval
        const readyProducts = products.filter(
          (product) =>
            product.approved === true &&
            product.isDraft !== true &&
            product.deleted !== true
        );

        if (readyProducts.length > 0) {
          // Take the first product from each category
          const product = readyProducts[0];
          // Get image URL properly - handle different field naming (imageUrl vs image_url)
          let imageUrl = "";

          // Use actual product images with fallback to category placeholders if needed
          if (product.imageUrl) {
            imageUrl = product.imageUrl;
          } else if (product.images && typeof product.images === "string") {
            try {
              const parsedImages = JSON.parse(product.images);
              if (Array.isArray(parsedImages) && parsedImages.length > 0) {
                imageUrl = parsedImages[0];
              }
            } catch (e) {
              console.log("Error parsing images JSON for hero:", e);
            }
          }

          // Fallback to category placeholders if no product image
          if (!imageUrl) {
            const categoryPlaceholders: Record<string, string> = {
              Electronics: "/images/categories/electronics.svg",
              Fashion: "/images/categories/fashion.svg",
              Home: "/images/categories/home.svg",
              Appliances: "/images/categories/appliances.svg",
              Mobiles: "/images/categories/mobiles.svg",
              Beauty: "/images/categories/beauty.svg",
              Toys: "/images/categories/toys.svg",
              Grocery: "/images/categories/grocery.svg",
            };

            imageUrl =
              categoryPlaceholders[product.category] ||
              "/images/placeholder.svg";
          }

          heroProducts.push({
            title: `${category.name} Sale`,
            subtitle: `Up to 30% off on all ${category.name.toLowerCase()} items`,
            url: imageUrl,
            alt: product.name,
            buttonText: "Shop Now",
            category: category.name,
            badgeText: "HOT DEAL",
            productId: product.id,
          });
        }
      }

      res.json(heroProducts);
    } catch (error) {
      console.error("Error fetching hero products:", error);
      res.status(500).json({ error: "Failed to fetch hero products" });
    }
  });

  // Get deal of the day product
  app.get("/api/deal-of-the-day", async (_req, res) => {
    try {
      // Get all electronics products (or another category that typically has good deals)
      // Get only approved products and filter out drafts
      const products = await storage.getProducts(
        "Electronics",
        undefined,
        true
      );
      const readyProducts = products.filter((p) => !p.isDraft && !p.deleted);

      // If no products, try a different category
      let dealProducts = readyProducts;
      if (dealProducts.length === 0) {
        // Try Mobiles category as fallback
        const mobileProducts = await storage.getProducts(
          "Mobiles",
          undefined,
          true
        );
        const readyMobileProducts = mobileProducts.filter(
          (p) => !p.isDraft && !p.deleted
        );
        if (readyMobileProducts.length > 0) {
          dealProducts = readyMobileProducts;
        }

        // Try Fashion as a third option
        if (dealProducts.length === 0) {
          const fashionProducts = await storage.getProducts(
            "Fashion",
            undefined,
            true
          );
          const readyFashionProducts = fashionProducts.filter(
            (p) => !p.isDraft && !p.deleted
          );
          if (readyFashionProducts.length > 0) {
            dealProducts = readyFashionProducts;
          }
        }
      }

      if (!dealProducts || dealProducts.length === 0) {
        return res.status(200).json(null); // Return null instead of 404 to avoid error in console
      }

      // Deterministically select a deal based on the current day (rotates daily)
      // Use UTC date to avoid timezone issues
      const now = new Date();
      const dayOfYear = Math.floor(
        (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
          Date.UTC(now.getUTCFullYear(), 0, 0)) /
          86400000
      );
      const dealIndex = dayOfYear % dealProducts.length;
      const dealProduct = dealProducts[dealIndex];

      // Get product image - use actual product images with fallback
      let imageUrl = "";

      // Try to get image URL from product data
      if (dealProduct.imageUrl) {
        imageUrl = dealProduct.imageUrl;
      } else if (dealProduct.images && typeof dealProduct.images === "string") {
        try {
          const parsedImages = JSON.parse(dealProduct.images);
          if (Array.isArray(parsedImages) && parsedImages.length > 0) {
            imageUrl = parsedImages[0];
          }
        } catch (e) {
          console.log("Error parsing images JSON for deal of the day:", e);
        }
      }

      // If no image found, use category placeholder
      if (!imageUrl) {
        const categoryPlaceholders = {
          Electronics: "/images/categories/electronics.svg",
          Fashion: "/images/categories/fashion.svg",
          Home: "/images/categories/home.svg",
          Appliances: "/images/categories/appliances.svg",
          Mobiles: "/images/categories/mobiles.svg",
          Beauty: "/images/categories/beauty.svg",
          Toys: "/images/categories/toys.svg",
          Grocery: "/images/categories/grocery.svg",
        };

        imageUrl =
          categoryPlaceholders[dealProduct.category] ||
          "/images/placeholder.svg";
      }

      // Calculate discount (for display purposes)
      const originalPrice = dealProduct.price;
      const discountPercentage = 15; // 15% off
      const discountPrice = originalPrice * (1 - discountPercentage / 100);

      // Calculate time remaining until next UTC midnight
      const nowUTC = new Date();
      const nextMidnightUTC = new Date(
        Date.UTC(
          nowUTC.getUTCFullYear(),
          nowUTC.getUTCMonth(),
          nowUTC.getUTCDate() + 1,
          0,
          0,
          0
        )
      );
      const diffMs = nextMidnightUTC.getTime() - nowUTC.getTime();
      const totalSeconds = Math.floor(diffMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      res.json({
        title: `Deal of the Day: ${dealProduct.name}`,
        subtitle: `Limited time offer on premium ${dealProduct.category}`,
        image: imageUrl,
        originalPrice: originalPrice,
        discountPrice: discountPrice,
        discountPercentage: discountPercentage,
        productId: dealProduct.id,
        hours,
        minutes,
        seconds,
      });
    } catch (error) {
      console.error("Error fetching deal of the day:", error);
      res.status(500).json({ error: "Failed to fetch deal of the day" });
    }
  });

  // Image proxy route to handle CORS issues with external images
  app.get("/api/image-proxy", handleImageProxy);

  // Advanced search endpoint with instant results
  app.get("/api/lelekart-search", async (req, res) => {
    try {
      const query = req.query.q as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const showOnlyApproved = req.query.showOnlyApproved === "true";

      // Determine user role for filtering results
      // First check if a role was explicitly provided in the request
      let userRole = req.query.userRole as string;

      // If no role was provided, use the authenticated user's role or default to 'buyer'
      if (!userRole) {
        userRole = req.isAuthenticated() ? req.user.role : "buyer";
      }

      // Force userRole to 'buyer' if showOnlyApproved is true, or if the user is a buyer
      // This ensures non-approved products are never shown to buyers or when explicitly requested
      if (showOnlyApproved || userRole === "buyer") {
        userRole = "buyer";
      }

      console.log("SEARCH API: Received request with query params:", req.query);
      console.log(
        "SEARCH API: Parsed query:",
        query,
        "limit:",
        limit,
        "userRole:",
        userRole,
        "showOnlyApproved:",
        showOnlyApproved
      );

      if (!query || query.trim().length < 1) {
        console.log(
          "SEARCH API: Empty query received, returning empty results"
        );
        return res.json([]);
      }

      console.log("SEARCH API: Searching products with query:", query);
      const results = await storage.searchProducts(query, limit, userRole);
      console.log(`SEARCH API: Found ${results.length} results for "${query}"`);

      if (results.length > 0) {
        console.log("SEARCH API: First result:", JSON.stringify(results[0]));
      }

      // Set the content type explicitly to application/json
      res.setHeader("Content-Type", "application/json");
      return res.json(results);
    } catch (error) {
      console.error("SEARCH API: Error searching products:", error);
      res.status(500).json({ error: "Failed to search products" });
    }
  });

  // Review Routes
  // Get reviews for a product
  app.get("/api/products/:id/reviews", async (req, res) => {
    try {
      const productId = parseInt(req.params.id);
      const product = await storage.getProduct(productId);

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Check user role to determine if they should see unapproved products
      const userRole = req.isAuthenticated() ? req.user.role : "buyer";

      // If user is a buyer and product is not approved, return 404
      if (userRole === "buyer" && !product.approved) {
        console.log(
          `Unauthorized access attempt by buyer to reviews of unapproved product ${productId}`
        );
        return res.status(404).json({ error: "Product not found" });
      }

      const reviews = await storage.getProductReviews(productId);
      res.json(reviews);
    } catch (error) {
      console.error("Error fetching product reviews:", error);
      res.status(500).json({ error: "Failed to fetch product reviews" });
    }
  });

  // Get product rating summary
  app.get("/api/products/:id/rating", async (req, res) => {
    try {
      const productId = parseInt(req.params.id);
      const product = await storage.getProduct(productId);

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Check user role to determine if they should see unapproved products
      const userRole = req.isAuthenticated() ? req.user.role : "buyer";

      // If user is a buyer and product is not approved, return 404
      if (userRole === "buyer" && !product.approved) {
        console.log(
          `Unauthorized access attempt by buyer to rating of unapproved product ${productId}`
        );
        return res.status(404).json({ error: "Product not found" });
      }

      const ratingSummary = await storage.getProductRatingSummary(productId);
      res.json(ratingSummary);
    } catch (error) {
      console.error("Error fetching product rating summary:", error);
      res.status(500).json({ error: "Failed to fetch product rating summary" });
    }
  });

  // Update user profile
  app.patch("/api/user/profile", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      // Only allow updating certain fields
      const allowedFields = [
        "username",
        "email",
        "phone",
        "address",
        "profileImage",
      ];
      const updateData: Partial<User> = {};

      // Filter out any fields that shouldn't be updated
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updateData[field as keyof User] = req.body[field];
        }
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const updatedUser = await storage.updateUserProfile(
        req.user.id,
        updateData
      );
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ error: "Failed to update user profile" });
    }
  });

  // Profile image upload endpoint
  app.post(
    "/api/user/profile-image",
    upload.single("profileImage"),
    async (req, res) => {
      if (!req.isAuthenticated()) return res.sendStatus(401);

      try {
        if (!req.file) {
          return res.status(400).json({ error: "No image file uploaded" });
        }

        console.log(
          `Processing profile image upload: ${req.file.originalname}, size: ${req.file.size}, mimetype: ${req.file.mimetype}`
        );

        try {
          // Upload the image to S3
          const uploadResult = await uploadFileToS3(req.file);
          console.log(
            `Profile image uploaded successfully to S3: ${uploadResult.Location}`
          );

          if (!uploadResult || !uploadResult.Location) {
            throw new Error("S3 upload failed - no URL returned");
          }

          // Update the user's profile image URL in the database
          const updatedUser = await storage.updateUserProfile(req.user.id, {
            profileImage: uploadResult.Location,
          });

          // Return a simple JSON response with no HTML
          return res.json({
            success: true,
            profileImage: updatedUser.profileImage,
          });
        } catch (uploadError) {
          console.error("S3 upload error:", uploadError);
          return res.status(500).json({
            error: "Failed to upload to cloud storage",
            details:
              uploadError instanceof Error
                ? uploadError.message
                : "Unknown error",
          });
        }
      } catch (error) {
        console.error("Error in profile image upload handler:", error);
        res.status(500).json({
          error: "Failed to process profile image upload",
          details: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );

  // Get user notification preferences
  app.get("/api/user/notification-preferences", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const preferences = await storage.getUserNotificationPreferences(
        req.user.id
      );

      if (!preferences) {
        // Return default preferences if none are set
        return res.json({
          orderUpdates: true,
          promotions: true,
          priceAlerts: true,
          stockAlerts: true,
          accountUpdates: true,
          deliveryUpdates: true,
          recommendationAlerts: true,
          paymentReminders: true,
          communicationPreference: "email",
        });
      }

      res.json(preferences);
    } catch (error) {
      console.error("Error getting notification preferences:", error);
      res.status(500).json({ error: "Failed to get notification preferences" });
    }
  });

  // Update user notification preferences
  app.post("/api/user/notification-preferences", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      // Validate essential preference fields
      const requiredFields = [
        "orderUpdates",
        "promotions",
        "priceAlerts",
        "stockAlerts",
        "accountUpdates",
        "deliveryUpdates",
        "recommendationAlerts",
        "paymentReminders",
      ];

      for (const field of requiredFields) {
        if (typeof req.body[field] !== "boolean") {
          return res
            .status(400)
            .json({ error: `${field} must be a boolean value` });
        }
      }

      // Validate communication preference
      if (
        req.body.communicationPreference &&
        !["email", "sms", "push"].includes(req.body.communicationPreference)
      ) {
        return res.status(400).json({
          error: "communicationPreference must be 'email', 'sms', or 'push'",
        });
      }

      // Save preferences
      const updatedUser = await storage.updateUserNotificationPreferences(
        req.user.id,
        req.body
      );
      res.json({ success: true, preferences: req.body });
    } catch (error) {
      console.error("Error updating notification preferences:", error);
      res
        .status(500)
        .json({ error: "Failed to update notification preferences" });
    }
  });

  // Get reviews by a user
  app.get("/api/user/reviews", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const reviews = await storage.getUserReviews(req.user.id);
      res.json(reviews);
    } catch (error) {
      console.error("Error fetching user reviews:", error);
      res.status(500).json({ error: "Failed to fetch user reviews" });
    }
  });

  // Get a specific review
  app.get("/api/reviews/:id", async (req, res) => {
    try {
      const reviewId = parseInt(req.params.id);
      const review = await storage.getReview(reviewId);

      if (!review) {
        return res.status(404).json({ error: "Review not found" });
      }

      res.json(review);
    } catch (error) {
      console.error("Error fetching review:", error);
      res.status(500).json({ error: "Failed to fetch review" });
    }
  });

  // Create a review
  app.post("/api/products/:id/reviews", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const productId = parseInt(req.params.id);
      const product = await storage.getProduct(productId);

      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Check if user has purchased the product (for verified purchase status)
      const hasUserPurchased = await storage.hasUserPurchasedProduct(
        req.user.id,
        productId
      );

      // Create the review
      const reviewData = insertReviewSchema.parse({
        ...req.body,
        userId: req.user.id,
        productId,
        verifiedPurchase: hasUserPurchased,
      });

      const review = await storage.createReview(reviewData);

      // If review has images, create them
      if (req.body.images && Array.isArray(req.body.images)) {
        for (const imageUrl of req.body.images) {
          await storage.addReviewImage({
            reviewId: review.id,
            imageUrl,
          });
        }
      }

      res.status(201).json(review);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error creating review:", error);
      res.status(500).json({
        error: "Failed to create review",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Update a review
  app.put("/api/reviews/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const reviewId = parseInt(req.params.id);
      const review = await storage.getReview(reviewId);

      if (!review) {
        return res.status(404).json({ error: "Review not found" });
      }

      // Only the author of the review or an admin can update it
      if (review.userId !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not authorized" });
      }

      const updatedReview = await storage.updateReview(reviewId, req.body);
      res.json(updatedReview);
    } catch (error) {
      console.error("Error updating review:", error);
      res.status(500).json({ error: "Failed to update review" });
    }
  });

  // Delete a review
  app.delete("/api/reviews/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const reviewId = parseInt(req.params.id);
      const review = await storage.getReview(reviewId);

      if (!review) {
        return res.status(404).json({ error: "Review not found" });
      }

      // Only the author of the review or an admin can delete it
      if (review.userId !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not authorized" });
      }

      await storage.deleteReview(reviewId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting review:", error);
      res.status(500).json({ error: "Failed to delete review" });
    }
  });

  // Mark a review as helpful
  app.post("/api/reviews/:id/helpful", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const reviewId = parseInt(req.params.id);
      const review = await storage.getReview(reviewId);

      if (!review) {
        return res.status(404).json({ error: "Review not found" });
      }

      // Can't mark your own review as helpful
      if (review.userId === req.user.id) {
        return res
          .status(400)
          .json({ error: "Cannot mark your own review as helpful" });
      }

      const helpfulVote = await storage.markReviewHelpful(
        reviewId,
        req.user.id
      );
      res.status(201).json(helpfulVote);
    } catch (error) {
      console.error("Error marking review as helpful:", error);
      res.status(500).json({ error: "Failed to mark review as helpful" });
    }
  });

  // Remove helpful mark from a review
  app.delete("/api/reviews/:id/helpful", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const reviewId = parseInt(req.params.id);
      const review = await storage.getReview(reviewId);

      if (!review) {
        return res.status(404).json({ error: "Review not found" });
      }

      // Check if user has marked this review as helpful
      const isHelpful = await storage.isReviewHelpfulByUser(
        reviewId,
        req.user.id
      );

      if (!isHelpful) {
        return res
          .status(400)
          .json({ error: "You have not marked this review as helpful" });
      }

      await storage.unmarkReviewHelpful(reviewId, req.user.id);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing helpful mark from review:", error);
      res
        .status(500)
        .json({ error: "Failed to remove helpful mark from review" });
    }
  });

  // Check if user has marked a review as helpful
  app.get("/api/reviews/:id/helpful", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const reviewId = parseInt(req.params.id);
      const review = await storage.getReview(reviewId);

      if (!review) {
        return res.status(404).json({ error: "Review not found" });
      }

      const isHelpful = await storage.isReviewHelpfulByUser(
        reviewId,
        req.user.id
      );
      res.json({ isHelpful });
    } catch (error) {
      console.error("Error checking if review is helpful:", error);
      res.status(500).json({ error: "Failed to check if review is helpful" });
    }
  });

  // RECOMMENDATION API ENDPOINTS

  // Get personalized recommendations for the current user
  app.get("/api/recommendations", async (req, res) => {
    try {
      const userId = req.isAuthenticated() ? req.user.id : null;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

      // Determine if we should filter by approval status based on user role
      const userRole = req.isAuthenticated() ? req.user.role : "buyer";
      const showOnlyApproved = userRole !== "admin" && userRole !== "seller";

      console.log(
        `Getting personalized recommendations for ${
          userId ? `user ${userId}` : "anonymous user"
        } (role: ${userRole}, showOnlyApproved: ${showOnlyApproved})`
      );
      const recommendations =
        await RecommendationEngine.getPersonalizedRecommendations(
          userId,
          limit
        );

      // For regular buyers, ensure we only return approved products that aren't drafts
      let filteredRecommendations = recommendations;
      if (showOnlyApproved) {
        filteredRecommendations = recommendations.filter(
          (product) =>
            product.approved === true &&
            product.isDraft !== true &&
            product.deleted !== true
        );

        if (filteredRecommendations.length < recommendations.length) {
          console.log(
            `Filtered out ${
              recommendations.length - filteredRecommendations.length
            } unapproved/draft products from recommendations`
          );
        }
      }

      console.log(
        `Found ${filteredRecommendations.length} personalized recommendations`
      );
      res.json(filteredRecommendations);
    } catch (error) {
      console.error("Error getting personalized recommendations:", error);
      res.status(500).json({ error: "Failed to get recommendations" });
    }
  });

  // Get similar products for a specific product
  app.get("/api/recommendations/similar/:id", async (req, res) => {
    try {
      const productId = parseInt(req.params.id);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 6;

      // Determine if we should filter by approval status based on user role
      const userRole = req.isAuthenticated() ? req.user.role : "buyer";
      const showOnlyApproved = userRole !== "admin" && userRole !== "seller";

      console.log(`Getting similar products for product ID ${productId}`);
      const similarProducts = await RecommendationEngine.getSimilarProducts(
        productId,
        limit
      );

      // For regular buyers, ensure we only return approved products that aren't drafts
      let filteredProducts = similarProducts;
      if (showOnlyApproved) {
        filteredProducts = similarProducts.filter(
          (product) =>
            product.approved === true &&
            product.isDraft !== true &&
            product.deleted !== true
        );

        if (filteredProducts.length < similarProducts.length) {
          console.log(
            `Filtered out ${
              similarProducts.length - filteredProducts.length
            } unapproved/draft products from similar products`
          );
        }
      }

      console.log(
        `Found ${filteredProducts.length} similar products for product ID ${productId}`
      );
      res.json(filteredProducts);
    } catch (error) {
      console.error("Error getting similar products:", error);
      res.status(500).json({ error: "Failed to get similar products" });
    }
  });

  // Get recommended products for homepage and product pages
  app.get("/api/recommendations/featured", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 8;
      const userId = req.isAuthenticated() ? req.user.id : null;

      // Determine if we should filter by approval status based on user role
      const userRole = req.isAuthenticated() ? req.user.role : "buyer";
      const showOnlyApproved = userRole !== "admin" && userRole !== "seller";

      console.log(
        `Getting featured recommendations (role: ${userRole}, showOnlyApproved: ${showOnlyApproved})`
      );
      const featuredRecommendations =
        await RecommendationEngine.getPersonalizedRecommendations(
          userId,
          limit
        );

      // For regular buyers, ensure we only return approved products that aren't drafts
      let filteredRecommendations = featuredRecommendations;
      if (showOnlyApproved) {
        filteredRecommendations = featuredRecommendations.filter(
          (product) =>
            product.approved === true &&
            product.isDraft !== true &&
            product.deleted !== true
        );

        if (filteredRecommendations.length < featuredRecommendations.length) {
          console.log(
            `Filtered out ${
              featuredRecommendations.length - filteredRecommendations.length
            } unapproved/draft products from featured recommendations`
          );
        }
      }

      console.log(
        `Found ${filteredRecommendations.length} featured recommendations`
      );
      res.json(filteredRecommendations);
    } catch (error) {
      console.error("Error getting featured recommendations:", error);
      res.status(500).json({ error: "Failed to get featured recommendations" });
    }
  });

  // Image proxy route to avoid CORS issues with external image URLs
  app.get("/api/proxy-image", handleImageProxy);

  // All AI Shopping Assistant API Routes removed

  // Smart Inventory & Price Management API Routes

  // Sales History endpoints
  app.get("/api/seller/sales-history/:productId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const productId = parseInt(req.params.productId);
      const sellerId = req.user.id;

      // Verify product belongs to seller
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      if (product.sellerId !== sellerId && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not authorized" });
      }

      const salesHistory = await storage.getSalesHistory(productId, sellerId);
      res.json(salesHistory);
    } catch (error) {
      console.error("Error fetching sales history:", error);
      res.status(500).json({ error: "Failed to fetch sales history" });
    }
  });

  app.post("/api/seller/sales-history", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const {
        productId,
        quantity,
        revenue,
        costPrice,
        channel,
        promotionApplied,
        seasonality,
      } = req.body;

      // Verify product belongs to seller
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      if (product.sellerId !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not authorized" });
      }

      const salesData = insertSalesHistorySchema.parse({
        productId,
        sellerId: req.user.id,
        date: new Date(),
        quantity,
        revenue,
        costPrice,
        profitMargin: ((revenue - costPrice) / revenue) * 100,
        channel: channel || "marketplace",
        promotionApplied: promotionApplied || false,
        seasonality: seasonality || "",
        createdAt: new Date(),
      });

      const salesRecord = await storage.createSalesRecord(salesData);
      res.status(201).json(salesRecord);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error recording sales data:", error);
      res.status(500).json({ error: "Failed to record sales data" });
    }
  });

  // Demand Forecast endpoints
  app.get("/api/seller/demand-forecasts/:productId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const productId = parseInt(req.params.productId);
      const sellerId = req.user.id;

      // Verify product belongs to seller
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      if (product.sellerId !== sellerId && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not authorized" });
      }

      const forecasts = await storage.getDemandForecasts(productId, sellerId);
      res.json(forecasts);
    } catch (error) {
      console.error("Error fetching demand forecasts:", error);
      res.status(500).json({ error: "Failed to fetch demand forecasts" });
    }
  });

  app.post("/api/seller/demand-forecasts/:productId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const productId = parseInt(req.params.productId);
      const sellerId = req.user.id;
      const { period } = req.body;

      // Verify product belongs to seller
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      if (product.sellerId !== sellerId && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not authorized" });
      }

      // Generate demand forecast using Gemini AI
      const forecast = await generateDemandForecast(
        productId,
        sellerId,
        period || "monthly"
      );
      res.status(201).json(forecast);
    } catch (error) {
      console.error("Error generating demand forecast:", error);
      res.status(500).json({ error: "Failed to generate demand forecast" });
    }
  });

  // Price Optimization endpoints
  app.get("/api/seller/price-optimizations/:productId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const productId = parseInt(req.params.productId);
      const sellerId = req.user.id;

      // Verify product belongs to seller
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      if (product.sellerId !== sellerId && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not authorized" });
      }

      const optimizations = await storage.getPriceOptimizations(
        productId,
        sellerId
      );
      res.json(optimizations);
    } catch (error) {
      console.error("Error fetching price optimizations:", error);
      res.status(500).json({ error: "Failed to fetch price optimizations" });
    }
  });

  app.post("/api/seller/price-optimizations/:productId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const productId = parseInt(req.params.productId);
      const sellerId = req.user.id;

      // Verify product belongs to seller
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      if (product.sellerId !== sellerId && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not authorized" });
      }

      // Generate price optimization using Gemini AI
      const optimization = await generatePriceOptimization(productId, sellerId);
      res.status(201).json(optimization);
    } catch (error) {
      console.error("Error generating price optimization:", error);
      res.status(500).json({ error: "Failed to generate price optimization" });
    }
  });

  app.put("/api/seller/price-optimizations/:id/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;

      if (!status || !["pending", "applied", "rejected"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const optimization = await storage.updatePriceOptimizationStatus(
        id,
        status,
        req.user.id
      );
      res.json(optimization);
    } catch (error) {
      console.error("Error updating price optimization status:", error);
      res
        .status(500)
        .json({ error: "Failed to update price optimization status" });
    }
  });

  app.post("/api/seller/price-optimizations/:id/apply", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);

      // Apply the price optimization to the product
      const updatedProduct = await storage.applyPriceOptimization(
        id,
        req.user.id
      );
      res.json(updatedProduct);
    } catch (error) {
      console.error("Error applying price optimization:", error);
      res.status(500).json({ error: "Failed to apply price optimization" });
    }
  });

  // Inventory Optimization endpoints
  app.get(
    "/api/seller/inventory-optimizations/:productId",
    async (req, res) => {
      if (!req.isAuthenticated()) return res.sendStatus(401);
      if (req.user.role !== "seller" && req.user.role !== "admin")
        return res.status(403).json({ error: "Not authorized" });

      try {
        const productId = parseInt(req.params.productId);
        const sellerId = req.user.id;

        // Verify product belongs to seller
        const product = await storage.getProduct(productId);
        if (!product) {
          return res.status(404).json({ error: "Product not found" });
        }

        if (product.sellerId !== sellerId && req.user.role !== "admin") {
          return res.status(403).json({ error: "Not authorized" });
        }

        const optimizations = await storage.getInventoryOptimizations(
          productId,
          sellerId
        );
        res.json(optimizations);
      } catch (error) {
        console.error("Error fetching inventory optimizations:", error);
        res
          .status(500)
          .json({ error: "Failed to fetch inventory optimizations" });
      }
    }
  );

  app.post(
    "/api/seller/inventory-optimizations/:productId",
    async (req, res) => {
      if (!req.isAuthenticated()) return res.sendStatus(401);
      if (req.user.role !== "seller" && req.user.role !== "admin")
        return res.status(403).json({ error: "Not authorized" });

      try {
        const productId = parseInt(req.params.productId);
        const sellerId = req.user.id;

        // Verify product belongs to seller
        const product = await storage.getProduct(productId);
        if (!product) {
          return res.status(404).json({ error: "Product not found" });
        }

        if (product.sellerId !== sellerId && req.user.role !== "admin") {
          return res.status(403).json({ error: "Not authorized" });
        }

        // Generate inventory optimization using Gemini AI
        const optimization = await generateInventoryOptimization(
          productId,
          sellerId
        );
        res.status(201).json(optimization);
      } catch (error) {
        console.error("Error generating inventory optimization:", error);
        res
          .status(500)
          .json({ error: "Failed to generate inventory optimization" });
      }
    }
  );

  app.put(
    "/api/seller/inventory-optimizations/:id/status",
    async (req, res) => {
      if (!req.isAuthenticated()) return res.sendStatus(401);
      if (req.user.role !== "seller" && req.user.role !== "admin")
        return res.status(403).json({ error: "Not authorized" });

      try {
        const id = parseInt(req.params.id);
        const { status } = req.body;

        if (!status || !["pending", "applied", "rejected"].includes(status)) {
          return res.status(400).json({ error: "Invalid status" });
        }

        const optimization = await storage.updateInventoryOptimizationStatus(
          id,
          status,
          req.user.id
        );
        res.json(optimization);
      } catch (error) {
        console.error("Error updating inventory optimization status:", error);
        res
          .status(500)
          .json({ error: "Failed to update inventory optimization status" });
      }
    }
  );

  app.post(
    "/api/seller/inventory-optimizations/:id/apply",
    async (req, res) => {
      if (!req.isAuthenticated()) return res.sendStatus(401);
      if (req.user.role !== "seller" && req.user.role !== "admin")
        return res.status(403).json({ error: "Not authorized" });

      try {
        const id = parseInt(req.params.id);

        // Apply the inventory optimization to the product
        const updatedProduct = await storage.applyInventoryOptimization(
          id,
          req.user.id
        );
        res.json(updatedProduct);
      } catch (error) {
        console.error("Error applying inventory optimization:", error);
        res
          .status(500)
          .json({ error: "Failed to apply inventory optimization" });
      }
    }
  );

  // AI Generated Content endpoints
  app.get("/api/seller/ai-generated-content/:productId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const productId = parseInt(req.params.productId);
      const sellerId = req.user.id;
      const contentType = req.query.contentType as string | undefined;

      // Verify product belongs to seller
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      if (product.sellerId !== sellerId && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not authorized" });
      }

      const contents = await storage.getAIGeneratedContents(
        productId,
        sellerId,
        contentType
      );
      res.json(contents);
    } catch (error) {
      console.error("Error fetching AI generated content:", error);
      res.status(500).json({ error: "Failed to fetch AI generated content" });
    }
  });

  app.post("/api/seller/ai-generated-content/:productId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const productId = parseInt(req.params.productId);
      const sellerId = req.user.id;
      const { contentType, originalData } = req.body;

      if (
        !contentType ||
        !["description", "features", "specifications"].includes(contentType)
      ) {
        return res.status(400).json({ error: "Invalid content type" });
      }

      // Verify product belongs to seller
      const product = await storage.getProduct(productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      if (product.sellerId !== sellerId && req.user.role !== "admin") {
        return res.status(403).json({ error: "Not authorized" });
      }

      // Generate AI content using Gemini AI
      const content = await generateProductContent(
        productId,
        sellerId,
        contentType,
        originalData || ""
      );
      res.status(201).json(content);
    } catch (error) {
      console.error("Error generating AI content:", error);
      res.status(500).json({ error: "Failed to generate AI content" });
    }
  });

  app.put("/api/seller/ai-generated-content/:id/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;

      if (!status || !["pending", "applied", "rejected"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const content = await storage.updateAIGeneratedContentStatus(
        id,
        status,
        req.user.id
      );
      res.json(content);
    } catch (error) {
      console.error("Error updating AI content status:", error);
      res.status(500).json({ error: "Failed to update AI content status" });
    }
  });

  app.post("/api/seller/ai-generated-content/:id/apply", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" && req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);

      // Apply the AI generated content to the product
      const updatedProduct = await storage.applyAIGeneratedContent(
        id,
        req.user.id
      );
      res.json(updatedProduct);
    } catch (error) {
      console.error("Error applying AI content:", error);
      res.status(500).json({ error: "Failed to apply AI content" });
    }
  });

  // Wishlist routes
  app.get("/api/wishlist", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const wishlistItems = await storage.getWishlistItems(req.user.id);
      res.json(wishlistItems);
    } catch (error) {
      console.error("Error fetching wishlist:", error);
      res.status(500).json({ error: "Failed to fetch wishlist" });
    }
  });

  app.post("/api/wishlist", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const { productId } = req.body;
      if (!productId) {
        return res.status(400).json({ error: "Product ID is required" });
      }

      const wishlistData = insertWishlistSchema.parse({
        userId: req.user.id,
        productId: parseInt(productId),
      });

      // Check if product exists
      const product = await storage.getProduct(wishlistData.productId);
      if (!product) {
        return res.status(404).json({ error: "Product not found" });
      }

      // Check if item already exists in wishlist
      const existing = await storage.getWishlistItem(
        req.user.id,
        wishlistData.productId
      );
      if (existing) {
        return res
          .status(409)
          .json({ error: "Product already in wishlist", item: existing });
      }

      const wishlistItem = await storage.addToWishlist(wishlistData);
      res.status(201).json(wishlistItem);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Error adding to wishlist:", error);
      res.status(500).json({ error: "Failed to add to wishlist" });
    }
  });

  app.delete("/api/wishlist/:productId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const productId = parseInt(req.params.productId);

      // Check if product exists in user's wishlist
      const existing = await storage.getWishlistItem(req.user.id, productId);
      if (!existing) {
        return res.status(404).json({ error: "Product not found in wishlist" });
      }

      await storage.removeFromWishlist(req.user.id, productId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing from wishlist:", error);
      res.status(500).json({ error: "Failed to remove from wishlist" });
    }
  });

  // Check if a product is in the user's wishlist
  app.get("/api/wishlist/check/:productId", async (req, res) => {
    if (!req.isAuthenticated())
      return res.status(401).json({ inWishlist: false });

    try {
      const productId = parseInt(req.params.productId);
      const wishlistItem = await storage.getWishlistItem(
        req.user.id,
        productId
      );
      res.json({ inWishlist: !!wishlistItem });
    } catch (error) {
      console.error("Error checking wishlist:", error);
      res.status(500).json({ error: "Failed to check wishlist status" });
    }
  });

  // Address Management API

  // Check shipping availability for a pincode
  app.get("/api/shipping/check-pincode", async (req, res) => {
    try {
      const { pincode, productId } = req.query;

      if (!pincode) {
        return res.status(400).json({
          isDeliverable: false,
          message: "Please enter a valid PIN code",
        });
      }

      // First try to find in our local database for fast response
      const localLocationData = findLocationByPincode(pincode as string);
      let locationData = null;

      if (localLocationData) {
        console.log(`PIN code ${pincode} found in local database`);
        locationData = localLocationData;
      } else {
        // If not in local database, use external API
        console.log(
          `PIN code ${pincode} not found in local database, using external API`
        );

        // Use India Post API for PIN code lookup
        const apiUrl = `https://api.postalpincode.in/pincode/${pincode}`;

        const response = await fetch(apiUrl);
        const data = await response.json();

        if (
          Array.isArray(data) &&
          data.length > 0 &&
          data[0].Status === "Success" &&
          data[0].PostOffice &&
          data[0].PostOffice.length > 0
        ) {
          // Extract the first result from the API
          const postOffice = data[0].PostOffice[0];

          // Format the response to match our expected format
          locationData = {
            pincode: pincode,
            district:
              postOffice.District ||
              postOffice.Division ||
              postOffice.Region ||
              "",
            state: postOffice.State || "",
          };

          console.log(
            `Found location data for PIN code ${pincode} via API:`,
            locationData
          );
        }
      }

      // If we couldn't find location data, the pincode is invalid
      if (!locationData) {
        console.log(`PIN code ${pincode} not found in external API`);
        return res.json({
          isDeliverable: false,
          message: "PIN code not found. Please check and try again.",
          pincode,
        });
      }

      // All valid Indian PIN codes are deliverable
      // If we can resolve the location data from a PIN code, it's considered valid
      const isDeliverable = !!locationData;

      // Return delivery availability information
      return res.json({
        isDeliverable,
        message: isDeliverable
          ? `Delivery is available at this PIN code`
          : "Sorry, we don't deliver to this location yet",
        pincode,
        etd: isDeliverable ? "3-5" : null, // Estimated time of delivery in days
        cod_available: isDeliverable, // Cash on delivery availability
        location: locationData,
      });
    } catch (error) {
      console.error("Error checking pincode deliverability:", error);
      return res.json({
        isDeliverable: false,
        message:
          "Unable to check delivery availability. Please try again later.",
        pincode: req.query.pincode,
      });
    }
  });

  // Get location data for a PIN code
  app.get("/api/pincode/:code", async (req, res) => {
    try {
      const pincode = req.params.code;

      // First try to find in our local database for fast response
      const localLocationData = findLocationByPincode(pincode);

      if (localLocationData) {
        console.log(`PIN code ${pincode} found in local database`);
        return res.json(localLocationData);
      }

      // If not in local database, use external API
      console.log(
        `PIN code ${pincode} not found in local database, using external API`
      );

      // Use India Post API for PIN code lookup
      // This API returns details for any valid Indian PIN code
      const apiUrl = `https://api.postalpincode.in/pincode/${pincode}`;

      const response = await fetch(apiUrl);
      const data = await response.json();

      if (
        Array.isArray(data) &&
        data.length > 0 &&
        data[0].Status === "Success" &&
        data[0].PostOffice &&
        data[0].PostOffice.length > 0
      ) {
        // Extract the first result from the API
        const postOffice = data[0].PostOffice[0];

        // Format the response to match our expected format
        const locationData = {
          pincode: pincode,
          district:
            postOffice.District ||
            postOffice.Division ||
            postOffice.Region ||
            "",
          state: postOffice.State || "",
        };

        console.log(
          `Found location data for PIN code ${pincode} via API:`,
          locationData
        );
        return res.json(locationData);
      }

      // If we reached here, the PIN code wasn't found in external API either
      console.log(`PIN code ${pincode} not found in external API`);
      return res.status(404).json({ error: "PIN code not found" });
    } catch (error) {
      console.error("Error looking up PIN code:", error);
      res.status(500).json({ error: "Failed to look up PIN code" });
    }
  });

  // Get all addresses for a user
  app.get("/api/addresses", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const userId = req.user.id;
      const addresses = await storage.getUserAddresses(userId);
      res.json(addresses);
    } catch (error) {
      console.error("Error fetching addresses:", error);
      res.status(500).json({ error: "Failed to fetch addresses" });
    }
  });

  // Get default address for a user
  app.get("/api/addresses/default", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const userId = req.user.id;
      const defaultAddress = await storage.getDefaultAddress(userId);

      if (!defaultAddress) {
        return res.status(404).json({ error: "No default address found" });
      }

      res.json(defaultAddress);
    } catch (error) {
      console.error("Error fetching default address:", error);
      res.status(500).json({ error: "Failed to fetch default address" });
    }
  });

  // Get a specific address by ID
  app.get("/api/addresses/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const addressId = parseInt(req.params.id);
      const userId = req.user.id;

      const address = await storage.getUserAddressById(addressId);

      if (!address) {
        return res.status(404).json({ error: "Address not found" });
      }

      // Security check: Make sure the address belongs to the requesting user
      if (address.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Unauthorized access to this address" });
      }

      res.json(address);
    } catch (error) {
      console.error("Error fetching address:", error);
      res.status(500).json({ error: "Failed to fetch address" });
    }
  });

  // Create a new address
  app.post("/api/addresses", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const userId = req.user.id;

      // Validate the input data
      const addressData = insertUserAddressSchema.parse({
        ...req.body,
        userId,
      });

      const newAddress = await storage.createUserAddress(addressData);
      res.status(201).json(newAddress);
    } catch (error) {
      console.error("Error creating address:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create address" });
    }
  });

  // Update an existing address
  app.put("/api/addresses/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const addressId = parseInt(req.params.id);
      const userId = req.user.id;

      // Get the address to verify ownership
      const existingAddress = await storage.getUserAddressById(addressId);

      if (!existingAddress) {
        return res.status(404).json({ error: "Address not found" });
      }

      // Security check: Make sure the address belongs to the requesting user
      if (existingAddress.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Unauthorized access to this address" });
      }

      // Update the address
      const updatedAddress = await storage.updateUserAddress(
        addressId,
        req.body
      );
      res.json(updatedAddress);
    } catch (error) {
      console.error("Error updating address:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to update address" });
    }
  });

  // Delete an address
  app.delete("/api/addresses/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const addressId = parseInt(req.params.id);
      const userId = req.user.id;

      // Get the address to verify ownership
      const existingAddress = await storage.getUserAddressById(addressId);

      if (!existingAddress) {
        return res.status(404).json({ error: "Address not found" });
      }

      // Security check: Make sure the address belongs to the requesting user
      if (existingAddress.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Unauthorized access to this address" });
      }

      // Try to delete the address
      try {
        await storage.deleteUserAddress(addressId);
        res.status(204).send();
      } catch (deleteError: any) {
        console.error("Error deleting address:", deleteError);

        // Check if it's our specific error about addresses used in orders
        if (
          deleteError.message &&
          deleteError.message.includes("used in completed orders")
        ) {
          return res.status(400).json({
            error:
              "This address cannot be deleted because it's associated with one or more orders. Please create a new address instead.",
          });
        }

        // Some other error occurred
        res.status(500).json({ error: "Failed to delete address" });
      }
    } catch (error) {
      console.error("Error in address deletion route:", error);
      res
        .status(500)
        .json({ error: "Failed to process address deletion request" });
    }
  });

  // Set an address as default
  app.post("/api/addresses/:id/set-default", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const addressId = parseInt(req.params.id);
      const userId = req.user.id;

      // Get the address to verify ownership
      const existingAddress = await storage.getUserAddressById(addressId);

      if (!existingAddress) {
        return res.status(404).json({ error: "Address not found" });
      }

      // Security check: Make sure the address belongs to the requesting user
      if (existingAddress.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Unauthorized access to this address" });
      }

      // Set as default
      await storage.setDefaultAddress(userId, addressId);

      // Get the updated address
      const updatedAddress = await storage.getUserAddressById(addressId);
      res.json(updatedAddress);
    } catch (error) {
      console.error("Error setting default address:", error);
      res.status(500).json({ error: "Failed to set default address" });
    }
  });

  // Set an address as default billing address
  app.post("/api/addresses/:id/set-default-billing", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const addressId = parseInt(req.params.id);
      const userId = req.user.id;

      // Get the address to verify ownership
      const existingAddress = await storage.getUserAddressById(addressId);

      if (!existingAddress) {
        return res.status(404).json({ error: "Address not found" });
      }

      // Security check: Make sure the address belongs to the requesting user
      if (existingAddress.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Unauthorized access to this address" });
      }

      // Set as default billing address
      await storage.setDefaultBillingAddress(userId, addressId);

      // Get the updated address
      const updatedAddress = await storage.getUserAddressById(addressId);
      res.json(updatedAddress);
    } catch (error) {
      console.error("Error setting default billing address:", error);
      res.status(500).json({ error: "Failed to set default billing address" });
    }
  });

  // Set an address as default shipping address
  app.post("/api/addresses/:id/set-default-shipping", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const addressId = parseInt(req.params.id);
      const userId = req.user.id;

      // Get the address to verify ownership
      const existingAddress = await storage.getUserAddressById(addressId);

      if (!existingAddress) {
        return res.status(404).json({ error: "Address not found" });
      }

      // Security check: Make sure the address belongs to the requesting user
      if (existingAddress.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Unauthorized access to this address" });
      }

      // Set as default shipping address
      await storage.setDefaultShippingAddress(userId, addressId);

      // Get the updated address
      const updatedAddress = await storage.getUserAddressById(addressId);
      res.json(updatedAddress);
    } catch (error) {
      console.error("Error setting default shipping address:", error);
      res.status(500).json({ error: "Failed to set default shipping address" });
    }
  });

  // Get default billing address
  app.get("/api/addresses/default-billing", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const userId = req.user.id;
      const address = await storage.getDefaultBillingAddress(userId);

      if (!address) {
        return res
          .status(404)
          .json({ error: "No default billing address found" });
      }

      res.json(address);
    } catch (error) {
      console.error("Error fetching default billing address:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch default billing address" });
    }
  });

  // Get default shipping address
  app.get("/api/addresses/default-shipping", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const userId = req.user.id;
      const address = await storage.getDefaultShippingAddress(userId);

      if (!address) {
        return res
          .status(404)
          .json({ error: "No default shipping address found" });
      }

      res.json(address);
    } catch (error) {
      console.error("Error fetching default shipping address:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch default shipping address" });
    }
  });

  // Seller approval endpoints (admin only)
  app.get("/api/admin/sellers", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const sellers = await storage.getSellers();
      res.json(sellers);
    } catch (error) {
      console.error("Error fetching sellers:", error);
      res.status(500).json({ error: "Failed to fetch sellers" });
    }
  });

  app.post("/api/admin/sellers/:id/approve", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const sellerId = parseInt(req.params.id);
      await storage.updateSellerApprovalStatus(sellerId, true);
      res.json({ message: "Seller approved successfully" });
    } catch (error) {
      console.error("Error approving seller:", error);
      res.status(500).json({ error: "Failed to approve seller" });
    }
  });

  app.post("/api/admin/sellers/:id/reject", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const sellerId = parseInt(req.params.id);
      // Set approved to false and rejected to true
      await storage.updateSellerApprovalStatus(sellerId, false, true);
      res.json({ message: "Seller rejected successfully" });
    } catch (error) {
      console.error("Error rejecting seller:", error);
      res.status(500).json({ error: "Failed to reject seller" });
    }
  });

  // Seller status check (for sellers to check their approval status)
  app.get("/api/seller/status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const seller = await storage.getUser(req.user.id);

      if (!seller) {
        return res.status(404).json({ error: "Seller not found" });
      }

      res.json({
        approved: seller.approved || false,
        rejected: seller.rejected || false,
        message: seller.approved
          ? "Your seller account is approved. You can now list products and manage your store."
          : seller.rejected
            ? "Your seller account has been rejected. Please contact customer support for more information."
            : "Your seller account is pending approval. Please wait for an admin to review your application.",
      });
    } catch (error) {
      console.error("Error checking seller status:", error);
      res.status(500).json({ error: "Failed to check seller status" });
    }
  });

  // Footer Content APIs
  app.get("/api/footer-content", async (req, res) => {
    try {
      const { section, isActive } = req.query;
      const isActiveBoolean =
        isActive === "true" ? true : isActive === "false" ? false : undefined;

      const contents = await storage.getFooterContents(
        section as string | undefined,
        isActiveBoolean
      );
      res.json(contents);
    } catch (error) {
      console.error("Error getting footer contents:", error);
      res.status(500).json({ error: "Failed to get footer contents" });
    }
  });

  app.get("/api/footer-content/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const content = await storage.getFooterContentById(id);

      if (!content) {
        return res.status(404).json({ error: "Footer content not found" });
      }

      res.json(content);
    } catch (error) {
      console.error(`Error getting footer content ${req.params.id}:`, error);
      res.status(500).json({ error: "Failed to get footer content" });
    }
  });

  app.post("/api/admin/footer-content", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const { section, title, content, order } = req.body;

      if (!section || !title || !content) {
        return res
          .status(400)
          .json({ error: "Section, title, and content are required" });
      }

      const footerContent = await storage.createFooterContent({
        section,
        title,
        content,
        order: order || 0,
        isActive: true,
      });

      res.status(201).json(footerContent);
    } catch (error) {
      console.error("Error creating footer content:", error);
      res.status(500).json({ error: "Failed to create footer content" });
    }
  });

  app.put("/api/admin/footer-content/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const { section, title, content, order } = req.body;

      // Get existing content
      const existingContent = await storage.getFooterContentById(id);
      if (!existingContent) {
        return res.status(404).json({ error: "Footer content not found" });
      }

      const updatedContent = await storage.updateFooterContent(id, {
        section: section || existingContent.section,
        title: title || existingContent.title,
        content: content !== undefined ? content : existingContent.content,
        order: order !== undefined ? order : existingContent.order,
      });

      res.json(updatedContent);
    } catch (error) {
      console.error(`Error updating footer content ${req.params.id}:`, error);
      res.status(500).json({ error: "Failed to update footer content" });
    }
  });

  app.delete("/api/admin/footer-content/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      await storage.deleteFooterContent(id);
      res.status(204).end();
    } catch (error) {
      console.error(`Error deleting footer content ${req.params.id}:`, error);
      res.status(500).json({ error: "Failed to delete footer content" });
    }
  });

  app.put("/api/admin/footer-content/:id/toggle", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const content = await storage.toggleFooterContentActive(id);
      res.json(content);
    } catch (error) {
      console.error(
        `Error toggling footer content status ${req.params.id}:`,
        error
      );
      res.status(500).json({ error: "Failed to toggle footer content status" });
    }
  });

  app.put("/api/admin/footer-content/:id/order", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const { order } = req.body;

      if (typeof order !== "number" || order < 0) {
        return res
          .status(400)
          .json({ error: "Order must be a non-negative number" });
      }

      const content = await storage.updateFooterContentOrder(id, order);
      res.json(content);
    } catch (error) {
      console.error(
        `Error updating footer content order ${req.params.id}:`,
        error
      );
      res.status(500).json({ error: "Failed to update footer content order" });
    }
  });

  // Product Display Settings APIs
  app.get("/api/product-display-settings", async (req, res) => {
    try {
      const settings = await storage.getProductDisplaySettings();
      if (!settings) {
        return res
          .status(404)
          .json({ error: "Product display settings not found" });
      }
      res.json(settings);
    } catch (error) {
      console.error("Error getting product display settings:", error);
      res.status(500).json({ error: "Failed to get product display settings" });
    }
  });

  app.post("/api/admin/product-display-settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const { displayType, config, isActive } = req.body;

      if (!displayType || !config) {
        return res
          .status(400)
          .json({ error: "Display type and configuration are required" });
      }

      const settings = await storage.createProductDisplaySettings({
        displayType,
        config,
        isActive: isActive ?? true,
      });

      res.status(201).json(settings);
    } catch (error) {
      console.error("Error creating product display settings:", error);
      res
        .status(500)
        .json({ error: "Failed to create product display settings" });
    }
  });

  app.put("/api/admin/product-display-settings/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    try {
      const id = parseInt(req.params.id);
      const { displayType, config, isActive } = req.body;

      const updatedSettings = await storage.updateProductDisplaySettings(id, {
        displayType,
        config,
        isActive,
      });

      res.json(updatedSettings);
    } catch (error) {
      console.error(
        `Error updating product display settings ${req.params.id}:`,
        error
      );
      res
        .status(500)
        .json({ error: "Failed to update product display settings" });
    }
  });

  // Shipping API routes
  // Shipping Methods
  app.get("/api/shipping/methods", getShippingMethods);
  app.get("/api/shipping/methods/:id", getShippingMethod);
  app.post("/api/shipping/methods", createShippingMethod);
  app.put("/api/shipping/methods/:id", updateShippingMethod);
  app.delete("/api/shipping/methods/:id", deleteShippingMethod);

  // Shipping Zones
  app.get("/api/shipping/zones", getShippingZones);
  app.get("/api/shipping/zones/:id", getShippingZone);
  app.post("/api/shipping/zones", createShippingZone);
  app.put("/api/shipping/zones/:id", updateShippingZone);
  app.delete("/api/shipping/zones/:id", deleteShippingZone);

  // Shipping Rules
  app.get("/api/shipping/rules", getShippingRules);
  app.get("/api/shipping/rules/:id", getShippingRule);
  app.post("/api/shipping/rules", createShippingRule);
  app.put("/api/shipping/rules/:id", updateShippingRule);
  app.delete("/api/shipping/rules/:id", deleteShippingRule);

  // Shiprocket Integration Routes
  app.get("/api/shiprocket/settings", shiprocketHandlers.getShiprocketSettings);
  app.post(
    "/api/shiprocket/settings",
    shiprocketHandlers.saveShiprocketSettings
  );
  app.post("/api/shiprocket/token", shiprocketHandlers.generateShiprocketToken);
  app.post(
    "/api/shiprocket/connect",
    shiprocketHandlers.generateShiprocketToken
  );
  app.post("/api/shiprocket/test", shiprocketHandlers.testShiprocketConnection);
  app.get("/api/shiprocket/couriers", shiprocketHandlers.getShiprocketCouriers);
  app.get(
    "/api/shiprocket/orders/pending",
    shiprocketHandlers.getPendingShiprocketOrders
  );
  app.get("/api/shiprocket/orders", shiprocketHandlers.getShiprocketOrders);
  app.post(
    "/api/shiprocket/ship-order",
    shiprocketHandlers.shipOrderWithShiprocket
  );
  app.post(
    "/api/shiprocket/auto-ship",
    shiprocketHandlers.autoShipWithShiprocket
  );

  // Seller Shipping Settings
  app.get("/api/seller/shipping-settings", getSellerShippingSettings);
  app.post(
    "/api/seller/shipping-settings",
    createOrUpdateSellerShippingSettings
  );

  // Product Shipping Overrides
  app.get(
    "/api/seller/product-shipping-overrides",
    getProductShippingOverrides
  );
  app.get(
    "/api/seller/product-shipping-override/:productId",
    getProductShippingOverride
  );
  app.post(
    "/api/seller/product-shipping-override",
    createOrUpdateProductShippingOverride
  );
  app.delete(
    "/api/seller/product-shipping-override/:productId",
    deleteProductShippingOverride
  );

  // Order Shipping Tracking
  app.get("/api/orders/:orderId/shipping-tracking", getOrderShippingTracking);
  app.post(
    "/api/orders/:orderId/shipping-tracking",
    createOrUpdateOrderShippingTracking
  );

  // Shiprocket integration routes
  // [Shiprocket integration routes removed]

  // New seller dashboard module routes

  // Returns Routes
  app.get("/api/seller/returns", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" || !req.user.approved)
      return res.status(403).json({ error: "Not authorized" });

    await returnsHandlers.getSellerReturnsHandler(req, res);
  });

  app.get("/api/seller/returns/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    await returnsHandlers.getReturnByIdHandler(req, res);
  });

  app.post("/api/seller/returns", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    await returnsHandlers.createReturnHandler(req, res);
  });

  app.put("/api/seller/returns/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    await returnsHandlers.updateReturnStatusHandler(req, res);
  });

  // Analytics Routes
  app.get("/api/seller/analytics", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" || !req.user.approved)
      return res.status(403).json({ error: "Not authorized" });

    await analyticsHandlers.getSellerAnalyticsHandler(req, res);
  });

  app.get("/api/seller/analytics/export", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" || !req.user.approved)
      return res.status(403).json({ error: "Not authorized" });

    await analyticsHandlers.exportSellerAnalyticsHandler(req, res);
  });

  app.post("/api/seller/analytics", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" || !req.user.approved)
      return res.status(403).json({ error: "Not authorized" });

    await analyticsHandlers.createOrUpdateAnalyticsHandler(req, res);
  });

  app.get("/api/seller/dashboard-summary", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" || !req.user.approved)
      return res.status(403).json({ error: "Not authorized" });

    await analyticsHandlers.getSellerDashboardSummaryHandler(req, res);
  });

  // Payments Routes
  app.get("/api/seller/payments", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" || !req.user.approved)
      return res.status(403).json({ error: "Not authorized" });

    await paymentsHandlers.getSellerPaymentsHandler(req, res);
  });

  app.get("/api/seller/payments/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    await paymentsHandlers.getSellerPaymentByIdHandler(req, res);
  });

  app.post("/api/seller/payments", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    await paymentsHandlers.createSellerPaymentHandler(req, res);
  });

  app.put("/api/seller/payments/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Not authorized" });

    await paymentsHandlers.updateSellerPaymentHandler(req, res);
  });

  app.get("/api/seller/payments-summary", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" || !req.user.approved)
      return res.status(403).json({ error: "Not authorized" });

    await paymentsHandlers.getSellerPaymentsSummaryHandler(req, res);
  });

  // Settings Routes
  app.get("/api/seller/settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" || !req.user.approved)
      return res.status(403).json({ error: "Not authorized" });

    await settingsHandlers.getSellerSettingsHandler(req, res);
  });

  app.put("/api/seller/settings", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" || !req.user.approved)
      return res.status(403).json({ error: "Not authorized" });

    await settingsHandlers.updateSellerSettingsHandler(req, res);
  });

  app.post("/api/seller/settings/holiday-mode", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" || !req.user.approved)
      return res.status(403).json({ error: "Not authorized" });

    await settingsHandlers.toggleHolidayModeHandler(req, res);
  });

  app.put("/api/seller/settings/notifications", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller" || !req.user.approved)
      return res.status(403).json({ error: "Not authorized" });

    await settingsHandlers.updateNotificationPreferencesHandler(req, res);
  });

  app.put("/api/seller/settings/personal-info", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not authorized" });

    await settingsHandlers.updatePersonalInfoHandler(req, res);
  });

  app.put("/api/seller/settings/address", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not authorized" });

    await settingsHandlers.updateAddressHandler(req, res);
  });

  app.put("/api/seller/settings/pickup-address", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not authorized" });

    await settingsHandlers.updatePickupAddressHandler(req, res);
  });

  app.put("/api/seller/settings/tax-info", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not authorized" });

    await settingsHandlers.updateTaxInfoHandler(req, res);
  });

  app.put("/api/seller/settings/store", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "seller")
      return res.status(403).json({ error: "Not authorized" });

    await settingsHandlers.updateStoreHandler(req, res);
  });

  // Support Routes
  app.get("/api/support/tickets", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    await supportHandlers.getSupportTicketsHandler(req, res);
  });

  app.get("/api/support/tickets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    await supportHandlers.getSupportTicketByIdHandler(req, res);
  });

  app.post("/api/support/tickets", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    await supportHandlers.createSupportTicketHandler(req, res);
  });

  app.put("/api/support/tickets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    await supportHandlers.updateSupportTicketHandler(req, res);
  });

  app.delete("/api/support/tickets/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    await supportHandlers.deleteSupportTicketHandler(req, res);
  });

  app.get("/api/support/tickets/:id/messages", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    await supportHandlers.getSupportMessagesHandler(req, res);
  });

  app.post("/api/support/tickets/:id/messages", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    await supportHandlers.addSupportMessageHandler(req, res);
  });

  // ========== Rewards System Routes ==========

  // Get user rewards - allows both user to view their own rewards and admin to view any user's rewards
  app.get("/api/rewards/:userId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const requestedUserId = parseInt(req.params.userId);

    // Authorization check - only allow users to view their own rewards or admins to view any user's rewards
    if (
      req.user.id !== requestedUserId &&
      req.user.role !== "admin" &&
      req.user.role !== "co-admin"
    ) {
      return res
        .status(403)
        .json({ error: "Not authorized to view these rewards" });
    }

    await rewardsHandlers.getUserRewards(req, res);
  });

  // Get user reward transactions - with pagination
  app.get("/api/rewards/:userId/transactions", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const requestedUserId = parseInt(req.params.userId);

    // Authorization check
    if (
      req.user.id !== requestedUserId &&
      req.user.role !== "admin" &&
      req.user.role !== "co-admin"
    ) {
      return res
        .status(403)
        .json({ error: "Not authorized to view these transactions" });
    }

    await rewardsHandlers.getUserRewardTransactions(req, res);
  });

  // Add reward points (admin only)
  app.post("/api/rewards/add", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin" && req.user.role !== "co-admin") {
      return res
        .status(403)
        .json({ error: "Only admins can add reward points" });
    }

    await rewardsHandlers.addRewardPoints(req, res);
  });

  // Redeem reward points (user or admin)
  app.post("/api/rewards/redeem", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    // If user is trying to redeem points for another user, check if they're admin
    if (
      req.body.userId !== req.user.id &&
      req.user.role !== "admin" &&
      req.user.role !== "co-admin"
    ) {
      return res
        .status(403)
        .json({ error: "Not authorized to redeem points for another user" });
    }

    await rewardsHandlers.redeemRewardPoints(req, res);
  });

  // Get all reward rules (admin only)
  app.get("/api/rewards/rules", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin" && req.user.role !== "co-admin") {
      return res
        .status(403)
        .json({ error: "Not authorized to view reward rules" });
    }

    await rewardsHandlers.getRewardRules(req, res);
  });

  // Create a new reward rule (admin only)
  app.post("/api/rewards/rules", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin" && req.user.role !== "co-admin") {
      return res
        .status(403)
        .json({ error: "Not authorized to create reward rules" });
    }

    await rewardsHandlers.createRewardRule(req, res);
  });

  // Update a reward rule (admin only)
  app.put("/api/rewards/rules/:ruleId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin" && req.user.role !== "co-admin") {
      return res
        .status(403)
        .json({ error: "Not authorized to update reward rules" });
    }

    // Set the rule ID from the URL parameter
    req.params.ruleId = req.params.ruleId;

    await rewardsHandlers.updateRewardRule(req, res);
  });

  // Delete a reward rule (admin only)
  app.delete("/api/rewards/rules/:ruleId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Only admins can delete reward rules" });
    }

    await rewardsHandlers.deleteRewardRule(req, res);
  });

  // Get reward statistics (admin only)
  app.get("/api/rewards/statistics", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin" && req.user.role !== "co-admin") {
      return res
        .status(403)
        .json({ error: "Not authorized to view reward statistics" });
    }

    await rewardsHandlers.getRewardStatistics(req, res);
  });

  // ========== Gift Cards System Routes ==========

  // Get all gift cards (admin only) with pagination
  app.get("/api/gift-cards", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin" && req.user.role !== "co-admin") {
      return res
        .status(403)
        .json({ error: "Not authorized to view all gift cards" });
    }

    await giftCardsHandlers.getAllGiftCards(req, res);
  });

  // Get user's gift cards
  app.get("/api/gift-cards/user/:userId", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    const requestedUserId = parseInt(req.params.userId);

    // Authorization check
    if (
      req.user.id !== requestedUserId &&
      req.user.role !== "admin" &&
      req.user.role !== "co-admin"
    ) {
      return res
        .status(403)
        .json({ error: "Not authorized to view these gift cards" });
    }

    await giftCardsHandlers.getUserGiftCards(req, res);
  });

  // Get a single gift card by ID
  app.get("/api/gift-cards/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    // The card ownership check will be done in the handler
    await giftCardsHandlers.getGiftCard(req, res);
  });

  // Check gift card balance by code (public)
  app.post("/api/gift-cards/check-balance", async (req, res) => {
    await giftCardsHandlers.checkGiftCardBalance(req, res);
  });

  // Create a new gift card (admin or user)
  app.post("/api/gift-cards", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    // Set the purchasedBy field to the current user's ID
    req.body.purchasedBy = req.user.id;

    await giftCardsHandlers.createGiftCard(req, res);
  });

  // Apply gift card to an order
  app.post("/api/gift-cards/apply", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    // Set the user ID from the authenticated user
    req.body.userId = req.user.id;

    await giftCardsHandlers.applyGiftCard(req, res);
  });

  // Deactivate/reactivate a gift card (admin only)
  app.put("/api/gift-cards/:id/toggle-status", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin" && req.user.role !== "co-admin") {
      return res
        .status(403)
        .json({ error: "Not authorized to toggle gift card status" });
    }

    await giftCardsHandlers.toggleGiftCardStatus(req, res);
  });

  // Get all gift card templates
  app.get("/api/gift-cards/templates", async (req, res) => {
    // Anyone can view gift card templates
    await giftCardsHandlers.getGiftCardTemplates(req, res);
  });

  // Create a new gift card template (admin only)
  app.post("/api/gift-cards/templates", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin" && req.user.role !== "co-admin") {
      return res
        .status(403)
        .json({ error: "Not authorized to create gift card templates" });
    }

    await giftCardsHandlers.createGiftCardTemplate(req, res);
  });

  // Update a gift card template (admin only)
  app.put("/api/gift-cards/templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin" && req.user.role !== "co-admin") {
      return res
        .status(403)
        .json({ error: "Not authorized to update gift card templates" });
    }

    await giftCardsHandlers.updateGiftCardTemplate(req, res);
  });

  // Delete a gift card template (admin only)
  app.delete("/api/gift-cards/templates/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Only admins can delete gift card templates" });
    }

    await giftCardsHandlers.deleteGiftCardTemplate(req, res);
  });

  // ========== Wallet System Routes ==========

  // Get wallet settings
  app.get("/api/wallet/settings", async (req, res) => {
    await walletRoutes.getWalletSettings(req, res);
  });

  // Update wallet settings (admin only)
  app.put("/api/wallet/settings", async (req, res) => {
    await walletRoutes.updateWalletSettings(req, res);
  });

  // Additional POST route for wallet settings to maintain compatibility with client
  app.post("/api/wallet/settings", async (req, res) => {
    await walletRoutes.updateWalletSettings(req, res);
  });

  // Get user wallet
  app.get("/api/wallet", async (req, res) => {
    await walletRoutes.getUserWallet(req, res);
  });

  // Get user wallet transactions
  app.get("/api/wallet/transactions", async (req, res) => {
    await walletRoutes.getUserWalletTransactions(req, res);
  });

  // Redeem coins from wallet
  app.post("/api/wallet/redeem", async (req, res) => {
    await walletRoutes.redeemCoins(req, res);
  });

  // Process expired coins (admin only)
  app.post("/api/wallet/process-expired", async (req, res) => {
    await walletRoutes.processExpiredCoins(req, res);
  });

  // Manual wallet adjustment (admin only)
  app.post("/api/wallet/adjust", async (req, res) => {
    await walletRoutes.manualWalletAdjustment(req, res);
  });

  // Get user wallet by ID (admin only)
  app.get("/api/wallet/user/:userId", async (req, res) => {
    await walletRoutes.getWalletByUserId(req, res);
  });

  // Get wallet transactions by user ID (admin only)
  app.get("/api/wallet/user/:userId/transactions", async (req, res) => {
    await walletRoutes.getWalletTransactionsByUserId(req, res);
  });

  // Get users with wallets (admin only)
  app.get("/api/wallet/users", async (req, res) => {
    await walletRoutes.getUsersWithWallets(req, res);
  });

  // Spend redeemed coins at checkout
  app.post("/api/wallet/spend-redeemed", async (req, res) => {
    await walletRoutes.spendRedeemedCoins(req, res);
  });

  // Create HTTP server with port forwarding support for Replit deployment
  const httpServer = createServer(app);

  // Health check endpoint for Replit deployment
  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

  // Handle health check at root for non-UI requests
  app.get("/", (req, res, next) => {
    // Only act as health check if the request explicitly wants non-HTML
    const acceptHeader = req.get("Accept");
    if (acceptHeader && !acceptHeader.includes("text/html")) {
      return res.status(200).send("OK");
    }
    // Otherwise, proceed to serve the actual app
    next();
  });

  // Career form submission route
  app.post("/api/careers/submit", upload.single("resume"), async (req, res) => {
    try {
      const {
        name,
        fatherName,
        maritalStatus,
        address,
        highestQualification,
        specialization,
        workExperience,
        idNumber,
        email,
        country,
        phone,
        whatsapp,
        message,
      } = req.body;

      // Validate required fields
      const requiredFields = [
        "name",
        "fatherName",
        "maritalStatus",
        "address",
        "highestQualification",
        "specialization",
        "workExperience",
        "idNumber",
        "email",
        "country",
        "phone",
        "message",
      ];

      const missingFields = requiredFields.filter((field) => !req.body[field]);
      if (missingFields.length > 0) {
        return res.status(400).json({
          error: "Missing required fields",
          required: missingFields,
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: "Invalid email format",
        });
      }

      // Validate phone number format (Indian numbers)
      const phoneRegex = /^\+?[1-9]\d{9,14}$/;
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({
          error: "Invalid phone number format",
        });
      }

      // Validate WhatsApp number if provided
      if (whatsapp && !phoneRegex.test(whatsapp)) {
        return res.status(400).json({
          error: "Invalid WhatsApp number format",
        });
      }

      // Upload resume to S3 if provided
      let resumeUrl = null;
      if (req.file) {
        try {
          const uploadResult = await uploadFileToS3(req.file);
          resumeUrl = uploadResult.Location; // Get just the URL from the upload result
          console.log("Resume uploaded successfully:", resumeUrl);
        } catch (error) {
          console.error("Error uploading resume:", error);
          return res.status(500).json({
            error: "Failed to upload resume",
            details: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Prepare email data
      const emailData = {
        name,
        fatherName,
        maritalStatus,
        address,
        highestQualification,
        specialization,
        workExperience,
        idNumber,
        email,
        country,
        phone,
        whatsapp: whatsapp || "Not provided",
        message: message || "No additional message provided",
        resumeUrl,
        submissionDate: new Date().toLocaleString(),
      };

      // Send email
      const emailSent = await sendEmail({
        to: "marketing.lelekart@gmail.com",
        subject: "New Career Application",
        template: EMAIL_TEMPLATES.CAREER_APPLICATION,
        data: emailData,
      });

      if (!emailSent) {
        console.error("Failed to send career application email");
        // Don't fail the request if email fails, just log it
      }

      // Return success response
      res.status(200).json({
        message: "Application submitted successfully",
        data: {
          name,
          email,
          submissionDate: emailData.submissionDate,
        },
      });
    } catch (error) {
      console.error("Error processing career application:", error);
      res.status(500).json({
        error: "Failed to process application",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Simple ping endpoint for deployment health checks
  app.get("/ping", (req, res) => {
    res.status(200).send("pong");
  });

  // More detailed health check endpoint
  app.get("/api/health", (req, res) => {
    // Check database connection
    try {
      pool
        .query("SELECT 1")
        .then(() => {
          res.status(200).json({
            status: "ok",
            message: "Server is running and database connection is working",
            timestamp: new Date().toISOString(),
          });
        })
        .catch((error) => {
          console.error("Health check - Database error:", error);
          res.status(500).json({
            status: "error",
            message: "Database connection failed",
            timestamp: new Date().toISOString(),
          });
        });
    } catch (error) {
      console.error("Health check failed:", error);
      res.status(500).json({
        status: "error",
        message: "Server error during health check",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Dashboard Statistics API
  app.get("/api/admin/dashboard/stats", async (req, res) => {
    try {
      // Check if the user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Check if this is an admin user or an admin who was impersonating but returned to admin
      const isAdmin = req.user.role === "admin";
      const wasAdminImpersonating =
        req.session && req.session.originalRole === "admin";

      if (!isAdmin && !wasAdminImpersonating) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      console.log("Dashboard stats request received");

      // Initialize default values in case of DB errors
      let totalUsers = 0;
      let totalProducts = 0;
      let totalOrders = 0;
      let totalRevenue = 0;

      try {
        // Get total users count
        const totalUsersResult = await pool.query(`
          SELECT COUNT(*) as count FROM users
        `);
        totalUsers = totalUsersResult.rows[0]?.count || 0;
      } catch (err) {
        console.error("Error fetching total users count:", err);
        // Continue with the default value
      }

      try {
        // Get total products count
        const totalProductsResult = await pool.query(`
          SELECT COUNT(*) as count FROM products WHERE deleted = false
        `);
        totalProducts = totalProductsResult.rows[0]?.count || 0;
      } catch (err) {
        console.error("Error fetching total products count:", err);
        // Continue with the default value
      }

      try {
        // Get total orders count
        const totalOrdersResult = await pool.query(`
          SELECT COUNT(*) as count FROM orders
        `);
        totalOrders = totalOrdersResult.rows[0]?.count || 0;
      } catch (err) {
        console.error("Error fetching total orders count:", err);
        // Continue with the default value
      }

      try {
        // Get total revenue
        const totalRevenueResult = await pool.query(`
          SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE status NOT IN ('cancelled', 'returned', 'refunded')
        `);
        totalRevenue = totalRevenueResult.rows[0]?.total || 0;
      } catch (err) {
        console.error("Error fetching total revenue:", err);
        // Continue with the default value
      }

      console.log("Dashboard stats retrieved successfully");

      return res.status(200).json({
        totalUsers: parseInt(totalUsers),
        totalProducts: parseInt(totalProducts),
        totalOrders: parseInt(totalOrders),
        totalRevenue: parseFloat(totalRevenue) || 0,
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      // Return empty stats instead of an error to prevent dashboard failure
      return res.status(200).json({
        totalUsers: 0,
        totalProducts: 0,
        totalOrders: 0,
        totalRevenue: 0,
      });
    }
  });

  // API endpoint to fetch recent activity for admin dashboard
  app.get("/api/admin/recent-activity", async (req, res) => {
    try {
      // Check if the user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Check if this is an admin user or an admin who was impersonating but returned to admin
      const isAdmin = req.user.role === "admin";
      const wasAdminImpersonating =
        req.session && (req.session as any).originalRole === "admin";

      if (!isAdmin && !wasAdminImpersonating) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      console.log("Fetching recent activity for admin dashboard");

      // Combine recent activities from multiple sources
      const activities = [];

      try {
        // Recent orders (last 5)
        const recentOrdersResult = await pool.query(`
          SELECT o.id, o.user_id, o.date as created_at, o.status, o.total, u.username 
          FROM orders o
          JOIN users u ON o.user_id = u.id
          ORDER BY o.date DESC LIMIT 5
        `);

        if (recentOrdersResult.rows.length > 0) {
          recentOrdersResult.rows.forEach((order) => {
            activities.push({
              id: `order-${order.id}`,
              type: "order",
              description: `New order #${order.id} placed by ${order.username}`,
              amount: order.total,
              status: order.status,
              timestamp: order.created_at,
            });
          });
        }
      } catch (err) {
        console.error("Error fetching recent orders:", err);
      }

      try {
        // Recent product approvals/rejections (last 5)
        const recentProductsResult = await pool.query(`
          SELECT p.id, p.name, p.approved, p.seller_id, p.created_at, u.username as seller_name
          FROM products p
          JOIN users u ON p.seller_id = u.id
          WHERE p.approved IS NOT NULL AND p.deleted = FALSE
          ORDER BY p.created_at DESC LIMIT 5
        `);

        if (recentProductsResult.rows.length > 0) {
          recentProductsResult.rows.forEach((product) => {
            activities.push({
              id: `product-${product.id}`,
              type: "product",
              description: `Product "${product.name}" by ${
                product.seller_name
              } was ${product.approved ? "approved" : "rejected"}`,
              status: product.approved ? "approved" : "rejected",
              timestamp: product.created_at,
            });
          });
        }
      } catch (err) {
        console.error("Error fetching recent products:", err);
      }

      // Recent user registrations (last 5)
      // Note: users table doesn't have a created_at column, we'll skip this part

      // Sort all activities by timestamp (newest first)
      if (activities.length > 0) {
        activities.sort((a, b) => {
          return (
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
        });
      }

      // Return the 10 most recent activities
      return res.status(200).json({
        activities: activities.slice(0, 10),
      });
    } catch (error) {
      console.error("Error fetching recent activity:", error);
      // Return an empty array instead of error to prevent dashboard failure
      return res.status(200).json({
        activities: [],
      });
    }
  });

  // Admin Product Statistics API - separate from dashboard stats
  app.get("/api/admin/product-stats", async (req, res) => {
    try {
      // Check if the user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // Check if this is an admin user or an admin who was impersonating but returned to admin
      const isAdmin = req.user.role === "admin";
      const wasAdminImpersonating =
        req.session && (req.session as any).originalRole === "admin";

      if (!isAdmin && !wasAdminImpersonating) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      console.log("Fetching product statistics");

      // Initialize default values in case of DB errors
      let totalProducts = 0;
      let approvedProducts = 0;
      let rejectedProducts = 0;
      let pendingProducts = 0;

      try {
        // Get total products count
        const totalProductsResult = await pool.query(`
          SELECT COUNT(*) as count FROM products WHERE deleted = false
        `);
        totalProducts = totalProductsResult.rows[0]?.count || 0;
      } catch (err) {
        console.error("Error fetching total products count:", err);
      }

      try {
        // Get approved products count
        const approvedProductsResult = await pool.query(`
          SELECT COUNT(*) as count FROM products WHERE approved = true AND deleted = false
        `);
        approvedProducts = approvedProductsResult.rows[0]?.count || 0;
      } catch (err) {
        console.error("Error fetching approved products count:", err);
      }

      try {
        // Get rejected products count
        const rejectedProductsResult = await pool.query(`
          SELECT COUNT(*) as count FROM products WHERE rejected = true AND deleted = false
        `);
        rejectedProducts = rejectedProductsResult.rows[0]?.count || 0;
      } catch (err) {
        console.error("Error fetching rejected products count:", err);
      }

      try {
        // Get pending products count (not approved and not rejected)
        const pendingProductsResult = await pool.query(`
          SELECT COUNT(*) as count FROM products WHERE approved = false AND rejected = false AND deleted = false
        `);
        pendingProducts = pendingProductsResult.rows[0]?.count || 0;
      } catch (err) {
        console.error("Error fetching pending products count:", err);
      }

      console.log(
        `Product statistics: Total=${totalProducts}, Approved=${approvedProducts}, Rejected=${rejectedProducts}, Pending=${pendingProducts}`
      );

      return res.status(200).json({
        total: parseInt(totalProducts),
        approved: parseInt(approvedProducts),
        rejected: parseInt(rejectedProducts),
        pending: parseInt(pendingProducts),
      });
    } catch (error) {
      console.error("Error fetching product statistics:", error);
      // Return empty stats instead of error response to prevent dashboard failure
      return res.status(200).json({
        total: 0,
        approved: 0,
        rejected: 0,
        pending: 0,
      });
    }
  });

  // Endpoint to get product approval counts
  app.get("/api/products/approval-counts", async (req, res) => {
    try {
      // Check if the user is authenticated and is an admin
      if (!req.isAuthenticated() || req.user.role !== "admin") {
        return res.status(401).json({ error: "Unauthorized" });
      }

      console.log("Fetching product approval counts");

      // Get approved products count using db.select()
      const approvedCount = await db
        .select({
          count: count(),
        })
        .from(products)
        .where(and(eq(products.approved, true), eq(products.deleted, false)))
        .then((result) => parseInt(result[0].count.toString()));

      // Get rejected products count
      const rejectedCount = await db
        .select({
          count: count(),
        })
        .from(products)
        .where(and(eq(products.rejected, true), eq(products.deleted, false)))
        .then((result) => parseInt(result[0].count.toString()));

      // Get pending products count (not approved and not rejected)
      const pendingCount = await db
        .select({
          count: count(),
        })
        .from(products)
        .where(
          and(
            eq(products.approved, false),
            eq(products.rejected, false),
            eq(products.deleted, false)
          )
        )
        .then((result) => parseInt(result[0].count.toString()));

      console.log(
        `Product counts - Approved: ${approvedCount}, Rejected: ${rejectedCount}, Pending: ${pendingCount}`
      );

      res.json({
        approved: approvedCount,
        rejected: rejectedCount,
        pending: pendingCount,
        total: approvedCount + rejectedCount + pendingCount,
      });
    } catch (error) {
      console.error("Error getting product approval counts:", error);
      res.status(500).json({ error: "Failed to get product approval counts" });
    }
  });

  // Notification routes
  app.get("/api/notifications", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const { notifications, total } = await storage.getUserNotifications(
        req.user.id,
        page,
        limit
      );
      res.json({ notifications, total, page, limit });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread/count", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const count = await storage.getUserUnreadNotificationsCount(req.user.id);
      res.json({ count });
    } catch (error) {
      console.error("Error fetching unread notifications count:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch unread notifications count" });
    }
  });

  app.put("/api/notifications/:id/read", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const id = parseInt(req.params.id);

      // Check if notification belongs to the user
      const notification = await storage.getNotification(id);
      if (!notification) {
        return res.status(404).json({ error: "Notification not found" });
      }

      if (notification.userId !== req.user.id) {
        return res.status(403).json({
          error: "You don't have permission to access this notification",
        });
      }

      const updatedNotification = await storage.markNotificationAsRead(id);
      res.json(updatedNotification);
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  });

  app.put("/api/notifications/read/all", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      await storage.markAllUserNotificationsAsRead(req.user.id);
      res.sendStatus(200);
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res
        .status(500)
        .json({ error: "Failed to mark all notifications as read" });
    }
  });

  app.delete("/api/notifications/:id", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const id = parseInt(req.params.id);

      // Check if notification belongs to the user
      const notification = await storage.getNotification(id);
      if (!notification) {
        return res.status(404).json({ error: "Notification not found" });
      }

      if (notification.userId !== req.user.id) {
        return res.status(403).json({
          error: "You don't have permission to delete this notification",
        });
      }

      await storage.deleteNotification(id);
      res.sendStatus(204);
    } catch (error) {
      console.error("Error deleting notification:", error);
      res.status(500).json({ error: "Failed to delete notification" });
    }
  });

  app.delete("/api/notifications", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      await storage.deleteAllUserNotifications(req.user.id);
      res.sendStatus(204);
    } catch (error) {
      console.error("Error deleting all notifications:", error);
      res.status(500).json({ error: "Failed to delete all notifications" });
    }
  });

  // Notifications API routes
  app.get("/api/notifications", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);

    try {
      const page = parseInt((req.query.page as string) || "1");
      const limit = parseInt((req.query.limit as string) || "20");

      const result = await storage.getUserNotifications(
        req.user.id,
        page,
        limit
      );

      res.json({
        notifications: result.notifications,
        total: result.total,
        page,
        limit,
      });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  });

  // Media Library API Endpoints
  app.get("/api/media", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const user = req.user;
      // Only admin, co-admin, or sellers can access the media library
      if (user.role !== "admin" && user.role !== "seller" && !user.isCoAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = (req.query.search as string) || undefined;

      const result = await storage.getMediaItems(page, limit, search);

      res.json(result);
    } catch (error) {
      console.error("Error fetching media items:", error);
      res.status(500).json({ error: "Failed to fetch media library items" });
    }
  });

  app.get("/api/media/:id", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const user = req.user;
      // Only admin, co-admin, or sellers can access the media library
      if (user.role !== "admin" && user.role !== "seller" && !user.isCoAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid media item ID" });
      }

      const mediaItem = await storage.getMediaItemById(id);

      if (!mediaItem) {
        return res.status(404).json({ error: "Media item not found" });
      }

      res.json(mediaItem);
    } catch (error) {
      console.error(`Error fetching media item:`, error);
      res.status(500).json({ error: "Failed to fetch media item" });
    }
  });

  // Upload media item - requires authentication
  app.post("/api/media", upload.array("file", 10), async (req, res) => {
    try {
      console.log("Media upload request received");
      console.log("Request headers:", req.headers);
      console.log("Request body keys:", Object.keys(req.body));
      console.log(
        "Request files:",
        req.files
          ? `Found ${Array.isArray(req.files) ? req.files.length : "unknown"} files`
          : "No files found"
      );

      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const user = req.user;
      console.log(
        `User: ${user.username}, Role: ${user.role}, Co-Admin: ${user.isCoAdmin ? "Yes" : "No"}`
      );

      // Only admin, co-admin, or sellers can upload to the media library
      if (user.role !== "admin" && user.role !== "seller" && !user.isCoAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Check if files were uploaded
      if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
        console.error("No files uploaded in request");
        return res.status(400).json({ error: "No files uploaded" });
      }

      // Get alt text and tags from request body
      const alt = (req.body.alt as string) || "";
      const tags = (req.body.tags as string) || "";

      console.log(`Alt text: "${alt}", Tags: "${tags}"`);

      const uploadedFiles = req.files as Express.Multer.File[];
      console.log(`Processing ${uploadedFiles.length} files for upload`);

      const uploadedItems = [];

      // Process each file
      for (const file of uploadedFiles) {
        console.log(
          `Processing file: ${file.originalname}, size: ${file.size}, type: ${file.mimetype}`
        );

        try {
          // Upload file to S3
          const uploadResult = await uploadFileToS3(file);
          console.log(`S3 upload successful: ${uploadResult.Location}`);

          // Create media library item
          const mediaItem = await storage.createMediaItem({
            filename: file.originalname.split(".")[0], // Base filename without extension
            originalName: file.originalname,
            url: uploadResult.Location,
            mimeType: file.mimetype,
            size: file.size,
            alt,
            tags,
            uploadedBy: user.id,
          });

          console.log(`Media item created with ID: ${mediaItem.id}`);
          uploadedItems.push(mediaItem);
        } catch (fileError) {
          console.error(
            `Error processing file ${file.originalname}:`,
            fileError
          );
          // Return the S3 or storage error to the frontend for debugging
          return res.status(500).json({
            error: `Failed to upload file: ${file.originalname}. ${fileError instanceof Error ? fileError.message : fileError}`,
          });
        }
      }

      if (uploadedItems.length === 0) {
        console.error("Failed to upload any files (all failed)");
        return res.status(500).json({ error: "Failed to upload any files" });
      }

      // If single file upload, maintain backward compatibility
      if (uploadedItems.length === 1) {
        console.log(
          `Returning single uploaded item with ID: ${uploadedItems[0].id}`
        );
        res.status(201).json(uploadedItems[0]);
      } else {
        console.log(`Returning ${uploadedItems.length} uploaded items`);
        res.status(201).json({ items: uploadedItems });
      }
    } catch (error) {
      console.error("Error uploading media items:", error);
      // Return the real error message for debugging
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload media items",
      });
    }
  });

  // Delete media item
  app.delete("/api/media/:id", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const user = req.user;
      // Only admin, co-admin, or the user who uploaded can delete media items
      if (user.role !== "admin" && !user.isCoAdmin) {
        // If the user is not admin or co-admin, they can only delete their own uploads
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
          return res.status(400).json({ error: "Invalid media item ID" });
        }

        const mediaItem = await storage.getMediaItemById(id);
        if (!mediaItem) {
          return res.status(404).json({ error: "Media item not found" });
        }

        if (mediaItem.uploadedBy !== user.id) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid media item ID" });
      }

      const mediaItem = await storage.getMediaItemById(id);
      if (!mediaItem) {
        return res.status(404).json({ error: "Media item not found" });
      }

      // Delete file from S3
      try {
        await deleteFile(mediaItem.url);
      } catch (error) {
        console.error("Warning: Failed to delete file from S3:", error);
        // Continue with database deletion even if S3 deletion fails
      }

      // Delete from database
      await storage.deleteMediaItem(id);

      res.status(200).json({ message: "Media item deleted successfully" });
    } catch (error) {
      console.error("Error deleting media item:", error);
      res.status(500).json({ error: "Failed to delete media item" });
    }
  });

  // Helper function to generate invoice HTML
  async function generateInvoiceHtml(data: any): Promise<string> {
    try {
      // Register Handlebars helpers
      handlebars.registerHelper("formatMoney", function (value: number) {
        return value.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, "$&,");
      });

      // Helper function to convert number to Indian Rupee words
      handlebars.registerHelper("amountInWords", function (amount: number) {
        const ones = [
          "",
          "One",
          "Two",
          "Three",
          "Four",
          "Five",
          "Six",
          "Seven",
          "Eight",
          "Nine",
        ];
        const tens = [
          "",
          "",
          "Twenty",
          "Thirty",
          "Forty",
          "Fifty",
          "Sixty",
          "Seventy",
          "Eighty",
          "Ninety",
        ];
        const teens = [
          "Ten",
          "Eleven",
          "Twelve",
          "Thirteen",
          "Fourteen",
          "Fifteen",
          "Sixteen",
          "Seventeen",
          "Eighteen",
          "Nineteen",
        ];

        function convertLessThanThousand(n: number): string {
          if (n === 0) return "";

          let words = "";

          // Handle hundreds
          if (n >= 100) {
            words += ones[Math.floor(n / 100)] + " Hundred ";
            n %= 100;
          }

          // Handle tens and ones
          if (n > 0) {
            if (n < 10) {
              words += ones[n];
            } else if (n < 20) {
              words += teens[n - 10];
            } else {
              words += tens[Math.floor(n / 10)];
              if (n % 10 > 0) {
                words += " " + ones[n % 10];
              }
            }
          }

          return words.trim();
        }

        if (amount === 0) return "Zero Rupees";

        let rupees = Math.floor(amount);
        const paise = Math.round((amount - rupees) * 100);

        let words = "";

        // Handle crores
        if (rupees >= 10000000) {
          const crore = Math.floor(rupees / 10000000);
          words += convertLessThanThousand(crore) + " Crore ";
          rupees %= 10000000;
        }

        // Handle lakhs
        if (rupees >= 100000) {
          const lakh = Math.floor(rupees / 100000);
          words += convertLessThanThousand(lakh) + " Lakh ";
          rupees %= 100000;
        }

        // Handle thousands
        if (rupees >= 1000) {
          const thousand = Math.floor(rupees / 1000);
          words += convertLessThanThousand(thousand) + " Thousand ";
          rupees %= 1000;
        }

        // Handle remaining amount
        if (rupees > 0) {
          words += convertLessThanThousand(rupees);
        }

        // Add "Rupees" if there's any amount
        if (words) {
          words += " Rupees";
        }

        // Add paise if any
        if (paise > 0) {
          words += " and " + convertLessThanThousand(paise) + " Paise";
        }

        return words.trim();
      });

      handlebars.registerHelper(
        "calculateGST",
        function (price: number, quantity: number, gstRate: number) {
          const totalPrice = price * quantity;
          // GST is already included in the price, so we need to extract it
          const basePrice =
            gstRate > 0 ? (totalPrice * 100) / (100 + gstRate) : totalPrice;
          const gstAmount = totalPrice - basePrice;
          return gstAmount.toFixed(2);
        }
      );

      handlebars.registerHelper(
        "calculateTaxableValue",
        function (price: number, quantity: number, gstRate: number) {
          const totalPrice = price * quantity;
          const taxableValue = totalPrice / (1 + gstRate / 100);
          return taxableValue.toFixed(2);
        }
      );

      handlebars.registerHelper(
        "calculateTaxes",
        function (
          price: number,
          quantity: number,
          gstRate: number,
          buyerState: any,
          sellerState: string
        ) {
          console.log("Buyer state received:", buyerState); // Debug log
          console.log("Seller state received:", sellerState); // Debug log
          const totalPrice = price * quantity;
          const basePrice =
            gstRate > 0 ? totalPrice / (1 + gstRate / 100) : totalPrice;
          const taxAmount = totalPrice - basePrice;

          // Helper function to normalize state names
          const normalizeState = (state: string): string => {
            if (!state) return "";

            // Convert to lowercase and remove special characters
            const normalized = state
              .trim()
              .toLowerCase()
              .replace(/[^a-z]/g, "");

            // Map of common state abbreviations to full names
            const stateMap: { [key: string]: string } = {
              hp: "himachalpradesh",
              mp: "madhyapradesh",
              up: "uttarpradesh",
              ap: "andhrapradesh",
              tn: "tamilnadu",
              ka: "karnataka",
              mh: "maharashtra",
              gj: "gujarat",
              rj: "rajasthan",
              wb: "westbengal",
              pb: "punjab",
              hr: "haryana",
              kl: "kerala",
              or: "odisha",
              br: "bihar",
              jh: "jharkhand",
              ct: "chhattisgarh",
              ga: "goa",
              mn: "manipur",
              ml: "meghalaya",
              tr: "tripura",
              ar: "arunachalpradesh",
              nl: "nagaland",
              mz: "mizoram",
              sk: "sikkim",
              dl: "delhi",
              ch: "chandigarh",
              py: "pondicherry",
              an: "andamanandnicobar",
              dn: "dadraandnagarhaveli",
              dd: "damananddiu",
              ld: "lakshadweep",
              jk: "jammukashmir",
              la: "ladakh",
              ut: "uttarakhand",
              ts: "telangana",
            };

            // Check if the normalized state is an abbreviation
            return stateMap[normalized] || normalized;
          };

          // Normalize both buyer and seller states
          const normalizedBuyerState = normalizeState(String(buyerState || ""));
          const normalizedSellerState = normalizeState(sellerState || "");

          // If buyer and seller are from the same state, split GST into CGST and SGST
          if (
            normalizedBuyerState &&
            normalizedSellerState &&
            normalizedBuyerState === normalizedSellerState
          ) {
            const halfAmount = taxAmount / 2;
            return `SGST @ ${gstRate / 2}% i.e. ${halfAmount.toFixed(
              2
            )}<br>CGST @ ${gstRate / 2}% i.e. ${halfAmount.toFixed(2)}`;
          } else {
            // If different states or state info not available, show as IGST
            return `IGST @ ${gstRate}% i.e. ${taxAmount.toFixed(2)}`;
          }
        }
      );

      // Function to convert image URL to base64
      async function getBase64FromUrl(url: string): Promise<string> {
        try {
          const response = await fetch(url);
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString("base64");
          const mimeType = response.headers.get("content-type") || "image/png";
          return `data:${mimeType};base64,${base64}`;
        } catch (error) {
          console.error("Error converting image to base64:", error);
          return ""; // Return empty string if conversion fails
        }
      }

      // Convert logo and signature images to base64
      const logoUrl =
        "https://drive.google.com/uc?export=view&id=1LTlPnVbtn6oiDsYoVX7-umnZH5JnWZBN";

      const signatureUrl =
        data.seller?.pickupAddress?.authorizationSignature ||
        "https://drive.google.com/uc?export=view&id=1NC3MTl6qklBjamL3bhjRMdem6rQ0mB9F";

      const [logoBase64, signatureBase64] = await Promise.all([
        getBase64FromUrl(logoUrl),
        getBase64FromUrl(signatureUrl),
      ]);

      // Generate QR code with invoice details
      const qrData = `https://lelekart.in/orders/${data.order.id}`;

      const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
        errorCorrectionLevel: "H",
        margin: 1,
        width: 150,
      });

      // Add QR code to the data
      data.qrCodeDataUrl = qrCodeDataUrl;

      // Register QR code helper
      handlebars.registerHelper("qrCode", function () {
        return new handlebars.SafeString(
          `<img src="${qrCodeDataUrl}" alt="Invoice QR Code" style="width: 150px; height: 150px;">`
        );
      });

      // Register 'gt' helper for greater-than comparisons
      handlebars.registerHelper("gt", function (a, b) {
        return a > b;
      });

      // Invoice template with fixed header alignment
      const invoiceTemplate = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tax Invoice</title>
  <style>
    @page {
      size: A4;
      margin: 5mm;
    }
    
    body {
      font-family: Arial, sans-serif;
      font-size: 11px;
      line-height: 1.3;
      color: #333;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    
    .container {
      max-width: 100%;
      margin: 0 auto;
      border: 1px solid #000;
      page-break-inside: avoid;
    }
    
    .invoice-header {
      padding: 10px;
      background-color: #ffffff;
      margin-bottom: 0;
      border-bottom: 1px solid #eee;
      page-break-inside: avoid;
      display: table;
      width: 100%;
      box-sizing: border-box;
    }
    
    .header-left {
      display: table-cell;
      width: 35%;
      vertical-align: top;
      padding-top: 20px;
    }
    
    .header-right {
      display: table-cell;
      width: 65%;
      vertical-align: top;
      text-align: right;
    }
    
    .invoice-logo {
      max-height: 75px;
      margin-top: 10px;
      height: 60px;
      max-width: 300px;
      object-fit: contain;
      margin-bottom: 15px;
    }
    
    .invoice-title {
      font-weight: bold;
      font-size: 16px;
      color: #2c3e50;
      margin: 0 0 10px 0;
      text-align: right;
    }
    
    .header-info-table {
      border-collapse: collapse;
      float: right;
      clear: both;
      margin-top: 0;
    }
    
    .header-info-table td {
      padding: 2px 0;
      font-size: 11px;
      line-height: 1.3;
    }
    
    .header-info-table .label-col {
      text-align: left;
      padding-right: 15px;
      white-space: nowrap;
      min-width: 80px;
    }
    
    .header-info-table .value-col {
      text-align: left;
      white-space: nowrap;
    }
    
    .address-section {
      overflow: hidden;
      font-size: 11px;
      padding: 8px;
      page-break-inside: avoid;
    }
    
    .bill-to, .ship-to {
      width: 48%;
      padding: 8px;
      box-sizing: border-box;
      min-height: 100px;
      vertical-align: top;
    }
    
    .bill-to {
      float: left;
    }
    
    .ship-to {
      float: right;
    }
    
    .business-section {
      overflow: hidden;
      font-size: 11px;
      padding: 8px;
      page-break-inside: avoid;
    }
    
    .bill-from, .ship-from {
      width: 48%;
      padding: 8px;
      box-sizing: border-box;
      min-height: 90px;
      vertical-align: top;
    }
    
    .bill-from {
      float: left;
    }
    
    .ship-from {
      float: right;
    }
    
    table.items {
      width: 100%;
      border-collapse: collapse;
      border-bottom: 1px solid #000;
      font-size: 11px;
      page-break-inside: avoid;
    }
    
    table.items th {
      background-color: #f8f9fa;
      border: 1px solid #000;
      padding: 6px 4px;
      text-align: center;
      font-weight: bold;
      font-size: 11px;
      color: #2c3e50;
    }
    
    table.items td {
      border: 1px solid #000;
      padding: 6px 4px;
      text-align: center;
      font-size: 11px;
      vertical-align: top;
    }
    
    .description-cell {
      text-align: left !important;
      max-width: 180px;
      word-wrap: break-word;
    }
    
    .amount-in-words {
      margin: 0;
      padding: 8px;
      background-color: #ffffff;
      font-family: 'Arial', sans-serif;
      font-size: 11px;
      line-height: 1.3;
      color: #2c3e50;
      page-break-inside: avoid;
    }
    
    .signature-section {
      background-color: #ffffff;
      padding: 8px;
      border-radius: 4px;
      overflow: hidden;
      page-break-inside: avoid;
      margin-bottom: 2px;
    }
    
    .signature-content {
      width: 100%;
      overflow: hidden;
    }
    
    .qr-section {
      float: left;
      width: 30%;
      text-align: left;
    }
    
    .qr-section img,
    .qr-section svg {
      max-width: 70px;
      max-height: 70px;
    }
    
    .signature-box {
      float: right;
      width: 60%;
      text-align: right;
      font-size: 11px;
      color: #2c3e50;
    }
    
    .signature-box .bold {
      font-size: 12px;
      margin-bottom: 4px;
      font-weight: 600;
      color: #000000;
    }
    
    .signature-box img {
      height: 40px;
      margin: 6px 0;
      display: block;
      margin-left: auto;
      object-fit: contain;
    }
    
    .bold {
      font-weight: 600;
      color: #2c3e50;
    }
    
    .taxes-cell {
      font-size: 10px;
      line-height: 1.2;
    }

    /* Clear floats */
    .clearfix::after {
      content: "";
      display: table;
      clear: both;
    }

    /* Print-specific styles */
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      
      .container {
        page-break-inside: avoid;
      }
      
      table.items {
        page-break-inside: avoid;
      }
      
      .signature-section {
        page-break-inside: avoid;
      }
      
      .header-info-table {
        page-break-inside: avoid;
      }
    }

    /* Font loading fallbacks for consistent rendering */
    @font-face {
      font-family: 'Arial';
      src: local('Arial'), local('Helvetica Neue'), local('Helvetica'), local('sans-serif');
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Fixed Header Section with proper alignment -->
    <div class="invoice-header">
      <div class="header-left">
        <img src="${logoBase64}" alt="LeleKart Logo" class="invoice-logo">
      </div>
      
      <div class="header-right">
        <div class="invoice-title">Tax Invoice/Bill of Supply/Cash Memo</div>
        
        <table class="header-info-table">
          <tr>
            <td class="label-col bold">Invoice Date:</td>
            <td class="value-col">{{formatDate order.date " DD MMM YYYY,dddd"}}</td>
          </tr>
          <tr>
            <td class="label-col bold">Invoice No:</td>
            <td class="value-col">LK-{{order.id}}</td>
          </tr>
          <tr>
            <td class="label-col bold">Order No:</td>
            <td class="value-col">{{order.orderNumber}}</td>
          </tr>
        </table>
      </div>
    </div>
    
    <div class="address-section clearfix">
      <div class="bill-to">
        <div class="bold">Billing Address</div>
        <br>
        {{#if order.shippingDetails}}
          <div>{{user.name}}</div>
          <div>{{order.shippingDetails.address}}</div>
          {{#if order.shippingDetails.address2}}<div>{{order.shippingDetails.address2}}</div>{{/if}}
          <div>{{order.shippingDetails.city}}, {{order.shippingDetails.state}} {{order.shippingDetails.zipCode}}</div>
        {{else}}
          <div>{{user.name}}</div>
          <div>{{user.email}}</div>
          <div>Address details not available</div>
        {{/if}}
      </div>
      <div class="ship-to">
        <div class="bold">Shipping Address</div>
        <br>
        {{#if order.shippingDetails}}
          <div>{{user.name}}</div>
          <div>{{order.shippingDetails.address}}</div>
          {{#if order.shippingDetails.address2}}<div>{{order.shippingDetails.address2}}</div>{{/if}}
          <div>{{order.shippingDetails.city}}, {{order.shippingDetails.state}} {{order.shippingDetails.zipCode}}</div>
        {{else}}
          <div>{{user.name}}</div>
          <div>{{user.email}}</div>
          <div>Address details not available</div>
        {{/if}}
      </div>
    </div>
    
    <div class="business-section clearfix">
      <div class="bill-from">
        <div class="bold">Bill From</div>
        <br>
        {{#if seller.billingAddress}}
          <div class="bold">{{seller.pickupAddress.businessName}}</div>
          <div>{{seller.billingAddress.line1}}</div>
          {{#if seller.billingAddress.line2}}<div>{{seller.billingAddress.line2}}</div>{{/if}}
          <div>{{seller.billingAddress.city}}, {{seller.billingAddress.state}} {{seller.billingAddress.pincode}}</div>
          <div>GSTIN: {{seller.taxInformation.gstin}}</div>
          <div>PAN: {{seller.taxInformation.panNumber}}</div>
        {{else}}
          <div class="bold">{{seller.taxInformation.businessName}}</div>
          <div>{{seller.address}}</div>
          <div>Mumbai, Maharashtra 400001</div>
          {{#if seller.taxInformation.gstin}}<div>GSTIN: {{seller.taxInformation.gstin}}</div>{{/if}}
        {{/if}}
      </div>
      <div class="ship-from">
        <div class="bold">Ship From</div>
        <br>
        {{#if seller.pickupAddress}}
          <div class="bold">{{seller.pickupAddress.businessName}}</div>
          <div>{{seller.pickupAddress.line1}}</div>
          {{#if seller.pickupAddress.line2}}<div>{{seller.pickupAddress.line2}}</div>{{/if}}
          <div>{{seller.pickupAddress.city}}, {{seller.pickupAddress.state}} {{seller.pickupAddress.pincode}}</div>
          <div>GSTIN: {{seller.taxInformation.gstin}}</div>
          <div>PAN: {{seller.taxInformation.panNumber}}</div>
        {{else}}
          <div class="bold">{{seller.taxInformation.businessName}}</div>
          <div>Warehouse Address: {{seller.address}}</div>
          <div>Mumbai, Maharashtra 400001</div>
          {{#if seller.taxInformation.gstin}}<div>GSTIN: {{seller.taxInformation.gstin}}</div>{{/if}}
        {{/if}}
      </div>
    </div>
    
    <table class="items">
      <thead>
        <tr>
          <th>Sr No</th>
          <th>Description</th>
          <th>Qty</th>
          <th>MRP</th>
          <th>Discount</th>
          <th>Taxable Value</th>
          <th>Taxes</th>
          <th>Delivery Charges</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        {{#each order.items}}
        <tr>
          <td>{{add @index 1}}</td>
          <td class="description-cell">{{this.product.name}}</td>
          <td>{{this.quantity}}</td>
          <td>{{formatMoney (multiply this.product.mrp this.quantity)}}</td>
          <td>{{formatMoney (multiply (subtract this.product.mrp this.price) this.quantity)}}</td>
          <td>{{calculateTaxableValue this.price this.quantity this.product.gstRate}}</td>
          <td class="taxes-cell">{{{calculateTaxes this.price this.quantity this.product.gstRate ../order.shippingDetails.state ../seller.pickupAddress.state}}}</td>
          <td>{{#if this.product.deliveryCharges}}{{#if (gt this.product.deliveryCharges 0)}}₹{{multiply this.product.deliveryCharges this.quantity}}{{else}}Free{{/if}}{{else}}Free{{/if}}</td>
          <td>{{formatMoney (add (multiply this.price this.quantity) (multiply this.product.deliveryCharges this.quantity))}}</td>
        </tr>
        {{/each}}
      </tbody>
    </table>
    
    <div class="amount-in-words">
      <span class="bold">Amount in words:</span>
      <span style="font-style: italic; margin-left: 5px;">{{amountInWords total}} Only</span>
    </div>
    
    <div class="signature-section">
      <div class="signature-content clearfix">
        <div class="qr-section">
          <div style="margin-bottom: 5px; font-size: 10px; color: #666;">Scan to verify invoice</div>
          <div style="margin-top: 10px;">
            {{{qrCode}}}
          </div>
        </div>
        <div class="signature-box">
          {{#if seller.pickupAddress.businessName}}
            <div class="bold">{{seller.pickupAddress.businessName}}</div>
          {{else}}
            <div class="bold">Lele Kart Retail Private Limited</div>
          {{/if}}
          <img 
            src="${signatureBase64}"
            alt="Authorized Signature"
          />
          <div class="bold">Authorized Signatory</div>
        </div>
      </div>
      <!-- Declaration section inside container -->
      <div style="padding: 12px; font-size: 10px; line-height: 1.4; color: #333; background-color: #f9f9f9; border-top: 1px solid #000; margin-top: 2px; max-width: 800px;">
        <div style="display: flex; justify-content: space-between; gap: 20px;">
          <div style="flex: 1; padding-right: 15px;">
            <div style="font-weight: bold; font-size: 11px; margin-bottom: 6px; color: #2c3e50;">Declaration</div>
            <div style="margin-bottom: 12px; text-align: justify;">The goods sold as part of this shipment are intended for end-user consumption and are not for retail sale distribution.</div>
            
            <div style="font-weight: bold; font-size: 11px; margin-bottom: 6px; color: #2c3e50;">Return Policy:</div>
            <div style="text-align: justify;">If the item is defective or not as described, you may return it during delivery. You may also request a return within 02 days of delivery for defective items or items different from what you ordered. All returned items must be complete with freebies, undamaged, and unopened if returned for being different from what was ordered according to our policy.</div>
          </div>
          
          <div style="flex: 1; padding-left: 15px;">
            <div style="font-weight: bold; font-size: 11px; margin-bottom: 6px; color: #2c3e50;">Regd. Office</div>
            <div style="margin-bottom: 12px; text-align: justify;">Building no 2072, Chandigarh Royale City, Bollywood Gully Banur, SAS Nagar, Mohali, Punjab, India - 140601</div>
            
            <div style="font-weight: bold; font-size: 11px; margin-bottom: 6px; color: #2c3e50;">Contact us</div>
            <div style="text-align: justify;">For any questions, please call our customer care at +91 98774 54036. You can also use the Contact Us section in our App or visit www.lelekart.com/Contact-us for assistance and support regarding your orders.</div>
          </div>
        </div>
    </div>
    </div>
  </div>
</body>
</html>`;

      handlebars.registerHelper("calculateTotal", function (items) {
        return items.reduce(
          (sum: number, item: any) => sum + item.price * item.quantity,
          0
        );
      });

      // Additional helpers for math operations
      handlebars.registerHelper("multiply", function (a: number, b: number) {
        return a * b;
      });

      handlebars.registerHelper("add", function (a: number, b: number) {
        return a + b;
      });

      handlebars.registerHelper("subtract", function (a: number, b: number) {
        return a - b;
      });

      // Add formatDate helper if not already present
      handlebars.registerHelper(
        "formatDate",
        function (date: string, format: string) {
          // This is a placeholder - you'll need to implement proper date formatting
          // or use a library like moment.js or date-fns
          const d = new Date(date);
          return d.toLocaleDateString("en-IN", {
            weekday: "long",
            year: "numeric",
            month: "short",
            day: "2-digit",
          });
        }
      );

      // Register 'gt' helper for greater-than comparisons
      handlebars.registerHelper("gt", function (a, b) {
        return a > b;
      });

      const template = handlebars.compile(invoiceTemplate);
      return template(data);
    } catch (error) {
      console.error("Error generating invoice HTML:", error);
      throw error;
    }
  }
  // Helper function to generate shipping slip HTML
  async function generateShippingSlipHtml(data: any): Promise<string> {
    try {
      // Define the shipping slip template - Flipkart style packing slip
      const shippingSlipTemplate = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Packing Slip</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            font-size: 12px;
            line-height: 1.4;
            color: #000;
            margin: 20px;
            padding: 0;
          }
          
          .container {
            max-width: 800px;
            margin: 0 auto;
            border: 2px solid #000;
          }
          
          .slip-title {
            text-align: center;
            font-weight: bold;
            font-size: 18px;
            padding: 10px;
           
          }
          
          .seller-info {
            display: flex;
            justify-content: space-between;
            padding: 10px;
        
          }
          
          .seller-details {
            width: 70%;
          }
          
          .qr-code {
            width: 30%;
            text-align: right;
          }
          
          .address-section {
            display: flex;
            border-bottom: 1px solid #000;
          }
            
          
          .ship-from, .ship-to {
            width: 50%;
            padding: 12px;
            box-sizing: border-box;
          }
          
          .ship-from {
            text-align: right;
            float: right;
          }
          
          .order-details {
            display: flex;
            border-bottom: 1px solid #000;
          }
          
          .order-left, .order-right {
            width: 50%;
            padding: 10px;
          }
          
          .order-left {
            border-right: 1px solid #000;
          }
          
          table {
            width: 100%;
            border-collapse: collapse;
          }
          
          table.items {
            border-bottom: 1px solid #000;
          }
          
          table.items th, table.items td {
            border: 1px solid #000;
            padding: 6px;
            text-align: center;
          }
          
          table.items th {
            background-color: #f2f2f2;
          }
          
          .summary {
            text-align: center;
            padding: 10px;
            border-bottom: 1px solid #000;
            font-weight: bold;
          }
          
          .totals-section {
            border-bottom: 1px solid #000;
            padding: 10px;
          }
          
          .signature-section {
            display: flex;
            padding: 10px;
            
            margin-bottom: 2px;
          }
          
          .signature {
            width: 50%;
          }
          
          .authorized-signature {
            margin-top: 60px;
            border-top: 1px solid #000;
            width: 150px;
            text-align: center;
            padding-top: 5px;
          }
          
          .instructions {
            font-size: 10px;
            padding: 10px;
            border-bottom: 1px solid #000;
          }
          
          .footer {
            display: flex;
            align-items: center;
            padding: 10px;
          }
          
          .footer-text {
            width: 75%;
            font-size: 10px;
          }
          
          .footer-logo {
            width: 25%;
            text-align: right;
          }
          
          .barcode {
            font-family: monospace;
            text-align: center;
            padding: 10px;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
            margin: 10px 0;
          }
          
          .bold {
            font-weight: bold;
          }
          
          .item-list-title {
            font-weight: bold;
            text-align: left;
            padding: 5px 10px;
            border-bottom: 1px solid #000;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="slip-title">
            PACKING SLIP
          </div>
          
          <div class="seller-info">
            <div class="seller-details">
              <div class="bold">Seller: {{#if businessDetails.businessName}}{{businessDetails.businessName}}{{else}}{{seller.username}}{{/if}}</div>
              <div>{{#if businessDetails.address}}{{businessDetails.address}}{{else}}Please update your business address{{/if}}</div>
              {{#if businessDetails.gstNumber}}<div>GSTIN: {{businessDetails.gstNumber}}</div>{{/if}}
            </div>
            <div class="qr-code">
              <!-- This would typically be a QR code image -->
              QR Code #{{mainOrder.orderNumber}}
            </div>
          </div>
          
          <div class="address-section">
            <div class="ship-from">
              <div class="bold">Ship From</div>
              <div>{{#if businessDetails.businessName}}{{businessDetails.businessName}}{{else}}{{seller.username}}{{/if}}</div>
              {{#if businessDetails.address}}
                <div>{{businessDetails.address}}</div>
                <div>{{businessDetails.city}}, {{businessDetails.state}} {{businessDetails.pincode}}</div>
                <div>{{businessDetails.country}}</div>
              {{else}}
                <div>Please update your business address in settings</div>
              {{/if}}
            </div>
            <div class="ship-to">
              <div class="bold">Ship To</div>
              {{#if shippingAddress}}
                <div>{{buyer.name}}</div>
                <div>{{shippingAddress.address1}}</div>
                {{#if shippingAddress.address2}}<div>{{shippingAddress.address2}}</div>{{/if}}
                <div>{{shippingAddress.city}}, {{shippingAddress.state}} {{shippingAddress.pincode}}</div>
                <div>{{shippingAddress.country}}</div>
                {{#if shippingAddress.phone}}<div>Phone: {{shippingAddress.phone}}</div>{{/if}}
              {{else}}
                <div>{{buyer.name}}</div>
                <div>Address details not available</div>
              {{/if}}
            </div>
          </div>
          
          <div class="order-details">
            <div class="order-left">
              <div>Order Date: {{mainOrder.formattedDate}}</div>
              <div>Seller Order ID: SO-{{sellerOrder.id}}</div>
            </div>
            <div class="order-right">
              <div>Order ID: {{mainOrder.orderNumber}}</div>
              <div>Generated On: {{currentDate}}</div>
            </div>
          </div>
          
          <div class="item-list-title">
            Items to Ship
          </div>
          
          <table class="items">
            <thead>
              <tr>
                <th>S.No</th>
                <th>Item</th>
                <th>SKU</th>
                <th>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {{#each sellerOrder.items}}
              <tr>
                <td>{{add @index 1}}</td>
                <td style="text-align: left">{{this.product.name}}</td>
                <td>{{#if this.product.sku}}{{this.product.sku}}{{else}}SKU-{{this.product.id}}{{/if}}</td>
                <td>{{this.quantity}}</td>
              </tr>
              {{/each}}
            </tbody>
          </table>
          
          <div class="barcode">
            *LE-{{mainOrder.id}}-SO-{{sellerOrder.id}}*
          </div>
          
          <div class="summary">
            Shipping Instructions
          </div>
          
          <div class="totals-section">
            <div>
              {{#if mainOrder.shippingDetails.notes}}
                <div class="bold">Special Instructions:</div>
                <div>{{mainOrder.shippingDetails.notes}}</div>
              {{else}}
                <div>Standard shipping. No special instructions.</div>
              {{/if}}
            </div>
          </div>
          
          <div class="signature-section">
            <div class="signature">
              <div class="bold">LeleKart Retail Private Limited</div>
              <div class="authorized-signature">
                Authorized Signatory
              </div>
            </div>
          </div>
          
          <div class="instructions">
            <div class="bold">Instructions for Packaging:</div>
            <ol>
              <li>Please verify all items are included and match the order details before shipping.</li>
              <li>Pack items securely to prevent damage during transit using appropriate packaging materials.</li>
              <li>Include any product documentation, warranty cards, or accessories as applicable.</li>
              <li>Affix shipping label securely to the outside of the package.</li>
              <li>Retain a copy of this packing slip for your records.</li>
            </ol>
          </div>
          
          <div class="footer">
            <div class="footer-text">
              <div>This is a computer-generated document. No signature required.</div>
              <div>For any assistance, contact: sellers@lelekart.com | Helpline: 1800-123-4567</div>
            </div>
            <div class="footer-logo">
              <div style="font-weight: bold; font-size: 14px; color: #2874f0;">LeleKart</div>
            </div>
          </div>
        </div>
      </body>
      </html>
      `;

      const template = handlebars.compile(shippingSlipTemplate);
      return template(data);
    } catch (error) {
      console.error("Error generating shipping slip HTML:", error);
      throw error;
    }
  }

  // Setup WebSocket server for real-time notifications
  setupWebSocketServer(httpServer);

  return httpServer;
}

import { db } from "../db";
import {
  affiliateMarketing,
  insertAffiliateMarketingSchema,
} from "../../shared/schema";
import { eq, ilike } from "drizzle-orm";
import { Request, Response } from "express";

// discountPercentage is now required and handled by the schema

export async function getAllAffiliates(req: Request, res: Response) {
  try {
    // If code is provided as a query param, return the affiliate by code (case-insensitive)
    if (req.query.code) {
      const code = String(req.query.code).toLowerCase();
      const [affiliate] = await db
        .select()
        .from(affiliateMarketing)
        .where(ilike(affiliateMarketing.code, code));
      if (!affiliate)
        return res.status(404).json({ error: "Affiliate not found" });
      return res.json(affiliate);
    }
    const affiliates = await db.select().from(affiliateMarketing);
    res.json(affiliates);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch affiliates" });
  }
}

export async function createAffiliate(req: Request, res: Response) {
  try {
    const parsed = insertAffiliateMarketingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid data", details: parsed.error.errors });
    }
    // discountPercentage is required and included in parsed.data
    const [created] = await db
      .insert(affiliateMarketing)
      .values(parsed.data)
      .returning();
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: "Failed to create affiliate" });
  }
}

export async function updateAffiliate(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const parsed = insertAffiliateMarketingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: "Invalid data", details: parsed.error.errors });
    }
    // discountPercentage is required and included in parsed.data
    const [updated] = await db
      .update(affiliateMarketing)
      .set(parsed.data)
      .where(eq(affiliateMarketing.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Affiliate not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update affiliate" });
  }
}

export async function deleteAffiliate(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    const [deleted] = await db
      .delete(affiliateMarketing)
      .where(eq(affiliateMarketing.id, id))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Affiliate not found" });
    res.json(deleted);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete affiliate" });
  }
}

export async function incrementAffiliateUsage(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });
    // Fetch current usageCount
    const [affiliate] = await db
      .select()
      .from(affiliateMarketing)
      .where(eq(affiliateMarketing.id, id));
    if (!affiliate)
      return res.status(404).json({ error: "Affiliate not found" });
    const newUsageCount = (affiliate.usageCount || 0) + 1;
    const [updated] = await db
      .update(affiliateMarketing)
      .set({ usageCount: newUsageCount })
      .where(eq(affiliateMarketing.id, id))
      .returning();
    if (!updated) return res.status(404).json({ error: "Affiliate not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to increment usage" });
  }
}

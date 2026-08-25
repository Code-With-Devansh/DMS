import { z } from "zod";
import { classification, docType } from "../db/schema/enums.js";

// Reuse the DB enums as the single source of truth for allowed values.
const classificationEnum = z.enum(classification.enumValues);
const docTypeEnum = z.enum(docType.enumValues);

// Metadata for a brand-new document — sent as the multipart "metadata" JSON field.
export const createDocumentMetadataSchema = z.object({
  title: z.string().trim().min(1).max(500),
  docType: docTypeEnum,
  classification: classificationEnum,
  description: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(50).optional(),
});

// Metadata for a new version of an existing document.
export const newVersionMetadataSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

// List query string (?page&pageSize).
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

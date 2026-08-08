/** Zod schemas shared across API routes and forms. */
import { z } from "zod";
import { FIELD_TYPES } from "./field-types";

export const signupSchema = z.object({
  name: z.string().trim().min(1, "お名前を入力してください").max(80),
  email: z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません"),
  password: z
    .string()
    .min(8, "パスワードは8文字以上にしてください")
    .max(200),
  workspaceName: z.string().trim().min(1).max(80).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("メールアドレスの形式が正しくありません"),
  password: z.string().min(1, "パスワードを入力してください"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const selectOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  color: z.string().optional(),
});

export const fieldInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  key: z.string().trim().min(1).max(48).optional(),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional().default(false),
  options: z.array(selectOptionSchema).optional(),
  config: z.record(z.unknown()).optional(),
  position: z.number().int().optional(),
});
export type FieldInput = z.infer<typeof fieldInputSchema>;

export const createCollectionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional().default(""),
  icon: z.string().max(40).optional().default("table"),
  color: z.string().max(40).optional().default("khaki"),
  template: z.enum(["inquiry", "task", "custom"]).optional().default("custom"),
  fields: z.array(fieldInputSchema).optional(),
});
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

export const updateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  icon: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
});

export const recordDataSchema = z.record(z.unknown());

export const createRecordSchema = z.object({
  data: recordDataSchema,
});

export const updateRecordSchema = z.object({
  data: recordDataSchema,
});

/** Bulk records payload used by the importer. */
export const bulkRecordsSchema = z.object({
  records: z.array(recordDataSchema).max(50000),
});

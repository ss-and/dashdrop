/**
 * Built-in collection templates. A template is just a Collection preset with a
 * predefined set of Fields — proving the metadata engine is the product.
 */
import type { FieldType, SelectOption } from "./field-types";

export interface TemplateField {
  key: string;
  name: string;
  type: FieldType;
  required?: boolean;
  options?: SelectOption[];
}

export interface CollectionTemplate {
  id: "inquiry" | "task";
  name: string;
  description: string;
  icon: string;
  color: string;
  fields: TemplateField[];
}

const INQUIRY_STATUS: SelectOption[] = [
  { label: "新規", value: "new", color: "info" },
  { label: "対応中", value: "in_progress", color: "warning" },
  { label: "対応済み", value: "resolved", color: "success" },
  { label: "保留", value: "on_hold", color: "khaki" },
];

const INQUIRY_CHANNEL: SelectOption[] = [
  { label: "メール", value: "email" },
  { label: "電話", value: "phone" },
  { label: "Webフォーム", value: "web" },
  { label: "対面", value: "in_person" },
];

const TASK_STATUS: SelectOption[] = [
  { label: "未着手", value: "todo", color: "khaki" },
  { label: "進行中", value: "doing", color: "warning" },
  { label: "完了", value: "done", color: "success" },
];

const TASK_PRIORITY: SelectOption[] = [
  { label: "高", value: "high", color: "danger" },
  { label: "中", value: "medium", color: "warning" },
  { label: "低", value: "low", color: "info" },
];

export const TEMPLATES: Record<"inquiry" | "task", CollectionTemplate> = {
  inquiry: {
    id: "inquiry",
    name: "顧客問い合わせ",
    description: "顧客からの問い合わせを受付・対応状況まで管理",
    icon: "inbox",
    color: "info",
    fields: [
      { key: "customer", name: "顧客名", type: "text", required: true },
      { key: "email", name: "メール", type: "email" },
      { key: "phone", name: "電話", type: "phone" },
      { key: "channel", name: "受付経路", type: "select", options: INQUIRY_CHANNEL },
      { key: "subject", name: "件名", type: "text", required: true },
      { key: "detail", name: "内容", type: "longtext" },
      { key: "status", name: "対応状況", type: "select", required: true, options: INQUIRY_STATUS },
      { key: "received_at", name: "受付日", type: "date" },
    ],
  },
  task: {
    id: "task",
    name: "タスク",
    description: "社内タスクの担当・期限・進捗を管理",
    icon: "check-square",
    color: "khaki",
    fields: [
      { key: "title", name: "タスク名", type: "text", required: true },
      { key: "assignee", name: "担当者", type: "text" },
      { key: "priority", name: "優先度", type: "select", options: TASK_PRIORITY },
      { key: "status", name: "進捗", type: "select", required: true, options: TASK_STATUS },
      { key: "due_date", name: "期限", type: "date" },
      { key: "done", name: "完了", type: "checkbox" },
      { key: "notes", name: "メモ", type: "longtext" },
    ],
  },
};

/** Which stored value of a template's status field counts as "resolved/complete". */
export const RESOLVED_VALUES = {
  inquiry: "resolved",
  task: "done",
} as const;

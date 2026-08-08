/**
 * Category: 問い合わせ・サポート (support)
 *
 * This file is the REFERENCE implementation for all category template files.
 * A template = collections (fields + light sample hints) + a widgets layout on
 * a 4-column grid (widget `span` sums to 4 per visual row). Sample data is
 * auto-generated from field types + `sample` hints, so charts populate on apply.
 */
import type { DashboardTemplate } from "../widgets";

const STATUS = [
  { label: "新規", value: "new", color: "info" },
  { label: "対応中", value: "in_progress", color: "warning" },
  { label: "対応済み", value: "resolved", color: "success" },
  { label: "保留", value: "on_hold", color: "khaki" },
];
const CHANNEL = [
  { label: "メール", value: "email" },
  { label: "電話", value: "phone" },
  { label: "Webフォーム", value: "web" },
  { label: "対面", value: "in_person" },
];
const CATEGORY = [
  { label: "見積", value: "quote" },
  { label: "不具合", value: "bug" },
  { label: "納期", value: "delivery" },
  { label: "使い方", value: "howto" },
  { label: "その他", value: "other" },
];
const PRIORITY = [
  { label: "高", value: "high", color: "danger" },
  { label: "中", value: "medium", color: "warning" },
  { label: "低", value: "low", color: "info" },
];

export const supportTemplates: DashboardTemplate[] = [
  {
    key: "support-inquiries",
    category: "support",
    name: "問い合わせ対応ダッシュボード",
    description:
      "顧客からの問い合わせを受付から解決まで追跡。対応率・チャネル・カテゴリを一望。",
    icon: "inbox",
    color: "info",
    collections: [
      {
        name: "問い合わせ",
        slug: "inquiries",
        icon: "inbox",
        color: "info",
        sampleRows: 120,
        fields: [
          { key: "customer", name: "顧客名", type: "text", required: true },
          { key: "channel", name: "受付経路", type: "select", options: CHANNEL, sample: { weights: [5, 3, 4, 1] } },
          { key: "category", name: "カテゴリ", type: "select", options: CATEGORY },
          { key: "priority", name: "優先度", type: "select", options: PRIORITY, sample: { weights: [2, 5, 3] } },
          { key: "status", name: "対応状況", type: "select", required: true, options: STATUS, sample: { weights: [2, 2, 6, 1] } },
          { key: "assignee", name: "担当者", type: "text" },
          { key: "csat", name: "満足度(1-5)", type: "number", sample: { min: 3, max: 5 } },
          { key: "received_at", name: "受付日", type: "date", sample: { daysBack: 30, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "今週の新規問い合わせ", collection: "inquiries", span: 1, measure: { kind: "count" }, delta: { dateField: "received_at", period: "week" }, icon: "inbox" },
      { id: "k2", type: "kpi", title: "対応済み率", collection: "inquiries", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "status", op: "eq", value: "resolved" }] },
      { id: "k3", type: "kpi", title: "未対応", collection: "inquiries", span: 1, measure: { kind: "count" }, filters: [{ field: "status", op: "in", value: ["new", "in_progress"] }] },
      { id: "k4", type: "kpi", title: "平均満足度", collection: "inquiries", span: 1, measure: { kind: "avg", field: "csat" } },
      {
        id: "s1", type: "area", title: "問い合わせ推移", collection: "inquiries", span: 2,
        dateField: "received_at", bucket: "day", rangeCount: 21,
        measures: [
          { label: "受付", measure: { kind: "count" }, color: "khaki" },
          { label: "解決", measure: { kind: "count" }, filters: [{ field: "status", op: "eq", value: "resolved" }], color: "success" },
        ],
      },
      { id: "b1", type: "donut", title: "受付経路の内訳", collection: "inquiries", span: 1, groupBy: "channel", measure: { kind: "count" }, limit: 5 },
      { id: "b2", type: "donut", title: "対応状況の内訳", collection: "inquiries", span: 1, groupBy: "status", measure: { kind: "count" }, limit: 5 },
      { id: "b3", type: "hbar", title: "カテゴリ別の件数", collection: "inquiries", span: 2, groupBy: "category", measure: { kind: "count" }, limit: 6 },
      { id: "t1", type: "table", title: "直近の問い合わせ", collection: "inquiries", span: 2, columns: ["customer", "category", "priority", "status", "assignee"], sort: { field: "received_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "support-sla",
    category: "support",
    name: "サポート品質・SLAダッシュボード",
    description:
      "初回応答時間・SLA達成率・再オープン率で、サポートチームの品質を管理。",
    icon: "check-square",
    color: "success",
    collections: [
      {
        name: "サポートチケット",
        slug: "support-tickets",
        icon: "check-square",
        color: "success",
        sampleRows: 140,
        fields: [
          { key: "subject", name: "件名", type: "text", required: true },
          { key: "agent", name: "担当エージェント", type: "text" },
          { key: "priority", name: "優先度", type: "select", options: PRIORITY, sample: { weights: [3, 5, 2] } },
          { key: "status", name: "状況", type: "select", required: true, options: STATUS, sample: { weights: [1, 2, 7, 1] } },
          { key: "response_hours", name: "初回応答(時間)", type: "number", sample: { min: 1, max: 24, trend: "down" } },
          { key: "sla_met", name: "SLA達成", type: "checkbox", sample: { min: 0.82 } },
          { key: "reopened", name: "再オープン", type: "checkbox", sample: { min: 0.08 } },
          { key: "opened_at", name: "起票日", type: "date", sample: { daysBack: 30, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "平均初回応答(時間)", collection: "support-tickets", span: 1, measure: { kind: "avg", field: "response_hours" } },
      { id: "k2", type: "kpi", title: "SLA達成率", collection: "support-tickets", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "sla_met", op: "truthy" }] },
      { id: "k3", type: "kpi", title: "再オープン率", collection: "support-tickets", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "reopened", op: "truthy" }] },
      { id: "k4", type: "kpi", title: "解決件数(今月)", collection: "support-tickets", span: 1, measure: { kind: "count" }, filters: [{ field: "status", op: "eq", value: "resolved" }], delta: { dateField: "opened_at", period: "month" } },
      {
        id: "s1", type: "line", title: "初回応答時間の推移", collection: "support-tickets", span: 2,
        dateField: "opened_at", bucket: "day", rangeCount: 21,
        measures: [{ label: "平均応答(時間)", measure: { kind: "avg", field: "response_hours" }, color: "info" }],
      },
      { id: "b1", type: "donut", title: "優先度の内訳", collection: "support-tickets", span: 1, groupBy: "priority", measure: { kind: "count" }, limit: 4 },
      { id: "b2", type: "hbar", title: "エージェント別の対応数", collection: "support-tickets", span: 1, groupBy: "agent", measure: { kind: "count" }, limit: 6 },
      { id: "t1", type: "table", title: "対応中のチケット", collection: "support-tickets", span: 4, columns: ["subject", "agent", "priority", "status", "response_hours"], sort: { field: "opened_at", dir: "desc" }, limit: 8 },
    ],
  },

  {
    key: "support-csat",
    category: "support",
    name: "顧客満足度(CSAT)ダッシュボード",
    description: "アンケート結果から満足度スコア・感情・チャネル別の傾向を可視化。",
    icon: "sparkles",
    color: "info",
    collections: [
      {
        name: "顧客フィードバック",
        slug: "feedback",
        icon: "sparkles",
        color: "info",
        sampleRows: 150,
        fields: [
          { key: "customer", name: "顧客名", type: "text" },
          { key: "score", name: "スコア(1-5)", type: "number", required: true, sample: { min: 2, max: 5 } },
          { key: "sentiment", name: "感情", type: "select", options: [
            { label: "肯定的", value: "positive", color: "success" },
            { label: "中立", value: "neutral", color: "khaki" },
            { label: "否定的", value: "negative", color: "danger" },
          ], sample: { weights: [6, 3, 1] } },
          { key: "channel", name: "経路", type: "select", options: CHANNEL },
          { key: "comment", name: "コメント", type: "longtext" },
          { key: "submitted_at", name: "回答日", type: "date", sample: { daysBack: 45, trend: "up" } },
        ],
      },
    ],
    widgets: [
      { id: "k1", type: "kpi", title: "平均スコア", collection: "feedback", span: 1, measure: { kind: "avg", field: "score" }, target: 4.5 },
      { id: "k2", type: "kpi", title: "肯定的な割合", collection: "feedback", span: 1, measure: { kind: "count" }, rateNumerator: [{ field: "sentiment", op: "eq", value: "positive" }] },
      { id: "k3", type: "kpi", title: "回答数", collection: "feedback", span: 1, measure: { kind: "count" }, delta: { dateField: "submitted_at", period: "week" } },
      { id: "k4", type: "kpi", title: "否定的な件数", collection: "feedback", span: 1, measure: { kind: "count" }, filters: [{ field: "sentiment", op: "eq", value: "negative" }] },
      {
        id: "s1", type: "area", title: "満足度スコアの推移", collection: "feedback", span: 2,
        dateField: "submitted_at", bucket: "week", rangeCount: 8,
        measures: [{ label: "平均スコア", measure: { kind: "avg", field: "score" }, color: "khaki" }],
      },
      { id: "b1", type: "donut", title: "感情の内訳", collection: "feedback", span: 1, groupBy: "sentiment", measure: { kind: "count" }, limit: 3 },
      { id: "b2", type: "hbar", title: "経路別の回答数", collection: "feedback", span: 1, groupBy: "channel", measure: { kind: "count" }, limit: 4 },
      { id: "t1", type: "table", title: "最近のフィードバック", collection: "feedback", span: 4, columns: ["customer", "score", "sentiment", "channel"], sort: { field: "submitted_at", dir: "desc" }, limit: 8 },
    ],
  },
];

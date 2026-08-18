/**
 * Shared shapes for the spreadsheet 表 / 分析 tabs.
 *
 * Kept in its own module so <AnalyzeView/> and <FilterBar/> can both import the
 * field shape without importing each other.
 */
import type { SelectOption } from "@/lib/field-types";

/** A sheet field as the analysis tabs see it (subset of the DB Field row). */
export interface SheetField {
  key: string;
  name: string;
  type: string;
  /** Field.options JSON — present for select / multiselect. */
  options: SelectOption[] | null;
}

/** The sheet being analysed. */
export interface SheetRef {
  id: string;
  slug: string;
  name: string;
}

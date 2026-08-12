/**
 * 詳細 card — every field of the record as a two-column definition list.
 *
 * Values are formatted by <RecordValue/>; computed (lookup / rollup) fields
 * carry a subtle 自動計算 hint so it is obvious they cannot be typed into.
 */
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/Card";
import { isComputedField } from "@/lib/field-types";
import {
  NUMERIC_TYPES,
  RecordValue,
  type RecordFieldDef,
  type RelationLabels,
} from "./RecordValue";

export function RecordFields({
  fields,
  data,
  computed,
  relationLabels,
}: {
  fields: RecordFieldDef[];
  data: Record<string, unknown>;
  computed: Record<string, unknown>;
  relationLabels: RelationLabels;
}) {
  if (fields.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>詳細</CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-ink-muted">
            このスプレッドシートにはまだ項目がありません。
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>詳細</CardTitle>
      </CardHeader>
      <CardBody>
        <dl className="grid grid-cols-1 gap-x-10 md:grid-cols-2">
          {fields.map((f) => {
            const numeric = NUMERIC_TYPES.has(f.type);
            return (
              <div
                key={f.key}
                className="flex items-baseline gap-3 border-b border-ink-line/70 py-2.5 last:border-b-0"
              >
                <dt className="flex w-32 shrink-0 flex-col text-xs text-ink-muted">
                  <span className="break-words">{f.name}</span>
                  {isComputedField(f.type) && (
                    <span className="text-2xs text-ink-faint">自動計算</span>
                  )}
                </dt>
                <dd className="min-w-0 flex-1 text-sm text-ink">
                  <RecordValue
                    field={f}
                    data={data}
                    computed={computed}
                    relationLabels={relationLabels}
                    numericAlign={numeric}
                  />
                </dd>
              </div>
            );
          })}
        </dl>
      </CardBody>
    </Card>
  );
}

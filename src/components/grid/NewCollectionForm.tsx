"use client";

/**
 * Guided "new table" flow: pick a starting point (a built-in template or an
 * empty table), name it, optionally seed a few starter fields, then POST to
 * /api/collections and jump straight into the new grid.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Select } from "@/components/ui/Input";
import { CollectionIcon } from "@/components/app/icons";
import { cn } from "@/lib/utils";
import { TEMPLATES } from "@/lib/templates";
import {
  FIELD_TYPE_META,
  FIELD_TYPES,
  type FieldType,
} from "@/lib/field-types";

type StartId = "inquiry" | "task" | "custom";

interface StarterField {
  name: string;
  type: FieldType;
}

const CHOICES: {
  id: StartId;
  name: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "inquiry",
    name: TEMPLATES.inquiry.name,
    description: TEMPLATES.inquiry.description,
    icon: TEMPLATES.inquiry.icon,
  },
  {
    id: "task",
    name: TEMPLATES.task.name,
    description: TEMPLATES.task.description,
    icon: TEMPLATES.task.icon,
  },
  {
    id: "custom",
    name: "空のスプレッドシート",
    description: "項目を自由に定義して、ゼロから作成します",
    icon: "table",
  },
];

export function NewCollectionForm() {
  const router = useRouter();
  const [choice, setChoice] = useState<StartId>("inquiry");
  const [name, setName] = useState(TEMPLATES.inquiry.name);
  const [starters, setStarters] = useState<StarterField[]>([
    { name: "", type: "text" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(id: StartId) {
    setChoice(id);
    setError(null);
    if (id === "inquiry") setName(TEMPLATES.inquiry.name);
    else if (id === "task") setName(TEMPLATES.task.name);
    else setName("");
  }

  function updateStarter(i: number, patch: Partial<StarterField>) {
    setStarters((s) => s.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function addStarter() {
    setStarters((s) => [...s, { name: "", type: "text" }]);
  }
  function removeStarter(i: number) {
    setStarters((s) => s.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!name.trim()) {
      setError("スプレッドシート名を入力してください");
      return;
    }
    setSaving(true);
    setError(null);

    let body: Record<string, unknown>;
    if (choice === "inquiry" || choice === "task") {
      const tpl = TEMPLATES[choice];
      body = {
        name: name.trim(),
        icon: tpl.icon,
        color: tpl.color,
        template: tpl.id,
        fields: tpl.fields,
      };
    } else {
      const fields = starters
        .filter((s) => s.name.trim())
        .map((s) => ({ name: s.name.trim(), type: s.type }));
      body = { name: name.trim(), template: "custom", fields };
    }

    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? "作成に失敗しました");
        setSaving(false);
        return;
      }
      router.push(`/c/${json.data.id}`);
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
      setSaving(false);
    }
  }

  const activeTemplate =
    choice === "custom" ? null : TEMPLATES[choice];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-ink">出発点を選ぶ</h2>
        <p className="mt-1 text-sm text-ink-muted">
          用意されたテンプレートから始めるか、空のスプレッドシートを作成します。
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {CHOICES.map((c) => {
          const active = choice === c.id;
          return (
            <button key={c.id} type="button" onClick={() => pick(c.id)} className="text-left">
              <Card
                className={cn(
                  "h-full p-4 transition-colors",
                  active
                    ? "border-khaki-400 ring-2 ring-khaki-500/30"
                    : "hover:border-khaki-300",
                )}
              >
                <span
                  className={cn(
                    "mb-3 flex h-9 w-9 items-center justify-center rounded-md",
                    active ? "bg-khaki-100" : "bg-paper-sunken",
                  )}
                >
                  <CollectionIcon name={c.icon} className="h-5 w-5 text-khaki-600" />
                </span>
                <p className="font-medium text-ink">{c.name}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{c.description}</p>
              </Card>
            </button>
          );
        })}
      </div>

      <div className="card space-y-4 p-5">
        <div>
          <Label htmlFor="table-name">スプレッドシート名</Label>
          <Input
            id="table-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：顧客問い合わせ"
          />
        </div>

        {activeTemplate && (
          <div>
            <Label>含まれる項目</Label>
            <div className="flex flex-wrap gap-1.5">
              {activeTemplate.fields.map((f) => (
                <span
                  key={f.key}
                  className="inline-flex items-center gap-1 rounded-sm border border-ink-line bg-paper-sunken px-2 py-0.5 text-xs text-ink-soft"
                >
                  {f.name}
                  <span className="font-mono text-2xs text-ink-faint">
                    {FIELD_TYPE_META[f.type].label}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        {choice === "custom" && (
          <div className="space-y-2">
            <Label>最初の項目（任意）</Label>
            <div className="space-y-2">
              {starters.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    className="flex-1"
                    value={s.name}
                    onChange={(e) => updateStarter(i, { name: e.target.value })}
                    placeholder="項目名（例：会社名）"
                  />
                  <Select
                    className="w-40"
                    value={s.type}
                    onChange={(e) =>
                      updateStarter(i, { type: e.target.value as FieldType })
                    }
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {FIELD_TYPE_META[t].label}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => removeStarter(i)}
                    className="shrink-0 rounded p-2 text-ink-faint hover:bg-paper-sunken hover:text-danger"
                    aria-label="項目を削除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={addStarter}>
              + 項目を追加
            </Button>
            <p className="text-xs text-ink-faint">
              作成後もグリッド上で項目を追加・編集できます。
            </p>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={submit} disabled={saving}>
            {saving ? "作成中…" : "スプレッドシートを作成"}
          </Button>
        </div>
      </div>
    </div>
  );
}

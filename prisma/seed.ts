/**
 * Seed a realistic demo workspace so the dashboard, grids and charts have data
 * on first run. Idempotent: re-running upserts the demo user & workspace.
 *
 * Demo login:  owner@demo.dashdrop  /  demo1234
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { TEMPLATES } from "../src/lib/templates";

const db = new PrismaClient();

const DEMO_EMAIL = "owner@demo.dashdrop";
const DEMO_PASSWORD = "demo1234";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(9 + (n % 8), (n * 7) % 60, 0, 0);
  return d;
}

async function main() {
  console.log("🌱 Seeding DashDrop demo data…");

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const user = await db.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, name: "デモ オーナー", passwordHash },
  });

  // Fresh workspace each seed run for deterministic demo state.
  await db.workspace.deleteMany({
    where: { memberships: { some: { userId: user.id } }, slug: "demo" },
  });

  const workspace = await db.workspace.create({
    data: {
      name: "デモ商店",
      slug: "demo",
      plan: "pro",
      memberships: { create: { userId: user.id, role: "owner" } },
    },
  });

  // --- Inquiries collection ---
  const inquiryTpl = TEMPLATES.inquiry;
  const inquiries = await db.collection.create({
    data: {
      workspaceId: workspace.id,
      name: inquiryTpl.name,
      slug: "inquiries",
      description: inquiryTpl.description,
      icon: inquiryTpl.icon,
      color: inquiryTpl.color,
      template: "inquiry",
      position: 0,
      fields: {
        create: inquiryTpl.fields.map((f, i) => ({
          key: f.key,
          name: f.name,
          type: f.type,
          required: f.required ?? false,
          options: (f.options ?? undefined) as object | undefined,
          position: i,
        })),
      },
    },
  });

  const customers = [
    "山田商事", "佐藤工務店", "鈴木デザイン", "田中フーズ", "高橋物流",
    "伊藤クリニック", "渡辺印刷", "中村酒店", "小林電機", "加藤農園",
  ];
  const statuses = ["new", "in_progress", "resolved", "resolved", "resolved", "on_hold"];
  const channels = ["email", "phone", "web", "in_person"];
  const subjects = [
    "見積もりの依頼", "納期の確認", "商品の不具合について", "追加注文の相談",
    "請求書の再発行", "アフターサービスの問い合わせ", "資料請求", "キャンセルの相談",
  ];

  for (let i = 0; i < 32; i++) {
    const status = statuses[i % statuses.length];
    const created = daysAgo(i % 14);
    await db.record.create({
      data: {
        collectionId: inquiries.id,
        createdById: user.id,
        createdAt: created,
        data: {
          customer: customers[i % customers.length],
          email: `contact${i}@example.com`,
          phone: `03-1234-${String(1000 + i).slice(-4)}`,
          channel: channels[i % channels.length],
          subject: subjects[i % subjects.length],
          detail: "お問い合わせ内容のサンプルテキストです。",
          status,
          received_at: created.toISOString().slice(0, 10),
        },
      },
    });
    await db.activity.create({
      data: { workspaceId: workspace.id, type: "record.created", createdAt: created, meta: { collection: "inquiries" } },
    });
    if (status === "resolved") {
      await db.activity.create({
        data: { workspaceId: workspace.id, type: "inquiry.resolved", createdAt: created, meta: { collection: "inquiries" } },
      });
    }
  }

  // --- Tasks collection ---
  const taskTpl = TEMPLATES.task;
  const tasks = await db.collection.create({
    data: {
      workspaceId: workspace.id,
      name: taskTpl.name,
      slug: "tasks",
      description: taskTpl.description,
      icon: taskTpl.icon,
      color: taskTpl.color,
      template: "task",
      position: 1,
      fields: {
        create: taskTpl.fields.map((f, i) => ({
          key: f.key,
          name: f.name,
          type: f.type,
          required: f.required ?? false,
          options: (f.options ?? undefined) as object | undefined,
          position: i,
        })),
      },
    },
  });

  const taskTitles = [
    "月次レポート作成", "在庫棚卸し", "取引先へ請求書送付", "Webサイト更新",
    "新商品の写真撮影", "SNS投稿の準備", "経費精算", "顧客フォローアップ電話",
    "仕入先との価格交渉", "スタッフのシフト調整",
  ];
  const assignees = ["山本", "中島", "小川", "森田"];
  const taskStatuses = ["todo", "doing", "done", "done"];
  const priorities = ["high", "medium", "low"];

  for (let i = 0; i < 20; i++) {
    const status = taskStatuses[i % taskStatuses.length];
    const created = daysAgo(i % 14);
    await db.record.create({
      data: {
        collectionId: tasks.id,
        createdById: user.id,
        createdAt: created,
        data: {
          title: taskTitles[i % taskTitles.length],
          assignee: assignees[i % assignees.length],
          priority: priorities[i % priorities.length],
          status,
          due_date: daysAgo(i % 14 - 3).toISOString().slice(0, 10),
          done: status === "done",
          notes: "",
        },
      },
    });
    await db.activity.create({
      data: { workspaceId: workspace.id, type: "record.created", createdAt: created, meta: { collection: "tasks" } },
    });
    if (status === "done") {
      await db.activity.create({
        data: { workspaceId: workspace.id, type: "task.completed", createdAt: created, meta: { collection: "tasks" } },
      });
    }
  }

  console.log(`✅ Seeded workspace "${workspace.name}" with demo inquiries & tasks.`);
  console.log(`   Login → ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });

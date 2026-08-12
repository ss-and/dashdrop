import { ZodError } from "zod";
import { db, toJson } from "@/lib/db";
import { ok, fail } from "@/lib/api";
import { hashPassword, setSessionCookie } from "@/lib/auth";
import { signupSchema } from "@/lib/validation";
import { slugify } from "@/lib/utils";
import { TEMPLATES, type CollectionTemplate } from "@/lib/templates";
import { logActivity } from "@/lib/workspace";
import { installCrm } from "@/lib/install-crm";
import type { Prisma } from "@prisma/client";

/**
 * Pre-auth signup endpoint. Creates the User, their first Workspace + owner
 * Membership, and bootstraps the workspace with the two built-in template
 * collections so a fresh account is never empty. Plain handler (no withAuth,
 * since the caller is not yet authenticated).
 */

/** Find a globally-unique workspace slug derived from `name`. */
async function uniqueWorkspaceSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let n = 2;
  // Workspace.slug is globally unique — loop until we find a free one.
  while (await db.workspace.findUnique({ where: { slug: candidate } })) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

/** Seed one template collection (with its fields) inside a transaction. */
async function createTemplateCollection(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  slug: string,
  position: number,
  template: CollectionTemplate,
): Promise<void> {
  await tx.collection.create({
    data: {
      workspaceId,
      name: template.name,
      slug,
      description: template.description,
      icon: template.icon,
      color: template.color,
      template: template.id,
      position,
      fields: {
        create: template.fields.map((f, i) => ({
          key: f.key,
          name: f.name,
          type: f.type,
          required: f.required ?? false,
          options: f.options ? toJson(f.options) : undefined,
          position: i,
        })),
      },
    },
  });
}

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail("リクエストの形式が正しくありません", 400);
    }

    const input = signupSchema.parse(body);
    // Schema already lowercases, but be explicit and defensive.
    const email = input.email.toLowerCase();

    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return fail("このメールアドレスは既に登録されています", 409);
    }

    const passwordHash = await hashPassword(input.password);
    const workspaceName = input.workspaceName?.trim() || `${input.name}のワークスペース`;
    const slug = await uniqueWorkspaceSlug(workspaceName);

    const { user, workspaceId } = await db.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { email, name: input.name, passwordHash },
      });

      const workspace = await tx.workspace.create({
        data: { name: workspaceName, slug, plan: "free" },
      });

      await tx.membership.create({
        data: {
          userId: createdUser.id,
          workspaceId: workspace.id,
          role: "owner",
        },
      });

      // Bootstrap both built-in templates so the account starts populated.
      await createTemplateCollection(
        tx,
        workspace.id,
        "inquiries",
        0,
        TEMPLATES.inquiry,
      );
      await createTemplateCollection(
        tx,
        workspace.id,
        "tasks",
        1,
        TEMPLATES.task,
      );

      return { user: createdUser, workspaceId: workspace.id };
    });

    // Activity logging is best-effort and lives outside the transaction.
    await logActivity(workspaceId, "collection.created", { template: "inquiry" });
    await logActivity(workspaceId, "collection.created", { template: "task" });

    // Every workspace starts with the customer database — DashDrop is meant to
    // be the master record, not just a viewer over imported files. Best-effort:
    // a failure here must never block the signup itself (the sidebar offers a
    // 「顧客データベースを作成」 button as the fallback).
    try {
      await installCrm(
        {
          id: user.id,
          email,
          name: input.name,
          workspace: {
            id: workspaceId,
            name: workspaceName,
            slug,
            plan: "free",
            role: "owner",
          },
        },
        { withSampleData: false },
      );
    } catch (err) {
      console.error("CRM bootstrap failed for new workspace:", err);
    }

    await setSessionCookie(user.id);
    return ok({ redirect: "/home" });
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0]?.message ?? "入力内容を確認してください";
      return fail(first, 422, { issues: err.flatten().fieldErrors });
    }
    console.error("Signup failed:", err);
    return fail("アカウントの作成に失敗しました。しばらくして再度お試しください。", 500);
  }
}

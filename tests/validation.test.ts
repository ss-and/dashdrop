import { describe, it, expect } from "vitest";
import {
  signupSchema,
  loginSchema,
  createCollectionSchema,
  fieldInputSchema,
} from "@/lib/validation";

describe("signupSchema", () => {
  it("accepts valid input and trims + lowercases email", () => {
    const r = signupSchema.safeParse({
      name: "Alice",
      email: "  Alice@Example.COM  ",
      password: "supersecret",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("alice@example.com");
  });

  it("rejects a password shorter than 8 chars", () => {
    const r = signupSchema.safeParse({
      name: "Alice",
      email: "a@b.com",
      password: "short",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const r = signupSchema.safeParse({
      name: "Alice",
      email: "not-an-email",
      password: "supersecret",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty name", () => {
    const r = signupSchema.safeParse({
      name: "   ",
      email: "a@b.com",
      password: "supersecret",
    });
    expect(r.success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts valid credentials and normalises email", () => {
    const r = loginSchema.safeParse({ email: " USER@X.COM ", password: "x" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe("user@x.com");
  });

  it("rejects an empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });

  it("rejects a bad email", () => {
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
  });
});

describe("createCollectionSchema", () => {
  it("applies defaults for optional fields", () => {
    const r = createCollectionSchema.safeParse({ name: "Tasks" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.description).toBe("");
      expect(r.data.icon).toBe("table");
      expect(r.data.color).toBe("khaki");
      expect(r.data.template).toBe("custom");
    }
  });

  it("rejects an unknown template", () => {
    const r = createCollectionSchema.safeParse({ name: "T", template: "bogus" });
    expect(r.success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(createCollectionSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("fieldInputSchema", () => {
  it("accepts a valid field and defaults required to false", () => {
    const r = fieldInputSchema.safeParse({ name: "Amount", type: "number" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.required).toBe(false);
  });

  it("enforces the type enum", () => {
    expect(fieldInputSchema.safeParse({ name: "X", type: "text" }).success).toBe(true);
    expect(fieldInputSchema.safeParse({ name: "X", type: "notatype" }).success).toBe(false);
  });
});

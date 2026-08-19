import { describe, it, expect, beforeAll } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  safeEqual,
} from "@/lib/crypto";

beforeAll(() => {
  process.env.AUTH_SECRET =
    process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16
      ? process.env.AUTH_SECRET
      : "test-secret-value-for-crypto-tests-0123456789";
});

describe("integration credential encryption", () => {
  it("round-trips a value", () => {
    const s = "https://hooks.slack.com/services/T000/B000/abcdef123456";
    expect(decryptSecret(encryptSecret(s))).toBe(s);
  });

  it("round-trips unicode and long values", () => {
    const s = "秘密トークン🔑" + "x".repeat(4000);
    expect(decryptSecret(encryptSecret(s))).toBe(s);
  });

  it("round-trips an empty string", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("never stores the plaintext in the sealed form", () => {
    const s = "xoxb-super-secret-token";
    const sealed = encryptSecret(s);
    expect(sealed).not.toContain(s);
    expect(sealed.startsWith("v1.")).toBe(true);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const s = "same-input";
    const a = encryptSecret(s);
    const b = encryptSecret(s);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(s);
    expect(decryptSecret(b)).toBe(s);
  });

  it("rejects a tampered ciphertext instead of returning garbage", () => {
    const sealed = encryptSecret("original");
    const parts = sealed.split(".");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff; // flip a bit in the payload
    const tampered = [parts[0], parts[1], parts[2], data.toString("base64")].join(".");
    expect(decryptSecret(tampered)).toBeNull();
  });

  it("rejects a tampered auth tag", () => {
    const parts = encryptSecret("original").split(".");
    const tag = Buffer.from(parts[2], "base64");
    tag[0] ^= 0xff;
    expect(
      decryptSecret([parts[0], parts[1], tag.toString("base64"), parts[3]].join(".")),
    ).toBeNull();
  });

  it("returns null for malformed input rather than throwing", () => {
    for (const bad of [
      "",
      "plaintext",
      "v1.only-two",
      "v1.a.b.c.d",
      "v2.a.b.c",
      "v1...",
      "v1.!!!.!!!.!!!",
      "・".repeat(50),
    ]) {
      expect(() => decryptSecret(bad)).not.toThrow();
      expect(decryptSecret(bad)).toBeNull();
    }
  });

  it("masks a credential without revealing it", () => {
    const s = "xoxb-1234567890-abcdefghij";
    const masked = maskSecret(s);
    expect(masked).toContain("…");
    expect(masked.length).toBeLessThan(s.length);
    expect(masked).not.toContain("567890");
    expect(maskSecret("short")).toBe("••••");
    expect(maskSecret("")).toBe("••••");
  });

  it("safeEqual matches only identical strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

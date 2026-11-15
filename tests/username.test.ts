import { describe, expect, it } from "vitest";
import { isValidUsername, normalizeUsername, usernameToEmail } from "@/lib/auth/username";

describe("usernames", () => {
  it("normalizes case, spaces and Arabic-Indic digits", () => {
    expect(normalizeUsername("  Noura  ")).toBe("noura");
    expect(normalizeUsername("٠٥٥١٢٣٤٥٦٧")).toBe("0551234567");
  });
  it("validates format", () => {
    expect(isValidUsername("noura")).toBe(true);
    expect(isValidUsername("ahmad.s_12")).toBe(true);
    expect(isValidUsername("0551234567")).toBe(true);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("نورة")).toBe(false);
    expect(isValidUsername("a b c")).toBe(false);
    expect(isValidUsername(".hidden")).toBe(false);
    expect(isValidUsername("x@evil.com")).toBe(false);
  });
  it("maps to a reserved, undeliverable domain", () => {
    expect(usernameToEmail("noura")).toBe("noura@hissati.invalid");
  });
});

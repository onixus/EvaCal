import crypto from "node:crypto";

export function generatePassword(): string {
  return crypto.randomBytes(9).toString("base64url"); // 12 url-safe chars
}

import { createHmac, randomBytes } from "node:crypto";
export class SyntheticEffects {
  events: { kind: "email" | "payment" | "notification"; amount?: number }[] =
    [];
  notify() {
    this.events.push({ kind: "notification" });
  }
  receipt(amount: number) {
    this.events.push({ kind: "payment", amount }, { kind: "email" });
  }
}
// An ephemeral HMAC key correlates explicitly selected private fields only within one recording.
export function placeholders() {
  const key = randomBytes(32);
  return (value: string) =>
    "[private-" +
    createHmac("sha256", key).update(value).digest("hex").slice(0, 16) +
    "]";
}

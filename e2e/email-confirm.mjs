// E2E: real email-confirmation flow against the LOCAL stack, with emails captured
// by Mailpit (http://localhost:54324). Requires GoTrue running with
// LOCAL_AUTOCONFIRM=false. Usage: node e2e/email-confirm.mjs
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const { chromium, devices } = pw;

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAIL = process.env.MAILPIT_URL ?? "http://localhost:54324";
const email = `confirm-${Date.now()}@example.test`;

const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();

await page.goto(`${BASE}/signup`);
await page.fill("#full_name", "معلم تأكيد البريد");
await page.fill("#email", email);
await page.fill("#password", "confirm-password-1");
await page.click("button[type=submit]");
await page.waitForURL("**/login?confirm=1");
await page.getByText("أرسلنا رابط تأكيد إلى بريدك").waitFor();
console.log("✓ signup asks the teacher to confirm their email");

// not confirmed yet → login must fail
await page.fill("#email", email);
await page.fill("#password", "confirm-password-1");
await page.click("button[type=submit]");
await page.getByText("البريد الإلكتروني أو كلمة المرور غير صحيحة").waitFor();
console.log("✓ unconfirmed account cannot log in");

// fetch the confirmation email from Mailpit
let msg;
for (let i = 0; i < 20 && !msg; i++) {
  const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
  msg = list.messages?.[0];
  if (!msg) await new Promise((r) => setTimeout(r, 500));
}
if (!msg) throw new Error("confirmation email not received");
const full = await (await fetch(`${MAIL}/api/v1/message/${msg.ID}`)).json();
const link = (full.HTML || full.Text).match(/https?:\/\/[^"'\s<>]+\/auth\/v1\/verify[^"'\s<>]*/)?.[0]?.replace(/&amp;/g, "&");
if (!link) throw new Error("no confirmation link in email");
if (!decodeURIComponent(link).includes("/auth/confirm")) throw new Error(`link does not return to /auth/confirm: ${link}`);
console.log("✓ confirmation email received; link returns to /auth/confirm");

// click it in the same browser (PKCE verifier cookie lives here)
await page.goto(link);
await page.waitForURL("**/dashboard");
await page.getByText("لنبدأ بإعداد فصولك").waitFor();
console.log("✓ clicking the link confirms the account and signs the teacher in");

// a tampered/expired link lands on login with a clear message
await page.context().clearCookies();
await page.goto(`${BASE}/auth/confirm?token_hash=bogus&type=signup`);
await page.waitForURL("**/login?confirm_error=1");
await page.getByText("رابط التأكيد غير صالح").waitFor();
console.log("✓ invalid link shows a clear error");

await browser.close();
console.log("EMAIL CONFIRMATION FLOW PASSED");

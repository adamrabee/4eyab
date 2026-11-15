// End-to-end smoke test of the core flow against a running app (default http://localhost:3000)
// with AI_PROVIDER=mock. Usage: node e2e/smoke.mjs [outDir]
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
// Use the machine's pre-installed Playwright (global) rather than a project copy.
const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require(`${execSync("npm root -g").toString().trim()}/playwright`); }
const { chromium, devices } = pw;
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? "e2e/screenshots";
fs.mkdirSync(OUT, { recursive: true });

const png = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#ffffff" } }).png().toBuffer();
const img = path.join(OUT, "sample.png");
fs.writeFileSync(img, png);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], locale: "ar-SA" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true });
const step = (m) => console.log("✓", m);

const email = `e2e-${Date.now()}@example.test`;
await page.goto(`${BASE}/signup`);
await page.fill("#full_name", "أ. نورة القحطاني");
await page.fill("#school_name", "متوسطة التجربة");
await page.fill("#email", email);
await page.fill("#password", "e2e-password-123");
await shot("01-signup");
await page.click("button[type=submit]");
await page.waitForURL("**/dashboard");
await page.getByText("لنبدأ بإعداد فصولك").waitFor();
await shot("02-dashboard-empty");
step("signup → empty dashboard");

// roster scan
await page.goto(`${BASE}/scan`);
await page.locator("input[type=file]:not([capture])").setInputFiles(img);
await shot("03-scan-selected");
await page.getByRole("button", { name: "حلّل المستند" }).click();
await page.waitForURL(/\/scan\/[0-9a-f-]{36}$/);
await page.getByText("بيانات تجريبية").first().waitFor();
await shot("04-roster-review");
step("roster upload → review (mock clearly labelled)");

await page.fill("#c-name", "ثاني متوسط ١");
await page.getByLabel("اسم الطالب 1").fill("محمد عبدالله الشهري");
await page.getByRole("button", { name: /اعتماد وحفظ 8 طالب/ }).click();
await page.waitForURL(/\/classrooms\/[0-9a-f-]{36}/);
await page.getByText("تمت إضافة 8 طالب").waitFor();
await page.getByText("محمد عبدالله الشهري").waitFor();
await shot("05-classroom");
step("approve roster → classroom with 8 students (edit applied)");

// add a student manually
await page.fill("#new-student", "فهد سعد العتيبي");
await page.getByRole("button", { name: "إضافة", exact: true }).click();
await page.getByText("أُضيف فهد سعد العتيبي").waitFor();
step("manual add student");

// schedule scan
await page.goto(`${BASE}/scan?kind=schedule`);
await page.locator("input[type=file]:not([capture])").setInputFiles(img);
await page.getByRole("button", { name: "حلّل المستند" }).click();
await page.waitForURL(/\/scan\/[0-9a-f-]{36}$/);
await page.getByText("ربط الفصول").waitFor();
await shot("06-schedule-review");
await page.getByRole("button", { name: /اعتماد وحفظ 15 حصة/ }).click();
await page.waitForURL("**/schedule?saved=1");
await page.getByText("تم حفظ الجدول").waitFor();
await shot("07-schedule");
step("approve schedule → schedule page");

await page.goto(`${BASE}/dashboard`);
await shot("08-dashboard");
step("dashboard with data");

// isolation: a second teacher sees none of it
const ctx2 = await browser.newContext({ ...devices["iPhone 13"] });
const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/signup`);
await p2.fill("#full_name", "معلم آخر");
await p2.fill("#email", `e2e-other-${Date.now()}@example.test`);
await p2.fill("#password", "e2e-password-123");
await p2.click("button[type=submit]");
await p2.waitForURL("**/dashboard");
await p2.goto(`${BASE}/classrooms`);
await p2.getByText("لا توجد فصول بعد").waitFor();
step("second teacher sees no data from the first");

await browser.close();
if (errors.length) {
  console.error("page errors:", errors);
  process.exit(1);
}
console.log("ALL E2E STEPS PASSED");

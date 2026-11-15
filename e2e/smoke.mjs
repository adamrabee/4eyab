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
// a realistic phone photo: 4032x3024 with noise, several MB (above Vercel's 4.5 MB body limit)
const noise = Buffer.alloc(4032 * 3024 * 3);
for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
const bigPhoto = path.join(OUT, "phone-photo.jpg");
fs.writeFileSync(bigPhoto, await sharp(noise, { raw: { width: 4032, height: 3024, channels: 3 } }).jpeg({ quality: 95 }).toBuffer());
console.log(`  (test photo: ${(fs.statSync(bigPhoto).size / 1024 / 1024).toFixed(1)} MB)`);

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

// roster scan, using a large phone-size photo
await page.goto(`${BASE}/scan`);
await page.locator("input[type=file]:not([capture])").setInputFiles(bigPhoto);
await shot("03-scan-selected");
await page.getByRole("button", { name: "حلّل المستند" }).click();
await page.waitForURL(/\/scan\/[0-9a-f-]{36}$/);
await page.getByText("بيانات تجريبية").first().waitFor();
await shot("04-roster-review");
step("roster upload → review (mock clearly labelled)");

await page.fill("#c-name", "ثاني متوسط ١");
await page.getByLabel("اسم الطالب 1").fill("عبدالعزيز سلطان ناصر آل مفلح");
await page.getByRole("button", { name: /اعتماد وحفظ 8 طالب/ }).click();
await page.waitForURL(/\/classrooms\/[0-9a-f-]{36}/);
await page.getByText("تمت إضافة 8 طالب").waitFor();
await page.getByText("عبدالعزيز سلطان ناصر آل مفلح").waitFor();
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
// map the timetable's "فصل تجريبي" onto the roster classroom created above
const map = page.getByLabel("ربط فصل تجريبي", { exact: true });
await map.selectOption({ label: "ثاني متوسط ١" });
await shot("06-schedule-review");
await page.getByRole("button", { name: /اعتماد وحفظ 15 حصة/ }).click();
await page.waitForURL("**/schedule?saved=1");
await page.getByText("تم حفظ الجدول").waitFor();
await shot("07-schedule");
step("approve schedule → schedule page");

// ---- attendance (modelled on the original sheet's workflow)
const t = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh" }));
t.setDate(t.getDate() - t.getDay()); // most recent Sunday (school day with mock periods)
const sunday = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
await page.goto(`${BASE}/attendance?date=${sunday}`);
await page.getByText("ثاني متوسط ١").first().waitFor();
await shot("08-attendance-hub");
await page.getByRole("link", { name: /الحصة\s*1\s*ثاني متوسط ١/ }).click();
await page.waitForURL(/\/attendance\/[0-9a-f-]{36}\?date=.*&period=1/);
await page.getByRole("group", { name: "حالة طالب تجريبي 2" }).getByRole("button", { name: "غائب" }).click();
await page.getByRole("group", { name: "حالة طالب تجريبي 3" }).getByRole("button", { name: "غائب" }).click();
await page.getByRole("group", { name: "حالة طالب تجريبي 4" }).getByRole("button", { name: "متأخر" }).click();
await page.getByRole("group", { name: "حالة طالب تجريبي 5" }).getByRole("button", { name: "مستأذن" }).click();
await page.getByRole("group", { name: "حالة طالب تجريبي 3" }).getByRole("button", { name: "غائب" }).click(); // undo
await page.getByText("تم الحفظ ✓").waitFor({ timeout: 15000 });
await page.getByText("الغائبون: 1").waitFor();
await shot("09-taking");
await page.reload();
await page.getByText("الغائبون: 1").waitFor();
await page.getByText("متأخر: 1").waitFor();
step("take attendance: absent/late/excused, autosaved, survives reload");

// sheet + PDF
await page.getByRole("link", { name: /كشف الغائبين/ }).click();
await page.getByRole("heading", { name: "كشف الطلاب الغائبين" }).waitFor();
await page.locator("article").getByText("أ. نورة القحطاني").waitFor();
await shot("10-sheet");
const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "تحميل PDF" }).click()]);
const pdfPath = path.join(OUT, "sheet.pdf");
await pdf.saveAs(pdfPath);
if (!fs.readFileSync(pdfPath).subarray(0, 4).equals(Buffer.from("%PDF"))) throw new Error("not a PDF");
step(`absence sheet + PDF download (${fs.statSync(pdfPath).size} bytes)`);

// period 5: copy absences from the previous period
await page.goto(`${BASE}/attendance?date=${sunday}`);
await page.getByRole("link", { name: /الحصة\s*5\s*ثاني متوسط ١/ }).click();
await page.getByRole("button", { name: "نفس غياب الحصة 1" }).click();
await page.getByText("تم الحفظ ✓").waitFor({ timeout: 15000 });
await page.getByText("الغائبون: 1").waitFor();
step("same-as-previous-period copies absences");

// period 3 (other class has no students) → empty state; mark whole class present elsewhere
await page.goto(`${BASE}/attendance?date=${sunday}`);
await page.getByText("غياب: 1").first().waitFor();
await shot("11-hub-after");
step("hub shows per-period absence counts");

// reports + Excel
await page.goto(`${BASE}/reports?preset=90`);
await page.getByText("الحصص المسجّلة", { exact: true }).waitFor();
await page.getByRole("row", { name: /طالب تجريبي 2/ }).getByText("2").first().waitFor();
await shot("12-reports");
const [xl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /Excel/ }).click()]);
const xlPath = path.join(OUT, "report.xlsx");
await xl.saveAs(xlPath);
const ExcelJS = (await import("exceljs")).default;
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlPath);
const s1 = wb.getWorksheet("الملخص");
const r = s1.getRows(5, 9).find((row) => row.getCell(2).value === "طالب تجريبي 2");
if (!r || r.getCell(5).value !== 2) throw new Error("Excel summary wrong: " + JSON.stringify(r?.values));
if (!s1.views[0].rightToLeft) throw new Error("Excel sheet is not RTL");
step("reports page + Excel export verified (RTL, absent count = 2)");

await page.getByRole("link", { name: "طالب تجريبي 4" }).click();
await page.getByText("الغياب والتأخر والاستئذان").waitFor();
await page.getByText("متأخر", { exact: true }).last().waitFor();
await shot("13-student");
step("student history page");

await page.goto(`${BASE}/dashboard`);
await shot("14-dashboard");
step("dashboard with data");

// the API refuses a path in someone else's storage folder
const forged = await page.evaluate(async () => {
  const r = await fetch("/api/extractions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "roster", path: "00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111.png" }),
  });
  return r.status;
});
if (forged !== 400) throw new Error(`forged path not rejected: ${forged}`);
step("API rejects another teacher's storage path");

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

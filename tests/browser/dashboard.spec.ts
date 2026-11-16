import { test, expect } from "@playwright/test";
test("worker result can be queued, inspected and downloaded", async ({
  page,
  request,
}) => {
  await page.goto("http://127.0.0.1:4200");
  await page.getByText("Schedule replay").click();
  await page.getByLabel("Candidate").selectOption("stale");
  await page.getByRole("button", { name: "Queue run" }).click();
  await expect(page.getByRole("status")).toContainText("Queued");
  await expect(page.locator("aside button").first()).toBeVisible({
    timeout: 60000,
  });
  await page.locator("aside button").first().click();
  await expect(
    page.getByRole("heading", { name: "First divergence at summary" }),
  ).toBeVisible();
  const r = await request.get(
    "http://127.0.0.1:4200" +
      (await page
        .getByRole("link", { name: "JSON report" })
        .getAttribute("href")),
  );
  expect((await r.json()).first).toBe("summary");
  for (const label of ["Regressions", "Trends", "Coverage"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.locator("article h2")).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 780 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

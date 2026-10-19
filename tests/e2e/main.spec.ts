import { expect, test } from "@playwright/test";

/**
 * The main scenario of the brief: a visitor starts a private demo, browses the documents, asks a question,
 * gets an answer with a source, and the source opens on its page with the passage highlighted; a question
 * the documents don't answer goes to the manager's inbox, and the reply comes back to the resident.
 */

const ai = process.env.E2E_AI === "1";

test("a visitor starts a private demo and reads the sample documents", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Try as a resident/ }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: "Ask about your home" })).toBeVisible();

  await page.getByRole("link", { name: "Documents" }).first().click();
  await expect(page.getByText("Sample documents")).toBeVisible();
  await expect(page.getByText(/18 documents of the fictional company/)).toBeVisible();
  // A resident sees the documents but cannot upload.
  await expect(page.getByText("Upload a document")).toHaveCount(0);

  await page.getByRole("link", { name: "Fee Schedule" }).click();
  await expect(page.getByRole("heading", { name: /Fee Schedule/ })).toBeVisible();
  await expect(page.locator(".react-pdf__Page canvas")).toBeVisible();
  // The viewer's pager (the PDF's own footer says the same in its text layer).
  await expect(page.locator("span.tabular", { hasText: /Page 1 of \d+/ })).toBeVisible();
});

test("the manager view has the upload form and the admin pages", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Try as the property manager/ }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.getByText("Upload a document")).toBeVisible();

  for (const [link, heading] of [
    ["Inbox", "Inbox"],
    ["Frequent questions", "Frequent questions"],
    ["Answer log", "Answer log"],
  ]) {
    await page.getByRole("link", { name: link }).first().click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  // Switching roles redraws the menu as well as the page.
  await page.getByRole("button", { name: "Resident" }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("link", { name: "Answer log" })).toHaveCount(0);
  await page.getByRole("button", { name: "Manager" }).click();
  await expect(page).toHaveURL(/\/admin\/inbox$/);
  await expect(page.getByRole("link", { name: "Answer log" })).toBeVisible();
});

test("an answer cites its source, which opens on the page with the passage highlighted", async ({
  page,
}) => {
  test.skip(!ai, "needs the AI keys (run with E2E_AI=1)");
  await page.goto("/");
  await page.getByRole("button", { name: /Try as a resident/ }).click();
  await page
    .getByPlaceholder(/Ask a question/)
    .fill("How much is the late fee if I pay rent on the 6th?");
  await page.keyboard.press("Enter");

  const source = page
    .getByRole("button", { name: /Fee Schedule|Rent Payment Guide|Lease/ })
    .first();
  await expect(source).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("$75").first()).toBeVisible();
  await source.click();
  await expect(page.locator(".textLayer mark").first()).toBeVisible({ timeout: 60_000 });
});

test("a question the documents don't answer reaches the manager, and the reply reaches the resident", async ({
  page,
}) => {
  test.skip(!ai, "needs the AI keys (run with E2E_AI=1)");
  await page.goto("/");
  await page.getByRole("button", { name: /Try as a resident/ }).click();
  await page.getByPlaceholder(/Ask a question/).fill("Are there EV chargers in the parking lot?");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Sent to the property management team.")).toBeVisible({
    timeout: 90_000,
  });

  await page.getByRole("button", { name: "Manager" }).click();
  await expect(page).toHaveURL(/\/admin\/inbox$/);
  await page
    .getByLabel("Reply")
    .first()
    .fill("Not yet: two chargers are planned for lot B next spring.");
  await page.getByRole("button", { name: "Send reply" }).first().click();
  await expect(page.getByText("Answered").first()).toBeVisible();

  await page.getByRole("button", { name: "Resident" }).click();
  await page
    .getByRole("link", { name: /EV chargers/ })
    .first()
    .click();
  await expect(page.getByText(/two chargers are planned for lot B/)).toBeVisible();
});

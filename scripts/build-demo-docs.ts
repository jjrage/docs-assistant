/**
 * Renders the demo documents (demo/content/docs/*.md) to the files the seed uploads (demo/files): PDF through
 * Chromium, DOCX through the docx library. The rendered files are committed, so seeding needs no browser.
 *
 * Usage: npm run demo:docs [-- <content dir> <output dir>]
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

import { parseDemoMarkdown } from "@/demo/markdown";
import { renderDocx } from "@/demo/render-docx";
import { footerTemplate, renderHtml, type Letterhead } from "@/demo/render-html";

const [contentDir = "demo/content", outputDir = "demo/files"] = process.argv.slice(2);

async function main() {
  const company = JSON.parse(await readFile(path.join(contentDir, "company.json"), "utf8")) as {
    name: string;
    address: string;
    phone: string;
    website: string;
  };
  const letterhead: Letterhead = {
    company: company.name,
    address: company.address,
    phone: company.phone,
    website: company.website,
  };

  const docsDir = path.join(contentDir, "docs");
  const files = (await readdir(docsDir)).filter((f) => f.endsWith(".md")).sort();
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const file of files) {
      const doc = parseDemoMarkdown(await readFile(path.join(docsDir, file), "utf8"));
      const target = path.join(outputDir, `${doc.meta.slug}.${doc.meta.format}`);
      if (doc.meta.format === "pdf") {
        await page.setContent(renderHtml(doc, letterhead), { waitUntil: "load" });
        const pdf = await page.pdf({
          format: "Letter",
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: "<span></span>",
          footerTemplate: footerTemplate(doc, letterhead),
          preferCSSPageSize: true,
          tagged: true,
        });
        await writeFile(target, pdf);
      } else {
        await writeFile(target, await renderDocx(doc, letterhead));
      }
      console.log(`${target}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

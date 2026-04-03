import { existsSync, mkdirSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  ensureDirs, listPages, getPageHTML, getPageBySlug,
  listCollections, listEntries,
} from './core/store.js';
import { resolvePartials } from './core/partial.js';
import { resolveCollectionDirectives, renderListing, renderDetail } from './core/collection.js';

const DIST = join(__dirname, 'dist');

function stripOverlay(html) {
  html = html.replace(/<script[^>]*data-sm-overlay[^>]*>[\s\S]*?<\/script>\n?/gi, '');
  html = html.replace(/<link[^>]*data-sm-overlay[^>]*>\n?/gi, '');

  html = html.replace(/\s*data-content="[^"]*"/g, '');
  html = html.replace(/\s*data-section="[^"]*"/g, '');
  html = html.replace(/\s*data-partial="[^"]*"/g, '');
  html = html.replace(/\s*data-nav-page="[^"]*"/g, '');
  html = html.replace(/\s*data-slot="[^"]*"/g, '');
  html = html.replace(/\s*data-each-entry/g, '');
  html = html.replace(/\s*data-entry/g, '');
  html = html.replace(/\s*data-sm-overlay/g, '');

  html = html.replace(/<!-- @partial:[\w-]+:begin -->\n?/g, '');
  html = html.replace(/<!-- @partial:[\w-]+:end -->\n?/g, '');
  html = html.replace(/<!-- @collection:[\w-]+:begin[^>]*-->\n?/g, '');
  html = html.replace(/<!-- @collection-template:[\w-]+[\s\S]*?-->\n?/g, '');
  html = html.replace(/<!-- @collection:[\w-]+:end -->\n?/g, '');

  return html;
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function exportPage(slug, html, outputPath) {
  html = resolvePartials(html, slug);
  html = resolveCollectionDirectives(html);
  html = stripOverlay(html);
  ensureDir(dirname(outputPath));
  writeFileSync(outputPath, html, 'utf8');
}

console.log('Stablemount Export');
console.log('=================\n');

ensureDirs();
ensureDir(DIST);

const allPages = listPages();
const hasPublished = allPages.some(p => p.status === 'published');
const pages = hasPublished ? allPages.filter(p => p.status === 'published') : allPages;

if (hasPublished) {
  console.log(`  Publishing ${pages.length} of ${allPages.length} pages (status: published)\n`);
} else {
  console.log(`  No pages marked as published — exporting all ${pages.length} pages\n`);
}

let pageCount = 0;

for (const page of pages) {
  const html = getPageHTML(page.slug);
  if (!html) continue;
  const outputPath = page.slug === 'home'
    ? join(DIST, 'index.html')
    : join(DIST, page.slug, 'index.html');
  exportPage(page.slug, html, outputPath);
  pageCount++;
  console.log(`  Page: /${page.slug} -> ${outputPath.replace(DIST, 'dist')}`);
}

const collections = listCollections();
let collectionPageCount = 0;

for (const col of collections) {
  const listingHTML = renderListing(col.slug, col.name);
  if (listingHTML) {
    const outputPath = join(DIST, col.slug, 'index.html');
    const cleaned = stripOverlay(listingHTML);
    ensureDir(dirname(outputPath));
    writeFileSync(outputPath, cleaned, 'utf8');
    collectionPageCount++;
    console.log(`  Listing: /${col.slug} -> dist/${col.slug}/index.html`);
  }

  const entries = listEntries(col.slug);
  for (const entry of entries) {
    const detailHTML = renderDetail(col.slug, entry.slug, col.name);
    if (detailHTML) {
      const outputPath = join(DIST, col.slug, entry.slug, 'index.html');
      const cleaned = stripOverlay(detailHTML);
      ensureDir(dirname(outputPath));
      writeFileSync(outputPath, cleaned, 'utf8');
      collectionPageCount++;
      console.log(`  Detail: /${col.slug}/${entry.slug} -> dist/${col.slug}/${entry.slug}/index.html`);
    }
  }
}

const mediaDir = join(__dirname, 'content', 'media');
if (existsSync(mediaDir)) {
  cpSync(mediaDir, join(DIST, 'media'), { recursive: true });
  console.log(`  Media: copied to dist/media/`);
}

console.log(`\nExported ${pageCount} pages, ${collectionPageCount} collection pages to dist/`);
console.log('Done.\n');

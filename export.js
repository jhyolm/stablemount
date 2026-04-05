import { existsSync, mkdirSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  ensureDirs, listPages, getPageHTML, getPageBySlug,
  listCollections, listEntries,
  getSite, listDecisions,
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

function esc_attr(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function extractAutoDescription(html) {
  const m = html.match(/data-content="[^"]*"[^>]*>([^<]{10,})/);
  if (m) return m[1].trim().slice(0, 160);
  const bodyM = html.match(/<p[^>]*>([^<]{10,})/i);
  if (bodyM) return bodyM[1].trim().slice(0, 160);
  return '';
}

function buildTokenStyle() {
  const tokens = listDecisions().filter(d => d.kind === 'token' && d.variable);
  if (!tokens.length) return '';
  const vars = tokens.map(t => `  --${t.variable}: ${t.content};`).join('\n');
  return `<style>:root {\n${vars}\n}</style>`;
}

function injectSEOExport(html, slug) {
  const site = getSite();
  const siteSeo = site.seo || {};
  const page = getPageBySlug(slug);
  const pageSeo = page?.seo || {};
  const siteUrl = siteSeo.url || '';

  const title = pageSeo.title || ((page?.title || slug) + (siteSeo.titleSuffix || ''));
  const description = pageSeo.description || siteSeo.defaultDescription || extractAutoDescription(html);
  const ogImage = pageSeo.ogImage || siteSeo.ogImage || '';
  const canonical = pageSeo.canonicalUrl || '';
  const robots = pageSeo.robots || 'index, follow';
  const locale = siteSeo.locale || 'en_US';
  const twitterHandle = siteSeo.twitterHandle || '';
  const pageUrl = siteUrl ? `${siteUrl}${slug === 'home' ? '/' : '/' + slug}` : '';

  let tags = '';
  tags += `<title>${esc_attr(title)}</title>\n`;
  tags += `<meta name="description" content="${esc_attr(description)}">\n`;
  tags += `<meta name="robots" content="${esc_attr(robots)}">\n`;
  if (canonical || pageUrl) tags += `<link rel="canonical" href="${esc_attr(canonical || pageUrl)}">\n`;
  tags += `<meta property="og:type" content="website">\n`;
  tags += `<meta property="og:title" content="${esc_attr(title)}">\n`;
  if (description) tags += `<meta property="og:description" content="${esc_attr(description)}">\n`;
  if (pageUrl) tags += `<meta property="og:url" content="${esc_attr(pageUrl)}">\n`;
  if (ogImage) tags += `<meta property="og:image" content="${esc_attr(ogImage.startsWith('/') && siteUrl ? siteUrl + ogImage : ogImage)}">\n`;
  if (locale) tags += `<meta property="og:locale" content="${esc_attr(locale)}">\n`;
  tags += `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">\n`;
  tags += `<meta name="twitter:title" content="${esc_attr(title)}">\n`;
  if (description) tags += `<meta name="twitter:description" content="${esc_attr(description)}">\n`;
  if (ogImage) tags += `<meta name="twitter:image" content="${esc_attr(ogImage.startsWith('/') && siteUrl ? siteUrl + ogImage : ogImage)}">\n`;
  if (twitterHandle) tags += `<meta name="twitter:site" content="${esc_attr(twitterHandle)}">\n`;

  const schemaType = pageSeo.schemaOrg?.type || 'WebPage';
  const siteSchema = siteSeo.schemaOrg || {};
  const ld = { '@context': 'https://schema.org', '@type': schemaType, name: title };
  if (description) ld.description = description;
  if (pageUrl) ld.url = pageUrl;
  if (siteSchema.type === 'Organization' || siteSchema.name) {
    ld.publisher = { '@type': siteSchema.type || 'Organization' };
    if (siteSchema.name) ld.publisher.name = siteSchema.name;
    if (siteSchema.url) ld.publisher.url = siteSchema.url;
    if (siteSchema.logo) ld.publisher.logo = siteSchema.logo;
  }
  tags += `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n`;

  html = html.replace(/<title>[^<]*<\/title>\s*\n?/i, '');
  html = html.replace(/<meta\s+name="description"[^>]*>\s*\n?/i, '');
  html = html.replace(/<meta\s+property="og:[^"]*"[^>]*>\s*\n?/gi, '');
  html = html.replace(/<meta\s+name="twitter:[^"]*"[^>]*>\s*\n?/gi, '');
  html = html.replace(/<link\s+rel="canonical"[^>]*>\s*\n?/i, '');
  html = html.replace(/<meta\s+name="robots"[^>]*>\s*\n?/i, '');
  html = html.replace(/<script\s+type="application\/ld\+json">[^<]*<\/script>\s*\n?/gi, '');
  html = html.replace('</head>', tags + '</head>');
  return html;
}

function injectTokens(html) {
  const tokenStyle = buildTokenStyle();
  if (!tokenStyle) return html;
  html = html.replace(/(<style[^>]*>)\s*:root\s*\{[^}]*\}/, (m, styleTag) => styleTag);
  html = html.replace(/<style data-sm-tokens>[^<]*<\/style>\s*\n?/g, '');
  html = html.replace('</head>', `${tokenStyle}\n</head>`);
  return html;
}

function exportPage(slug, html, outputPath) {
  html = resolvePartials(html, slug);
  html = resolveCollectionDirectives(html);
  html = injectTokens(html);
  html = injectSEOExport(html, slug);
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
    let cleaned = resolveCollectionDirectives(listingHTML);
    cleaned = injectTokens(cleaned);
    cleaned = injectSEOExport(cleaned, col.slug);
    cleaned = stripOverlay(cleaned);
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
      let cleaned = resolveCollectionDirectives(detailHTML);
      cleaned = injectTokens(cleaned);
      cleaned = injectSEOExport(cleaned, `${col.slug}/${entry.slug}`);
      cleaned = stripOverlay(cleaned);
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

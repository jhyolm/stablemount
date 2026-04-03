import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLACEHOLDER_DIR = join(__dirname, '..', 'content', 'media', 'placeholder');

async function downloadImage(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    const ext = contentType.includes('png') ? '.png'
      : contentType.includes('webp') ? '.webp'
      : contentType.includes('gif') ? '.gif'
      : '.jpg';
    const buffer = Buffer.from(await res.arrayBuffer());
    const name = randomBytes(8).toString('hex') + ext;
    if (!existsSync(PLACEHOLDER_DIR)) mkdirSync(PLACEHOLDER_DIR, { recursive: true });
    writeFileSync(join(PLACEHOLDER_DIR, name), buffer);
    return { name, localPath: `/media/placeholder/${name}` };
  } catch {
    return null;
  }
}

export async function localizeImages(html) {
  const urlRegex = /https?:\/\/loremflickr\.com\/[^"'\s)]+/g;
  const urls = [...new Set(html.match(urlRegex) || [])];
  if (!urls.length) return html;

  const replacements = await Promise.all(
    urls.map(async url => {
      const result = await downloadImage(url);
      return result ? { url, local: result.localPath } : null;
    })
  );

  for (const r of replacements) {
    if (r) html = html.replaceAll(r.url, r.local);
  }

  return html;
}

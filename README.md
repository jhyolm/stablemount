# Stablemount

**AI generates websites. You govern them.**

Stablemount is an open-source website builder where you describe what you want in plain English and AI builds it — complete pages with real content, real design, and real structure. Then you refine through conversation, direct inline editing, or both.

Everything the AI decides is captured as an editable **decision** (design tokens, instructions, assets). Every change is versioned. Nothing is a black box.

## Getting started

```bash
git clone https://github.com/jhyolm/stablemount.git
cd stablemount
npm install
```

Create a `.env` file:

```
ANTHROPIC_API_KEY=your-key-here
```

Start the server:

```bash
npm start
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard). Generate your first page.

## How it works

### Generate a page

Type an intent like *"Landing page for a coffee roastery with hero, menu highlights, and about section"*. The AI returns:

- A complete HTML page with inline CSS
- Design decisions (color tokens, font choices, spacing)
- Reusable components (header, footer)

All of it lands in your project as flat files.

### Edit inline

Click any text on the page to edit it directly. Select a section and prompt the AI to change just that part. The toolbar gives you formatting. Save persists to disk.

### Govern with decisions

Every design choice the AI makes becomes a **decision** — a named constraint with a kind (token, instruction, asset), a weight (rule or guide), and a scope (global, per-page, per-collection). You edit them, the AI follows them on future generations.

### Build with collections

Create structured content types (blog posts, products, events) with schemas. The AI generates listing and detail templates. Entries are stored as JSON. Pages embed collections via directives:

```html
<!-- @collection:blog limit=3 sort=created order=desc -->
  <article data-each-entry>
    <h2>{{title}}</h2>
    <p>{{excerpt}}</p>
  </article>
<!-- @/collection:blog -->
```

### Compose with components

Two types:

- **Partials** — reusable HTML injected server-side via `<!-- @partial:header -->` directives. Edit once, updates everywhere.
- **Patterns** — reference templates the AI uses when generating similar elements. Not injected, just guidance.

### Export static HTML

```bash
npm run export
```

Resolves all directives, strips editing artifacts, copies media, outputs clean HTML to `dist/`. Only published pages are exported (or all if none are published).

## Architecture

**Zero dependencies beyond the AI SDK.** The entire server is built on Node.js builtins: `node:http`, `node:fs`, `node:crypto`. No Express, no React, no build step.

**Flat-file storage.** Everything lives in `content/` as JSON and HTML files. No database to configure, migrate, or corrupt. Git-diffable by default.

```
content/
  site.json              # Site name, settings, password hash
  decisions.json         # Design tokens, instructions, assets
  pages.json             # Page metadata
  pages/                 # Page HTML files
  partials.json          # Component metadata
  partials/              # Component HTML files
  collections/           # Each collection gets a directory
    blog/
      collection.json    # Schema and metadata
      entries.json       # Entry data
      listing.html       # AI-generated listing template
      detail.html        # AI-generated detail template
  chats/                 # Conversation history per page
  functions/             # Sandboxed server-side JS
  media/                 # Uploaded files
  history/               # Version snapshots
```

**Atomic writes.** All file writes go to a temp file first, then rename. No partial writes, no corruption on concurrent access.

**Two-tier trust model:**

| Layer | Access | Safe for AI? | Location |
|-------|--------|-------------|----------|
| **Sandboxed functions** | `store`, `http`, `env` APIs only. No filesystem, no imports. | Yes | `content/functions/*.js` |
| **Developer extensions** | Full Node.js. Hot-reloaded. | No | `extensions/*/extension.js` |

Functions are safe enough for AI to write. Extensions are for developers who need real integrations.

## Security

- Path traversal protection on all file-serving routes
- Request body size limits (2 MB JSON, 20 MB uploads)
- File type allowlist on media uploads
- Atomic file writes to prevent corruption
- Cookie-based auth with `scrypt` password hashing
- `Secure` cookie flag when behind HTTPS proxy
- Session expiry with periodic cleanup
- Sandboxed function execution (no filesystem, no imports, strict timeout)

## Deploying

Stablemount is a single Node.js process. For production:

1. Put it behind a reverse proxy for HTTPS (nginx, Caddy, Cloudflare Tunnel)
2. Set `ANTHROPIC_API_KEY` in your environment
3. Run with `node server.js` (or PM2, systemd, Docker, etc.)

The `Secure` flag on session cookies is set automatically when the server detects HTTPS via `X-Forwarded-Proto`.

## Extending

Extensions live in `extensions/` and have full Node.js access:

- Custom API routes under `/x/`
- Middleware that runs before page renders
- Lifecycle hooks (`onRequest`, `onPageRender`, `onPageSave`, `onContentChange`, `onAIResponse`)
- Dashboard panels and overlay toolbar buttons
- Hot-reloaded on file change

See `extensions/example/` for the pattern.

## License

MIT

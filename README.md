# Stablemount

Open-source website builder with AI built in. Not a coding tool — the AI lives inside the product. Anyone on your team opens the dashboard, describes a page in plain language, and the system builds it within the site's existing design system. Then you edit your own words directly on the rendered page.

There are some key differences between Stablemount and basic vibe coding. Stablemount is a managed environment where AI-generated output is automatically constrained by design tokens, instruction rules, and a growing component library. Every page the AI builds makes the next one more consistent. The architecture exists to capture, standardize, and accumulate the decisions that would otherwise be throwaway context in a chat window.

## How to use Stablemount

### Install

```bash
git clone https://github.com/jhyolm/stablemount.git
cd stablemount
npm install
```

Create a `.env` with your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Start:

```bash
npm start
```

Dashboard at [localhost:3000/dashboard](http://localhost:3000/dashboard). Your site at [localhost:3000](http://localhost:3000).

### Generate a page

From the dashboard, describe what you want: *"Landing page for a developer tool with hero, feature grid, and pricing section."* The AI returns a complete HTML page with inline CSS, proposes design tokens (colors, fonts, spacing as CSS custom properties), and creates reusable components (header, footer) — all saved as flat files to `content/`.

### Edit inline

Open any page. Click any text to edit it — the element becomes `contenteditable` with a formatting toolbar (bold, italic, links, heading levels). Click an image to replace it. Select a section and type an instruction to the AI ("make this three columns", "add testimonials here") and it rewrites just that section. Save persists directly to the HTML file on disk.

There is no separate editor view. The rendered page is the editing surface.

### Components are single files

Each component is one self-contained HTML file: markup, then `<style>`, then optional `<script>`. That's it. Copy a file to share a component between projects. Paste one in from someone else's site. No build step, no dependencies, no framework coupling.

Pages reference components with HTML comments:

```html
<!-- @partial:header -->
<main>...</main>
<!-- @partial:footer -->
```

The server resolves these at browse time. Edit a component once, every page that uses it updates immediately.

### Decisions govern the AI

Design constraints are stored in `decisions.json`. Token decisions (colors, fonts, spacing) become CSS custom properties injected at serve time — change a token, the whole site updates. Instruction decisions are prose rules ("use formal tone", "every page needs a CTA") that the AI follows during generation.

### Export static HTML

```bash
npm run export
```

Resolves all directives, strips editing artifacts, outputs clean HTML to `dist/`. Deploy anywhere — any CDN, any static host, any web server.

## Why not a visual builder

Visual builders solve the problem of *assembling* a page. AI makes that unnecessary. The AI handles structure, layout, responsive behavior, and code. What it can't do well is write your specific content — your headline, your product description, your team bio. That's what inline editing is for.

The division: **AI handles structure, you handle content.** No drag-and-drop, no block palette, no column resizers. Tell the AI what structural change you want in natural language. Edit the words yourself, directly on the page.

This is a fundamentally different editing model from WordPress, Webflow, Squarespace, or any block editor. The page is not assembled from predefined components. The AI generates whatever HTML/CSS the page needs — carousels, accordions, pricing tables, comparison grids — from scratch, constrained only by your design tokens and instructions. The component library isn't designed upfront; it grows organically as you save patterns worth reusing.

### vs. traditional CMS (WordPress, Ghost, Strapi)

- No theme layer. No template rendering pipeline. Pages are HTML files on disk, served directly.
- No content fields that get "rendered into" templates. The rendered page is the content.
- No admin panel for content entry. Edit on the page itself.
- No database. Everything is files. Git-diffable, copyable, portable.

### vs. site builders (Webflow, Squarespace, Wix, Framer)

- No visual builder UI. AI generates structure; you edit text inline.
- No predefined component library. AI creates any pattern the page needs.
- No proprietary format. Your site is HTML, CSS, and JSON. Take it anywhere.
- Self-hostable. Bring your own AI key, run on your own machine.

### vs. AI generators (v0, Bolt, Lovable) and vibe coding

- Not a one-shot generator. Stablemount is a persistent environment where the design system accumulates across every generation.
- The AI is built into the product. You don't connect an external coding tool — you talk to the AI inside the dashboard and on the page itself. A marketer uses it the same way a developer does.
- Content is editable inline after generation. You edit your words directly, not by re-prompting.
- Design consistency enforced through tokens, instructions, and reusable components — not luck. The 10th page is far more consistent than the 1st because the system learned from the first 9.
- Components, collections, versioning, media management, SEO, multi-user auth — it's a full platform, not a code export.

## Architecture

Single `node:http` process. One runtime dependency: `@anthropic-ai/sdk`. No Express, no React, no bundler, no database.

### Flat-file content model

```
content/
  site.json              # Site name, global settings
  decisions.json         # Design tokens (CSS vars) and instructions
  users.json             # Multi-user auth (admin/editor roles, scrypt hashes)
  pages.json             # Page metadata (title, slug, status, intent)
  pages/                 # One .html file per page
  partials.json          # Component metadata (name, mode, weight, scope)
  partials/              # One .html file per component
  collections/           # Structured content types (blog, products, etc.)
  functions/             # Sandboxed server-side JS
  media/                 # Uploaded assets
  chats/                 # Per-page AI conversation history
  history/               # Version snapshots
```

All state is plain files. `git diff` shows every change. Copy the `content/` folder to back up or migrate a site. No export/import tooling needed.

### Page rendering pipeline

When a page is requested, the server:

1. Reads the HTML file from `content/pages/`
2. Resolves `<!-- @partial:name -->` directives (replaces with component HTML, collects CSS/JS into single blocks)
3. Resolves `<!-- @collection:slug -->` directives (queries entries, fills templates)
4. Injects token decisions as CSS custom properties (`<style data-sm-tokens>:root { --color-primary: ...; }</style>`)
5. Injects the editing overlay (toolbar, chat panel, image panel, site panel)
6. Runs extension hooks (`onPageRender`)

No build step. No compilation. Files on disk are the source of truth.

### Inline editing overlay

Every served page gets an injected overlay providing:

- **contenteditable text editing** — click any `data-content` element, formatting toolbar appears
- **Section selection** — click a `data-section` area, type an AI instruction, changes apply to just that section
- **AI chat panel** — conversational editing for structural changes and multi-step modifications
- **Image panel** — scans DOM for all `<img>` and `background-image` elements, replace via upload
- **Site panel** — live view of decisions (inline-editable with real-time CSS var updates), components (iframe previews), and media library

Changes save directly to HTML files. The overlay cleans itself out of the saved HTML (removes `contenteditable` attributes, overlay elements, editing classes).

### Components

Two types, both stored as single HTML files (markup + `<style>` + optional `<script>`):

- **Partials**: Server-injected via `<!-- @partial:name -->`. Two modes — `global` (same everywhere: headers, footers) and `injectable` (data-driven templates that read `data-*` attributes from context).
- **Patterns**: Reference templates the AI consults when generating similar elements. Not injected, just guidance.

Deleting a partial that's in use triggers a check — affected pages are listed, and if confirmed, the partial's HTML is inlined back into each page before removal.

### Decisions

Token decisions are CSS custom properties. The server injects all tokens as `:root` variables at serve time. The AI uses `var()` references and never hardcodes values. Change `decisions.json`, the entire site updates.

Instruction decisions are prose constraints included in AI prompts. Each decision has a weight (`rule` or `guide`) and scope (`global`, `page:slug`, `collection:slug`).

### AI integration

Three entry points, all sharing `buildArchitecturePrompt()` for a consistent view of the content model:

- `generatePage(intent)` — full HTML page + proposed decisions and components
- `chatSite(message, history, pageHTML, pageSlug)` — conversational editing with structured JSON responses (find-and-replace changes + create/delete actions)
- `generateCollectionTemplates(collection)` — listing/detail templates for structured content

The AI can create and delete pages, partials, collections, entries, and functions. All actions are executed server-side. Real-time updates via SSE push changes to any open overlay.

### Sandboxed functions

User/AI-authored server logic at `/api/fn/{name}`. Runs in a `vm` sandbox with three APIs: `store` (read/write collections), `http` (outbound requests), `env` (environment variables). No filesystem, no imports, no process access. Safe for the AI to generate.

### Extensions

Full Node.js extensions in `extensions/` for integrations that need real access. Hot-reloaded on file change.

- Routes under `/x/{name}/*`
- Middleware (intercept page requests)
- Lifecycle hooks: `onRequest`, `onPageRender`, `onPageSave`, `onContentChange`, `onAIResponse`
- Dashboard panels and overlay toolbar buttons
- Generate enhancers (inject fields and context into page generation)

Included: Figma extension (extracts design tokens, layout structure, and images from Figma files via the REST API).

### Two-tier trust model

| Tier | Location | Access | AI-safe? |
|------|----------|--------|----------|
| **Functions** | `content/functions/` | Sandboxed: `store`, `http`, `env` only | Yes |
| **Extensions** | `extensions/` | Full Node.js, any npm package | No — developer-owned |

### Security

- Atomic writes on all file operations (write to temp, rename)
- Path traversal protection on all routes
- Body size limits: 2 MB JSON, 20 MB media
- File type allowlist on uploads
- Multi-user auth with scrypt hashing, role-based access (admin/editor)
- HttpOnly session cookies, Secure flag auto-set behind HTTPS
- Sandboxed function execution with strict timeout

## Deploying

Single Node.js process. Put it behind a reverse proxy for HTTPS (nginx, Caddy, Cloudflare Tunnel), set `ANTHROPIC_API_KEY`, run `node server.js`. Requires Node.js >= 20.

## Contributing

Stablemount is MIT-licensed. The entire codebase is intentionally dependency-minimal and framework-free — vanilla JS on both server and client. PRs welcome.

## License

MIT

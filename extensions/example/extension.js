// ─────────────────────────────────────────────────────────────
// Example Stablemount Extension
// ─────────────────────────────────────────────────────────────
// This file is the entry point for an extension. Drop a folder
// into extensions/ with an extension.js file and the server
// picks it up automatically on startup. Extensions hot-reload
// when you save — no server restart needed.
//
// You only export what you need. Everything below is optional.
// ─────────────────────────────────────────────────────────────

// The id is used to identify this extension in logs and manifests.
// If omitted, the folder name is used instead.
//
// export const id = 'example';


// ─── Routes ─────────────────────────────────────────────────
// Custom API endpoints, mounted under /x/.
// Each object in the array defines a path and HTTP method handlers.
// Handlers receive { body, query, params, req, res } and return { status, body }.
// Content type is auto-detected: strings starting with < are served as HTML,
// objects as JSON. Override with { status, body, type: 'text/csv' }.
// Paths ending in /* are wildcards — params.path has the matched portion.
//
// export const routes = [
//   {
//     path: '/example',
//     async GET({ query }) {
//       return { status: 200, body: { hello: 'world', query } };
//     },
//     async POST({ body }) {
//       // Do something with the posted data
//       return { status: 201, body: { received: body } };
//     },
//   },
//   {
//     path: '/example/*',
//     async GET({ params }) {
//       // params.path is everything after /example/
//       // e.g. /x/example/panel → params.path = 'panel'
//       return { status: 200, body: { subpath: params.path } };
//     },
//   },
// ];


// ─── Middleware ──────────────────────────────────────────────
// Runs before matching pages render. Can redirect, block, or pass through.
// "pages" is a pattern: '*' for all, 'about' for one page,
// 'blog/*' for a prefix, or 'about, contact' for a list.
//
// export const middleware = [
//   {
//     pages: 'account, account/*',
//     async before({ path, slug, method, headers }) {
//       // Check auth, return { redirect: '/login' } to redirect,
//       // return { status: 403, body: 'Forbidden' } to block,
//       // or return nothing to allow the request through.
//     },
//   },
// ];


// ─── Hooks ──────────────────────────────────────────────────
// Lifecycle functions that react to server events.
// Multiple extensions can define the same hook — they all run in order.
//
// export const hooks = {
//
//   // Runs before every HTTP request.
//   // Return { redirect } or { status, body } to short-circuit.
//   onRequest({ path, method, headers, url }) {},
//
//   // Runs after page HTML is assembled, before the overlay is injected.
//   // Return modified HTML to transform it, or nothing to leave it alone.
//   onPageRender(html, slug) {},
//
//   // Runs when page HTML is saved (from overlay or API).
//   // Return modified HTML or nothing.
//   onPageSave(html, slug) {},
//
//   // Notification when content changes. Cannot modify the content.
//   // action is 'save' (manual) or 'ai-edit' (AI-applied change).
//   onContentChange({ type, slug, action }) {},
//
//   // Fires after the AI processes a chat message.
//   // For observing/logging, not modifying.
//   async onAIResponse({ reply, changes, actions, page }) {},
//
// };


// ─── Dashboard UI ───────────────────────────────────────────
// Add a nav item to the dashboard sidebar and a panel that loads
// when clicked. The panel URL should point to one of your routes
// that serves HTML.
//
// export const ui = {
//   dashboard: {
//     nav: { label: 'Example' },
//     panel: '/x/example/panel',
//
//     // generateEnhancer: inject extra fields into the "+ Generate Page" modal.
//     // fields: URL returning an HTML fragment (use data-enhancer-field on inputs).
//     // prepare: URL POSTed before generation; return { context: "..." } to prepend to intent.
//     // generateEnhancer: {
//     //   label: 'Example',
//     //   icon: '⚡',
//     //   fields: '/x/example/gen-fields',
//     //   prepare: '/x/example/gen-prepare',
//     // },
//   },
// };


// ─── Overlay UI ─────────────────────────────────────────────
// Add buttons to the page editing experience.
//
// toolbar: buttons in the floating formatting toolbar.
//   - icon: a single character or emoji shown on the button
//   - action: URL to POST to with { page, selection } when clicked
//
// contextMenu: buttons in the bar that appears when a section is selected.
//   - action: URL to POST to with { page, selection } when clicked
//
// Both receive a POST with:
//   { page: { slug, title, html }, selection: { name, html } | null }
// Return { html } to replace the page, or { message } to show a toast.
//
// export const overlay = {
//   toolbar: [
//     { label: 'My Tool', icon: '⚡', action: '/x/example/tool' },
//   ],
//   contextMenu: [
//     { label: 'Analyze Section', action: '/x/example/analyze' },
//   ],
// };

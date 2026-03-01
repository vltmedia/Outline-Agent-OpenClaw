---
name: outline_tools
description: Read, search, create, update, and append to Outline documents using registered plugin tools.
metadata: {"openclaw":{"emoji":"📓","requires":{"plugins":["outline_tools"]},"homepage":"https://www.getoutline.com/developers"}}
---

# Outline Tools skill

Interact with Outline (wiki/docs) using the tools registered by the `outline_tools` plugin.
Do NOT make raw HTTP calls — use the tools below instead.

## Root document anchoring

All operations are scoped to children of the configured `rootDoc`. This prevents documents from being scattered across the workspace.

- **Always call `outline_root_info` first** to understand the doc tree you're working in. It returns the root document's metadata and its immediate children.
- `outline_documents_create` automatically nests new documents under the rootDoc unless a different `parentDocumentId` is specified. The `collectionId` is auto-derived — you never need to provide it.
- You **cannot** modify, delete, archive, or move documents that are outside the rootDoc subtree. Attempts will be rejected with an error.
- You **cannot** delete or archive the rootDoc itself — only its children.
- Arbitrary nesting is supported: you can create documents at any depth (e.g. `rootDoc/Theme/Dark/Fun/Balloons`) as long as every ancestor traces back to the rootDoc.

## Available tools

| Tool | Purpose |
|------|---------|
| `outline_root_info` | Get rootDoc metadata and its children — **call this first** |
| `outline_collections_list` | List all collections |
| `outline_documents_search` | Search docs by query, optionally filter by `collectionName` |
| `outline_documents_info` | Get full document content + metadata by `id` |
| `outline_documents_create` | Create a new document under rootDoc (`title`, `text`, optional `parentDocumentId`) |
| `outline_documents_update` | Replace a document's full markdown body by `id` |
| `outline_documents_append` | Safely append markdown to a document by `id` |
| `outline_documents_move` | Move a document to a different parent within the rootDoc subtree |
| `outline_documents_duplicate` | Duplicate a document within the rootDoc subtree |
| `outline_documents_archive` | Archive a document (not rootDoc itself) |
| `outline_documents_restore` | Restore an archived document |
| `outline_documents_delete` | Delete a document (not rootDoc itself) |

## When to use each tool

### Reading
- **Start here**: `outline_root_info` to see the root document and its children.
- **Find docs**: `outline_documents_search` with a `query`. Add `collectionName` to narrow results.
- **Read a doc**: `outline_documents_info` with the `id` from search results.
- **Browse collections**: `outline_collections_list` to discover what exists.

### Writing
- **New doc**: `outline_documents_create` — requires `title` and `text` (markdown). Optionally pass `parentDocumentId` to nest under a specific child of rootDoc.
- **Full rewrite**: `outline_documents_update` — pass `id` and the complete new `text`.
- **Append safely**: `outline_documents_append` — pass `id` and `appendText`. Use `datedHeading` (e.g. `"2026-02-27"`) to add a dated section header automatically.

## Organizing documents

- **Walk the existing hierarchy before creating.** When placing a document at a nested path (e.g. `rootDoc / A / B / C`), you MUST resolve each level of the path from the top down before creating anything:
  1. Call `outline_root_info` to get the rootDoc's immediate children.
  2. For each level of the target path, check if a document with that title already exists among the current parent's children (use `outline_documents_info` on the parent to see its children, or search by title).
  3. If it exists, use its `id` as the `parentDocumentId` for the next level — do **not** create a duplicate.
  4. Only create a document when you reach a level in the path that does **not** already exist.
  5. Example: user says "create doc C under A / B". First check if A exists under rootDoc (it might). Then check if B exists under A (it might). Only then create C under the existing B. Never blindly recreate A and B.
- **Keep the tree organized.** When a user asks for a document to be placed as a child of another document, use `outline_documents_create` with the `parentDocumentId` set to the target parent. If the document already exists and needs to be relocated, use `outline_documents_move` to re-parent it — do not recreate it.
- **Use `outline_documents_move`** whenever a user wants to reorganize the hierarchy — e.g. "put X under Y", "move X into Y", "make X a child of Y". Look up both documents first (search or info), then move the child under the parent.
- **Think about structure.** If a user is creating multiple related documents, group them logically — create a parent doc first if one doesn't exist, then nest the children under it rather than dumping everything flat under rootDoc.

## Best practices

- **Never change a document's title** unless the user explicitly asks you to rename it. When using `outline_documents_update`, omit the `title` field to leave it unchanged. Changing titles without being asked is disruptive — the user chose that title deliberately.
- **Always verify docs by name.** When a user references a document by name (e.g. "update the Design Notes doc"), use `outline_documents_search` to find it first. Do not guess the id or assume it exists — confirm it via search, then use the returned id. If no match is found, tell the user the document wasn't found rather than creating a new one silently.
- **Prefer append over update** when adding new content to an existing doc. This avoids accidentally losing existing content.
- **Search before create** to avoid duplicates. If a doc with the same title already exists at the intended location, update or append instead. This applies to every level of a nested path — never recreate parent documents that already exist.
- **Use datedHeading** when appending logs, notes, or daily entries so the doc stays organized.
- **Keep docs human-readable**: use headings, bullets, and tables. Don't dump raw data.
- When reporting results to the user, always cite the doc title and id.

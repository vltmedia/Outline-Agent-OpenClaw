# Outline Tools Plugin

An OpenClaw plugin that gives agents full read/write access to an [Outline](https://www.getoutline.com/) wiki instance, scoped to a single root document tree.

## Configuration

Add the plugin to your `openclaw.json` under `skills.entries`:

```json
{
  "skills": {
    "entries": {
      "outline_tools": {
        "enabled": true
      }
    }
  }
}
```

The plugin requires three config values (defined in `openclaw.plugin.json`):

| Property | Required | Description |
|----------|----------|-------------|
| `baseUrl` | Yes | Your Outline instance URL (e.g. `https://wiki.example.com`) |
| `apiToken` | Yes | Outline API token (Bearer). Treat as sensitive. |
| `rootDoc` | Yes | URL or ID of the Outline document to anchor all operations under |

Optional properties for Cloudflare Access-protected instances:

| Property | Description |
|----------|-------------|
| `cfAccessClientId` | CF Access service token client ID |
| `cfAccessClientSecret` | CF Access service token client secret |

## Root Document Anchoring

The `rootDoc` config is the key constraint. Every write operation is scoped to the subtree beneath this document:

- **Create** auto-nests new documents under `rootDoc` (no `collectionId` needed)
- **Update/Append** only works on `rootDoc` or its descendants
- **Delete/Archive** only works on descendants (the root itself is protected)
- **Move/Duplicate** validates both source and target are within the tree

This prevents the agent from scattering documents across the workspace. The `collectionId` is automatically derived from the root document.

## Tools

### Read Tools

| Tool | Description |
|------|-------------|
| `outline_root_info` | Returns root document metadata and its immediate children. Call this first. |
| `outline_collections_list` | Lists all collections in the Outline instance. |
| `outline_documents_search` | Full-text search across documents. Supports `collectionName` filter and `limit`. |
| `outline_documents_info` | Fetches a single document's full content and metadata by ID. |

### Write Tools

| Tool | Description |
|------|-------------|
| `outline_documents_create` | Creates a new document. Requires `title` and `text`. Optional `parentDocumentId` (defaults to rootDoc). |
| `outline_documents_update` | Full markdown replacement of a document's body by `id`. |
| `outline_documents_append` | Appends markdown to a document. Supports `datedHeading` for automatic section headers. |
| `outline_documents_move` | Moves a document under a different parent. Auto-publishes drafts before moving. |
| `outline_documents_duplicate` | Duplicates a document, optionally under a different parent. Supports `recursive` for child docs. |
| `outline_documents_archive` | Archives a document (cannot archive rootDoc itself). |
| `outline_documents_restore` | Restores an archived or deleted document. Supports restoring to a specific `revisionId`. |
| `outline_documents_delete` | Moves a document to trash. Set `permanent: true` to destroy permanently. Cannot delete rootDoc. |

## File Structure

```
outline_tools/
  openclaw.plugin.json   # Plugin manifest and config schema
  index.ts               # All tool registrations and logic
  skills/
    SKILLS.md            # Agent-facing skill instructions
```

## How It Works

1. On first use, `resolveRootDoc()` extracts the document ID from the configured `rootDoc` URL, fetches its metadata via `documents.info`, and caches the result (id, collectionId, title) for the session.

2. Write tools call `guardDescendant()` or `guardDescendantNotRoot()` before executing. These walk up the `parentDocumentId` chain (max 20 hops, with cycle protection) to verify the target document is inside the root tree.

3. If a document falls outside the tree, the tool returns an error message instead of executing the operation.

4. All API calls go through `outlinePost()`, which handles auth headers (Bearer token + optional CF Access headers) and error formatting.

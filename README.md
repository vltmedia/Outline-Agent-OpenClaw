# Outline — OpenClaw Server

An OpenClaw server that connects agents to an [Outline](https://www.getoutline.com/) wiki instance. Agents can search, read, create, update, move, and delete documents — all scoped to a configurable root document tree so they don't scatter content across the workspace.

## Project Structure

```
.
├── openclaw/
│   ├── openclaw.json                        # Server configuration
│   └── plugins/
│       └── outline_tools/                   # Outline API plugin
│           ├── openclaw.plugin.json         # Plugin manifest & config schema
│           ├── index.ts                     # Tool implementations
│           ├── README.md                    # Plugin-specific docs
│           └── skills/
│               └── SKILLS.md               # Agent-facing instructions
└── .claude/
    └── settings.local.json                  # Local dev permissions
```

## Setup

### 1. Plugin Configuration

The `outline_tools` plugin requires three values:

| Property | Description |
|----------|-------------|
| `baseUrl` | Your Outline instance URL (e.g. `https://wiki.example.com`) |
| `apiToken` | Outline API token (Bearer) |
| `rootDoc` | URL or ID of the root document to anchor all operations under |

If your Outline instance is behind Cloudflare Access, you can also provide `cfAccessClientId` and `cfAccessClientSecret`.

### 2. Server Configuration (`openclaw.json`)

The server config defines agent behavior, gateway auth, and enabled skills:

```json
{
  "agents": {
    "list": [
      {
        "skills": ["outline_tools"]
      }
    ]
  },
  "skills": {
    "entries": {
      "outline_tools": {
        "enabled": true
      }
    }
  }
}
```

Key sections:

- **`agents.list`** — Agents and the skills they have access to
- **`messages`** — Message handling (ack reaction scope)
- **`commands`** — Command registration (native, skills, restart)
- **`session`** — Session scoping (DM scope per channel peer)
- **`gateway`** — Auth mode and denied node commands
- **`skills.entries`** — Which plugins are enabled

## What the Agent Can Do

### Read

- **`outline_root_info`** — View the root document and its children (start here)
- **`outline_collections_list`** — Browse all collections
- **`outline_documents_search`** — Full-text search with optional collection filter
- **`outline_documents_info`** — Fetch a document's full content by ID

### Write

- **`outline_documents_create`** — Create documents (auto-nested under rootDoc)
- **`outline_documents_update`** — Replace a document's markdown body
- **`outline_documents_append`** — Safely append content with optional dated headings
- **`outline_documents_move`** — Reorganize the document hierarchy
- **`outline_documents_duplicate`** — Copy documents within the tree
- **`outline_documents_archive`** / **`outline_documents_restore`** — Archive and restore
- **`outline_documents_delete`** — Trash or permanently delete

### Safety Constraints

All write operations enforce **root document anchoring**:

- Documents can only be created, modified, or deleted within the rootDoc subtree
- The rootDoc itself cannot be deleted or archived
- `collectionId` is auto-derived — agents never need to specify it
- Ancestry is validated by walking up the `parentDocumentId` chain before every write

## Outline API Reference

This plugin wraps the [Outline API](https://www.getoutline.com/developers). The agent should use the registered tools — not raw HTTP calls.

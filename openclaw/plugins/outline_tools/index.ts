/**
 * Outline Tools (no dependencies)
 * Plugin id: outline_tools
 *
 * Configure in openclaw.json:
 * plugins.entries["outline_tools"].config = {
 *   baseUrl: "https://...",
 *   apiToken: "....",
 *   rootDoc: "https://.../doc/...",
 *   cfAccessClientId?: "...",
 *   cfAccessClientSecret?: "..."
 * }
 */


function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

type OutlineConfig = {
  baseUrl: string;
  apiToken: string;
  rootDoc: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
};

function getCfg(api: any): OutlineConfig {
  // Debug: log top-level keys on api so we can find where config lives
  console.log("[outline_tools] api keys:", Object.keys(api ?? {}));
  console.log("[outline_tools] api.config:", JSON.stringify(api.config ?? null));
  console.log("[outline_tools] api.pluginConfig:", JSON.stringify((api as any).pluginConfig ?? null));
  console.log("[outline_tools] api.settings:", JSON.stringify((api as any).settings ?? null));

  // Try multiple possible locations
  const cfg = api.config ?? (api as any).pluginConfig ?? (api as any).settings ?? {};

  if (!cfg.baseUrl || !cfg.apiToken) {
    throw new Error(
      "outline_tools plugin config is missing baseUrl or apiToken. " +
      "Check plugins.entries.outline_tools.config in openclaw.json. " +
      `Got keys: ${JSON.stringify(Object.keys(cfg))}`
    );
  }
  return {
    baseUrl: cfg.baseUrl,
    apiToken: cfg.apiToken,
    rootDoc: cfg.rootDoc ?? "",
    cfAccessClientId: cfg.cfAccessClientId,
    cfAccessClientSecret: cfg.cfAccessClientSecret,
  };
}

type RootDocInfo = { id: string; collectionId: string; title: string; url: string };
let _cachedRootDoc: RootDocInfo | null = null;

async function resolveRootDoc(api: any): Promise<RootDocInfo> {
  if (_cachedRootDoc) return _cachedRootDoc;

  const cfg = getCfg(api);
  console.log("HEYYY");
  console.log(cfg);
  if (!cfg.rootDoc) throw new Error("rootDoc is not configured. Set it in the plugin config.");

  // Extract urlId from URL: everything after /doc/
  const urlMatch = cfg.rootDoc.match(/\/doc\/(.+?)(?:\/|$)/);
  const identifier = urlMatch ? urlMatch[1] : cfg.rootDoc;

  const result = await outlinePost(api, "documents.info", { id: identifier });
  const doc = result?.data ?? result;

  if (!doc?.id) throw new Error(`Could not resolve rootDoc from: ${cfg.rootDoc}`);

  _cachedRootDoc = {
    id: doc.id,
    collectionId: doc.collectionId,
    title: doc.title,
    url: doc.url,
  };
  return _cachedRootDoc;
}

async function isDescendantOfRoot(api: any, docId: string, rootDocId: string): Promise<boolean> {
  if (docId === rootDocId) return true;

  const visited = new Set<string>();
  let currentId = docId;
  const MAX_DEPTH = 20;

  for (let i = 0; i < MAX_DEPTH; i++) {
    if (visited.has(currentId)) return false;
    visited.add(currentId);

    const result = await outlinePost(api, "documents.info", { id: currentId });
    const doc = result?.data ?? result;
    const parentId = doc?.parentDocumentId;

    if (!parentId) return false;
    if (parentId === rootDocId) return true;
    currentId = parentId;
  }
  return false;
}

async function guardDescendant(api: any, docId: string, _label?: string): Promise<string | null> {
  const root = await resolveRootDoc(api);
  const ok = await isDescendantOfRoot(api, docId, root.id);
  if (!ok) {
    return `Document ${docId} is not under the rootDoc (${root.title}). Operations are restricted to children of the root document.`;
  }
  return null;
}

async function guardDescendantNotRoot(api: any, docId: string, label: string): Promise<string | null> {
  const root = await resolveRootDoc(api);
  if (docId === root.id) {
    return `Cannot ${label} the rootDoc itself (${root.title}). Only children of the root document can be targeted.`;
  }
  return guardDescendant(api, docId, label);
}

async function outlinePost(api: any, endpoint: string, body: any) {
  const cfg = getCfg(api);
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = `${base}/api/${endpoint}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiToken}`,
  };

  if (cfg.cfAccessClientId && cfg.cfAccessClientSecret) {
    headers["CF-Access-Client-Id"] = cfg.cfAccessClientId;
    headers["CF-Access-Client-Secret"] = cfg.cfAccessClientSecret;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });

  const raw = await res.text();
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg = json?.message || json?.error || raw || `HTTP ${res.status}`;
    throw new Error(`Outline API ${endpoint} failed: ${res.status} ${msg}`);
  }

  return json;
}

function mdAppend(existing: string, toAppend: string, datedHeading?: string) {
  const safeExisting = (existing ?? "").trimEnd();
  const safeAppend = (toAppend ?? "").trim();
  if (!safeAppend) return safeExisting + "\n";
  const chunk = (datedHeading ? `\n\n## ${datedHeading}\n\n` : "\n\n") + safeAppend + "\n";
  return safeExisting + chunk;
}

export default function register(api: any) {
  // READ: collections.list
  api.registerTool({
    name: "outline_collections_list",
    description: "List Outline collections.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_id: string, _params: any) {
      const data = await outlinePost(api, "collections.list", {});
      return textResult(JSON.stringify(data, null, 2));
    },
  });

  // READ: outline_root_info
  api.registerTool({
    name: "outline_root_info",
    description: "Get the configured rootDoc metadata and its immediate children. Call this first to understand the doc tree you're working in.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    async execute(_id: string, _params: any) {
      const root = await resolveRootDoc(api);

      // Fetch children: documents with parentDocumentId === root.id
      const childrenResult = await outlinePost(api, "documents.list", {
        parentDocumentId: root.id,
      });
      const childDocs: any[] = childrenResult?.data ?? [];
      const children = childDocs.map((d: any) => ({
        id: d.id,
        title: d.title,
        url: d.url,
        updatedAt: d.updatedAt,
      }));

      return textResult(JSON.stringify({
        rootDoc: {
          id: root.id,
          title: root.title,
          url: root.url,
          collectionId: root.collectionId,
        },
        children,
      }, null, 2));
    },
  });

  // READ: documents.search
  api.registerTool({
    name: "outline_documents_search",
    description:
      "Search Outline documents. Optionally filter by collectionName (e.g., DevBed).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        collectionName: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
    async execute(_id: string, params: any) {
      const limit = Math.max(1, Math.min(50, params?.limit ?? 10));
      const result = await outlinePost(api, "documents.search", { query: params.query });

      let docs: any[] = result?.data ?? result?.documents ?? [];
      if (params?.collectionName) {
        const want = String(params.collectionName).toLowerCase();
        docs = docs.filter((d) => String(d?.collection?.name ?? "").toLowerCase() === want);
      }

      const compact = docs.slice(0, limit).map((d) => ({
        id: d.id,
        title: d.title,
        url: d.url,
        updatedAt: d.updatedAt,
        publishedAt: d.publishedAt,
        collection: d.collection ? { id: d.collection.id, name: d.collection.name } : undefined,
      }));

      return textResult(JSON.stringify({ matches: compact }, null, 2));
    },
  });

  // READ: documents.info
  api.registerTool({
    name: "outline_documents_info",
    description: "Get full Outline document content and metadata by id.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    async execute(_id: string, params: any) {
      const result = await outlinePost(api, "documents.info", { id: params.id });
      const doc = result?.data ?? result;

      const payload = {
        id: doc?.id,
        title: doc?.title,
        url: doc?.url,
        collection: doc?.collection ? { id: doc.collection.id, name: doc.collection.name } : undefined,
        text: doc?.text,
        updatedAt: doc?.updatedAt,
        publishedAt: doc?.publishedAt,
      };

      return textResult(JSON.stringify(payload, null, 2));
    },
  });

  // WRITE: documents.create
  api.registerTool({
    name: "outline_documents_create",
    description: "Create a new Outline document (Markdown). Auto-nests under the configured rootDoc unless a parentDocumentId is provided.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        text: { type: "string" },
        parentDocumentId: { type: "string", description: "Parent document UUID to nest under. Must be rootDoc or a descendant. Defaults to rootDoc." },
        publish: { type: "boolean" },
      },
      required: ["title", "text"],
    },
    async execute(_id: string, params: any) {
      const root = await resolveRootDoc(api);
      const parentId = params.parentDocumentId || root.id;

      // Validate parent is rootDoc or descendant
      if (parentId !== root.id) {
        const err = await guardDescendant(api, parentId, "create under");
        if (err) return textResult(JSON.stringify({ error: err }));
      }

      const result = await outlinePost(api, "documents.create", {
        collectionId: root.collectionId,
        parentDocumentId: parentId,
        title: params.title,
        text: params.text,
        publish: params.publish ?? true,
      });
      const doc = result?.data ?? result;
      return textResult(JSON.stringify({ created: true, id: doc?.id, title: doc?.title, url: doc?.url }, null, 2));
    },
  });

  // WRITE: documents.update
  api.registerTool({
    name: "outline_documents_update",
    description: "Update an Outline document (full markdown replacement).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        text: { type: "string" },
        title: { type: "string" },
        publish: { type: "boolean" },
      },
      required: ["id", "text"],
    },
    async execute(_id: string, params: any) {
      const err = await guardDescendant(api, params.id, "update");
      if (err) return textResult(JSON.stringify({ error: err }));

      const result = await outlinePost(api, "documents.update", {
        id: params.id,
        text: params.text,
        title: params.title,
        publish: params.publish ?? true,
      });
      const doc = result?.data ?? result;
      return textResult(JSON.stringify({ updated: true, id: doc?.id, title: doc?.title, url: doc?.url }, null, 2));
    },
  });

  // WRITE: safe append
  api.registerTool({
    name: "outline_documents_append",
    description: "Append markdown to an Outline document (safe edit).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        appendText: { type: "string" },
        datedHeading: { type: "string" },
        publish: { type: "boolean" },
      },
      required: ["id", "appendText"],
    },
    async execute(_id: string, params: any) {
      const err = await guardDescendant(api, params.id, "append to");
      if (err) return textResult(JSON.stringify({ error: err }));

      const info = await outlinePost(api, "documents.info", { id: params.id });
      const doc = info?.data ?? info;
      const merged = mdAppend(doc?.text ?? "", params.appendText, params.datedHeading);

      const updated = await outlinePost(api, "documents.update", {
        id: params.id,
        text: merged,
        publish: params.publish ?? true,
      });

      const out = updated?.data ?? updated;
      return textResult(JSON.stringify({ appended: true, id: out?.id, title: out?.title, url: out?.url }, null, 2));
    },
  });

  // WRITE: documents.move
  api.registerTool({
    name: "outline_documents_move",
    description: "Move an Outline document to a different collection or under a parent document. If no parentDocumentId is given, the doc lands at the collection root.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Document id (UUID or urlId) to move" },
        collectionId: { type: "string", description: "Target collection UUID" },
        parentDocumentId: { type: "string", description: "Optional parent document UUID to nest under" },
        index: { type: "number", description: "Optional position index in the collection structure" },
      },
      required: ["id"],
    },
    async execute(_id: string, params: any) {
      const moveErr = await guardDescendantNotRoot(api, params.id, "move");
      if (moveErr) return textResult(JSON.stringify({ error: moveErr }));

      if (params.parentDocumentId) {
        const parentErr = await guardDescendant(api, params.parentDocumentId, "move to");
        if (parentErr) return textResult(JSON.stringify({ error: parentErr }));
      }

      // Auto-publish drafts before moving (Outline rejects moving drafts)
      const info = await outlinePost(api, "documents.info", { id: params.id });
      const existing = info?.data ?? info;
      if (!existing?.publishedAt) {
        await outlinePost(api, "documents.update", {
          id: params.id,
          text: existing?.text ?? "",
          publish: true,
        });
      }

      // Only send fields the Outline API accepts — nothing extra
      const body: Record<string, any> = { id: params.id };
      if (params.collectionId) body.collectionId = params.collectionId;
      if (params.parentDocumentId) body.parentDocumentId = params.parentDocumentId;
      if (params.index != null) body.index = params.index;

      const result = await outlinePost(api, "documents.move", body);
      const doc = result?.data ?? result;
      const wasPublished = !existing?.publishedAt;
      return textResult(JSON.stringify({ moved: true, autoPublished: wasPublished, id: doc?.id, title: doc?.title, url: doc?.url }, null, 2));
    },
  });

  // WRITE: documents.duplicate
  api.registerTool({
    name: "outline_documents_duplicate",
    description: "Duplicate an Outline document. Optionally place copy in a different collection or under a parent doc.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Document id (UUID or urlId) to duplicate" },
        title: { type: "string", description: "Title for the copy" },
        collectionId: { type: "string", description: "Target collection UUID for the copy" },
        parentDocumentId: { type: "string", description: "Parent document UUID to nest the copy under" },
        publish: { type: "boolean", description: "Whether the copy should be published immediately" },
        recursive: { type: "boolean", description: "Whether child documents should also be duplicated" },
      },
      required: ["id"],
    },
    async execute(_id: string, params: any) {
      const dupErr = await guardDescendant(api, params.id, "duplicate");
      if (dupErr) return textResult(JSON.stringify({ error: dupErr }));

      if (params.parentDocumentId) {
        const parentErr = await guardDescendant(api, params.parentDocumentId, "duplicate into");
        if (parentErr) return textResult(JSON.stringify({ error: parentErr }));
      }

      const root = await resolveRootDoc(api);
      const body: Record<string, any> = { id: params.id };
      if (params.title) body.title = params.title;
      body.collectionId = params.collectionId || root.collectionId;
      if (params.parentDocumentId) body.parentDocumentId = params.parentDocumentId;
      if (params.publish != null) body.publish = params.publish;
      if (params.recursive != null) body.recursive = params.recursive;

      const result = await outlinePost(api, "documents.duplicate", body);
      const doc = result?.data ?? result;
      return textResult(JSON.stringify({ duplicated: true, id: doc?.id, title: doc?.title, url: doc?.url }, null, 2));
    },
  });

  // WRITE: documents.archive
  api.registerTool({
    name: "outline_documents_archive",
    description: "Archive an Outline document.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Document id (UUID or urlId) to archive" },
      },
      required: ["id"],
    },
    async execute(_id: string, params: any) {
      const err = await guardDescendantNotRoot(api, params.id, "archive");
      if (err) return textResult(JSON.stringify({ error: err }));

      const result = await outlinePost(api, "documents.archive", { id: params.id });
      const doc = result?.data ?? result;
      return textResult(JSON.stringify({ archived: true, id: doc?.id, title: doc?.title }, null, 2));
    },
  });

  // WRITE: documents.restore
  api.registerTool({
    name: "outline_documents_restore",
    description: "Restore an archived or deleted Outline document. Optionally restore to a specific collection or revision.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Document id (UUID or urlId) to restore" },
        collectionId: { type: "string", description: "Collection UUID to restore into" },
        revisionId: { type: "string", description: "Revision UUID to restore to" },
      },
      required: ["id"],
    },
    async execute(_id: string, params: any) {
      const err = await guardDescendant(api, params.id, "restore");
      if (err) return textResult(JSON.stringify({ error: err }));

      const body: Record<string, any> = { id: params.id };
      if (params.collectionId) body.collectionId = params.collectionId;
      if (params.revisionId) body.revisionId = params.revisionId;

      const result = await outlinePost(api, "documents.restore", body);
      const doc = result?.data ?? result;
      return textResult(JSON.stringify({ restored: true, id: doc?.id, title: doc?.title, url: doc?.url }, null, 2));
    },
  });

  // WRITE: documents.delete
  api.registerTool({
    name: "outline_documents_delete",
    description: "Delete an Outline document (moves to trash). Set permanent=true to destroy permanently.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Document id (UUID or urlId) to delete" },
        permanent: { type: "boolean", description: "If true, permanently destroy instead of trashing" },
      },
      required: ["id"],
    },
    async execute(_id: string, params: any) {
      const err = await guardDescendantNotRoot(api, params.id, "delete");
      if (err) return textResult(JSON.stringify({ error: err }));

      const body: Record<string, any> = { id: params.id };
      if (params.permanent != null) body.permanent = params.permanent;

      await outlinePost(api, "documents.delete", body);
      return textResult(JSON.stringify({ deleted: true, id: params.id, permanent: params.permanent ?? false }, null, 2));
    },
  });
}
/**
 * Project ZIP Deployment Engine.
 *
 * Deploys or creates a project from a standard LocalMe ZIP bundle:
 * ├── localme.json       (Platform configuration: routes, roles, secrets, automations, settings)
 * └── codebase/          (Static frontend project assets: HTML, CSS, JS, etc.)
 *
 * In the config file, all fields are optional. Unset fields are initialized with
 * safe defaults or left empty.
 */
import { ApiError } from "@/lib/server/http";
import { readZip } from "@/lib/server/zip";
import {
  createProject,
  deleteFile,
  ensureLibraryProject,
  getUserById,
  listFiles,
  putFile,
  requireOwnedProject,
  updateProject,
  type ProjectRecord,
} from "@/lib/server/repos";
import { importFeature } from "@/lib/server/export/import-feature";
import { EXPORT_FEATURES } from "@/lib/server/export/common";
import { maxImportBytes, parseJsonSection } from "@/lib/server/export/archive";

export interface LocalMeConfig {
  /** Project name (1-63 chars: alphanumeric, _, -) */
  name?: string;
  /** Project description */
  description?: string;
  /** Project settings */
  settings?: {
    /** Whether platform watermark is enabled on HTML pages */
    watermarkEnabled?: boolean;
    /** Free monthly visits quota */
    freeVisitsPerMonth?: number;
  };
  /** Shared library assets mode: 'append' (default), 'skip', or 'overwrite' */
  libraryMode?: "append" | "overwrite" | "skip";
  /** Route rewrites and reverse proxy mounts */
  routes?: Array<{
    pathPattern: string;
    targetFile?: string | null;
    isProxy?: boolean;
    proxyConfig?: unknown;
    proxyUpstream?: string;
    requiresAuth?: boolean;
    requiredRole?: string | null;
    isActive?: boolean;
  }>;
  /** Visitor roles */
  roles?: Array<{
    name: string;
    permissions: string[];
  }>;
  /** Secrets for {{KEY}} substitution in proxies */
  secrets?: Record<string, string> | Array<{ key: string; value: string }>;
  /** Automations */
  automations?: {
    webhooks?: Array<{
      url: string;
      events: string[];
      secret?: string | null;
      isActive?: boolean;
    }>;
    cron?: Array<{
      task: string;
      isEnabled?: boolean;
      parameters?: Record<string, unknown>;
    }>;
  };
  /** Flat webhooks */
  webhooks?: Array<{
    url: string;
    events: string[];
    secret?: string | null;
    isActive?: boolean;
  }>;
  /** Flat cron */
  cron?: Array<{
    task: string;
    isEnabled?: boolean;
    parameters?: Record<string, unknown>;
  }>;
  /** Custom domains */
  domains?: Array<{
    domain: string;
    verificationToken?: string;
    isVerified?: boolean;
  }>;
  /** API endpoint toggles */
  endpoints?: Array<{
    endpoint: string;
    isEnabled?: boolean;
    requiresAuth?: boolean;
  }>;
}

export interface DeployOptions {
  projectId?: number | null;
  name?: string | null;
  libraryMode?: "append" | "overwrite" | "skip" | string | null;
}

export interface DeployResult {
  success: boolean;
  project: {
    id: number;
    name: string;
  };
  filesDeployed: number;
  featuresApplied: number;
  skipped: number;
  liveUrl: string;
}

export async function deployProjectArchive(
  userId: number,
  archive: Buffer,
  options: DeployOptions = {},
): Promise<DeployResult> {
  const maxBytes = await maxImportBytes(userId);
  if (archive.byteLength > maxBytes) {
    throw new ApiError(
      "payment_required",
      `Archive is larger than your ${maxBytes} byte storage cap.`,
    );
  }

  let entries: Array<{ path: string; content: Buffer }>;
  try {
    entries = readZip(archive, { maxEntryBytes: maxBytes });
  } catch {
    throw new ApiError("bad_request", "Body must be a valid ZIP archive.");
  }

  // 1. Locate and parse localme.json (or fallback config/config.json)
  let localmeJson: LocalMeConfig | null = null;
  const localmeEntry = entries.find(
    (e) => e.path === "localme.json" || e.path === "/localme.json",
  );
  if (localmeEntry) {
    localmeJson = parseJsonSection<LocalMeConfig>(localmeEntry, "localme.json");
  }

  // 2. Resolve or create target project
  let project: ProjectRecord;
  const user = await getUserById(userId);
  if (!user) throw new ApiError("unauthorized", "User not found.");

  if (options.projectId != null) {
    project = await requireOwnedProject(userId, options.projectId);
  } else {
    // Determine project name: options.name || localmeJson.name
    const rawName = (options.name || localmeJson?.name || "").trim().toLowerCase();
    if (!rawName) {
      throw new ApiError(
        "bad_request",
        "Project name is required. Specify 'name' in localme.json or in the deployment parameters.",
      );
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(rawName)) {
      throw new ApiError(
        "bad_request",
        "Project name must be 1-63 characters: alphanumeric, _ or - (starting with letter/digit).",
      );
    }
    project = await createProject(userId, rawName);
  }

  // 3. Handle library conflict and assets if library entries exist
  const libraryEntries = entries.filter(
    (e) => e.path.startsWith("library/") || e.path.startsWith("lib/"),
  );
  const libraryProject = await ensureLibraryProject(userId);
  const existingLibFiles = await listFiles(libraryProject.id, "");

  const effectiveLibraryMode = options.libraryMode || localmeJson?.libraryMode || "append";

  if (effectiveLibraryMode === "overwrite" && libraryEntries.length > 0) {
    for (const f of existingLibFiles) {
      await deleteFile(userId, libraryProject.id, f.path);
    }
  }

  // 4. Extract codebase assets
  const hasCodebasePrefix = entries.some((e) => e.path.startsWith("codebase/"));
  const hasStoragePrefix = entries.some((e) => e.path.startsWith("storage/"));

  let filesDeployed = 0;
  let skipped = 0;

  for (const entry of entries) {
    const isLibrary = entry.path.startsWith("library/") || entry.path.startsWith("lib/");
    if (isLibrary) {
      if (effectiveLibraryMode === "skip") {
        skipped++;
        continue;
      }
      const libPath = entry.path.startsWith("library/")
        ? entry.path.slice("library/".length)
        : entry.path.slice("lib/".length);

      if (!libPath || libPath.includes("..") || libPath.startsWith("/")) {
        skipped++;
        continue;
      }
      await putFile(userId, libraryProject.id, libPath, entry.content, true);
      filesDeployed++;
      continue;
    }

    let targetPath: string | null = null;
    if (hasCodebasePrefix && entry.path.startsWith("codebase/")) {
      targetPath = entry.path.slice("codebase/".length);
    } else if (hasStoragePrefix && entry.path.startsWith("storage/")) {
      targetPath = entry.path.slice("storage/".length);
    } else if (!hasCodebasePrefix && !hasStoragePrefix) {
      // Flat layout fallback: entries at root that are not config or docs
      const ignore =
        entry.path === "localme.json" ||
        entry.path.startsWith("config/") ||
        entry.path === "README.txt" ||
        entry.path === "README.md" ||
        entry.path === ".DS_Store";
      if (!ignore && !entry.path.endsWith("/")) {
        targetPath = entry.path;
      }
    }

    if (!targetPath || targetPath.includes("..") || targetPath.startsWith("/") || targetPath.length > 512) {
      skipped++;
      continue;
    }

    await putFile(userId, project.id, targetPath, entry.content, false);
    filesDeployed++;
  }

  // 5. Apply configuration from localme.json
  let featuresApplied = 0;

  if (localmeJson) {
    // Settings
    if (localmeJson.settings) {
      if (localmeJson.settings.watermarkEnabled !== undefined) {
        await updateProject(userId, project.id, {
          watermarkEnabled: Boolean(localmeJson.settings.watermarkEnabled),
        });
        featuresApplied++;
      }
    }

    // Routes
    if (localmeJson.routes && Array.isArray(localmeJson.routes)) {
      const normalizedRoutes = localmeJson.routes.map((r) => {
        let proxyConfig = r.proxyConfig;
        if (!proxyConfig && r.proxyUpstream) {
          proxyConfig = { upstream: r.proxyUpstream };
        }
        return {
          pathPattern: r.pathPattern,
          targetFile: r.targetFile ?? null,
          isProxy: Boolean(r.isProxy),
          proxyConfig: proxyConfig ?? null,
          requiresAuth: Boolean(r.requiresAuth),
          requiredRole: r.requiredRole ?? null,
          isActive: r.isActive ?? true,
        };
      });
      await importFeature(project.id, "routes", normalizedRoutes);
      featuresApplied++;
    }

    // Roles
    if (localmeJson.roles && Array.isArray(localmeJson.roles)) {
      await importFeature(project.id, "roles", localmeJson.roles);
      featuresApplied++;
    }

    // Secrets
    if (localmeJson.secrets) {
      let secretsList: Array<{ key: string; value: string }> = [];
      if (Array.isArray(localmeJson.secrets)) {
        secretsList = localmeJson.secrets;
      } else if (typeof localmeJson.secrets === "object") {
        secretsList = Object.entries(localmeJson.secrets).map(([key, value]) => ({
          key,
          value: String(value),
        }));
      }
      if (secretsList.length > 0) {
        await importFeature(project.id, "secrets", secretsList);
        featuresApplied++;
      }
    }

    // Webhooks
    const webhooks = localmeJson.automations?.webhooks ?? localmeJson.webhooks;
    if (webhooks && Array.isArray(webhooks)) {
      await importFeature(project.id, "webhooks", webhooks);
      featuresApplied++;
    }

    // Cron
    const cron = localmeJson.automations?.cron ?? localmeJson.cron;
    if (cron && Array.isArray(cron)) {
      await importFeature(project.id, "cron", cron);
      featuresApplied++;
    }

    // Domains
    const domains = localmeJson.domains;
    if (domains && Array.isArray(domains)) {
      await importFeature(project.id, "dns", domains);
      featuresApplied++;
    }

    // Endpoints
    const endpoints = localmeJson.endpoints;
    if (endpoints && Array.isArray(endpoints)) {
      await importFeature(project.id, "api", endpoints);
      featuresApplied++;
    }
  }

  // 6. Legacy config/config.json fallback support
  const legacyConfigEntry = entries.find((e) => e.path === "config/config.json");
  if (legacyConfigEntry && !localmeJson) {
    const bundle = parseJsonSection<Record<string, unknown>>(
      legacyConfigEntry,
      "config/config.json",
    );
    for (const feature of EXPORT_FEATURES) {
      if (bundle[feature] !== undefined) {
        try {
          await importFeature(project.id, feature, bundle[feature]);
          featuresApplied++;
        } catch {}
      }
    }
  }

  const legacySecretsEntry = entries.find((e) => e.path === "config/secrets.json");
  if (legacySecretsEntry && (!localmeJson || !localmeJson.secrets)) {
    try {
      await importFeature(
        project.id,
        "secrets",
        parseJsonSection(legacySecretsEntry, "config/secrets.json"),
      );
      featuresApplied++;
    } catch {}
  }

  return {
    success: true,
    project: {
      id: project.id,
      name: project.name,
    },
    filesDeployed,
    featuresApplied,
    skipped,
    liveUrl: `/${user.username}/${project.name}/`,
  };
}

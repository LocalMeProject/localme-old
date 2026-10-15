import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "deploy-test-"));
process.env.DB_DRIVER = "sqlite";
process.env.DB_PATH = `file:${join(tmp, "test.db")}`;
process.env.STORAGE_DATA_DIR = join(tmp, "storage_data");
process.env.SESSION_SECRET = "deploy-test-session-secret";
process.env.SECRETS_ENCRYPTION_KEY = "deploy-test-encryption-key-32-b!";

let sessionCookie = "";

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "localme_session" && sessionCookie ? { value: sessionCookie } : undefined,
    }),
}));

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/server/db/index";
import { createProject, createUser, getFileBlob, getProjectById } from "@/lib/server/repos";
import { createSession } from "@/lib/server/sessions";
import { buildZip } from "@/lib/server/zip";
import { deployProjectArchive } from "@/lib/server/deploy";
import { POST as deployRouteHandler } from "@/app/api/projects/deploy/route";
import { createCaptchaChallenge, verifyCaptcha } from "@/lib/server/captcha";

let db: ReturnType<typeof getDb>;
let user: { id: number; username: string };
let userCookie: string;

beforeAll(async () => {
  db = getDb();
  const dir = join(process.cwd(), "db", "sqlite");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(dir, file), "utf8"));
  }

  user = await createUser("deployuser", "Password123!");
  userCookie = await createSession(user.id);
  sessionCookie = userCookie;
});

afterAll(() => {
  db.close?.();
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});

describe("Captcha numbers under 20", () => {
  it("generates math challenge where operands and answers are strictly lower than 20", () => {
    for (let i = 0; i < 50; i++) {
      const { id, svg } = createCaptchaChallenge();
      const parts = id.split(".");
      const answer = Number(parts[1]);

      expect(answer).toBeLessThan(20);
      expect(answer).toBeGreaterThanOrEqual(2);

      // SVG text check: "a + b = ?"
      const match = svg.match(/(\d+)\s*\+\s*(\d+)\s*=\s*\?/);
      expect(match).not.toBeNull();
      const a = Number(match![1]);
      const b = Number(match![2]);

      expect(a).toBeLessThan(20);
      expect(b).toBeLessThan(20);
      expect(a + b).toBe(answer);
      expect(verifyCaptcha(id, String(answer))).toBe(true);
    }
  });
});

describe("ZIP Project Deployment Engine", () => {
  it("deploys a standard ZIP bundle with localme.json and codebase/ folder", async () => {
    const localmeConfig = {
      name: "cakeshop",
      description: "Online cake ordering",
      settings: {
        watermarkEnabled: false,
      },
      routes: [
        {
          pathPattern: "/api/weather/*",
          isProxy: true,
          proxyConfig: { upstream: "https://api.weatherapi.com/v1" },
          requiresAuth: false,
        },
      ],
      roles: [
        {
          name: "Manager",
          permissions: ["db_read", "db_write", "storage_read"],
        },
      ],
      secrets: {
        API_TOKEN: "weather-secret-123",
      },
      automations: {
        webhooks: [
          {
            url: "https://example.com/webhook",
            events: ["document.created"],
          },
        ],
      },
    };

    const zipBuffer = buildZip([
      {
        path: "localme.json",
        content: Buffer.from(JSON.stringify(localmeConfig, null, 2)),
      },
      {
        path: "codebase/index.html",
        content: Buffer.from("<h1>Cake Shop</h1>"),
      },
      {
        path: "codebase/css/style.css",
        content: Buffer.from("body { background: pink; }"),
      },
    ]);

    const result = await deployProjectArchive(user.id, zipBuffer);

    expect(result.success).toBe(true);
    expect(result.project.name).toBe("cakeshop");
    expect(result.filesDeployed).toBe(2);
    expect(result.featuresApplied).toBeGreaterThanOrEqual(4);

    // Verify files were stored in project storage without the codebase/ prefix
    const htmlBlob = await getFileBlob(result.project.id, "index.html");
    expect(htmlBlob).not.toBeNull();
    expect(htmlBlob!.content.toString("utf8")).toBe("<h1>Cake Shop</h1>");

    const cssBlob = await getFileBlob(result.project.id, "css/style.css");
    expect(cssBlob).not.toBeNull();
    expect(cssBlob!.content.toString("utf8")).toBe("body { background: pink; }");

    // Verify settings applied
    const projRow = await getProjectById(result.project.id);
    expect(projRow?.watermarkEnabled).toBe(false);
  });

  it("updates existing project and handles flat files gracefully", async () => {
    const existing = await createProject(user.id, "flatproj");

    const flatZip = buildZip([
      {
        path: "localme.json",
        content: Buffer.from(JSON.stringify({ description: "Updated flat project" })),
      },
      {
        path: "index.html",
        content: Buffer.from("<h1>Flat Root File</h1>"),
      },
    ]);

    const result = await deployProjectArchive(user.id, flatZip, {
      projectId: existing.id,
    });

    expect(result.success).toBe(true);
    expect(result.project.id).toBe(existing.id);
    expect(result.filesDeployed).toBe(1);

    const blob = await getFileBlob(existing.id, "index.html");
    expect(blob).not.toBeNull();
    expect(blob!.content.toString("utf8")).toBe("<h1>Flat Root File</h1>");
  });

  it("handles HTTP POST /api/projects/deploy", async () => {
    sessionCookie = userCookie;

    const zipBuffer = buildZip([
      {
        path: "localme.json",
        content: Buffer.from(JSON.stringify({ name: "apideploy" })),
      },
      {
        path: "codebase/index.html",
        content: Buffer.from("<h1>Deployed via HTTP</h1>"),
      },
    ]);

    const req = new Request("https://app.test/api/projects/deploy", {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: new Uint8Array(zipBuffer),
    });

    const res = await deployRouteHandler(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.project.name).toBe("apideploy");
    expect(body.filesDeployed).toBe(1);
    expect(body.liveUrl).toBe(`/${user.username}/apideploy/`);
  });

  it("deploys archive with library assets without conflict when user library already has files", async () => {
    const libUser = await createUser("libuser", "Password123!");
    const { ensureLibraryProject, putFile } = await import("@/lib/server/repos");
    const libProj = await ensureLibraryProject(libUser.id);
    await putFile(libUser.id, libProj.id, "existing-asset.js", Buffer.from("console.log('existing');"), true);

    const zipWithLib = buildZip([
      {
        path: "localme.json",
        content: Buffer.from(JSON.stringify({ name: "libtestproj" })),
      },
      {
        path: "codebase/index.html",
        content: Buffer.from("<h1>Lib Test</h1>"),
      },
      {
        path: "library/shared.css",
        content: Buffer.from("body { margin: 0; }"),
      },
    ]);

    const result = await deployProjectArchive(libUser.id, zipWithLib);
    expect(result.success).toBe(true);
    expect(result.project.name).toBe("libtestproj");

    const existingBlob = await getFileBlob(libProj.id, "existing-asset.js");
    expect(existingBlob).not.toBeNull();
    const sharedBlob = await getFileBlob(libProj.id, "shared.css");
    expect(sharedBlob).not.toBeNull();
    expect(sharedBlob!.content.toString("utf8")).toBe("body { margin: 0; }");
  });

  it("respects libraryMode: skip and overwrite in deploy", async () => {
    const libUser2 = await createUser("libuser2", "Password123!");
    const { ensureLibraryProject, putFile } = await import("@/lib/server/repos");
    const libProj = await ensureLibraryProject(libUser2.id);
    await putFile(libUser2.id, libProj.id, "existing-asset.js", Buffer.from("console.log('existing');"), true);

    // Deploy with skip: library assets in zip are ignored
    const zipSkip = buildZip([
      {
        path: "localme.json",
        content: Buffer.from(JSON.stringify({ name: "skipproj", libraryMode: "skip" })),
      },
      {
        path: "codebase/index.html",
        content: Buffer.from("<h1>Skip</h1>"),
      },
      {
        path: "library/ignored.js",
        content: Buffer.from("console.log('ignored');"),
      },
    ]);
    const resSkip = await deployProjectArchive(libUser2.id, zipSkip);
    expect(resSkip.success).toBe(true);
    const ignoredBlob = await getFileBlob(libProj.id, "ignored.js");
    expect(ignoredBlob).toBeNull();

    // Deploy with overwrite: replaces existing library
    const zipOverwrite = buildZip([
      {
        path: "localme.json",
        content: Buffer.from(JSON.stringify({ name: "overwriteproj" })),
      },
      {
        path: "codebase/index.html",
        content: Buffer.from("<h1>Overwrite</h1>"),
      },
      {
        path: "library/new-only.css",
        content: Buffer.from("body { color: blue; }"),
      },
    ]);
    const resOverwrite = await deployProjectArchive(libUser2.id, zipOverwrite, {
      libraryMode: "overwrite",
    });
    expect(resOverwrite.success).toBe(true);
    const oldBlob = await getFileBlob(libProj.id, "existing-asset.js");
    expect(oldBlob).toBeNull();
    const newOnlyBlob = await getFileBlob(libProj.id, "new-only.css");
    expect(newOnlyBlob).not.toBeNull();
  });
});

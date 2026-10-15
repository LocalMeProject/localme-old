/**
 * POST /api/projects/deploy — Deploy or create a project via standard ZIP upload.
 *
 * Accepts multipart/form-data or application/zip.
 * ZIP structure:
 * ├── localme.json   (routes, roles, secrets, automations, settings)
 * └── codebase/      (static project assets: index.html, styles, scripts)
 */
import { ApiError, apiOk, handler } from "@/lib/server/http";
import { resolvePrincipal } from "@/lib/server/api-auth";
import { deployProjectArchive } from "@/lib/server/deploy";

export const POST = handler(async (request) => {
  const principal = await resolvePrincipal(request);
  if (!principal || !principal.userId) {
    throw new ApiError("unauthorized", "Sign-in or API token required to deploy projects.");
  }

  const url = new URL(request.url);
  let archive: Buffer;
  let name = url.searchParams.get("name");
  let projectIdRaw = url.searchParams.get("projectId");
  let libraryMode = url.searchParams.get("libraryMode");

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError("bad_request", "Missing 'file' field with ZIP archive.");
    }
    archive = Buffer.from(await file.arrayBuffer());

    const formName = form.get("name");
    if (typeof formName === "string" && formName.trim()) {
      name = formName.trim();
    }

    const formProjectId = form.get("projectId");
    if (typeof formProjectId === "string" && formProjectId.trim()) {
      projectIdRaw = formProjectId.trim();
    }

    const formLibMode = form.get("libraryMode");
    if (typeof formLibMode === "string" && formLibMode.trim()) {
      libraryMode = formLibMode.trim();
    }
  } else {
    archive = Buffer.from(await request.arrayBuffer());
  }

  if (archive.byteLength === 0) {
    throw new ApiError("bad_request", "Uploaded archive cannot be empty.");
  }

  const projectId = projectIdRaw ? Number(projectIdRaw) : null;
  const result = await deployProjectArchive(principal.userId, archive, {
    projectId,
    name,
    libraryMode,
  });

  return apiOk(result, { status: projectId ? 200 : 201 });
});

---
name: localme
description: Comprehensive guide for AI models generating frontend applications, LocalMe ZIP deployment packages (localme.json + codebase/), and integrating with LocalMe BaaS APIs.
---

# LocalMe Agent Skill & Developer Guide

This guide instructs AI models (ChatGPT, Claude, Cursor, Antigravity, etc.) on how to build applications for the **LocalMe** platform, package them into the standard ZIP deployment bundle, and interact with LocalMe's Backend-as-a-Service (BaaS) APIs.

---

## 1. What is LocalMe?

LocalMe is a minimal **Backend-as-a-Service (BaaS)** for frontend-only web applications.
- **Zero Server-Side User Code**: Users write or generate HTML, CSS, JavaScript, or static build artifacts (React, Vue, Vite, etc.). No Node.js or Python backend server code is executed for tenant sites.
- **Platform Provides Everything Else**:
  - Embedded JSON document database (MongoDB-style query DSL over SQLite)
  - Asset and file storage with instant serving and compression
  - Shared per-user asset library (CDN namespace `/{username}/library/<asset>`)
  - Visitor accounts with captcha-gated login and project-scoped roles
  - Route rewrites and reverse proxy mounts with encrypted secret headers (`{{KEY}}`)
  - Webhooks with HMAC signing and scheduled cron tasks
  - Custom domains with automated ACME SSL

---

## 2. The Standard ZIP Deployment Package

When asked by a user to build an app for LocalMe, the AI model generates the complete application and packages it into a single `.zip` file with this exact root structure:

```text
my-project.zip
├── localme.json       # Platform configuration & metadata (root level)
└── codebase/          # All frontend project files (root level directory)
    ├── index.html     # Primary entry point (served at /{username}/{project}/)
    ├── style.css
    ├── app.js
    └── assets/
        └── logo.svg
```

### Key Packaging Rules:
1. **`localme.json` must be at the root** of the archive.
2. **`codebase/` must be a directory at the root** containing all static files. `codebase/index.html` will be served at the root of the project URL `https://localme.ir/{username}/{project}/`.
3. Subdirectories inside `codebase/` (e.g. `codebase/css/style.css`, `codebase/images/pic.png`) preserve their relative paths in storage.
4. (Optional) A `library/` folder at the root of the ZIP will deploy assets directly to the user's cross-project shared library (`/{username}/library/<asset>`). Handling is controlled by `libraryMode` (`"append"`, `"skip"`, or `"overwrite"`).

---

## 3. `localme.json` Configuration Specification

All fields in `localme.json` are **optional**. If a field or section is omitted, LocalMe automatically applies safe defaults (standard static hosting, default visitor roles, watermark enabled).

### Complete Annotated Example:

```json
{
  "name": "cake-shop",
  "description": "Online ordering app for cake shop",
  "libraryMode": "append",
  "settings": {
    "watermarkEnabled": true,
    "freeVisitsPerMonth": 100
  },
  "routes": [
    {
      "pathPattern": "/api/weather/*",
      "isProxy": true,
      "proxyConfig": {
        "upstream": "https://api.weatherapi.com/v1"
      },
      "requiresAuth": false
    },
    {
      "pathPattern": "/admin/*",
      "targetFile": "/admin.html",
      "requiresAuth": true,
      "requiredRole": "Admin"
    }
  ],
  "roles": [
    {
      "name": "Admin",
      "permissions": ["db_read", "db_write", "db_admin", "storage_read", "storage_write"]
    },
    {
      "name": "Member",
      "permissions": ["db_read", "storage_read"]
    }
  ],
  "secrets": {
    "WEATHER_API_KEY": "secret-token-value"
  },
  "automations": {
    "webhooks": [
      {
        "url": "https://my-webhook-listener.com/orders",
        "events": ["document.created"],
        "secret": "whsec_custom_signing_key"
      }
    ],
    "cron": [
      {
        "task": "storage_audit",
        "isEnabled": true,
        "parameters": {}
      }
    ]
  },
  "domains": [
    {
      "domain": "cakeshop.example.com"
    }
  ],
  "endpoints": [
    {
      "endpoint": "db",
      "isEnabled": true,
      "requiresAuth": false
    }
  ]
}
```

### Field Definitions:

| Field | Type | Description | Default if omitted |
|---|---|---|---|
| `name` | `string` | Project identifier (1–63 chars, alphanumeric, `_`, `-`). | Taken from upload form or ZIP filename. |
| `description` | `string` | Human-readable project description. | Empty string. |
| `settings.watermarkEnabled` | `boolean` | Whether to display the LocalMe attribution badge before `</body>`. | `true` |
| `settings.freeVisitsPerMonth` | `number` | Monthly visit threshold before 402 quota signal. | `100` |
| `routes` | `Array` | URL rewrites and reverse proxy configurations. | Empty (standard file serving). |
| `routes[].pathPattern` | `string` | Matching path glob, e.g. `"/api/external/*"`, `"/app/*"`. | Required if route defined. |
| `routes[].isProxy` | `boolean` | Whether this route forwards upstream. | `false` |
| `routes[].proxyConfig` | `object` | `{ upstream: "https://..." }`. Headers can reference secrets: `{{SECRET}}`. | `null` |
| `routes[].targetFile` | `string` | Local file to serve for static rewrites (e.g. `"/index.html"` for SPA routing). | `null` |
| `routes[].requiresAuth` | `boolean` | Whether route requires an authenticated visitor session. | `false` |
| `routes[].requiredRole` | `string` | Visitor role name required to access this route (e.g. `"Admin"`). | `null` (any signed-in visitor). |
| `roles` | `Array` | Project-scoped visitor roles and granted permissions. | Default roles (`Owner`, `Admin`, `Member`, `Guest`). |
| `secrets` | `object` or `Array` | Encrypted secrets for `{{KEY}}` substitution in proxy routes. | Empty. |
| `automations.webhooks` | `Array` | Outbox webhooks triggered by platform events (`document.created`, etc.). | Empty. |
| `automations.cron` | `Array` | Database-backed scheduled tasks. | Empty. |
| `domains` | `Array` | Custom domains attached to project. | Empty. |
| `endpoints` | `Array` | Per-endpoint policy toggles (`db`, `storage`, etc.). | Platform defaults. |

---

## 4. BaaS APIs for Client-Side Frontend Code

JavaScript running in `codebase/` can directly call LocalMe's platform REST APIs. All API endpoints use relative paths (`/api/...` or `/auth/...`).

### 4.1 Embedded Document Database (`/api/db/*`)
LocalMe includes a schema-less JSON document store isolated per project.

#### 1. Insert Document (`POST /api/db/insert`)
```javascript
const res = await fetch("/api/db/insert", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    table: "orders",
    document: {
      customerName: "Sina Vali",
      phone: "09120000000",
      cakeType: "Chocolate Velvet",
      quantity: 1,
      totalPrice: 450000,
      status: "pending"
    }
  })
});
const { data, id } = await res.json();
```

#### 2. Query Documents (`POST /api/db/find`)
Supports MongoDB-style operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$regex`, `$and`, `$or`.
```javascript
const res = await fetch("/api/db/find", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    table: "orders",
    filter: {
      status: "pending",
      totalPrice: { "$gte": 100000 }
    },
    sort: { created_at: -1 },
    limit: 50,
    offset: 0
  })
});
const { data, total } = await res.json();
// data includes stored document + _localme: { created, updated }
```

#### 3. Update Document (`POST /api/db/update`)
```javascript
const res = await fetch("/api/db/update", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    table: "orders",
    id: "1",
    patch: {
      status: "completed"
    }
  })
});
```

#### 4. Delete Document (`POST /api/db/delete`)
```javascript
const res = await fetch("/api/db/delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    table: "orders",
    id: "1"
  })
});
```

#### 5. Count Documents (`POST /api/db/count`)
```javascript
const res = await fetch("/api/db/count", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    table: "orders",
    filter: { status: "pending" }
  })
});
const { count } = await res.json();
```

---

### 4.2 Visitor Authentication & Captcha

For protected user sections, LocalMe provides captcha-gated visitor sessions.

#### 1. Fetch Captcha Challenge (`GET /auth/captcha`)
Returns an SVG image containing a simple math sum (operands and sum are strictly lower than 20):
```javascript
const res = await fetch("/auth/captcha");
const { id, svg } = await res.json();
// Render svg in container:
document.getElementById("captcha-box").innerHTML = svg;
```

#### 2. Visitor Sign-In (`POST /api/auth/login`)
```javascript
const res = await fetch("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: "customer_user",
    password: "Password123!",
    captchaId: id,            // from /auth/captcha
    captchaAnswer: "14"       // user's solved sum (< 20)
  })
});
// On success, sets secure HTTP-only auth_{projectId} cookie automatically
```

#### 3. Sign-Out (`POST /api/auth/logout`)
```javascript
await fetch("/api/auth/logout", { method: "POST" });
```

---

### 4.3 File Storage (`/api/storage/*`)
- Upload file: `POST /api/storage/upload` (`multipart/form-data` with `file` and `path`)
- Download file: `GET /api/storage/download?path=/uploads/file.png`
- List directory: `GET /api/storage/list?path=/`
- Shared User Library: Files placed in `library/` are served at `/{username}/library/<filename>`.

---

### 4.4 Reverse Proxy with Secret Masking
When calling an external API that requires a private API key, configure a route in `localme.json`:
```json
{
  "pathPattern": "/api/weather/*",
  "isProxy": true,
  "proxyConfig": {
    "upstream": "https://api.weather.com/v1"
  }
}
```
And add the secret:
```json
{
  "secrets": {
    "WEATHER_KEY": "my-secret-key-123"
  }
}
```
In your frontend code, simply call:
```javascript
const res = await fetch("/api/weather/current?city=Tehran");
```
LocalMe proxies the request to `https://api.weather.com/v1/current?city=Tehran` and injects the encrypted secret without exposing it to the browser.

---

## 5. Deployment Methods

### Method 1: Web Dashboard (Human Users)
1. Log in to `https://localme.ir/dashboard`.
2. Click **+ New Project** -> choose **Deploy ZIP** tab.
3. Select the `<project>.zip` file and click **Deploy**.
4. The site is live instantly at `https://localme.ir/{username}/{project}/`.

### Method 2: HTTP API (`POST /api/projects/deploy`)
Deployments can be automated via curl or scripts using a platform session cookie or Personal Access Token (PAT):

```bash
curl -X POST https://localme.ir/api/projects/deploy \
  -H "Authorization: Bearer pat_your_token_here" \
  -F "file=@my-project.zip" \
  -F "name=cake-shop"
```

Response:
```json
{
  "success": true,
  "project": {
    "id": 12,
    "name": "cake-shop"
  },
  "filesDeployed": 5,
  "featuresApplied": 3,
  "liveUrl": "/sinavali/cake-shop/"
}
```

---

## 6. Checklist for AI Models Generating LocalMe Apps

When asked to generate a web app for LocalMe:
1. **Always generate standard static HTML/CSS/JS** inside the `codebase/` directory with `codebase/index.html` as the entry point.
2. **Include `localme.json` at the root** of the ZIP containing any required routes, visitor roles, encrypted secrets, or automations.
3. **Use LocalMe BaaS endpoints** (`/api/db/*`, `/api/storage/*`, `/auth/captcha`, `/api/auth/login`) in frontend JavaScript for data persistence and authentication.
4. **Captcha numbers are simple arithmetic < 20**.
5. **Provide clear instructions** for the user to download the ZIP bundle and upload it in the LocalMe dashboard or via `POST /api/projects/deploy`.

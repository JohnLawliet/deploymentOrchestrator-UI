# Deployment Orchestrator UI

A React + Vite frontend for orchestrating application deployments to Wildfly, JBoss, and Tomcat servers.

## Local Development

### Prerequisites
- Node.js 18+
- npm

### Setup
```bash
# Install dependencies
npm install

# Environment-specific files are already provided:
# .env.development, .env.simqc, and .env.qc
```

### Running
```bash
# Start Vite; API requests are proxied to localhost:8080
npm run dev:local
```

App is available at `http://localhost:3000/deploymentOrchestrator`.

### Environment Variables (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_APP_NAME` | `Deployment Orchestrator` | App display name |
| `VITE_FRONTEND_PORT` | `3000` | Vite dev server port |
| `VITE_BACKEND_URL` | empty | API origin; empty uses relative URLs |
| `VITE_PROXY_TARGET` | `http://localhost:8080` | Backend target used by the local Vite proxy |
| `VITE_BASE_PATH` | `/deploymentOrchestrator` | App base path / static-resource mount point |
| `VITE_API_CONTEXT_PATH` | `VITE_BASE_PATH` | Backend context path used for API and event-stream URLs |

### Environment builds

```bash
npm run build:simqc
npm run build:qc
```

Both deployment builds use same-origin API URLs. Environment-specific server
filesystem roots remain backend configuration and are not embedded in the UI.

### Apache simQC/QC deployment

When Apache serves the UI from its `DocumentRoot` and proxies the backend at
`/tms/`, use the supplied `simqc` or `qc` build mode. Those modes build the
SPA at `/` and send API requests to `/tms/api/...` on the same origin:

```bash
npm run build:simqc
# or
npm run build:qc
```

Copy the contents of `dist/` to Apache's configured `DocumentRoot`. The
browser never contacts the backend IP directly, so no browser CORS policy is
required; Apache handles the `/tms/` proxy hop.

Client routes such as `/dashboard` must serve `index.html` so React Router can
run. The QC build includes `.htaccess` with a rewrite to `index.html` for
missing files. If `AllowOverride` is off, set this in the vhost instead and
keep `/tms/` proxied to the API:

```apache
FallbackResource /index.html
```

### QC large-download proxy checklist

File and directory downloads are streamed by the backend and intentionally use
an unlimited browser request timeout. A failed download must not by itself be
treated as a backend outage. If a large download stops unexpectedly, inspect
the browser Network panel/HAR and the proxy or load-balancer logs at the same
timestamp before changing the UI.

For the Apache/vhost or load-balancer route that proxies the API, configure
both client-facing and upstream read/idle timeouts for at least 30 minutes,
and ensure the route does not buffer streaming ZIP responses or impose a short
time-to-first-byte timeout. Check access/error logs for a client-abort or
499-style record. For the reported QC incident, correlate
`2026-09-07 18:45:35` through `18:45:38` with the browser HAR and backend log.

After deployment, download a roughly 250 MB exploded-WAR directory through
the QC proxy. The request should remain pending until complete, the browser
should save the ZIP, and a deliberately cancelled request should show a
download-specific retry message without an application-wide offline warning.

---

## Production Build (Static Files for Spring Boot)

The UI is designed to be served as static resources from the Spring Boot app running at context path `/deploymentOrchestrator`.

### 1. Build

```bash
npm run build
# or explicitly:
npm run build:prod
```

Vite reads `.env.production` automatically. `VITE_BACKEND_URL` is left empty there, so all API calls use **relative URLs** (e.g. `/deploymentOrchestrator/api/deploy`). This means the built output works at any IP/host without any code changes — including `192.168.x.x:8080` on the QC VM.

### 2. Deploy to Spring Boot

Copy the contents of `dist/` into your Spring Boot project:

```
dist/  →  src/main/resources/static/deploymentOrchestrator/
```

Your Spring Boot `application.properties` / `application.yml` should have:
```properties
server.servlet.context-path=/deploymentOrchestrator
```

Spring Boot will serve the static files at:
```
http://<host>:8080/deploymentOrchestrator/          ← UI
http://<host>:8080/deploymentOrchestrator/api/...   ← REST API
```

### 3. QC VM

With VM networking (NAT + Host-only) configured, access the app at:
```
http://192.168.x.x:8080/deploymentOrchestrator
```

No `.env` changes are needed — relative URLs resolve automatically to the correct host.

Unknown UI paths under `/deploymentOrchestrator` must forward to `index.html`
(the same SPA fallback Apache needs). Without that, reloading `/dashboard`
returns a server 404 before React loads.

---

## Project Structure

```
src/
  components/                    # Shared application and UI components
  context/                       # Portal session and operation state
  lib/                           # API contract and deployment helpers
  pages/
    PortalDashboardPage.jsx      # Runtime dashboard
    JarDeploymentPage.jsx       # JAR deployment workflow
    WarDeploymentPage.jsx       # WAR deployment workflow
    DownloadsPage.jsx           # File download workflow
    TablesPage.jsx              # Database administration tables
  App.jsx                        # Routes and application providers
  main.jsx                       # Browser entrypoint
```

# DUK Web

Web service that wraps the official ANAF **DUKIntegrator** kit: upload a declaration XML, pick the declaration type, and get it validated with the generated PDF back — no Java, no installs for end users.

- Runs the official ANAF components (untouched) inside Docker, so validation matches what ANAF itself checks.
- Currently bundled declaration: **D112**.
- Uploaded files are processed in a temporary folder and deleted right after the response.
- No smart-card signing — the flow ends at the generated PDF.

## Run locally

```sh
docker build -t duk-webapp .
docker run --rm -p 3000:3000 duk-webapp
# open http://localhost:3000
```

## Deploy (Render)

Create a **Web Service** from this repository:

- Runtime: **Docker** (Dockerfile at the repo root)
- Region: pick the closest one (e.g. Frankfurt for Romania)
- Start command: default (the Dockerfile `CMD`); the app listens on `$PORT`
- Health check path: `/healthz`

## Adding more declarations

Drop the new `XnnnValidator.jar` (and `XnnnPdf.jar`) into `app/lib/`, restart — the declaration shows up in the UI automatically (detected from `*Validator.jar` names).

## Layout

```
server.js        Node service: upload -> java -jar app/DUKIntegrator.jar -p ... -> JSON (messages + PDF)
public/          Web UI (Romanian)
app/             The official ANAF kit: DUKIntegrator.jar, config/, lib/
Dockerfile       Java 8 (Temurin) + Node 22, multi-stage
```

The ANAF components under `app/` come from the freely distributed DUKIntegrator kit (anaf.ro).

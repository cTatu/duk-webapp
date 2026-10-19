"use strict";

const express = require("express");
const multer = require("multer");
const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const PORT = process.env.PORT || 3000;

const APP_DIR = path.join(__dirname, "app");
const JAR = path.join(APP_DIR, "DUKIntegrator.jar");
const CONFIG_DIR = path.join(APP_DIR, "config");
const LIB_DIR = path.join(APP_DIR, "lib");
const JAVA = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, "bin", "java")
  : "java";

const MAX_CONCURRENT = 2;
const PROCESS_TIMEOUT_MS = 90_000;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// A declaration is supported when its validator jar is present in app/lib
// (e.g. D112Validator.jar -> "D112"). Drop in new jars to add declarations.
let DECLARATIONS = ["D112"];
try {
  const found = fs
    .readdirSync(LIB_DIR)
    .map((f) => (f.match(/^(.+?)Validator\.jar$/i) || [])[1])
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  if (found.length) DECLARATIONS = found;
} catch (_) {
  /* keep default */
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 2 },
});

const app = express();
app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));

let running = 0;

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.get("/api/declarations", (_req, res) =>
  res.json({ declarations: DECLARATIONS })
);

function runJava(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(JAVA, args, { cwd: APP_DIR });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String((e && e.stack) || e) });
    });
  });
}

app.post(
  "/api/process",
  upload.fields([
    { name: "xml", maxCount: 1 },
    { name: "zip", maxCount: 1 },
  ]),
  async (req, res) => {
    const files = req.files || {};
    const xmlFile = files.xml && files.xml[0];
    const zipFile = files.zip && files.zip[0];
    const declaration = String((req.body && req.body.declaration) || "");

    if (!xmlFile) {
      return res
        .status(400)
        .json({ ok: false, error: "Lipsește fișierul XML." });
    }
    if (!DECLARATIONS.includes(declaration)) {
      return res
        .status(400)
        .json({ ok: false, error: "Tip de declarație neacceptat." });
    }
    if (running >= MAX_CONCURRENT) {
      return res.status(429).json({
        ok: false,
        error: "Serverul este ocupat. Încercați din nou în câteva secunde.",
      });
    }

    running += 1;
    const startedAt = Date.now();
    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "duk-"));

    try {
      const xmlPath = path.join(workDir, "declaratie.xml");
      const zipPath = path.join(workDir, "atasament.zip");
      const resultPath = path.join(workDir, "rezultat.txt");
      const pdfPath = path.join(workDir, "declaratie.pdf");

      await fsp.writeFile(xmlPath, xmlFile.buffer);
      if (zipFile) await fsp.writeFile(zipPath, zipFile.buffer);

      // Mode B CLI: validate + create PDF, no signing.
      // `+` prefix on the result file keeps warnings and appends the "ok"
      // marker when validation and PDF creation both succeed.
      const args = [
        "-Xmx256m",
        "-Djava.awt.headless=true",
        "-Dfile.encoding=UTF-8",
        "-jar",
        JAR,
        "-c",
        CONFIG_DIR,
        "-p",
        declaration,
        xmlPath,
        "+" + resultPath,
        "0",
        zipFile ? zipPath : "0",
        pdfPath,
      ];

      const result = await runJava(args, PROCESS_TIMEOUT_MS);

      let messagesText = "";
      try {
        messagesText = await fsp.readFile(resultPath, "utf8");
      } catch (_) {
        /* no result file written */
      }
      if (!messagesText.trim()) {
        messagesText = [result.stdout, result.stderr]
          .filter(Boolean)
          .join("\n")
          .trim();
      }

      const lines = messagesText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const isOk = lines.includes("ok");
      const hasPdf = fs.existsSync(pdfPath);

      let pdfBase64 = null;
      if (hasPdf) {
        pdfBase64 = (await fsp.readFile(pdfPath)).toString("base64");
      }

      const status = isOk ? (lines.length > 1 ? "ok-with-warnings" : "ok") : "errors";
      console.log(
        `[process] ${declaration} -> ${status} in ${Date.now() - startedAt}ms (pdf: ${hasPdf})`
      );

      const baseName = path.basename(
        xmlFile.originalname || "declaratie",
        path.extname(xmlFile.originalname || "")
      );

      return res.json({
        ok: true,
        status,
        messages: lines,
        pdf: pdfBase64,
        pdfName: (baseName || "declaratie") + ".pdf",
      });
    } catch (e) {
      console.error("[process] error:", e);
      return res.status(500).json({
        ok: false,
        error: "Eroare internă la procesare.",
      });
    } finally {
      running -= 1;
      fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
);

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "Fișierul depășește limita de 25 MB."
        : "Eroare la încărcarea fișierului (" + err.code + ").";
    return res.status(400).json({ ok: false, error: msg });
  }
  console.error("[server] error:", err);
  return res.status(500).json({ ok: false, error: "Eroare internă." });
});

app.listen(PORT, () => {
  console.log(
    `DUK webapp listening on port ${PORT} (declarations: ${DECLARATIONS.join(", ")})`
  );
});

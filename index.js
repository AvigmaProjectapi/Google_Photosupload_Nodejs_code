const express = require("express");
const firebase = require("firebase-admin");
const cors = require("cors");
const Busboy = require("busboy");
const getRawBody = require("raw-body");
const sharp = require("sharp");
const serviceAccountKey = require("./serviceAccountKey.json");

const app = express();
app.use(cors());

// ---- Firebase Init ----
const firebaseApp = firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccountKey),
  storageBucket: "probe4shape",
});
const bucket = firebaseApp.storage().bucket();

// ---- Helper to get signed URL ----
function GetdownloadURL(FolderName, FileName) {
  return new Promise((resolve, reject) => {
    const file = bucket.file(`${FolderName}/${FileName}`);
    file
      .getSignedUrl({ action: "read", expires: new Date('2050-12-12') })
      .then(([url]) => resolve(url))
      .catch(reject);
  });
}

// ---- Upload endpoint ----
app.post("/upload", async (req, res) => {
  const ct = req.headers["content-type"] || "";
  if (!ct.includes("multipart/form-data")) {
    return res.status(400).json({ error: "multipart/form-data required" });
  }

  const busboy = new Busboy({ headers: req.headers });
  let folderName, fileName;
  let responded = false;
  let sawFile = false;

  busboy.on("field", (key, val) => {
    if (key === "FolderName") folderName = val;
    if (key === "FileName") fileName = val;
    if (key === "xyz") {
      try {
        const j = JSON.parse(val);
        folderName = j.FolderName || folderName;
        fileName = j.FileName || fileName;
      } catch {}
    }
  });

  busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
    sawFile = true;
    let targetName = fileName || filename || `file-${Date.now()}`;
    folderName = folderName || "uploads";

    // Buffer entire file so we can compress images before uploading
    const chunks = [];
    file.on("data", (chunk) => chunks.push(chunk));
    file.on("error", (err) => {
      if (responded) return;
      responded = true;
      res.status(500).json({ error: err.message });
    });
    file.on("end", async () => {
      try {
        let fileBuffer = Buffer.concat(chunks);
        let uploadMimetype = mimetype;

        // Compress images — same resolution, reduced file size
        const compressibleTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"];
        if (compressibleTypes.includes((mimetype || "").toLowerCase())) {
          try {
            const img = sharp(fileBuffer);
            const meta = await img.metadata();

            if (meta.format === "png") {
              // PNG: lossless compression, keep as PNG to preserve transparency
              fileBuffer = await img.png({ compressionLevel: 9 }).toBuffer();
            } else {
              // JPEG / HEIC / HEIF / WebP / AVIF → JPEG at quality 80
              // Same pixel dimensions, ~70-85% smaller file size for iPhone photos
              fileBuffer = await img.jpeg({ quality: 80 }).toBuffer();
              uploadMimetype = "image/jpeg";
              // Fix extension if converting from HEIC/HEIF/WebP/AVIF to JPEG
              targetName = targetName.replace(/\.(heic|heif|webp|avif)$/i, ".jpg");
            }
          } catch (sharpErr) {
            // Compression failed (e.g. unsupported format) — upload original
            console.warn("Image compression skipped:", sharpErr.message);
          }
        }

        const gcsFile = bucket.file(`${folderName}/${targetName}`);
        const gcsStream = gcsFile.createWriteStream({ contentType: uploadMimetype });

        gcsStream.on("error", (err) => {
          if (responded) return;
          responded = true;
          res.status(500).json({ error: err.message });
        });

        gcsStream.on("finish", async () => {
          try {
            const url = await GetdownloadURL(folderName, targetName);
            if (responded) return;
            responded = true;
            res.status(200).send({ Returnurl: url });
          } catch (err) {
            if (responded) return;
            responded = true;
            res.status(500).json({ error: err.message });
          }
        });

        gcsStream.end(fileBuffer);
      } catch (err) {
        if (responded) return;
        responded = true;
        res.status(500).json({ error: err.message });
      }
    });
  });

  busboy.on("finish", () => {
    if (!sawFile && !responded) {
      responded = true;
      res.status(400).json({
        error: "No file found in form-data",
        hint: "Add a File field (e.g., videoFile) and FolderName/FileName or xyz JSON"
      });
    }
  });

  if (req.rawBody) {
    busboy.end(req.rawBody);
    return;
  }

  getRawBody(req, { length: req.headers["content-length"], limit: "200mb" }, (err, body) => {
    if (err) return res.status(400).json({ error: err.message });
    busboy.end(body);
  });
});

// ---- Basic health route ----
app.get("/", (req, res) => res.send("Cloud Run service is live ✅"));

// ✅ ---- Required for Cloud Run (Source) ----
const PORT = process.env.PORT || 8080;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// ✅ ---- For Firebase Functions ----
const functions = require('firebase-functions');
exports.api = functions.https.onRequest(app);

const express = require("express");
const firebase = require("firebase-admin");
const engines = require("consolidate");
const bodyParser = require("body-parser");
const archiver = require("archiver");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cors = require("cors");
const axios = require("axios");
const getRawBody = require("raw-body");
const fileType = require("file-type");
const parser = require('exif-parser')
const piexif = require('piexifjs')
const ExifReader = require('exifreader')
const serviceAccountKey = require("./serviceAccountKey.json");
require("firebase-admin");
const Busboy = require("busboy");
const { format } = require("path");
const cons = require("consolidate");
//const { object } = require("firebase-functions/lib/providers/storage");
const { group } = require("console");
const isTif = require("is-tif");
const { Exifr } = require("exifr");
const dateFormat = require("dateformat");
const app = express();

// IMPORTANT: Do NOT start your own HTTP server in Cloud Functions.

app.use(cors());

const firebaseApp = firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccountKey),
  // Use the bucket NAME, not a gs:// URL
  storageBucket: "livey",
});
let db = firebase.firestore();
const bucket = firebaseApp.storage().bucket();
// Keep if you really have this bucket; otherwise update to your doc bucket name
const documentBucket = firebase.storage().bucket("image-bucket-wg2ab");
const serverurl = "";
const timeout = 3000

app.engine("hbs", engines.handlebars);

// Only use JSON/urlencoded parsers for non-multipart requests,
// otherwise Busboy won't see the stream.
const jsonParser = bodyParser.json({ limit: "50mb" });
const urlParser  = bodyParser.urlencoded({ limit: "50mb", extended: true, parameterLimit: 50000 });
app.use((req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (ct.startsWith("multipart/form-data")) return next();
  jsonParser(req, res, (err) => {
    if (err) return next(err);
    urlParser(req, res, next);
  });
});

app.set("views", "./views");
app.set("view engine", "hbs");

// =========== BEGIN Routing for Handlebar Template Pages ===========
app.get("/", (req, res) => {
  res.send("OK");
});
// =========== END Routing for Handlebar Template Pages ===========

// =========== BEGIN Helpers ===========
const decodeBase64Image = async (dataString) => {
  response = {};
  if (Buffer.from(dataString, "base64").toString("base64") !== dataString) {
    var matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || (matches && matches.length !== 3)) {
      return new Error("invalid input string");
    }
    response.type = matches[1];
    response.data = new Buffer(matches[2], "base64");
    return response;
  } else {
    const mimeInfo = await fileType.fromBuffer(
      Buffer.from(dataString, "base64")
    );
    if (mimeInfo) {
      response.type = mimeInfo.mime;
      response.data = new Buffer(dataString, "base64");
      return response;
    } else {
      return new Error("invalid input string");
    }
  }
};

const decodeBase64Document = async (dataString) => {
  response = {};

  if (Buffer.from(dataString, "base64").toString("base64") !== dataString) {
    var matches = dataString.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    console.log("GAPP", matches);
    if (!matches || (matches && matches.length !== 3)) {
      return new Error("invalid input string");
    }
    response.type = matches[1];
    response.data = new Buffer(matches[2], "base64");
    return response;
  } else {
    const mimeInfo = await fileType.fromBuffer(
      Buffer.from(dataString, "base64")
    );
    if (mimeInfo) {
      response.type = mimeInfo.mime;
      response.data = new Buffer(dataString, "base64");
      return response;
    } else {
      return new Error("invalid input string");
    }
  }
};

videosUploadMiddleWare = function(req, res, next) {
  if (req.headers["content-type"] && req.headers["content-type"].includes("multipart/form-data")){
    const busboy = new Busboy({
      headers: req.headers,
      limits: {
          fileSize: 1024*1024*1024
        }
    });
    const fields = {};
    const files = [];
    const fileWrites = [];
    const tmpdir = os.tmpdir();

    busboy.on('field', (key, value) => {
      if(key=='xyz')
      fields[key] = JSON.parse(value);
    });

    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      const filepath = path.join(tmpdir, filename);
      const writeStream = fs.createWriteStream(filepath);
      file.pipe(writeStream);

      fileWrites.push(new Promise((resolve, reject) => {
        file.on('end', () => writeStream.end());
        writeStream.on('finish', () => {
          fs.readFile(filepath, (err, buffer) => {
            const size = Buffer.byteLength(buffer);
            if (err) {
              return reject(err);
            }
            files.push({
              fieldname,
              originalname: filename,
              encoding,
              mimetype,
              buffer,
              size,
            });

            try {
              fs.unlinkSync(filepath);
            } catch (error) {
              return reject(error);
            }

            resolve();
          });
        });
        writeStream.on('error', reject);
      }));
    });

    busboy.on('finish', () => {
      Promise.all(fileWrites)
        .then(() => {
          req.body = fields.xyz;
          req.files = files;
          next();
        })
        .catch(next);
    });

    getRawBody(req, {
      length: req.headers['content-length'],
      limit: '50mb'
    }, (err, body) => {
      if (err) return next(err);
      busboy.end(body);
    });

  }
  else next()

}
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min);
}
// (Kept EXIF helpers unchanged; they are not used in this particular upload path)
const addExif = async(data)=>{ /* unchanged */ }
function convert_positive(a) { if (a < 0) a = a * -1; return a; }
const addExifMultipart = async(data,file)=>{ /* unchanged */ }

// Promise-based GetdownloadURL (KEEP THIS VERSION)
function GetdownloadURL(FolderName, FileName) {
  return new Promise((resolve, reject) => {
    const file = bucket.file(FolderName + "/" + FileName);
    file
      .getSignedUrl({
        action: "read",
        expires: "12-12-2050",
      })
      .then((signedUrls) => {
        resolve(signedUrls[0]);
      })
      .catch((err) => {
        console.log(err);
        reject(err);
      });
  });
}

// =========== Routes ===========

// Robust multipart upload that accepts either separate fields
// (FolderName, FileName) OR a JSON field named "xyz" = {"FolderName": "...", "FileName": "..."}
app.post("/upload", (req, res) => {
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
        if (j.FolderName) folderName = j.FolderName;
        if (j.FileName) fileName = j.FileName;
      } catch (e) {
        // ignore JSON parse errors; we'll validate later
      }
    }
  });

  busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
    sawFile = true;
    const targetName = fileName || filename;
    if (!folderName) folderName = "uploads";
    const gcsFile = bucket.file(`${folderName}/${targetName}`);
    const gcsStream = gcsFile.createWriteStream({ contentType: mimetype });

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
        res.status(200).send(url);
      } catch (err) {
        if (responded) return;
        responded = true;
        res.status(500).json({ error: err.message });
      }
    });

    file.pipe(gcsStream);
  });

  busboy.on("finish", () => {
    if (!sawFile && !responded) {
      responded = true;
      res.status(400).json({
        error: "No file found in form-data",
        hint: "Send a 'videoFile' (or any name) File field and FolderName/FileName as text fields OR xyz JSON field."
      });
    }
  });

  req.pipe(busboy);
});


app.post('/uploadVideo',videosUploadMiddleWare,async (req,res) =>{
  const data = req.body;
  const files = req.files;
  var videoFile;
  var errors = [];
  const token = req.headers.authorization;
  var file_name = "";
  var buc_upload_res;
  for(var i=0;i<req.files.length;i++){
      if(req.files[i].fieldname == 'videoFile'){
          videoFile = req.files[i];
      }
  }
  let valid_mime = ['video/mp4','video/x-msvideo','video/x-ms-wmv', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/vnd.wav'];
  if(videoFile){
      if(valid_mime.indexOf(videoFile.mimetype)==-1){
           return res.send({
              status:false,
              errors:"Video file format is not valid.",
              mimetype:videoFile.mimetype
          });
      }
      file_name = 'video_' +new Date().getTime()+"_"+ videoFile.originalname;
      const videoFile_b = bucket.file(data.FolderName + '/'+file_name);
      data.Client_Result_Photo_FileName = file_name;
  try {
      buc_upload_res = await videoFile_b.save(videoFile.buffer);
  } catch (error) {
      console.log(error);
      errors.push(error.message);
  }

  if(errors.length>0){
      res.send({
          status:false,
          errors:errors
      })
  }else{
      let newHeader = data;
      newHeader.videoFile = null;
      var config = {
        method: 'post',
        url:  serverurl+"api/MultiPhoto/UploadClientResultPhtotos",
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `${token}`
        },
        data : newHeader
      };
      var resp  ={};
      await axios(config)
      .then(function (response) {
          resp = {up_res:response.data};
      });
      
      resp.status = true;
      resp.file=buc_upload_res;
      resp.message = "Video updated.";
      res.send(resp);
  }
  }else{
    let resp = {};
    resp.status = false;
    resp.message = "video file is required.";
    res.status(400);
    res.send(resp);	
  }
});

// Expose the Express app as the function entry point:
exports.Photoupload = app;

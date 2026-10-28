const multer = require('multer');
const path = require('path');
const { Image } = require('../models');

// Files are kept in memory, then saved into MongoDB by saveUpload().
// (Vercel serverless request bodies are capped at ~4.5MB, so limit to 4MB.)
function fileFilter(_req, file, cb) {
  const allowed = /jpeg|jpg|png|webp|gif/;
  const ok = allowed.test(path.extname(file.originalname).toLowerCase());
  if (ok) cb(null, true);
  else cb(new Error('Only image files (jpg, png, webp, gif) are allowed.'));
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
});

// Store an uploaded file in MongoDB and return its id (served at /uploads/:id).
async function saveUpload(file) {
  const img = await Image.create({ data: file.buffer, contentType: file.mimetype });
  return img.id;
}

module.exports = upload;
module.exports.saveUpload = saveUpload;

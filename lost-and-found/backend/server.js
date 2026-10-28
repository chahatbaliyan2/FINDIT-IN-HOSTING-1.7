require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const initData = require('./utils/initData');
const { Image } = require('./models');

const authRoutes = require('./routes/authRoutes');
const itemRoutes = require('./routes/itemRoutes');
const orgRoutes = require('./routes/orgRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const chatRoutes = require('./routes/chatRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Connect to MongoDB (once) + seed admin before handling any request.
let ready = null;
app.use((_req, _res, next) => {
  if (!ready) ready = connectDB().then(initData).catch((e) => { ready = null; throw e; });
  ready.then(() => next(), next);
});

// Photos are stored in MongoDB and served from here (URL shape unchanged).
app.get('/uploads/:id', async (req, res, next) => {
  try {
    const img = await Image.findById(req.params.id);
    if (!img) return res.status(404).end();
    res.set('Content-Type', img.contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(img.data);
  } catch (err) {
    next(err);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/org', orgRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/chat', chatRoutes);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Public site metadata (e.g. the support/contact email shown on the Help page)
app.get('/api/meta', (_req, res) => {
  res.json({ supportEmail: process.env.SUPPORT_EMAIL || 'support@findit.example' });
});

// Generic error handler (e.g. multer file-type errors)
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: err.message || 'Something went wrong.' });
});

module.exports = app;

// Local / Render: start a normal server. On Vercel the app is exported instead.
if (require.main === module) {
  connectDB()
    .then(initData)
    .then(() => {
      app.listen(PORT, () => console.log(`Lost & Found backend running on http://localhost:${PORT}`));
    })
    .catch((err) => {
      console.error('Failed to start (is MongoDB running / MONGODB_URI correct?):', err.message);
      process.exit(1);
    });
}

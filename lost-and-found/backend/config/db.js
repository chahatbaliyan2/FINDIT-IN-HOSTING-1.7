const mongoose = require('mongoose');
const dns = require('dns');

// Some ISPs/routers refuse SRV lookups (needed by mongodb+srv:// URIs) and
// fail with "querySrv ECONNREFUSED". Use public DNS for Node's resolver.
if (process.env.MONGODB_URI && process.env.MONGODB_URI.startsWith('mongodb+srv://')) {
  dns.setServers((process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1').split(','));
}

// Cached so serverless invocations (Vercel) reuse one connection.
let connecting = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (!connecting) {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lost_and_found';
    mongoose.set('strictQuery', true);
    connecting = mongoose.connect(uri).then(() => {
      console.log(`MongoDB connected -> ${mongoose.connection.name}`);
    }).catch((err) => {
      connecting = null; // allow retry on next request
      throw err;
    });
  }
  await connecting;
}

module.exports = connectDB;

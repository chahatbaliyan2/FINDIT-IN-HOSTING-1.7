// Seeds a default super-admin account (from .env) the first time the server
// runs against an empty database.
const bcrypt = require('bcryptjs');
const { Admin } = require('../models');

async function initData() {
  if ((await Admin.countDocuments()) === 0) {
    const username = process.env.ADMIN_DEFAULT_USERNAME || 'admin';
    const password = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
    await Admin.create({ username, password: await bcrypt.hash(password, 10) });
    console.log(`Default super-admin created -> username: "${username}", password: "${password}"`);
    console.log('(Change ADMIN_DEFAULT_* in .env before the very first run for production.)');
  }
}

module.exports = initData;

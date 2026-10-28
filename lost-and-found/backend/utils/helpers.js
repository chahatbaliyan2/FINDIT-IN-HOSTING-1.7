const { Image } = require('../models');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Case-insensitive "contains" regex, safe against user input.
const contains = (s) => new RegExp(escapeRegex(s), 'i');
// Case-insensitive exact match.
const exact = (s) => new RegExp(`^${escapeRegex(s)}$`, 'i');

// Remove a stored image by id (fire-and-forget, never throws).
function deleteUpload(id) {
  if (!id) return Promise.resolve();
  return Image.deleteOne({ _id: id }).catch(() => {});
}

// Date range filter on createdAt (dateTo is inclusive for the whole day).
function dateRange(dateFrom, dateTo) {
  const r = {};
  if (dateFrom) r.$gte = new Date(dateFrom);
  if (dateTo) r.$lte = new Date(dateTo + 'T23:59:59');
  return Object.keys(r).length ? r : undefined;
}

// Last N days as [{ key: 'YYYY-MM-DD', label: 'Oct 28' }]
function lastDays(n = 14) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    });
  }
  return out;
}

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

module.exports = { escapeRegex, contains, exact, deleteUpload, dateRange, lastDays, dayKey };

// Express 4 doesn't catch rejected promises; forward them to the error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports.wrap = wrap;

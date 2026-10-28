const express = require('express');
const { Organization, User, Item } = require('../models');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { saveUpload } = upload;
const { contains, deleteUpload, dateRange, lastDays, dayKey, wrap } = require('../utils/helpers');

const router = express.Router();

router.use(requireAuth('org'));

const safeOrg = (org) => {
  const { password, ...safe } = org.toJSON();
  return safe;
};

/* Organization's own full profile (Settings page) */
router.get('/me', wrap(async (req, res) => {
  const org = await Organization.findById(req.user.orgId);
  if (!org) return res.status(404).json({ message: 'Organization not found.' });
  res.json(safeOrg(org));
}));

/* Edit org profile. Name/type/email/status are NOT editable here. */
router.put('/me', upload.single('logo'), wrap(async (req, res) => {
  const org = await Organization.findById(req.user.orgId);
  if (!org) return res.status(404).json({ message: 'Organization not found.' });

  const { removeLogo } = req.body;
  for (const f of ['description', 'phone', 'address', 'city', 'district', 'state', 'pincode', 'website']) {
    if (req.body[f] !== undefined) org[f] = req.body[f];
  }

  if (req.file) {
    deleteUpload(org.logo);
    org.logo = await saveUpload(req.file);
  } else if (removeLogo === 'true' && org.logo) {
    deleteUpload(org.logo);
    org.logo = null;
  }

  await org.save();
  res.json(safeOrg(org));
}));

/* All items posted under this organization, with filters for the dashboard */
router.get('/items', wrap(async (req, res) => {
  const { category, status, q, sort, dateFrom, dateTo } = req.query;
  const filter = { orgId: req.user.orgId };
  if (category) filter.category = category;
  if (status) filter.status = status;
  if (q) {
    const re = contains(q);
    filter.$or = [{ title: re }, { description: re }, { postedBy: re }];
  }
  const range = dateRange(dateFrom, dateTo);
  if (range) filter.createdAt = range;

  res.json(await Item.find(filter).sort({ createdAt: sort === 'oldest' ? 1 : -1 }));
}));

/* All members registered under this organization, searchable */
router.get('/users', wrap(async (req, res) => {
  const { q } = req.query;
  const filter = { orgId: req.user.orgId };
  if (q) {
    const re = contains(q);
    filter.$or = [{ name: re }, { email: re }, { city: re }];
  }
  const users = await User.find(filter).select('-password').sort({ createdAt: -1 });
  res.json(users);
}));

/* Stat cards */
router.get('/stats', wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [totalUsers, totalItems, lostItems, foundItems, resolvedItems] = await Promise.all([
    User.countDocuments({ orgId }),
    Item.countDocuments({ orgId }),
    Item.countDocuments({ orgId, category: 'lost' }),
    Item.countDocuments({ orgId, category: 'found' }),
    Item.countDocuments({ orgId, status: 'resolved' }),
  ]);
  res.json({ totalUsers, totalItems, lostItems, foundItems, resolvedItems, openItems: totalItems - resolvedItems });
}));

/* Analytics: daily activity (last 14 days), category split, resolution rate */
router.get('/analytics', wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const days = lastDays(14);
  const since = new Date();
  since.setDate(since.getDate() - 14);

  const [recentItems, recentUsers, lost, found, resolved] = await Promise.all([
    Item.find({ orgId, createdAt: { $gte: since } }).select('createdAt category'),
    User.find({ orgId, createdAt: { $gte: since } }).select('createdAt'),
    Item.countDocuments({ orgId, category: 'lost' }),
    Item.countDocuments({ orgId, category: 'found' }),
    Item.countDocuments({ orgId, status: 'resolved' }),
  ]);

  res.json({
    dailyItems: days.map(({ key, label }) => ({
      date: label,
      lost: recentItems.filter((i) => dayKey(i.createdAt) === key && i.category === 'lost').length,
      found: recentItems.filter((i) => dayKey(i.createdAt) === key && i.category === 'found').length,
    })),
    dailyUsers: days.map(({ key, label }) => ({
      date: label,
      signups: recentUsers.filter((u) => dayKey(u.createdAt) === key).length,
    })),
    categorySplit: [
      { name: 'Lost', value: lost },
      { name: 'Found', value: found },
    ],
    statusSplit: [
      { name: 'Open', value: lost + found - resolved },
      { name: 'Resolved', value: resolved },
    ],
  });
}));

module.exports = router;

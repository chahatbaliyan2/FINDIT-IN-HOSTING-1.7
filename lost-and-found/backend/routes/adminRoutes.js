const express = require('express');
const { Organization, User, Item, Conversation, Message } = require('../models');
const { requireAuth } = require('../middleware/auth');
const { contains, exact, deleteUpload, lastDays, dayKey, wrap } = require('../utils/helpers');

const router = express.Router();

router.use(requireAuth('admin'));

const countBy = async (Model, field) => {
  const rows = await Model.aggregate([{ $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
};

/* Organizations with filters: status, type, city/state, free text */
router.get('/organizations', wrap(async (req, res) => {
  const { status, type, city, state, q } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (city) filter.city = exact(city);
  if (state) filter.state = exact(state);
  if (q) {
    const re = contains(q);
    filter.$or = [{ name: re }, { email: re }, { description: re }, { city: re }];
  }

  const [orgs, itemCounts, userCounts] = await Promise.all([
    Organization.find(filter).select('-password').sort({ createdAt: -1 }),
    countBy(Item, 'orgId'),
    countBy(User, 'orgId'),
  ]);

  res.json(orgs.map((o) => ({ ...o.toJSON(), itemCount: itemCounts[o.id] || 0, userCount: userCounts[o.id] || 0 })));
}));

const setStatus = (status, message) =>
  wrap(async (req, res) => {
    const updated = await Organization.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!updated) return res.status(404).json({ message: 'Organization not found.' });
    const { password, ...safe } = updated.toJSON();
    res.json({ message, organization: safe });
  });

router.put('/organizations/:id/approve', setStatus('approved', 'Organization approved.'));
router.put('/organizations/:id/reject', setStatus('rejected', 'Organization rejected.'));

/* Delete org + cascade: its users, items, photos, and chats about those items */
router.delete('/organizations/:id', wrap(async (req, res) => {
  const org = await Organization.findById(req.params.id);
  if (!org) return res.status(404).json({ message: 'Organization not found.' });

  const [items, users] = await Promise.all([
    Item.find({ orgId: org.id }),
    User.find({ orgId: org.id }),
  ]);
  items.forEach((i) => deleteUpload(i.photo));
  users.forEach((u) => deleteUpload(u.profilePhoto));
  deleteUpload(org.logo);

  const convos = await Conversation.find({
    $or: [{ itemId: { $in: items.map((i) => i.id) } }, { participants: { $in: users.map((u) => u.id) } }],
  }).select('_id');
  const convoIds = convos.map((c) => c.id);
  await Message.deleteMany({ conversationId: { $in: convoIds } });
  await Conversation.deleteMany({ _id: { $in: convoIds } });

  await Item.deleteMany({ orgId: org.id });
  await User.deleteMany({ orgId: org.id });
  await org.deleteOne();
  res.json({ message: 'Organization and all its members/items deleted.' });
}));

/* Every user on the platform */
router.get('/users', wrap(async (req, res) => {
  const { q, orgId } = req.query;
  const filter = {};
  if (orgId) filter.orgId = orgId;
  if (q) {
    const re = contains(q);
    filter.$or = [{ name: re }, { email: re }];
  }

  const [users, orgs] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }),
    Organization.find().select('name'),
  ]);
  const orgsById = Object.fromEntries(orgs.map((o) => [o.id, o.name]));
  res.json(users.map((u) => ({ ...u.toJSON(), orgName: orgsById[u.orgId] || 'Unknown' })));
}));

router.delete('/users/:id', wrap(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  deleteUpload(user.profilePhoto);
  await user.deleteOne();
  res.json({ message: 'User removed.' });
}));

/* Every item on the platform - for moderation */
router.get('/items', wrap(async (req, res) => {
  const { q, category, status, orgId } = req.query;
  const filter = {};
  if (orgId) filter.orgId = orgId;
  if (category) filter.category = category;
  if (status) filter.status = status;
  if (q) {
    const re = contains(q);
    filter.$or = [{ title: re }, { description: re }];
  }

  const [items, orgs] = await Promise.all([
    Item.find(filter).sort({ createdAt: -1 }),
    Organization.find().select('name'),
  ]);
  const orgsById = Object.fromEntries(orgs.map((o) => [o.id, o.name]));
  res.json(items.map((i) => ({ ...i.toJSON(), orgName: orgsById[i.orgId] || 'Unknown' })));
}));

/* Platform-wide stat cards */
router.get('/stats', wrap(async (_req, res) => {
  const [orgStatus, totalUsers, totalItems, lostItems, foundItems, resolvedItems] = await Promise.all([
    countBy(Organization, 'status'),
    User.countDocuments(),
    Item.countDocuments(),
    Item.countDocuments({ category: 'lost' }),
    Item.countDocuments({ category: 'found' }),
    Item.countDocuments({ status: 'resolved' }),
  ]);
  const pending = orgStatus.pending || 0;
  const approved = orgStatus.approved || 0;
  const rejected = orgStatus.rejected || 0;
  res.json({
    totalOrganizations: pending + approved + rejected,
    pendingOrganizations: pending,
    approvedOrganizations: approved,
    rejectedOrganizations: rejected,
    totalUsers,
    totalItems,
    lostItems,
    foundItems,
    resolvedItems,
  });
}));

/* Analytics for dashboard charts */
router.get('/analytics', wrap(async (_req, res) => {
  const days = lastDays(14);
  const since = new Date();
  since.setDate(since.getDate() - 14);

  const [orgs, recentUsers, recentItems, typeCounts, statusCounts, perOrg] = await Promise.all([
    Organization.find({ createdAt: { $gte: since } }).select('createdAt'),
    User.find({ createdAt: { $gte: since } }).select('createdAt'),
    Item.find({ createdAt: { $gte: since } }).select('createdAt'),
    countBy(Organization, 'type'),
    countBy(Organization, 'status'),
    Item.aggregate([
      { $group: { _id: '$orgId', items: { $sum: 1 } } },
      { $sort: { items: -1 } },
      { $limit: 5 },
    ]),
  ]);

  const names = Object.fromEntries(
    (await Organization.find({ _id: { $in: perOrg.map((p) => p._id) } }).select('name')).map((o) => [o.id, o.name])
  );

  const on = (list, key) => list.filter((x) => dayKey(x.createdAt) === key).length;

  res.json({
    dailyGrowth: days.map(({ key, label }) => ({
      date: label,
      organizations: on(orgs, key),
      users: on(recentUsers, key),
      items: on(recentItems, key),
    })),
    orgTypeSplit: ['college', 'university', 'hospital', 'company', 'other'].map((type) => ({
      name: type[0].toUpperCase() + type.slice(1),
      value: typeCounts[type] || 0,
    })),
    topOrganizations: perOrg.map((p) => ({ name: names[p._id] || 'Unknown', items: p.items })),
    statusSplit: [
      { name: 'Pending', value: statusCounts.pending || 0 },
      { name: 'Approved', value: statusCounts.approved || 0 },
      { name: 'Rejected', value: statusCounts.rejected || 0 },
    ],
  });
}));

module.exports = router;

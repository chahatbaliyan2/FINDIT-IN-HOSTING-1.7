const express = require('express');
const { Item, Organization } = require('../models');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { saveUpload } = upload;
const { contains, exact, deleteUpload, dateRange, wrap } = require('../utils/helpers');

const router = express.Router();

/* Public: search/browse all approved organizations with rich filters. */
router.get('/organizations', wrap(async (req, res) => {
  const { q, type, city, district, state } = req.query;
  const filter = { status: 'approved' };
  if (type) filter.type = type;
  if (city) filter.city = exact(city);
  if (district) filter.district = exact(district);
  if (state) filter.state = exact(state);
  if (q) {
    const re = contains(q);
    filter.$or = [{ name: re }, { description: re }, { city: re }, { address: re }];
  }

  const orgs = await Organization.find(filter).sort({ name: 1 });
  const counts = await Item.aggregate([
    { $match: { orgId: { $in: orgs.map((o) => o.id) } } },
    { $group: { _id: '$orgId', n: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [c._id, c.n]));

  res.json(
    orgs.map((o) => ({
      id: o.id,
      name: o.name,
      type: o.type,
      description: o.description || '',
      address: o.address || '',
      city: o.city || '',
      district: o.district || '',
      state: o.state || '',
      pincode: o.pincode || '',
      website: o.website || '',
      logo: o.logo || null,
      itemCount: countMap[o.id] || 0,
    }))
  );
}));

/* Public: distinct values for filter dropdowns */
router.get('/organizations/filters', wrap(async (_req, res) => {
  const base = { status: 'approved' };
  const distinct = async (field) => (await Organization.distinct(field, base)).filter(Boolean).sort();
  const [types, cities, districts, states] = await Promise.all(
    ['type', 'city', 'district', 'state'].map(distinct)
  );
  res.json({ types, cities, districts, states });
}));

/* Public: list items for one organization, with rich filters */
router.get('/', wrap(async (req, res) => {
  const { orgId, category, status, q, sort, dateFrom, dateTo } = req.query;
  if (!orgId) return res.status(400).json({ message: 'orgId query param is required.' });

  const filter = { orgId };
  if (category === 'lost' || category === 'found') filter.category = category;
  if (status === 'open' || status === 'resolved') filter.status = status;
  if (q) {
    const re = contains(q);
    filter.$or = [{ title: re }, { description: re }];
  }
  const range = dateRange(dateFrom, dateTo);
  if (range) filter.createdAt = range;

  // contact info stays private in list view
  const items = await Item.find(filter)
    .select('-contactInfo')
    .sort({ createdAt: sort === 'oldest' ? 1 : -1 });
  res.json(items);
}));

/* Protected (user only): all items posted by the logged-in user */
router.get('/mine', requireAuth('user'), wrap(async (req, res) => {
  res.json(await Item.find({ userId: req.user.userId }).sort({ createdAt: -1 }));
}));

/* Item detail: contact info only for logged-in accounts */
router.get('/:id', optionalAuth, wrap(async (req, res) => {
  const item = await Item.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'Item not found.' });

  const org = await Organization.findById(item.orgId);
  const canSeeContact = !!req.user;
  const payload = item.toJSON();
  if (!canSeeContact) delete payload.contactInfo;
  res.json({ ...payload, orgName: org ? org.name : '', contactVisible: canSeeContact });
}));

/* Protected (user only): create a lost/found item post, with optional photo */
router.post('/', requireAuth('user'), upload.single('photo'), wrap(async (req, res) => {
  const { title, description, category, contactInfo } = req.body;
  if (!title || !description || !category) {
    return res.status(400).json({ message: 'Title, description and category (lost/found) are required.' });
  }
  if (category !== 'lost' && category !== 'found') {
    return res.status(400).json({ message: 'Category must be "lost" or "found".' });
  }

  const item = await Item.create({
    title,
    description,
    category,
    photo: req.file ? await saveUpload(req.file) : null,
    contactInfo: contactInfo || '',
    orgId: req.user.orgId,
    userId: req.user.userId,
    postedBy: req.user.name,
    status: 'open',
  });
  res.status(201).json(item);
}));

/* Protected (user only, own item): edit. New photo replaces the old file. */
router.put('/:id', requireAuth('user'), upload.single('photo'), wrap(async (req, res) => {
  const item = await Item.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'Item not found.' });
  if (item.userId !== req.user.userId) {
    return res.status(403).json({ message: 'You can only edit your own items.' });
  }

  const { title, description, category, contactInfo, removePhoto } = req.body;
  if (category && category !== 'lost' && category !== 'found') {
    return res.status(400).json({ message: 'Category must be "lost" or "found".' });
  }

  if (title !== undefined) item.title = title;
  if (description !== undefined) item.description = description;
  if (category !== undefined) item.category = category;
  if (contactInfo !== undefined) item.contactInfo = contactInfo;

  if (req.file) {
    await deleteUpload(item.photo);
    item.photo = await saveUpload(req.file);
  } else if (removePhoto === 'true' && item.photo) {
    deleteUpload(item.photo);
    item.photo = null;
  }

  await item.save();
  res.json(item);
}));

/* Protected (user only, own item): mark resolved */
router.put('/:id/resolve', requireAuth('user'), wrap(async (req, res) => {
  const item = await Item.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'Item not found.' });
  if (item.userId !== req.user.userId) return res.status(403).json({ message: 'Not your item.' });

  item.status = 'resolved';
  await item.save();
  res.json(item);
}));

router.delete('/:id', requireAuth('user', 'org', 'admin'), wrap(async (req, res) => {
  const item = await Item.findById(req.params.id);
  if (!item) return res.status(404).json({ message: 'Item not found.' });

  const isOwner = req.user.role === 'user' && item.userId === req.user.userId;
  const isOrgOwner = req.user.role === 'org' && item.orgId === req.user.orgId;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isOrgOwner && !isAdmin) return res.status(403).json({ message: 'Not allowed to delete this item.' });

  deleteUpload(item.photo);
  await item.deleteOne();
  res.json({ message: 'Item deleted.' });
}));

module.exports = router;

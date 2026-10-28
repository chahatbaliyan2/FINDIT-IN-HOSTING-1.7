const express = require('express');
const bcrypt = require('bcryptjs');
const { User, Organization } = require('../models');
const { requireAuth, signToken } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { saveUpload } = upload;
const { deleteUpload, wrap } = require('../utils/helpers');

const router = express.Router();

router.use(requireAuth('user'));

/* My own full profile */
router.get('/me', wrap(async (req, res) => {
  const user = await User.findById(req.user.userId);
  if (!user) return res.status(404).json({ message: 'Account not found.' });
  const org = await Organization.findById(user.orgId);
  const { password, ...safe } = user.toJSON();
  res.json({ ...safe, orgName: org ? org.name : '' });
}));

/* Edit profile (+ optional password change) */
router.put('/me', upload.single('profilePhoto'), wrap(async (req, res) => {
  const { name, currentPassword, newPassword, removePhoto } = req.body;
  const user = await User.findById(req.user.userId);
  if (!user) return res.status(404).json({ message: 'Account not found.' });

  if (name !== undefined && name.trim() !== '') user.name = name.trim();
  for (const f of ['phone', 'bio', 'address', 'city', 'state']) {
    if (req.body[f] !== undefined) user[f] = req.body[f];
  }

  if (newPassword) {
    if (!currentPassword) {
      return res.status(400).json({ message: 'Enter your current password to set a new one.' });
    }
    if (!(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }
    user.password = await bcrypt.hash(newPassword, 10);
  }

  if (req.file) {
    deleteUpload(user.profilePhoto);
    user.profilePhoto = await saveUpload(req.file);
  } else if (removePhoto === 'true' && user.profilePhoto) {
    deleteUpload(user.profilePhoto);
    user.profilePhoto = null;
  }

  await user.save();
  const org = await Organization.findById(user.orgId);

  // Re-issue token in case the name changed
  const token = signToken({ role: 'user', userId: user.id, orgId: user.orgId, name: user.name });

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      bio: user.bio || '',
      address: user.address || '',
      city: user.city || '',
      state: user.state || '',
      profilePhoto: user.profilePhoto || null,
      orgId: user.orgId,
      orgName: org ? org.name : '',
    },
  });
}));

module.exports = router;

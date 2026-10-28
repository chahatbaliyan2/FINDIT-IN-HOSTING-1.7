const express = require('express');
const { Item, User, Conversation, Message } = require('../models');
const { requireAuth } = require('../middleware/auth');
const { wrap } = require('../utils/helpers');

const router = express.Router();

router.use(requireAuth('user'));

// Messages from others that I haven't read yet in one conversation.
const unreadFor = (convo, me) => {
  const myReadAt = convo.readAt && convo.readAt[me];
  const filter = { conversationId: convo.id, senderId: { $ne: me } };
  if (myReadAt) filter.createdAt = { $gt: new Date(myReadAt) };
  return Message.countDocuments(filter);
};

/* Start (or reuse) a conversation about one item with its poster */
router.post('/start', wrap(async (req, res) => {
  const { itemId } = req.body;
  if (!itemId) return res.status(400).json({ message: 'itemId is required.' });

  const item = await Item.findById(itemId);
  if (!item) return res.status(404).json({ message: 'Item not found.' });

  if (item.userId === req.user.userId) {
    return res.status(400).json({ message: "You can't start a chat with yourself about your own item." });
  }

  const me = req.user.userId;
  const other = item.userId;

  let convo = await Conversation.findOne({ itemId, participants: { $all: [me, other] } });
  if (!convo) {
    const otherUser = await User.findById(other);
    convo = await Conversation.create({
      itemId,
      itemTitle: item.title,
      itemPhoto: item.photo || null,
      participants: [me, other],
      participantNames: { [me]: req.user.name, [other]: otherUser ? otherUser.name : 'User' },
      readAt: { [me]: new Date().toISOString() },
    });
  }
  res.status(201).json(convo);
}));

/* My conversations, newest activity first, with unread counts */
router.get('/conversations', wrap(async (req, res) => {
  const me = req.user.userId;
  const convos = await Conversation.find({ participants: me });

  const result = await Promise.all(
    convos.map(async (c) => {
      const otherId = c.participants.find((p) => p !== me);
      return {
        id: c.id,
        itemId: c.itemId,
        itemTitle: c.itemTitle,
        itemPhoto: c.itemPhoto,
        otherName: c.participantNames?.[otherId] || 'User',
        lastMessage: c.lastMessage,
        lastMessageAt: c.lastMessageAt,
        lastMessageIsMine: c.lastMessageSenderId === me,
        unread: await unreadFor(c, me),
        updatedAt: c.lastMessageAt || c.createdAt,
      };
    })
  );

  result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(result);
}));

/* Total unread - navbar badge */
router.get('/unread-count', wrap(async (req, res) => {
  const me = req.user.userId;
  const convos = await Conversation.find({ participants: me });
  const counts = await Promise.all(convos.map((c) => unreadFor(c, me)));
  res.json({ count: counts.reduce((a, b) => a + b, 0) });
}));

/* One conversation's messages; marks it read for me */
router.get('/conversations/:id/messages', wrap(async (req, res) => {
  const me = req.user.userId;
  const convo = await Conversation.findById(req.params.id);
  if (!convo) return res.status(404).json({ message: 'Conversation not found.' });
  if (!convo.participants.includes(me)) return res.status(403).json({ message: 'Not your conversation.' });

  const messages = await Message.find({ conversationId: convo.id }).sort({ createdAt: 1 });

  await Conversation.updateOne(
    { _id: convo.id },
    { $set: { [`readAt.${me}`]: new Date().toISOString() } },
    { timestamps: false }
  );

  const otherId = convo.participants.find((p) => p !== me);
  res.json({
    messages,
    itemId: convo.itemId,
    itemTitle: convo.itemTitle,
    otherName: convo.participantNames?.[otherId] || 'User',
  });
}));

/* Send a message */
router.post('/conversations/:id/messages', wrap(async (req, res) => {
  const me = req.user.userId;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ message: 'Message cannot be empty.' });

  const convo = await Conversation.findById(req.params.id);
  if (!convo) return res.status(404).json({ message: 'Conversation not found.' });
  if (!convo.participants.includes(me)) return res.status(403).json({ message: 'Not your conversation.' });

  const message = await Message.create({
    conversationId: convo.id,
    senderId: me,
    senderName: req.user.name,
    text: text.trim(),
  });

  await Conversation.updateOne(
    { _id: convo.id },
    {
      $set: {
        lastMessage: message.text,
        lastMessageAt: message.createdAt,
        lastMessageSenderId: me,
        [`readAt.${me}`]: message.createdAt.toISOString(),
      },
    }
  );

  res.status(201).json(message);
}));

module.exports = router;

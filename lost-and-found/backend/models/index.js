// Mongoose models. _id is a string (ObjectId hex) so references like orgId /
// userId stay plain strings and the API JSON keeps the same `id` field the
// frontend already uses.
const mongoose = require('mongoose');
const { Schema } = mongoose;

const newId = () => new mongoose.Types.ObjectId().toString();

function make(name, definition, opts = {}) {
  const schema = new Schema(
    { _id: { type: String, default: newId }, ...definition },
    { timestamps: true, minimize: false, ...opts }
  );
  schema.set('toJSON', {
    virtuals: false,
    versionKey: false,
    transform: (_doc, ret) => {
      ret.id = ret._id;
      delete ret._id;
      return ret;
    },
  });
  return { schema, model: mongoose.model(name, schema) };
}

const { model: Admin } = make('Admin', {
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});

const { model: Organization } = make('Organization', {
  name: { type: String, required: true, trim: true },
  type: { type: String, required: true }, // college | university | hospital | company | other
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  phone: { type: String, default: '' },
  description: { type: String, default: '' },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  district: { type: String, default: '' },
  state: { type: String, default: '' },
  pincode: { type: String, default: '' },
  website: { type: String, default: '' },
  logo: { type: String, default: null },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
});

const { model: User } = make('User', {
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  phone: { type: String, default: '' },
  bio: { type: String, default: '' },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  state: { type: String, default: '' },
  profilePhoto: { type: String, default: null },
  orgId: { type: String, required: true, index: true },
});

const { model: Item } = make('Item', {
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, enum: ['lost', 'found'], required: true },
  photo: { type: String, default: null },
  contactInfo: { type: String, default: '' },
  orgId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  postedBy: { type: String, default: '' },
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
});

const { model: Conversation } = make('Conversation', {
  itemId: { type: String, required: true },
  itemTitle: { type: String, default: '' },
  itemPhoto: { type: String, default: null },
  participants: { type: [String], index: true },
  participantNames: { type: Schema.Types.Mixed, default: {} },
  lastMessage: { type: String, default: '' },
  lastMessageAt: { type: Date, default: null },
  lastMessageSenderId: { type: String, default: null },
  readAt: { type: Schema.Types.Mixed, default: {} },
});

const { model: Message } = make('Message', {
  conversationId: { type: String, required: true, index: true },
  senderId: { type: String, required: true },
  senderName: { type: String, default: '' },
  text: { type: String, required: true },
});

// Uploaded photos/logos live in MongoDB (Vercel's filesystem is read-only).
const { model: Image } = make('Image', {
  data: { type: Buffer, required: true },
  contentType: { type: String, required: true },
});

module.exports = { Image, Admin, Organization, User, Item, Conversation, Message };

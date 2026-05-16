// ============================================================
// CINDERWELL — Mongoose connection to MongoDB Atlas
// Same cluster as Glide; database = 'lumora' (separate from glide)
// ============================================================

const mongoose = require('mongoose');

let cached = null;

async function connectCinderwell() {
  if (cached) return cached;

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('[Cinderwell] MONGO_URI is not set. Refusing to boot.');
  }

  // Mongoose 8 sensible defaults; let Atlas handle TLS automatically.
  mongoose.set('strictQuery', true);

  try {
    cached = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 20,
      minPoolSize: 2,
      retryWrites: true,
    });

    const db = cached.connection;
    console.log(`[Cinderwell] connected · db=${db.name} · host=${db.host}`);

    db.on('error', (err) => console.error('[Cinderwell] error:', err.message));
    db.on('disconnected', () => console.warn('[Cinderwell] disconnected'));
    db.on('reconnected', () => console.log('[Cinderwell] reconnected'));

    return cached;
  } catch (err) {
    console.error('[Cinderwell] failed to connect:', err.message);
    throw err;
  }
}

module.exports = { connectCinderwell, mongoose };

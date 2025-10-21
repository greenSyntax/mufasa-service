// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const cors = require('cors');
const Polygon = require('./models/Polygon');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 4000;
const DB_URL = process.env.DATABASE_URL;

if (!DB_URL) {
  console.error('ERROR: DATABASE_URL environment variable not set.');
  process.exit(1);
}

// connect to MongoDB
mongoose.connect(DB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.log("DB URL:", DB_URL)
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// multer: keep file in memory (so we can store buffer in MongoDB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// helper: compute bounds (NE, SW)
function computeBounds(coords) {
  if (!coords || coords.length === 0) return null;
  let minLat = coords[0].lat, maxLat = coords[0].lat;
  let minLng = coords[0].lng, maxLng = coords[0].lng;

  for (const c of coords) {
    const lat = Number(c.lat);
    const lng = Number(c.lng);
    if (isNaN(lat) || isNaN(lng)) continue;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }

  return {
    northeast: { lat: maxLat, lng: maxLng },
    southwest: { lat: minLat, lng: minLng }
  };
}

// ROUTES

// Health
app.get('/', (req, res) => res.json({ ok: true }));

// Create polygon (multipart/form-data with optional image file under field 'image')
app.post('/polygons', upload.single('image'), async (req, res) => {
  try {
    const { title, description, coordinates } = req.body;

    // Validate title
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'title is required' });
    }

    // Coordinates: expect JSON string or already-parsed array
    let coords = [];
    if (!coordinates) {
      return res.status(400).json({ error: 'coordinates are required (array of {lat,lng})' });
    }
    if (typeof coordinates === 'string') {
      try {
        coords = JSON.parse(coordinates);
      } catch (err) {
        return res.status(400).json({ error: 'coordinates must be a valid JSON array' });
      }
    } else if (Array.isArray(coordinates)) {
      coords = coordinates;
    } else {
      return res.status(400).json({ error: 'coordinates must be array' });
    }

    if (!Array.isArray(coords) || coords.length < 1) {
      return res.status(400).json({ error: 'coordinates must be a non-empty array' });
    }

    // Validate each coordinate
    const normalized = coords.map(c => {
      const lat = Number(c.lat ?? c.latitude ?? c[0]);
      const lng = Number(c.lng ?? c.longitude ?? c[1]);
      if (isNaN(lat) || isNaN(lng)) {
        throw new Error('invalid coordinate value');
      }
      return { lat, lng };
    });

    const bounds = computeBounds(normalized);

    const polygonDoc = new Polygon({
      title: title.trim(),
      description: (description || '').trim(),
      coordinates: normalized,
      bounds
    });

    // If image present, attach
    if (req.file) {
      polygonDoc.image = {
        data: req.file.buffer,
        contentType: req.file.mimetype,
        filename: req.file.originalname,
        size: req.file.size
      };
    }

    const saved = await polygonDoc.save();

    // respond with created object (without raw image data to keep payload small)
    const out = {
      id: saved._id,
      title: saved.title,
      description: saved.description,
      coordinates: saved.coordinates,
      bounds: saved.bounds,
      createdAt: saved.createdAt
    };
    res.status(201).json(out);
  } catch (err) {
    console.error('POST /polygons error:', err);
    if (err.message && err.message.includes('invalid coordinate')) {
      return res.status(400).json({ error: 'Invalid coordinate in array' });
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// List polygons (no image data)
app.get('/polygons', async (req, res) => {
  try {
    const list = await Polygon.find({}, '-image').sort({ createdAt: -1 }).limit(100).lean();
    res.json(list);
  } catch (err) {
    console.error('GET /polygons error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get polygon by id (metadata + coordinates + bounds) - does not return binary image
app.get('/polygons/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await Polygon.findById(id, '-image').lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) {
    console.error('GET /polygons/:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get image binary for polygon (if exists)
app.get('/polygons/:id/image', async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await Polygon.findById(id, 'image').lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (!doc.image || !doc.image.data) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.set('Content-Type', doc.image.contentType || 'application/octet-stream');
    res.send(Buffer.from(doc.image.data.buffer || doc.image.data));
  } catch (err) {
    console.error('GET /polygons/:id/image error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

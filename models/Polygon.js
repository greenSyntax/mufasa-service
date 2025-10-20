// models/Polygon.js
const mongoose = require('mongoose');

const CoordinateSchema = new mongoose.Schema({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true }
}, { _id: false });

const BoundsSchema = new mongoose.Schema({
  northeast: { lat: Number, lng: Number },
  southwest: { lat: Number, lng: Number }
}, { _id: false });

const ImageSchema = new mongoose.Schema({
  data: Buffer,
  contentType: String,
  filename: String,
  size: Number
}, { _id: false });

const PolygonSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, trim: true, default: '' },
  image: ImageSchema, // optional
  coordinates: { type: [CoordinateSchema], required: true },
  bounds: BoundsSchema,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

PolygonSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Polygon', PolygonSchema);
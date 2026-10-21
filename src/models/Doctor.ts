import mongoose, { model, Schema, type InferSchemaType } from "mongoose";
import { buildKeywords } from "../utils/query.js";

const doctorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    specialization: { type: String, required: true, trim: true, maxlength: 80 },
    hospital: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    keywords: { type: [String], select: false },
  },
  { timestamps: true },
);

doctorSchema.pre("validate", function () {
  this.keywords = buildKeywords(this.name, this.specialization, this.hospital, this.email);
});

doctorSchema.index({ createdAt: -1, _id: -1 });
doctorSchema.index({ specialization: 1, createdAt: -1 });
doctorSchema.index({ hospital: 1, createdAt: -1 });
doctorSchema.index({ keywords: 1 });
doctorSchema.index({ name: 1 });
doctorSchema.index({ email: 1 }, { unique: true });

export type DoctorDocument = InferSchemaType<typeof doctorSchema>;
export const Doctor = mongoose.models.Doctor || model("Doctor", doctorSchema);

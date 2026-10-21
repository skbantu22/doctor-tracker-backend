import mongoose, { model, Schema, type InferSchemaType } from "mongoose";
import { buildKeywords } from "../utils/query.js";

export const patientStatuses = ["Active", "Follow-up", "Recovered"] as const;

const patientSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, required: true, trim: true, maxlength: 30 },
    condition: { type: String, required: true, trim: true, maxlength: 100 },
    status: { type: String, enum: patientStatuses, default: "Active" },
    doctor: { type: Schema.Types.ObjectId, ref: "Doctor", required: true },
    keywords: { type: [String], select: false },
  },
  { timestamps: true },
);

patientSchema.pre("validate", function () {
  this.keywords = buildKeywords(this.name, this.email, this.phone?.replace(/\D/g, ""), this.condition);
});

patientSchema.index({ createdAt: -1, _id: -1 });
patientSchema.index({ doctor: 1, createdAt: -1 });
patientSchema.index({ condition: 1, createdAt: -1 });
patientSchema.index({ status: 1, createdAt: -1 });
patientSchema.index({ keywords: 1 });
patientSchema.index({ email: 1 });

export type PatientDocument = InferSchemaType<typeof patientSchema>;
export const Patient = mongoose.models.Patient || model("Patient", patientSchema);

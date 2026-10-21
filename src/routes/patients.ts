import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { Doctor } from "../models/Doctor.js";
import { Patient, patientStatuses } from "../models/Patient.js";
import { dateRangeFilter, HttpError, keywordFilter, pageMeta, parsePagination, queryString } from "../utils/query.js";

const router = Router();
const patientSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(254),
  phone: z.string().trim().min(7).max(30),
  condition: z.string().trim().min(2).max(100),
  status: z.enum(patientStatuses),
  doctor: z.string().refine((value) => Types.ObjectId.isValid(value), "Choose a valid doctor."),
});
const partialPatientSchema = patientSchema.partial().refine((value) => Object.keys(value).length > 0, "Nothing to update.");
const doctorFields = "name specialization hospital";

function patientId(id: string | string[] | undefined) {
  if (typeof id !== "string" || !Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid patient id.");
  return id;
}

router.get("/", async (req, res) => {
  const { page, limit } = parsePagination(req);
  const condition = queryString(req, "condition", 100);
  const status = queryString(req, "status");
  const doctorId = queryString(req, "doctor");
  if (doctorId && !Types.ObjectId.isValid(doctorId)) throw new HttpError(400, "Invalid doctor filter.");
  if (status && !patientStatuses.includes(status as (typeof patientStatuses)[number])) throw new HttpError(400, "Invalid status filter.");

  const filter = {
    ...dateRangeFilter(req),
    ...(condition ? { condition } : {}),
    ...(status ? { status } : {}),
    ...(doctorId ? { doctor: new Types.ObjectId(doctorId) } : {}),
    ...keywordFilter(queryString(req, "search")),
  };
  const [patients, total] = await Promise.all([
    Patient.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).populate("doctor", doctorFields).lean(),
    Patient.countDocuments(filter),
  ]);
  res.json({ data: patients, pagination: pageMeta(page, limit, total) });
});

router.get("/filters", async (_req, res) => {
  const [conditions, doctors] = await Promise.all([
    Patient.distinct("condition"),
    Doctor.find().select("_id name specialization").sort({ name: 1 }).lean(),
  ]);
  res.json({ data: { conditions: conditions.sort(), doctors } });
});

router.post("/", async (req, res) => {
  const parsed = patientSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Check the patient details and try again.", z.flattenError(parsed.error).fieldErrors);
  if (!(await Doctor.exists({ _id: parsed.data.doctor }))) throw new HttpError(404, "Doctor not found.");
  const patient = await Patient.create(parsed.data);
  res.status(201).json({ data: patient });
});

router.patch("/:id", async (req, res) => {
  const id = patientId(req.params.id);
  const parsed = partialPatientSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Check the patient details and try again.", z.flattenError(parsed.error).fieldErrors);
  if (parsed.data.doctor && !(await Doctor.exists({ _id: parsed.data.doctor }))) throw new HttpError(404, "Doctor not found.");
  const patient = await Patient.findById(id);
  if (!patient) throw new HttpError(404, "Patient not found.");
  patient.set(parsed.data);
  await patient.save();
  await patient.populate("doctor", doctorFields);
  res.json({ data: patient });
});

router.delete("/:id", async (req, res) => {
  const patient = await Patient.findByIdAndDelete(patientId(req.params.id));
  if (!patient) throw new HttpError(404, "Patient not found.");
  res.status(204).end();
});

export default router;

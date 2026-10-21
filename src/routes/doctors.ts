import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { Doctor } from "../models/Doctor.js";
import { Patient, patientStatuses } from "../models/Patient.js";
import { dateRangeFilter, HttpError, keywordFilter, pageMeta, parsePagination, queryString } from "../utils/query.js";

const router = Router();
const doctorSchema = z.object({
  name: z.string().trim().min(2).max(100),
  specialization: z.string().trim().min(2).max(80),
  hospital: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  email: z.email().max(254),
});
const partialDoctorSchema = doctorSchema.partial().refine((value) => Object.keys(value).length > 0, "Nothing to update.");
const patientSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(254),
  phone: z.string().trim().min(7).max(30),
  condition: z.string().trim().min(2).max(100),
  status: z.enum(patientStatuses).optional(),
});
const sortOptions = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  name: { name: 1, _id: 1 },
} as const;

function doctorId(id: string | string[] | undefined) {
  if (typeof id !== "string" || !Types.ObjectId.isValid(id)) throw new HttpError(400, "Invalid doctor id.");
  return new Types.ObjectId(id);
}

async function patientCountsFor(doctorIds: Types.ObjectId[]) {
  if (!doctorIds.length) return new Map<string, number>();
  const counts = await Patient.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { doctor: { $in: doctorIds } } },
    { $group: { _id: "$doctor", count: { $sum: 1 } } },
  ]);
  return new Map(counts.map((item) => [String(item._id), item.count]));
}

router.get("/", async (req, res) => {
  const { page, limit } = parsePagination(req);
  const specialization = queryString(req, "specialization");
  const hospital = queryString(req, "hospital", 120);
  const sortKey = queryString(req, "sort") as keyof typeof sortOptions;
  const filter = {
    ...dateRangeFilter(req),
    ...(specialization ? { specialization } : {}),
    ...(hospital ? { hospital } : {}),
    ...keywordFilter(queryString(req, "search")),
  };

  const [doctors, total] = await Promise.all([
    Doctor.find(filter).sort(sortOptions[sortKey] ?? sortOptions.newest).skip((page - 1) * limit).limit(limit).lean(),
    Doctor.countDocuments(filter),
  ]);
  const patientCounts = await patientCountsFor(doctors.map((doctor) => doctor._id as Types.ObjectId));

  res.json({
    data: doctors.map((doctor) => ({ ...doctor, patientCount: patientCounts.get(String(doctor._id)) ?? 0 })),
    pagination: pageMeta(page, limit, total),
  });
});

router.get("/filters", async (_req, res) => {
  const [specializations, hospitals] = await Promise.all([Doctor.distinct("specialization"), Doctor.distinct("hospital")]);
  res.json({ data: { specializations: specializations.sort(), hospitals: hospitals.sort() } });
});

router.post("/", async (req, res) => {
  const parsed = doctorSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Check the doctor details and try again.", z.flattenError(parsed.error).fieldErrors);
  const doctor = await Doctor.create(parsed.data);
  res.status(201).json({ data: doctor });
});

router.get("/:id", async (req, res) => {
  const id = doctorId(req.params.id);
  const [doctor, statusCounts] = await Promise.all([
    Doctor.findById(id).lean(),
    Patient.aggregate<{ _id: string; count: number }>([
      { $match: { doctor: id } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);
  if (!doctor) throw new HttpError(404, "Doctor not found.");
  const byStatus = Object.fromEntries(patientStatuses.map((status) => [status, statusCounts.find((row) => row._id === status)?.count ?? 0]));
  const patientCount = statusCounts.reduce((sum, row) => sum + row.count, 0);
  res.json({ data: { ...doctor, patientCount, byStatus } });
});

router.patch("/:id", async (req, res) => {
  const id = doctorId(req.params.id);
  const parsed = partialDoctorSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Check the doctor details and try again.", z.flattenError(parsed.error).fieldErrors);
  const doctor = await Doctor.findById(id);
  if (!doctor) throw new HttpError(404, "Doctor not found.");
  doctor.set(parsed.data);
  await doctor.save();
  res.json({ data: doctor });
});

router.delete("/:id", async (req, res) => {
  const id = doctorId(req.params.id);
  if (await Patient.exists({ doctor: id })) {
    throw new HttpError(409, "Reassign or remove this doctor's patients before deleting the doctor.");
  }
  const doctor = await Doctor.findByIdAndDelete(id);
  if (!doctor) throw new HttpError(404, "Doctor not found.");
  res.status(204).end();
});

router.get("/:id/patients", async (req, res) => {
  const id = doctorId(req.params.id);
  const { page, limit } = parsePagination(req);
  const status = queryString(req, "status");
  if (status && !patientStatuses.includes(status as (typeof patientStatuses)[number])) throw new HttpError(400, "Invalid status filter.");
  const filter = { doctor: id, ...(status ? { status } : {}), ...keywordFilter(queryString(req, "search")) };

  const [exists, patients, total] = await Promise.all([
    Doctor.exists({ _id: id }),
    Patient.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Patient.countDocuments(filter),
  ]);
  if (!exists) throw new HttpError(404, "Doctor not found.");
  res.json({ data: patients, pagination: pageMeta(page, limit, total) });
});

router.post("/:id/patients", async (req, res) => {
  const id = doctorId(req.params.id);
  const parsed = patientSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Check the patient details and try again.", z.flattenError(parsed.error).fieldErrors);
  if (!(await Doctor.exists({ _id: id }))) throw new HttpError(404, "Doctor not found.");
  const patient = await Patient.create({ ...parsed.data, doctor: id });
  res.status(201).json({ data: patient });
});

router.delete("/:id/patients/:patientId", async (req, res) => {
  const id = doctorId(req.params.id);
  if (!Types.ObjectId.isValid(req.params.patientId)) throw new HttpError(400, "Invalid patient id.");
  const patient = await Patient.findOneAndDelete({ _id: req.params.patientId, doctor: id });
  if (!patient) throw new HttpError(404, "Patient not found for this doctor.");
  res.status(204).end();
});

export default router;

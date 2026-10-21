import { Router } from "express";
import type { Model } from "mongoose";
import { Doctor } from "../models/Doctor.js";
import { Patient, patientStatuses } from "../models/Patient.js";
import { generateInsights } from "../services/insights.js";
import { queryString } from "../utils/query.js";

const router = Router();
const allowedRanges = [3, 6, 12] as const;

type MonthRow = { _id: { year: number; month: number }; count: number };

/** Groups documents created since `start` by calendar month; uses the createdAt index for the $match. */
function monthlyCounts(model: Model<any>, start: Date) {
  return model.aggregate<MonthRow>([
    { $match: { createdAt: { $gte: start } } },
    { $group: { _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } }, count: { $sum: 1 } } },
  ]);
}

function parseMonths(raw: string) {
  const requested = Number(raw);
  return allowedRanges.find((value) => value === requested) ?? 6;
}

async function buildOverview(months: number) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCMonth(start.getUTCMonth() - (months - 1));

  const [doctorCount, statusRows, patientMonths, doctorMonths, patientsByDoctor, conditions, specializations] = await Promise.all([
    Doctor.estimatedDocumentCount(),
    Patient.aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    monthlyCounts(Patient, start),
    monthlyCounts(Doctor, start),
    Patient.aggregate([
      { $group: { _id: "$doctor", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
      { $lookup: { from: "doctors", localField: "_id", foreignField: "_id", pipeline: [{ $project: { name: 1, specialization: 1 } }], as: "doctor" } },
      { $unwind: "$doctor" },
      { $project: { _id: 0, id: "$_id", name: "$doctor.name", specialization: "$doctor.specialization", count: 1 } },
    ]),
    Patient.aggregate([
      { $group: { _id: "$condition", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
      { $project: { _id: 0, name: "$_id", count: 1 } },
    ]),
    Doctor.aggregate([
      { $group: { _id: "$specialization", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
      { $project: { _id: 0, name: "$_id", count: 1 } },
    ]),
  ]);

  const byStatus = Object.fromEntries(patientStatuses.map((status) => [status, statusRows.find((row) => row._id === status)?.count ?? 0]));
  const patientCount = statusRows.reduce((sum, row) => sum + row.count, 0);
  const toMap = (rows: MonthRow[]) => new Map(rows.map((row) => [`${row._id.year}-${row._id.month}`, row.count]));
  const patientMap = toMap(patientMonths);
  const doctorMap = toMap(doctorMonths);
  const monthly = Array.from({ length: months }, (_, index) => {
    const date = new Date(start);
    date.setUTCMonth(start.getUTCMonth() + index);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`;
    return {
      month: date.toLocaleString("en", { month: "short", year: "2-digit", timeZone: "UTC" }),
      patients: patientMap.get(key) ?? 0,
      doctors: doctorMap.get(key) ?? 0,
    };
  });
  const newPatients = monthly.reduce((sum, row) => sum + row.patients, 0);

  return {
    months,
    doctorCount,
    patientCount,
    byStatus,
    newPatients,
    averagePerDoctor: doctorCount ? Math.round((patientCount / doctorCount) * 10) / 10 : 0,
    monthly,
    patientsByDoctor,
    conditions,
    specializations,
  };
}

router.get("/overview", async (req, res) => {
  res.json({ data: await buildOverview(parseMonths(queryString(req, "months"))) });
});

router.get("/insights", async (req, res) => {
  const overview = await buildOverview(parseMonths(queryString(req, "months")));
  // Only aggregates are sent to the model; the counts in the key refresh insights after data changes.
  const { months, doctorCount, patientCount, newPatients, averagePerDoctor, byStatus, monthly, patientsByDoctor, conditions, specializations } = overview;
  const summary = {
    rangeMonths: months, doctorCount, patientCount, newPatientsInRange: newPatients, averagePatientsPerDoctor: averagePerDoctor, byStatus,
    // Explicit names stop the model reading "doctors joined" as "doctors treating" that month's patients.
    monthly: monthly.map(({ month, patients, doctors }) => ({ month, newPatientsRegistered: patients, newDoctorsJoined: doctors })),
    topDoctorsByCaseload: patientsByDoctor.map(({ name, specialization, count }) => ({ name, specialization, count })),
    topConditions: conditions, doctorsBySpecialty: specializations,
  };
  const cacheKey = [months, doctorCount, patientCount, newPatients, byStatus.Active, byStatus["Follow-up"]].join(":");
  res.json({ data: await generateInsights(cacheKey, summary) });
});

export default router;

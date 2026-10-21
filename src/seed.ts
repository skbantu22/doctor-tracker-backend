import mongoose from "mongoose";
import { connectDatabase } from "./db.js";
import { Doctor } from "./models/Doctor.js";
import { Patient, patientStatuses } from "./models/Patient.js";

const doctors = [
  ["Amara Rahman", "Cardiology", "Northview Medical Center"],
  ["Daniel Cho", "Neurology", "Meridian Health"],
  ["Sofia Malik", "Dermatology", "Willowbrook Clinic"],
  ["Nikhil Das", "Pediatrics", "Northview Medical Center"],
  ["Maya Fernandez", "Orthopedics", "Cedar Grove Hospital"],
  ["Hasan Mahmud", "Endocrinology", "Meridian Health"],
  ["Priya Sen", "Pulmonology", "Cedar Grove Hospital"],
  ["Lucas Moreau", "Cardiology", "Willowbrook Clinic"],
  ["Rumana Akter", "Psychiatry", "Northview Medical Center"],
  ["Kenji Watanabe", "Neurology", "Cedar Grove Hospital"],
] as const;

const conditionsBySpecialty: Record<string, string[]> = {
  Cardiology: ["Hypertension", "Arrhythmia", "Coronary artery disease"],
  Neurology: ["Migraine", "Epilepsy", "Neuropathy"],
  Dermatology: ["Eczema", "Acne", "Psoriasis"],
  Pediatrics: ["Asthma", "Seasonal allergies", "Otitis media"],
  Orthopedics: ["Arthritis", "Back pain", "Fracture recovery"],
  Endocrinology: ["Type 2 diabetes", "Hypothyroidism"],
  Pulmonology: ["Asthma", "COPD"],
  Psychiatry: ["Anxiety", "Insomnia", "Depression"],
};

const firstNames = ["Leena", "Omar", "Nadia", "Arif", "Tara", "Rafiq", "Mina", "Ayaan", "Farah", "Zara", "Imran", "Sana", "Ibrahim", "Lamia", "Nora", "Tanvir", "Ritu", "Jamal", "Elena", "Samir"];
const lastNames = ["Chowdhury", "Hossain", "Islam", "Hasan", "Ahmed", "Sayeed", "Akter", "Karim", "Noor", "Begum", "Kabir", "Ali", "Haque", "Siddiqui"];
const PATIENT_TOTAL = 140;

// Deterministic pseudo-random sequence (mulberry32) so repeated seeds produce the same dataset.
let state = 42;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];

function daysAgo(maxDays: number) {
  // Skewed towards recent dates so the intake chart shows growth.
  const days = Math.floor(maxDays * random() ** 1.6);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function seed() {
  await connectDatabase();

  const doctorDocs = [];
  for (const [index, [name, specialization, hospital]] of doctors.entries()) {
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}@carepath.demo`;
    // Draw the date before the lookup so the random sequence (and every later email) is identical on re-runs.
    const createdAt = daysAgo(360);
    const existing = await Doctor.findOne({ email });
    doctorDocs.push(existing ?? await Doctor.create({
      name, specialization, hospital, email, createdAt,
      phone: `+880 1700-1101${String(index).padStart(2, "0")}`,
    }));
  }

  let created = 0;
  for (let index = 0; index < PATIENT_TOTAL; index += 1) {
    const doctor = pick(doctorDocs);
    const name = `${pick(firstNames)} ${pick(lastNames)}`;
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${index}@patient.demo`;
    const createdAt = new Date(Math.max(daysAgo(330).getTime(), doctor.createdAt.getTime()));
    const condition = pick(conditionsBySpecialty[doctor.specialization] ?? ["General checkup"]);
    const status = pick(patientStatuses);
    if (await Patient.exists({ email })) continue;
    await Patient.create({ name, email, condition, status, doctor: doctor._id, phone: `+880 1800-${String(200000 + index)}`, createdAt });
    created += 1;
  }

  console.log(`Seed complete: ${doctorDocs.length} doctors, ${created} new demo patients.`);
  await mongoose.disconnect();
}

seed().catch(async (error: unknown) => {
  console.error("Seed failed", error);
  await mongoose.disconnect();
  process.exit(1);
});

#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gradeDefaultPath } from "../../dist/verify.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const report = await gradeDefaultPath(root);
console.log(
  JSON.stringify(
    {
      verdict: report.verdict,
      gradedAt: report.gradedAt,
      paid_settled: report.checks.find((row) => row.id === "paid_one_sign_positive_spend_200")?.detail,
      drifted_claim: false
    },
    null,
    2
  )
);
if (report.verdict !== "valid") process.exitCode = 2;

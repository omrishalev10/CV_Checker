import fs from "node:fs";
import { extractTextFromBuffer } from "../server/src/services/cvParse.ts";
import { renderDocx, renderPdf, type TailoredCvDoc } from "../server/src/services/tailorExport.ts";
import { fetchJobUrl } from "../server/src/services/urlFetch.ts";

const text = await extractTextFromBuffer(
  fs.readFileSync("./fixtures/sample-cv.txt"),
  "sample-cv.txt",
  "text/plain"
);
console.log("cv chars:", text.length);

const bad = await fetchJobUrl("https://example.invalid/this-should-fail");
console.log("bad url ok?", bad.ok, "message:", bad.ok ? "" : bad.error.slice(0, 80));

const sample: TailoredCvDoc = {
  name: "Alex Rivera",
  headline: "Senior Full-Stack Engineer",
  summary: "Experienced engineer focused on React and Node.",
  skills: ["TypeScript", "React", "Node.js"],
  experience: [
    {
      title: "Senior Software Engineer",
      company: "Northwind Labs",
      dates: "2021–Present",
      bullets: ["Led a team of 4 engineers", "Improved p95 latency by 35%"],
    },
  ],
  education: [{ line: "B.S. Computer Science — State University (2018)" }],
  certifications: ["AWS Certified Developer – Associate (2023)"],
};

const docx = await renderDocx(sample);
const pdf = await renderPdf(sample);
console.log("docx bytes", docx.length);
console.log("pdf bytes", pdf.length, "valid header?", pdf.subarray(0, 4).toString() === "%PDF");

const page = await fetch("http://localhost:5173/");
console.log("web status", page.status, "has CareerFit?", (await page.text()).includes("CareerFit"));

import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import PDFDocument from "pdfkit";

export interface TailoredCvDoc {
  name?: string | null;
  headline: string;
  links?: { label: string; url: string }[];
  summary: string;
  skills: string[];
  experience: { title: string; company: string; dates: string; bullets: string[] }[];
  projects?: { name: string; url?: string | null; stack?: string[]; bullets: string[] }[];
  education: { line: string; details?: string | null }[];
  certifications: string[];
}

export async function renderDocx(cv: TailoredCvDoc): Promise<Buffer> {
  const children: Paragraph[] = [];

  if (cv.name) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 80 },
        children: [new TextRun({ text: cv.name, bold: true, size: 32, font: "Calibri" })],
      })
    );
  }

  children.push(
    new Paragraph({
      spacing: { after: cv.links?.length ? 80 : 200 },
      children: [new TextRun({ text: cv.headline, italics: true, size: 22, font: "Calibri" })],
    })
  );

  if (cv.links?.length) {
    for (const [i, link] of cv.links.entries()) {
      const last = i === cv.links.length - 1;
      children.push(
        new Paragraph({
          spacing: { after: last ? 200 : 40 },
          children: [
            new TextRun({ text: `${link.label}: `, size: 20, font: "Calibri" }),
            new ExternalHyperlink({
              link: link.url,
              children: [
                new TextRun({
                  text: link.url,
                  style: "Hyperlink",
                  size: 20,
                  font: "Calibri",
                  color: "0563C1",
                  underline: {},
                }),
              ],
            }),
          ],
        })
      );
    }
  }

  const section = (title: string) =>
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
      children: [new TextRun({ text: title, bold: true, size: 24, font: "Calibri" })],
    });

  children.push(section("Summary"));
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: cv.summary, size: 20, font: "Calibri" })],
    })
  );

  children.push(section("Skills"));
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: cv.skills.join(", "), size: 20, font: "Calibri" })],
    })
  );

  children.push(section("Experience"));
  for (const exp of cv.experience) {
    children.push(
      new Paragraph({
        spacing: { before: 120, after: 40 },
        children: [
          new TextRun({ text: `${exp.title} — ${exp.company}`, bold: true, size: 20, font: "Calibri" }),
        ],
      })
    );
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: exp.dates, size: 18, font: "Calibri", color: "444444" })],
      })
    );
    for (const bullet of exp.bullets) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          indent: { left: 360 },
          children: [new TextRun({ text: `• ${bullet}`, size: 20, font: "Calibri" })],
        })
      );
    }
  }

  if (cv.projects?.length) {
    children.push(section("Projects"));
    for (const project of cv.projects) {
      const title = project.url ? `${project.name} — ${project.url}` : project.name;
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 40 },
          children: [new TextRun({ text: title, bold: true, size: 20, font: "Calibri" })],
        })
      );
      if (project.stack?.length) {
        children.push(
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({
                text: project.stack.join(", "),
                size: 18,
                font: "Calibri",
                color: "444444",
              }),
            ],
          })
        );
      }
      for (const bullet of project.bullets || []) {
        children.push(
          new Paragraph({
            spacing: { after: 40 },
            indent: { left: 360 },
            children: [new TextRun({ text: `• ${bullet}`, size: 20, font: "Calibri" })],
          })
        );
      }
    }
  }

  if (cv.education.length) {
    children.push(section("Education"));
    for (const edu of cv.education) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [new TextRun({ text: edu.line, size: 20, font: "Calibri" })],
        })
      );
      if (edu.details) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: edu.details, size: 18, font: "Calibri", color: "444444" })],
          })
        );
      }
    }
  }

  if (cv.certifications.length) {
    children.push(section("Certifications"));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: cv.certifications.join("; "), size: 20, font: "Calibri" })],
      })
    );
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
  });

  return Packer.toBuffer(doc);
}

export async function renderPdf(cv: TailoredCvDoc): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 54, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(16);
    if (cv.name) doc.text(cv.name);
    doc.font("Helvetica-Oblique").fontSize(11).fillColor("#333333").text(cv.headline);
    if (cv.links?.length) {
      doc.moveDown(0.25);
      doc.font("Helvetica").fontSize(10);
      for (const link of cv.links) {
        doc.fillColor("#000000").text(`${link.label}: `, { continued: true });
        doc.fillColor("#0563C1").text(link.url, { link: link.url, underline: true });
      }
      doc.fillColor("#000000");
    }
    doc.moveDown(0.8).fillColor("#000000");

    const heading = (t: string) => {
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(12).text(t);
      doc.moveDown(0.2);
      doc.font("Helvetica").fontSize(10);
    };

    heading("Summary");
    doc.text(cv.summary);

    heading("Skills");
    doc.text(cv.skills.join(", "));

    heading("Experience");
    for (const exp of cv.experience) {
      doc.font("Helvetica-Bold").text(`${exp.title} — ${exp.company}`);
      doc.font("Helvetica").fillColor("#444444").text(exp.dates);
      doc.fillColor("#000000");
      for (const bullet of exp.bullets) {
        doc.text(`• ${bullet}`, { indent: 12 });
      }
      doc.moveDown(0.3);
    }

    if (cv.projects?.length) {
      heading("Projects");
      for (const project of cv.projects) {
        const title = project.url ? `${project.name} — ${project.url}` : project.name;
        doc.font("Helvetica-Bold").text(title);
        if (project.stack?.length) {
          doc.font("Helvetica").fillColor("#444444").text(project.stack.join(", ")).fillColor("#000000");
        }
        doc.font("Helvetica");
        for (const bullet of project.bullets || []) {
          doc.text(`• ${bullet}`, { indent: 12 });
        }
        doc.moveDown(0.3);
      }
    }

    if (cv.education.length) {
      heading("Education");
      for (const edu of cv.education) {
        doc.text(edu.line);
        if (edu.details) doc.fillColor("#444444").text(edu.details).fillColor("#000000");
      }
    }

    if (cv.certifications.length) {
      heading("Certifications");
      doc.text(cv.certifications.join("; "));
    }

    doc.end();
  });
}

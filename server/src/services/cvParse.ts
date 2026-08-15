import mammoth from "mammoth";
import pdfParse from "pdf-parse";

export async function extractTextFromBuffer(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<string> {
  const lower = filename.toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (lower.endsWith(".pdf") || mime.includes("pdf")) {
    const result = await pdfParse(buffer);
    const text = (result.text || "").trim();
    if (!text) throw new Error("Could not extract text from PDF. Try a text-based PDF or paste the content.");
    return text;
  }

  if (lower.endsWith(".docx") || mime.includes("wordprocessingml") || mime.includes("msword")) {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || "").trim();
    if (!text) throw new Error("Could not extract text from DOCX.");
    return text;
  }

  if (lower.endsWith(".txt") || mime.startsWith("text/") || mime === "application/octet-stream") {
    return buffer.toString("utf8").trim();
  }

  // Fallback: try as utf8 text
  const asText = buffer.toString("utf8").trim();
  if (asText && !asText.includes("\u0000")) return asText;
  throw new Error("Unsupported file type. Upload PDF, DOCX, or plain text.");
}

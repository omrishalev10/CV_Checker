import fs from "node:fs";

const base = "http://localhost:3001";
const paths = ["/", "/manifest.webmanifest", "/sw.js", "/registerSW.js", "/pwa-192.png", "/pwa-512.png"];

for (const p of paths) {
  const r = await fetch(base + p);
  console.log(`${p} -> ${r.status} ${r.headers.get("content-type")}`);
}

const manifest = await fetch(base + "/manifest.webmanifest").then((r) => r.json());
console.log("manifest icons:", manifest.icons);
console.log("display:", manifest.display, "| start_url:", manifest.start_url);

const html = await fetch(base + "/").then((r) => r.text());
console.log("html links manifest:", html.includes("manifest.webmanifest"));
console.log("html registers SW:", html.includes("registerSW.js"));

// Validate the generated PNGs are decodable: signature + IHDR dimensions.
for (const file of ["web/dist/pwa-192.png", "web/dist/pwa-512.png"]) {
  const buf = fs.readFileSync(file);
  const sig = buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  console.log(`${file}: validSignature=${sig} ${width}x${height} bytes=${buf.length}`);
}

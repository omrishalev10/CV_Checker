/**
 * End-to-end check of accounts and data isolation.
 *   PORT=3020 DATA_DIR=tmp-authtest node server/dist/index.js
 *   node scripts/test-auth.mjs http://localhost:3020
 */
const base = process.argv[2] || "http://localhost:3020";

let cookie = null;
let failures = 0;

function rememberCookie(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const entry of raw) {
    const [pair] = entry.split(";");
    if (pair.startsWith("cf_session=")) {
      cookie = pair.endsWith("=") ? null : pair;
    }
  }
}

async function call(method, path, { body, withCookie = true } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(withCookie && cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  if (withCookie) rememberCookie(res);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 80);
  }
  return { status: res.status, data };
}

function check(label, actual, expected) {
  const pass = actual === expected;
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
}

check("health is public", (await call("GET", "/api/health", { withCookie: false })).status, 200);
check("profile requires sign-in", (await call("GET", "/api/profile", { withCookie: false })).status, 401);

const alice = await call("POST", "/api/auth/signup", {
  body: { username: "alice", password: "alicepass1" },
});
check("alice can sign up", alice.status, 200);
check("alice cookie issued", cookie !== null, true);
const aliceCookie = cookie;

check("alice username in status", (await call("GET", "/api/auth/status")).data.username, "alice");
check("alice can read empty profile", (await call("GET", "/api/profile")).status, 200);

await call("PUT", "/api/profile", {
  body: {
    profile: {
      summary: "Alice only",
      skills: [],
      experience: [],
      education: [],
      certifications: [],
    },
  },
});

cookie = null;
const bob = await call("POST", "/api/auth/signup", {
  body: { username: "bob", password: "bobpass123" },
});
check("bob can sign up", bob.status, 200);
const bobCookie = cookie;

const bobProfile = await call("GET", "/api/profile");
check("bob does not see alice summary", bobProfile.data.profile?.summary === "Alice only", false);

cookie = aliceCookie;
const aliceProfile = await call("GET", "/api/profile");
check("alice still sees her summary", aliceProfile.data.profile?.summary, "Alice only");

cookie = null;
check(
  "duplicate username rejected",
  (await call("POST", "/api/auth/signup", { body: { username: "Alice", password: "otherpass1" } })).status,
  409
);

check(
  "login rejects wrong password",
  (await call("POST", "/api/auth/login", { body: { username: "alice", password: "nope-nope" } })).status,
  401
);

const login = await call("POST", "/api/auth/login", {
  body: { username: "alice", password: "alicepass1" },
});
check("alice can log in", login.status, 200);

check("logout succeeds", (await call("POST", "/api/auth/logout")).status, 200);
check("logged-out profile blocked", (await call("GET", "/api/profile")).status, 401);

cookie = bobCookie;
check("bob stays signed in after alice logout", (await call("GET", "/api/profile")).status, 200);

cookie = null;
let sawRateLimit = false;
for (let i = 0; i < 12; i += 1) {
  const res = await call("POST", "/api/auth/login", {
    body: { username: "alice", password: `bad-${i}` },
  });
  if (res.status === 429) {
    sawRateLimit = true;
    break;
  }
}
check("rate-limits brute force", sawRateLimit, true);

console.log(failures === 0 ? "\nAll auth checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

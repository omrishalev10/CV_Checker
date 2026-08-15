/**
 * End-to-end check of the password gate.
 * Run against a throwaway server, e.g.:
 *   PORT=3020 DATA_DIR=tmp-authtest node server/dist/index.js
 *   node scripts/test-auth.mjs http://localhost:3020
 */
const base = process.argv[2] || "http://localhost:3020";
const PASSWORD = "testpass123";

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
  console.log(`${pass ? "PASS" : "FAIL"}  ${label} (got ${actual}, expected ${expected})`);
}

const status0 = await call("GET", "/api/auth/status");
check("starts unlocked", status0.data.enabled, false);
check("open access before password", (await call("GET", "/api/profile")).status, 200);

check(
  "rejects short password",
  (await call("PUT", "/api/auth/password", { body: { password: "short" } })).status,
  400
);

const set = await call("PUT", "/api/auth/password", { body: { password: PASSWORD } });
check("sets password", set.status, 200);
check("issues a session cookie", cookie !== null, true);

check("reports locked", (await call("GET", "/api/auth/status")).data.enabled, true);
check("session can read profile", (await call("GET", "/api/profile")).status, 200);

check("blocks profile without cookie", (await call("GET", "/api/profile", { withCookie: false })).status, 401);
check(
  "blocks tailoring without cookie",
  (await call("POST", "/api/matches/1/tailor", { withCookie: false })).status,
  401
);
check(
  "blocks CV download without cookie",
  (await call("GET", "/api/matches/1/cv/pdf", { withCookie: false })).status,
  401
);
check(
  "blocks API key read without cookie",
  (await call("GET", "/api/settings", { withCookie: false })).status,
  401
);

const saved = cookie;
cookie = null;
check(
  "rejects wrong password",
  (await call("POST", "/api/auth/login", { body: { password: "wrongwrong" } })).status,
  401
);
check("no cookie after failed login", cookie === null, true);

check(
  "accepts correct password",
  (await call("POST", "/api/auth/login", { body: { password: PASSWORD } })).status,
  200
);
check("login issues a cookie", cookie !== null, true);
check("new session works", (await call("GET", "/api/profile")).status, 200);

const secondSession = cookie;
check("logout succeeds", (await call("POST", "/api/auth/logout")).status, 200);
check("cookie cleared on logout", cookie === null, true);

cookie = secondSession;
check("logged-out session is revoked", (await call("GET", "/api/profile")).status, 401);

// Signing out on one device must not sign out the others.
cookie = saved;
check("other device stays signed in", (await call("GET", "/api/profile")).status, 200);

// Changing the password is the "log everything out" lever.
check(
  "password change succeeds",
  (await call("PUT", "/api/auth/password", { body: { password: `${PASSWORD}-new` } })).status,
  200
);
cookie = saved;
check("password change revokes old sessions", (await call("GET", "/api/profile")).status, 401);

cookie = null;
let sawRateLimit = false;
for (let i = 0; i < 12; i += 1) {
  const res = await call("POST", "/api/auth/login", { body: { password: `bad-${i}` } });
  if (res.status === 429) {
    sawRateLimit = true;
    break;
  }
}
check("rate-limits brute force", sawRateLimit, true);

console.log(failures === 0 ? "\nAll auth checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

/* Sign-in: username + password now; designed so Microsoft (Entra ID) can be added as a second provider.
 * A provider turns credentials into a user row; sessions, roles and everything else stay the same. */
import crypto from "node:crypto";
import { rerouteFallbacks } from "./requests.mjs";
import { voiceInboxCount } from "./voice.mjs";
import { nowIso, tx } from "./db.mjs";
import { send, fail, readJson, HttpError } from "./http.mjs";
import { audit } from "./audit.mjs";
import { isApprover } from "./perm.mjs";

const ITER = 150000;
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("base64");
  return { salt, iter: ITER, hash: crypto.pbkdf2Sync(String(pw), Buffer.from(salt, "base64"), ITER, 32, "sha256").toString("base64") };
}
export function verifyPassword(pw, row) {
  if (!row || !row.pw_hash) return false;
  const h = crypto.pbkdf2Sync(String(pw), Buffer.from(row.pw_salt, "base64"), row.pw_iter || ITER, 32, "sha256");
  const want = Buffer.from(row.pw_hash, "base64");
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
/** One-time password: 10 characters without look-alikes (0/O, 1/l/I). */
export function tempPassword() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(10), (b) => abc[b % abc.length]).join("");
}
export function setPassword(db, userId, pw, mustChange) {
  const h = hashPassword(pw);
  db.prepare("UPDATE users SET pw_hash=?,pw_salt=?,pw_iter=?,must_change=? WHERE id=?").run(h.hash, h.salt, h.iter, mustChange ? 1 : 0, userId);
}

const usable = (db, u) => {
  if (!u || !u.active) return false;
  if (!u.employee_id) return true;
  const e = db.prepare("SELECT status FROM employees WHERE id=?").get(u.employee_id);
  return !!e && !["resigned", "terminated", "disabled"].includes(e.status);
};

const DUMMY = (() => { const h = hashPassword(crypto.randomBytes(12).toString("hex")); return { pw_hash: h.hash, pw_salt: h.salt, pw_iter: h.iter }; })();

export const providers = {
  local: {
    id: "local",
    login(db, { username, password }) {
      const u = db.prepare("SELECT * FROM users WHERE username=? AND auth_provider='local'").get(String(username || "").trim());
      if (!u) { verifyPassword(password, DUMMY); return null; } // same work for unknown names, so timing doesn't reveal them
      return usable(db, u) && verifyPassword(password, u) ? u : null;
    },
  },
  // microsoft: { id:"microsoft", startLogin(req,res), finishLogin(req) → {externalId,email} } — phase 2
};

export function ensureAdmin(db, env) {
  if (db.prepare("SELECT count(*) n FROM users").get().n > 0) return;
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    console.warn("No users yet. Set ADMIN_USERNAME and ADMIN_PASSWORD in the environment and restart to create the first admin.");
    return;
  }
  const h = hashPassword(env.ADMIN_PASSWORD);
  db.prepare("INSERT INTO users(username,role,pw_hash,pw_salt,pw_iter,must_change,created_at) VALUES(?,?,?,?,?,1,?)")
    .run(env.ADMIN_USERNAME.trim(), "admin", h.hash, h.salt, h.iter, nowIso());
  console.log(`Created first admin "${env.ADMIN_USERNAME}" — change the password at first sign-in.`);
}

const COOKIE = "hr_sid";
export function getSession(ctx, req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`).exec(req.headers.cookie || "");
  if (!m) return null;
  const { db } = ctx;
  const s = db.prepare("SELECT * FROM sessions WHERE token=?").get(m[1]);
  if (!s) return null;
  if (Date.now() - s.last_seen_at > ctx.sessionMs) { db.prepare("DELETE FROM sessions WHERE token=?").run(s.token); return null; }
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(s.user_id);
  if (!usable(db, user)) { db.prepare("DELETE FROM sessions WHERE user_id=?").run(s.user_id); return null; }
  if (Date.now() - s.last_seen_at > 60e3) db.prepare("UPDATE sessions SET last_seen_at=? WHERE token=?").run(Date.now(), s.token);
  const employee = user.employee_id ? db.prepare("SELECT * FROM employees WHERE id=?").get(user.employee_id) : null;
  return { token: s.token, user, employee, isApprover: isApprover(db, employee && employee.id) };
}

function cookie(req, token, maxAgeSec) {
  const secure = String(req.headers["x-forwarded-proto"] || "").includes("https");
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}

export const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role, lang: u.lang, mustChange: !!u.must_change, employeeId: u.employee_id });

const PUBLIC = new Set(["/api/health", "/api/login", "/api/login-options"]);
const ALLOWED_WHILE_MUST_CHANGE = new Set(["/api/me", "/api/me/password", "/api/me/lang", "/api/logout"]);

export function registerAuth(api, ctx) {
  const { db, env } = ctx;
  ctx.sessionMs = Number(env.SESSION_HOURS || 12) * 3600e3;
  ensureAdmin(db, env);
  const fails = new Map();
  // DEV ONLY: pick a staff name on the login page and use one shared password (default "2026").
  // Never active in production; set DEV_SHARED_PASSWORD="" to switch it off on dev too. Admin accounts keep their own password.
  const devPw = ctx.appEnv === "dev" ? (env.DEV_SHARED_PASSWORD ?? "2026") : ctx.appEnv === "test" ? env.DEV_SHARED_PASSWORD || "" : "";
  const sameText = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const activeStaff = () => db.prepare("SELECT id, emp_no, name_ar, name_en FROM employees WHERE status NOT IN ('resigned','terminated','disabled') ORDER BY name_ar").all();
  /** Login for a staff member chosen from the list; creates their staff login on first use. */
  function devLogin(employeeId, password) {
    if (!devPw || !sameText(password, devPw)) return null;
    const emp = activeStaff().find((e) => e.id === Number(employeeId));
    if (!emp) return null;
    let u = db.prepare("SELECT * FROM users WHERE employee_id=?").get(emp.id);
    if (u && u.role === "admin") return null;
    if (!u) {
      let name = String(emp.emp_no || "staff" + emp.id).toLowerCase().replace(/[^a-z0-9._-]/g, "") || "staff" + emp.id;
      while (db.prepare("SELECT 1 FROM users WHERE username=?").get(name)) name += "1";
      const h = hashPassword(crypto.randomBytes(12).toString("hex"));
      db.prepare("INSERT INTO users(username,employee_id,role,pw_hash,pw_salt,pw_iter,must_change,created_at) VALUES(?,?,?,?,?,?,0,?)").run(name, emp.id, "staff", h.hash, h.salt, h.iter, nowIso());
      u = db.prepare("SELECT * FROM users WHERE employee_id=?").get(emp.id);
      rerouteFallbacks(ctx); // requests waiting with Admin because this person had no login yet
    }
    if (!usable(db, u)) return null;
    if (u.must_change) db.prepare("UPDATE users SET must_change=0 WHERE id=?").run(u.id); // dev: no forced change
    return db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
  }

  api.get("/api/login-options", (req, res) => {
    if (!devPw) return send(req, res, 200, { devStaffList: false });
    send(req, res, 200, { devStaffList: true, people: activeStaff() });
  });
  // behind Dokploy/Traefik the proxy appends the real client address last; earlier entries can be forged
  const ipOf = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",").pop().trim();

  ctx.guard = (req, res, pathname) => {
    if (PUBLIC.has(pathname)) return true;
    const sess = getSession(ctx, req);
    if (!sess) { fail(req, res, 401, "unauthorized", "Please sign in"); return false; }
    if (sess.user.must_change && !ALLOWED_WHILE_MUST_CHANGE.has(pathname)) { fail(req, res, 403, "must_change_password", "Choose a new password first"); return false; }
    req.sess = sess;
    return true;
  };

  api.post("/api/login", async (req, res) => {
    const body = await readJson(req);
    // counted per username, so changing address doesn't reset it
    const byEmployee = body.employee_id !== undefined && body.employee_id !== null && body.employee_id !== "";
    const key = byEmployee ? `emp:${Number(body.employee_id)}` : String(body.username || "").trim().toLowerCase();
    if (fails.size > 5000) for (const [k, v] of fails) if (v.until < Date.now()) fails.delete(k);
    const f = fails.get(key);
    if (f && f.n >= 6 && f.until > Date.now()) return fail(req, res, 429, "locked", "Too many attempts. Try again in 10 minutes.");
    const user = byEmployee ? devLogin(body.employee_id, body.password) : providers.local.login(db, body);
    if (!user) {
      const g = f && f.until > Date.now() ? f : { n: 0 };
      g.n++; g.until = Date.now() + 10 * 60e3; fails.set(key, g);
      return fail(req, res, 401, "bad_credentials", "Wrong username or password");
    }
    fails.delete(key);
    const token = crypto.randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions(token,user_id,created_at,last_seen_at,ip,ua) VALUES(?,?,?,?,?,?)")
      .run(token, user.id, Date.now(), Date.now(), ipOf(req), String(req.headers["user-agent"] || "").slice(0, 200));
    db.prepare("UPDATE users SET last_login_at=? WHERE id=?").run(nowIso(), user.id);
    db.prepare("DELETE FROM sessions WHERE last_seen_at<?").run(Date.now() - ctx.sessionMs);
    res.setHeader("Set-Cookie", cookie(req, token, Math.round(ctx.sessionMs / 1000)));
    send(req, res, 200, { user: publicUser(user), mustChange: !!user.must_change });
  });

  api.post("/api/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(req.sess.token);
    res.setHeader("Set-Cookie", cookie(req, "", 0));
    send(req, res, 200, { ok: true });
  });

  api.get("/api/me", (req, res) => {
    const s = req.sess;
    const today = ctx.today(), own = s.employee ? s.employee.id : -1;
    const pendingApprovals = s.user.role === "admin"
      ? db.prepare("SELECT count(*) n FROM leave_requests WHERE status='pending' AND employee_id<>?").get(own).n
      : db.prepare(`SELECT count(*) n FROM leave_requests WHERE status='pending' AND employee_id<>? AND (approver_user_id=?
          OR approver_user_id IN (SELECT approver_user_id FROM approver_cover WHERE deputy_user_id=? AND start_date<=? AND end_date>=?))`).get(own, s.user.id, s.user.id, today, today).n;
    const pendingCapReviews = ["hr", "admin"].includes(s.user.role) ? db.prepare("SELECT count(*) n FROM cap_reviews WHERE status='pending'").get().n : 0;
    send(req, res, 200, { user: publicUser(s.user), employee: s.employee, isApprover: s.isApprover, pendingApprovals, pendingCapReviews, voiceInbox: voiceInboxCount(db, s), env: ctx.appEnv });
  });

  api.post("/api/me/password", async (req, res) => {
    const { current, next } = await readJson(req);
    if (typeof next !== "string" || next.length < 8) throw new HttpError(400, "weak_password", "The new password must be at least 8 characters");
    if (!verifyPassword(current, req.sess.user)) throw new HttpError(403, "wrong_password", "Current password is wrong");
    if (next === current) throw new HttpError(400, "same_password", "Choose a different password");
    tx(db, () => {
      setPassword(db, req.sess.user.id, next, false);
      db.prepare("DELETE FROM sessions WHERE user_id=? AND token<>?").run(req.sess.user.id, req.sess.token);
      audit(db, req.sess.user.id, "password.change", "user", req.sess.user.id);
    });
    send(req, res, 200, { ok: true });
  });

  api.put("/api/me/lang", async (req, res) => {
    const { lang } = await readJson(req);
    if (lang !== "ar" && lang !== "en") throw new HttpError(400, "invalid", "lang must be ar or en");
    db.prepare("UPDATE users SET lang=? WHERE id=?").run(lang, req.sess.user.id);
    send(req, res, 200, { ok: true });
  });
}

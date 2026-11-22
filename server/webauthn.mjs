/* Face ID / fingerprint at check-in (WebAuthn passkeys). The phone checks its owner's face or finger and signs a challenge;
 * we keep only a public key per registered phone — no face or fingerprint data ever reaches the portal.
 *   register: the signed-in person adds this phone (HR and Admin are told, so a stranger adding a phone is noticed)
 *   verify:   before a check-in; the session is then "verified" for 2 minutes, for one check-in */
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { nowIso, getSetting } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";
import { can } from "./perm.mjs";
import { audit } from "./audit.mjs";
import { notify, hrTeam } from "./notify.mjs";
import { verifyFor, setFaceDefault } from "./verify.mjs";

export const FACEID_MODES = ["required", "optional", "off"];
const CHALLENGE_MS = 5 * 60e3, VERIFIED_MS = 2 * 60e3;
const challenges = new Map(); // session token → { challenge, kind, at }
const verified = new Map();   // session token → { at, credId }

/** The company setting (Admin): required (default) / optional / off. Tests start with it off unless they turn it on. */
let defaultMode = "required"; // set from the environment when the module starts (tests start with it off)
export const faceidMode = (ctxOrDb) => { const db = ctxOrDb.db || ctxOrDb; const m = getSetting(db, "faceid_mode", defaultMode); return FACEID_MODES.includes(m) ? m : "required"; };
/** Does this person have to verify at check-in? */
export const faceidNeeded = (ctx, emp) => verifyFor(ctx.db || ctx, emp).faceid; // Admin's switch, or the person's own setting
setFaceDefault((db) => faceidMode(db) === "required");

/** A fresh verification for this session (not used up): the credential id or null. */
export function peekVerified(sess) {
  const v = verified.get(sess.token);
  return v && Date.now() - v.at <= VERIFIED_MS ? v.credId : null;
}
/** Take (and use up) a fresh verification for this session; returns the credential id or null. */
export function takeVerified(sess) {
  const v = verified.get(sess.token);
  verified.delete(sess.token);
  return v && Date.now() - v.at <= VERIFIED_MS ? v.credId : null;
}

/** Where the portal is reached from: the phone's passkey is tied to this name. Under nama.omanste.com the parent name is used,
 * so a phone registered on the test site keeps working on hr.nama.omanste.com. */
function rp(ctx, req) {
  const host = String(req.headers.host || "localhost").replace(/:\d+$/, "");
  const id = ctx.env.WEBAUTHN_RP_ID || (/(^|\.)nama\.omanste\.com$/.test(host) ? "nama.omanste.com" : host);
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (/^(localhost|127\.0\.0\.1)$/.test(host) ? "http" : "https");
  return { id, origin: `${proto}://${req.headers.host}` };
}
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const deviceName = (ua) => { const s = String(ua || ""); return /iPhone/.test(s) ? "iPhone" : /iPad/.test(s) ? "iPad" : /Android/.test(s) ? "Android" : /Mac OS/.test(s) ? "Mac" : /Windows/.test(s) ? "Windows" : "—"; };

export function registerWebauthn(api, ctx) {
  const { db } = ctx;
  if (FACEID_MODES.includes(ctx.env.FACEID_MODE_DEFAULT)) defaultMode = ctx.env.FACEID_MODE_DEFAULT;
  const creds = (userId) => db.prepare("SELECT * FROM webauthn_creds WHERE user_id=? ORDER BY id").all(userId);
  const take = (sess, kind) => {
    const c = challenges.get(sess.token); challenges.delete(sess.token);
    if (!c || c.kind !== kind || Date.now() - c.at > CHALLENGE_MS) throw new HttpError(400, "expired", "That took too long — try again");
    return c.challenge;
  };
  const listOut = (rows) => rows.map((r) => ({ id: r.id, device_name: r.device_name, created_at: r.created_at, last_used_at: r.last_used_at }));

  // what the check-in screen needs to know
  api.get("/api/webauthn/status", (req, res) => {
    const emp = req.sess.employee;
    send(req, res, 200, { mode: faceidMode(ctx), needed: faceidNeeded(ctx, emp), exempt: !!emp && !faceidNeeded(ctx, emp), devices: creds(req.sess.user.id).length });
  });

  api.post("/api/webauthn/register/options", async (req, res) => {
    const sess = req.sess, { id } = rp(ctx, req);
    const opts = await generateRegistrationOptions({
      rpName: "Nama HR", rpID: id, userName: sess.user.username, userDisplayName: (sess.employee && (sess.employee.name_en || sess.employee.name_ar)) || sess.user.username,
      userID: new TextEncoder().encode(`nama-${sess.user.id}`), attestationType: "none", timeout: 60000,
      excludeCredentials: creds(sess.user.id).map((c) => ({ id: c.cred_id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
    });
    challenges.set(sess.token, { challenge: opts.challenge, kind: "register", at: Date.now() });
    send(req, res, 200, opts);
  });
  api.post("/api/webauthn/register/verify", async (req, res) => {
    const sess = req.sess, { id, origin } = rp(ctx, req);
    const body = await readJson(req);
    const expectedChallenge = take(sess, "register");
    let v;
    try { v = await verifyRegistrationResponse({ response: body, expectedChallenge, expectedOrigin: origin, expectedRPID: id, requireUserVerification: true }); }
    catch (e) { throw new HttpError(400, "not_verified", `This phone couldn't be registered: ${e.message}`); }
    if (!v.verified || !v.registrationInfo) throw new HttpError(400, "not_verified", "This phone couldn't be registered");
    const { credential } = v.registrationInfo;
    if (db.prepare("SELECT 1 FROM webauthn_creds WHERE cred_id=?").get(credential.id)) throw new HttpError(409, "exists", "This phone is already registered");
    const name = deviceName(req.headers["user-agent"]);
    const r = db.prepare("INSERT INTO webauthn_creds(user_id,cred_id,public_key,counter,transports,device_name,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(sess.user.id, credential.id, b64u(credential.publicKey), credential.counter || 0, JSON.stringify(credential.transports || []), name, nowIso());
    audit(db, sess.user.id, "webauthn.register", "user", sess.user.id, null, { device: name });
    // a registration is also a verification of this person, for the check-in that asked for it
    verified.set(sess.token, { at: Date.now(), credId: credential.id });
    const who = (sess.employee && (sess.employee.name_ar || sess.employee.name_en)) || sess.user.username;
    notify(ctx, [sess.user.id], { title_ar: "تم تسجيل جهاز جديد للتحقق بالوجه", title_en: "A new phone was registered for face verification", body_ar: `${name} — إن لم تكن أنت فأبلغ الموارد البشرية فوراً.`, body_en: `${name} — if this wasn't you, tell HR at once.`, link: "#/me", inAppOnly: true });
    notify(ctx, hrTeam(db, { except: [sess.user.id] }), { title_ar: "جهاز جديد للتحقق بالوجه", title_en: "A new phone for face verification", body_ar: `${who}: ${name}`, body_en: `${who}: ${name}`, link: sess.employee ? `#/staff/${sess.employee.id}` : "#/users", inAppOnly: true });
    send(req, res, 201, { device: listOut([db.prepare("SELECT * FROM webauthn_creds WHERE id=?").get(r.lastInsertRowid)])[0] });
  });

  api.post("/api/webauthn/verify/options", async (req, res) => {
    const sess = req.sess, { id } = rp(ctx, req), mine = creds(sess.user.id);
    if (!mine.length) throw new HttpError(409, "no_device", "Register this phone first");
    const opts = await generateAuthenticationOptions({ rpID: id, userVerification: "required", timeout: 60000,
      allowCredentials: mine.map((c) => ({ id: c.cred_id, transports: c.transports ? JSON.parse(c.transports) : undefined })) });
    challenges.set(sess.token, { challenge: opts.challenge, kind: "verify", at: Date.now() });
    send(req, res, 200, opts);
  });
  api.post("/api/webauthn/verify", async (req, res) => {
    const sess = req.sess, { id, origin } = rp(ctx, req);
    const body = await readJson(req);
    const expectedChallenge = take(sess, "verify");
    const c = db.prepare("SELECT * FROM webauthn_creds WHERE cred_id=? AND user_id=?").get(String(body && body.id || ""), sess.user.id);
    if (!c) throw new HttpError(403, "unknown_device", "This phone isn't registered to you — register it first");
    let v;
    try {
      v = await verifyAuthenticationResponse({ response: body, expectedChallenge, expectedOrigin: origin, expectedRPID: id, requireUserVerification: true,
        credential: { id: c.cred_id, publicKey: Buffer.from(c.public_key, "base64url"), counter: c.counter, transports: c.transports ? JSON.parse(c.transports) : undefined } });
    } catch (e) { throw new HttpError(403, "not_verified", `Face / fingerprint check failed: ${e.message}`); }
    if (!v.verified) throw new HttpError(403, "not_verified", "Face / fingerprint check failed");
    db.prepare("UPDATE webauthn_creds SET counter=?, last_used_at=? WHERE id=?").run(v.authenticationInfo.newCounter, nowIso(), c.id);
    verified.set(sess.token, { at: Date.now(), credId: c.cred_id });
    send(req, res, 200, { ok: true });
  });

  // registered phones: one's own, or anyone's for HR / Admin; removing one (a lost phone) means registering again
  api.get("/api/webauthn/devices", (req, res) => send(req, res, 200, { items: listOut(creds(req.sess.user.id)) }));
  api.get("/api/employees/:id/devices", (req, res) => {
    if (!can(req.sess, "employee.edit")) throw new HttpError(403, "forbidden", "You do not have permission for this");
    const u = db.prepare("SELECT id FROM users WHERE employee_id=?").get(Number(req.params.id));
    send(req, res, 200, { items: u ? listOut(creds(u.id)) : [] });
  });
  api.delete("/api/webauthn/devices/:id", (req, res) => {
    const c = db.prepare("SELECT * FROM webauthn_creds WHERE id=?").get(Number(req.params.id));
    if (!c) throw new HttpError(404, "not_found", "Not found");
    if (c.user_id !== req.sess.user.id && !can(req.sess, "employee.edit")) throw new HttpError(403, "forbidden", "You do not have permission for this");
    db.prepare("DELETE FROM webauthn_creds WHERE id=?").run(c.id);
    audit(db, req.sess.user.id, "webauthn.remove", "user", c.user_id, { device: c.device_name, created_at: c.created_at }, null);
    send(req, res, 200, { ok: true });
  });
}

// Face ID / fingerprint at check-in (WebAuthn): a phone is registered once, then each check-in needs a fresh check by it.
// A small software authenticator stands in for the phone (P-256 keys from node:crypto, a minimal CBOR encoder).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { boot, adminClient, makePerson } from "./helpers.mjs";

// ---- a minimal CBOR encoder (maps, byte / text strings, integers) ----
function cbor(v) {
  const head = (major, n) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : n < 65536 ? Buffer.from([(major << 5) | 25, n >> 8, n & 255]) : Buffer.concat([Buffer.from([(major << 5) | 26]), (() => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; })()]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") { const b = Buffer.from(v, "utf8"); return Buffer.concat([head(3, b.length), b]); }
  if (Number.isInteger(v)) return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("cbor: unsupported");
}
const sha = (b) => crypto.createHash("sha256").update(b).digest();
const b64u = (b) => Buffer.from(b).toString("base64url");

/** A phone: one key pair, a counter, and the site it was registered on. */
function phone() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }), credId = crypto.randomBytes(16);
  let count = 0;
  const authData = (rpId, attested) => {
    const flags = 0x01 | 0x04 | (attested ? 0x40 : 0); // user present, user verified (Face ID), attested data
    const c = Buffer.alloc(4); c.writeUInt32BE(++count);
    const parts = [sha(Buffer.from(rpId)), Buffer.from([flags]), c];
    if (attested) {
      const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
      const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
      parts.push(Buffer.alloc(16), len, credId, cose);
    }
    return Buffer.concat(parts);
  };
  return {
    id: b64u(credId),
    create(opts, origin) {
      const client = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: opts.challenge, origin, crossOrigin: false }));
      const att = cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData(opts.rp.id, true)]]));
      return { id: b64u(credId), rawId: b64u(credId), type: "public-key", clientExtensionResults: {}, authenticatorAttachment: "platform",
        response: { clientDataJSON: b64u(client), attestationObject: b64u(att), transports: ["internal"] } };
    },
    get(opts, origin, { key = privateKey } = {}) {
      const client = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: opts.challenge, origin, crossOrigin: false }));
      const ad = authData(opts.rpId, false);
      const signature = crypto.sign("sha256", Buffer.concat([ad, sha(client)]), key);
      return { id: b64u(credId), rawId: b64u(credId), type: "public-key", clientExtensionResults: {},
        response: { clientDataJSON: b64u(client), authenticatorData: b64u(ad), signature: b64u(signature) } };
    },
  };
}

let t, admin, hr, s, s2;
const OFFICE = { lat: 23.588, lng: 58.3829 };
const jpg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
const ci = (p, kind) => p.c.upload(`/api/attendance/checkin?kind=${kind}&lat=${OFFICE.lat}&lng=${OFFICE.lng}&acc=10&device=d1`, jpg, "image/jpeg");
before(async () => {
  t = await boot({ FAKE_TODAY: "2026-11-16", FACEID_MODE_DEFAULT: "required" });
  admin = await adminClient(t.base);
  await admin.put("/api/settings", { att_sites: [{ name_ar: "المكتب", name_en: "Office", lat: OFFICE.lat, lng: OFFICE.lng, radius_m: 200 }] });
  hr = await makePerson(t.base, admin, { emp_no: "H1", name_ar: "موارد", join_date: "2020-01-01" }, "hr");
  s = await makePerson(t.base, admin, { emp_no: "S1", name_ar: "موظف", join_date: "2022-01-01", shift: 2 }, "staff");
  s2 = await makePerson(t.base, admin, { emp_no: "S2", name_ar: "زميل", join_date: "2022-01-01", shift: 2 }, "staff");
  for (const p of [s, s2]) await p.c.post("/api/attendance/checkin/consent", {});
  t.app.ctx.fakeToday = "2026-11-16"; t.app.ctx.fakeClock = "09:00";
});
after(async () => { await t.close(); });

const register = async (p, ph) => { const o = (await p.c.post("/api/webauthn/register/options", {})).data; return p.c.post("/api/webauthn/register/verify", ph.create(o, t.base)); };
const verify = async (p, ph, opts) => { const o = (await p.c.post("/api/webauthn/verify/options", {})).data; return p.c.post("/api/webauthn/verify", ph.get(o, t.base, opts)); };

test("required by default: no check-in without the phone's face / fingerprint check", async () => {
  assert.equal((await s.c.get("/api/webauthn/status")).data.needed, true);
  const r = await ci(s, "in");
  assert.equal(r.status, 403); assert.equal(r.data.error, "faceid_required");
  assert.equal((await s.c.post("/api/webauthn/verify/options", {})).data.error, "no_device", "register a phone first");
});

test("registering this phone counts as the check; the person, HR and Admin are told; the check-in is marked verified", async () => {
  const ph = phone();
  const r = await register(s, ph);
  assert.equal(r.status, 201); assert.ok(r.data.device);
  const c = await ci(s, "in");
  assert.equal(c.status, 201);
  assert.equal(t.db.prepare("SELECT verified FROM att_checkins WHERE id=?").get(c.data.checkin.id).verified, 1);
  assert.ok((await s.c.get("/api/notifications")).data.items.some((n) => /new phone/.test(n.title_en)));
  assert.ok((await hr.c.get("/api/notifications")).data.items.some((n) => /new phone/.test(n.title_en)));
  // one check, one check-in
  t.app.ctx.fakeClock = "17:00";
  assert.equal((await ci(s, "out")).data.error, "faceid_required");
  // the next one: verify with the phone, then check out
  assert.equal((await verify(s, ph)).status, 200);
  assert.equal((await ci(s, "out")).status, 201);
  s.phone = ph;
});

test("a wrong key, someone else's phone, or a replayed answer is refused", async () => {
  const other = phone();
  await register(s2, other);
  const o = (await s.c.post("/api/webauthn/verify/options", {})).data;
  // s answers with s2's phone
  assert.equal((await s.c.post("/api/webauthn/verify", other.get(o, t.base))).data.error, "unknown_device");
  // the right phone id but signed with another key
  const o2 = (await s.c.post("/api/webauthn/verify/options", {})).data;
  const bad = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  assert.equal((await s.c.post("/api/webauthn/verify", s.phone.get(o2, t.base, { key: bad }))).status, 403);
  // a used challenge can't be used again
  const o3 = (await s.c.post("/api/webauthn/verify/options", {})).data;
  const ans = s.phone.get(o3, t.base);
  assert.equal((await s.c.post("/api/webauthn/verify", ans)).status, 200);
  assert.equal((await s.c.post("/api/webauthn/verify", ans)).status, 400);
});

test("phones: the person and HR see them; removing one asks to register again; HR can exempt; Admin sets the mode", async () => {
  const mine = (await s.c.get("/api/webauthn/devices")).data.items;
  assert.equal(mine.length, 1);
  assert.equal((await hr.c.get(`/api/employees/${s.emp.id}/devices`)).data.items.length, 1);
  assert.equal((await s2.c.get(`/api/employees/${s.emp.id}/devices`)).status, 403);
  assert.equal((await s2.c.del(`/api/webauthn/devices/${mine[0].id}`)).status, 403);
  assert.equal((await hr.c.del(`/api/webauthn/devices/${mine[0].id}`)).status, 200, "a lost phone");
  assert.equal((await s.c.get("/api/webauthn/status")).data.devices, 0);
  // exempt: checks in without it (photo and location still taken)
  t.app.ctx.fakeToday = "2026-11-17"; t.app.ctx.fakeClock = "09:00";
  assert.equal((await s.c.put(`/api/employees/${s.emp.id}`, { faceid_exempt: true })).status, 403, "only HR / Admin");
  assert.equal((await hr.c.put(`/api/employees/${s.emp.id}`, { faceid_exempt: true })).status, 200);
  assert.equal((await ci(s, "in")).status, 201);
  // optional for everyone (Admin only)
  assert.equal((await hr.c.put("/api/settings", { faceid_mode: "optional" })).status, 403);
  assert.equal((await admin.put("/api/settings", { faceid_mode: "sometimes" })).status, 400);
  assert.equal((await admin.put("/api/settings", { faceid_mode: "optional" })).status, 200);
  assert.equal((await s2.c.get("/api/webauthn/status")).data.needed, false);
  assert.equal((await ci(s2, "in")).status, 201);
  await admin.put("/api/settings", { faceid_mode: "required" });
});

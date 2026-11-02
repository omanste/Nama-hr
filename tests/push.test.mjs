// Pop-up notifications (Web Push): a device subscribes; every in-app notification is also pushed; a gone device is removed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { boot, adminClient, makePerson } from "./helpers.mjs";
import { notify } from "../server/notify.mjs";

let t, admin, s, sent = [];
const SUB = { endpoint: "https://push.example.test/send/abcdefghijklmnop", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } };
before(async () => {
  t = await boot();
  admin = await adminClient(t.base);
  s = await makePerson(t.base, admin, { emp_no: "P1", name_ar: "موظف", join_date: "2022-01-01" }, "staff");
  t.app.ctx.pushSender = async (sub, body) => { if (sub.endpoint.includes("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 }); sent.push({ sub, body: JSON.parse(body) }); };
});
after(async () => { await t.close(); });

test("a device subscribes, gets the portal's notifications in its language, and unsubscribes", async () => {
  const key = (await s.c.get("/api/push/key")).data.publicKey;
  assert.match(key, /^[A-Za-z0-9_-]{60,}$/);
  assert.equal((await s.c.get("/api/push/key")).data.publicKey, key, "made once, kept");
  assert.equal((await s.c.post("/api/push/subscribe", { endpoint: "http://insecure", keys: SUB.keys })).status, 400);
  assert.equal((await s.c.post("/api/push/subscribe", { ...SUB, lang: "en" })).status, 200);
  notify(t.app.ctx, [s.user.id], { title_ar: "عنوان", title_en: "A title", body_ar: "نص", body_en: "Text", link: "#/leave/1", tag: "x",
    actions: [{ action: "#/?ci=out", title_ar: "انصراف", title_en: "Check out" }] });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, { title: "A title", body: "Text", link: "#/leave/1", tag: "x", dir: "ltr", lang: "en", actions: [{ action: "#/?ci=out", title: "Check out" }] });
  // the test button
  assert.equal((await s.c.post("/api/push/test", {})).data.sent, 1);
  // off
  await s.c.post("/api/push/unsubscribe", { endpoint: SUB.endpoint });
  sent = []; notify(t.app.ctx, [s.user.id], { title_ar: "ب", title_en: "B" }); await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 0);
});

test("a device that's gone is removed", async () => {
  await s.c.post("/api/push/subscribe", { ...SUB, endpoint: "https://push.example.test/gone/xyz1234567" });
  notify(t.app.ctx, [s.user.id], { title_ar: "ج", title_en: "C" });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(t.db.prepare("SELECT count(*) n FROM push_subs WHERE user_id=?").get(s.user.id).n, 0);
});

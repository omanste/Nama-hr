/* Pop-up notifications on phones and computers (Web Push): every in-app notification is also sent to the devices the
 * person turned notifications on for. The keys that sign them (VAPID) are made once and kept in the settings. Only a
 * title and a short line are sent. A device that is gone (404/410) is removed. */
import { createRequire } from "node:module";
import { getSetting, setSetting, nowIso } from "./db.mjs";
import { send, readJson, HttpError } from "./http.mjs";

const webpush = createRequire(import.meta.url)("web-push");
function keys(db) {
  let k = getSetting(db, "push_vapid", null);
  if (!k || !k.publicKey) { k = webpush.generateVAPIDKeys(); setSetting(db, "push_vapid", k); }
  return k;
}

/** Send one notification to the person's devices. msg: {title_ar, title_en, body_ar, body_en, link, tag, actions[]} */
export async function pushTo(ctx, userIds, msg) {
  const { db } = ctx;
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  const subs = db.prepare(`SELECT * FROM push_subs WHERE user_id IN (${ids.map(() => "?").join(",")})`).all(...ids);
  if (!subs.length) return 0;
  const k = keys(db), subject = (ctx.env.PUBLIC_URL || "").startsWith("https://") ? ctx.env.PUBLIC_URL : "mailto:hr@nama.om";
  const sender = ctx.pushSender || ((sub, body, opts) => webpush.sendNotification(sub, body, opts));
  let n = 0;
  await Promise.all(subs.map(async (s) => {
    const ar = s.lang !== "en";
    const body = JSON.stringify({
      title: (ar ? msg.title_ar : msg.title_en) || msg.title_ar, body: (ar ? msg.body_ar : msg.body_en) || "", link: msg.link || "#/", tag: msg.tag || undefined,
      dir: ar ? "rtl" : "ltr", lang: ar ? "ar" : "en",
      actions: (msg.actions || []).map((a) => ({ action: a.action, title: ar ? a.title_ar : a.title_en })),
    });
    try {
      await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { vapidDetails: { subject, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 12 * 3600 });
      n++;
    } catch (e) {
      if ([404, 410].includes(e.statusCode)) db.prepare("DELETE FROM push_subs WHERE id=?").run(s.id); // the device is gone
      else console.error(`push to device ${s.id} failed: ${e.statusCode || ""} ${e.message}`);
    }
  }));
  return n;
}

export function registerPush(api, ctx) {
  const { db } = ctx;
  // notify() hands every in-app notification to the devices too (never blocking, never failing the action)
  ctx.push = (ids, msg) => { pushTo(ctx, ids, msg).catch((e) => console.error("push failed:", e.message)); };
  api.get("/api/push/key", (req, res) => send(req, res, 200, { publicKey: keys(db).publicKey }));
  api.post("/api/push/subscribe", async (req, res) => {
    const b = await readJson(req);
    const ep = String(b.endpoint || ""), p = b.keys && String(b.keys.p256dh || ""), a = b.keys && String(b.keys.auth || "");
    if (!/^https:\/\/\S{10,2000}$/.test(ep) || !/^[A-Za-z0-9_-]{20,200}$/.test(p) || !/^[A-Za-z0-9_-]{8,100}$/.test(a))
      throw new HttpError(400, "invalid", "Not a valid push subscription");
    db.prepare(`INSERT INTO push_subs(user_id,endpoint,p256dh,auth,lang,user_agent,created_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth, lang=excluded.lang`)
      .run(req.sess.user.id, ep, p, a, b.lang === "en" ? "en" : "ar", String(req.headers["user-agent"] || "").slice(0, 200), nowIso());
    send(req, res, 200, { ok: true, devices: db.prepare("SELECT count(*) n FROM push_subs WHERE user_id=?").get(req.sess.user.id).n });
  });
  api.post("/api/push/unsubscribe", async (req, res) => {
    const b = await readJson(req);
    db.prepare("DELETE FROM push_subs WHERE user_id=? AND endpoint=?").run(req.sess.user.id, String(b.endpoint || ""));
    send(req, res, 200, { ok: true });
  });
  // a test pop-up on my own devices
  api.post("/api/push/test", async (req, res) => {
    const n = await pushTo(ctx, [req.sess.user.id], { title_ar: "الإشعارات تعمل ✓", title_en: "Notifications are on ✓", body_ar: "ستصلك تنبيهات البوابة على هذا الجهاز", body_en: "Portal alerts will appear on this device", link: "#/notifications", tag: "test" });
    send(req, res, 200, { sent: n });
  });
}

/* Notifications: always in-app; e-mail too when SMTP is configured (Nama's own mail server).
 * A failed e-mail is logged and never blocks the action that caused it. */
import { createRequire } from "node:module";
import { nowIso } from "./db.mjs";
import { send, readJson } from "./http.mjs";

let transport = null;      // async ({to, subject, text, html}) => void
let override = undefined;  // tests inject a transport with setTransport()

export function setTransport(fn) { override = fn; }

export function configureMail(env) {
  if (!env.SMTP_HOST) { transport = null; return; }
  const nodemailer = createRequire(import.meta.url)("nodemailer");
  const t = nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === "1",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  const from = env.SMTP_FROM || env.SMTP_USER;
  transport = (m) => t.sendMail({ from, ...m });
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** msg: {title_ar, title_en, body_ar, body_en, link} — link is an app hash route like "#/leave/12". */
export function notify(ctx, userIds, msg) {
  const { db } = ctx;
  const ids = [...new Set(userIds.filter(Boolean))];
  const ins = db.prepare("INSERT INTO notifications(user_id,title_ar,title_en,body_ar,body_en,link,created_at) VALUES(?,?,?,?,?,?,?)");
  for (const id of ids) ins.run(id, msg.title_ar, msg.title_en, msg.body_ar || "", msg.body_en || "", msg.link || null, nowIso());
  const fn = override !== undefined ? override : transport;
  if (!fn || msg.inAppOnly) return;
  const tag = ctx.appEnv === "production" ? "" : `[${ctx.appEnv}] `;
  const url = (ctx.env.PUBLIC_URL || "").replace(/\/$/, "") + "/" + (msg.link || "");
  for (const id of ids) {
    const r = db.prepare("SELECT e.email FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.id=? AND u.active=1").get(id);
    if (!r || !r.email) continue;
    const text = `${msg.title_ar}\n${msg.body_ar || ""}\n\n${msg.title_en}\n${msg.body_en || ""}\n\n${url}`;
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial;color:#122421"><h3 style="color:#154540">${esc(msg.title_ar)}</h3><p>${esc(msg.body_ar)}</p></div>
<hr style="border:0;border-top:1px solid #D3DDD9"><div dir="ltr" style="font-family:Arial;color:#122421"><h3 style="color:#154540">${esc(msg.title_en)}</h3><p>${esc(msg.body_en)}</p></div>
<p><a href="${esc(url)}" style="background:#154540;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">فتح · Open</a></p>`;
    try {
      Promise.resolve(fn({ to: r.email, subject: `${tag}${msg.title_ar} · ${msg.title_en}`, text, html }))
        .catch((e) => console.error(`e-mail to user ${id} failed: ${e.message}`));
    } catch (e) { console.error(`e-mail to user ${id} failed: ${e.message}`); }
  }
}

export function registerNotifications(api, ctx) {
  const { db } = ctx;
  configureMail(ctx.env);
  api.get("/api/notifications", (req, res) => {
    const uid = req.sess.user.id;
    const items = db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100").all(uid);
    const unread = db.prepare("SELECT count(*) n FROM notifications WHERE user_id=? AND read_at IS NULL").get(uid).n;
    send(req, res, 200, { items, unread });
  });
  api.post("/api/notifications/read", async (req, res) => {
    const { ids, all } = await readJson(req);
    const uid = req.sess.user.id, now = nowIso();
    if (all) db.prepare("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL").run(now, uid);
    else if (Array.isArray(ids)) { const u = db.prepare("UPDATE notifications SET read_at=? WHERE id=? AND user_id=?"); for (const id of ids) u.run(now, Number(id), uid); }
    send(req, res, 200, { ok: true });
  });
}

import { api } from "../api.js";
import { t, nm } from "../i18n.js";
import { h, field, select, toast, errText, pageHead, dateTime, confirm } from "../ui.js";
import { render as rerender, state } from "../app.js";
import { showTempPassword } from "./profile.js";

const ROLES = ["staff", "hr", "accounts", "ceo", "admin"];

export async function render(el, _p, { can }) {
  if (!can.admin()) throw { status: 403 };
  const [users, emps] = await Promise.all([api.get("/api/users"), api.get("/api/employees?status=active")]);
  const linked = new Set(users.items.map((u) => u.employee_id).filter(Boolean));
  const act = async (fn) => { try { await fn(); toast(t("saved")); rerender(); } catch (e) { toast(errText(e), "bad"); } };

  const uname = h("input", { name: "username", dir: "ltr", autocapitalize: "none" });
  const role = select("role", ROLES.map((r) => [r, t("role_" + r)]), "staff");
  const emp = select("employee_id", [["", "—"], ...emps.items.filter((e) => !linked.has(e.id)).map((e) => [e.id, `${nm(e)} (${e.emp_no})`])], "");
  emp.addEventListener("change", () => { const e = emps.items.find((x) => String(x.id) === emp.value); if (e && !uname.value) uname.value = e.emp_no.toLowerCase(); });

  el.append(pageHead(t("users_title")),
    h("div", { class: "table-wrap" }, h("table", null,
      h("thead", null, h("tr", null, [t("username"), t("employee"), t("role"), t("status"), t("last_login"), ""].map((x) => h("th", null, x)))),
      h("tbody", null, users.items.map((u) => {
        const self = u.id === state.me.user.id;
        return h("tr", null,
          h("td", { dir: "ltr" }, u.username), h("td", null, u.employee_id ? h("a", { href: `#/staff/${u.employee_id}` }, nm(u)) : "—"),
          h("td", null, select("role", ROLES.map((r) => [r, t("role_" + r)]), u.role, { disabled: self, "aria-label": t("role"), onchange: (e) => act(() => api.put(`/api/users/${u.id}`, { role: e.target.value })) })),
          h("td", null, h("span", { class: `badge ${u.active ? "b-active" : "b-cancelled"}` }, u.active ? t("active") : t("inactive"))),
          h("td", { class: "num" }, dateTime(u.last_login_at)),
          h("td", null, h("div", { class: "row", style: { flexWrap: "nowrap" } },
            h("button", { class: "btn small", type: "button", onclick: async () => {
              if (!(await confirm(`${t("reset_password")} · ${u.username}?`))) return;
              try { const r = await api.post(`/api/users/${u.id}/reset`); await showTempPassword(u.username, r.tempPassword); } catch (e) { toast(errText(e), "bad"); }
            } }, t("reset_password")),
            self ? null : h("button", { class: `btn small ${u.active ? "danger" : ""}`, type: "button", onclick: () => act(() => api.put(`/api/users/${u.id}`, { active: !u.active })) }, u.active ? t("deactivate") : t("activate")))));
      })))),
    h("section", { class: "card" }, h("h2", null, t("add_user")),
      h("form", { class: "fields", onsubmit: async (e) => {
        e.preventDefault();
        try { const r = await api.post("/api/users", { username: uname.value, role: role.value, employee_id: emp.value ? Number(emp.value) : null }); await showTempPassword(r.user.username, r.tempPassword); rerender(); }
        catch (er) { toast(errText(er), "bad"); }
      } }, field(t("link_employee"), emp), field(t("username"), uname, { req: true }), field(t("role"), role),
        h("div", { class: "field", style: { alignSelf: "end" } }, h("button", { class: "btn primary", type: "submit" }, t("add_user"))))));
}

/* Feature modules register their API routes here. New phases (attendance, KPIs, payroll) add a line. */
import { registerAuth } from "./auth.mjs";
import { registerEmployees } from "./employees.mjs";
import { registerFiles } from "./files.mjs";
import { registerAdmin } from "./admin.mjs";
import { registerNotifications } from "./notify.mjs";
import { registerRequests } from "./requests.mjs";
import { registerJobs } from "./jobs.mjs";

export async function registerModules(api, ctx) {
  registerAuth(api, ctx);
  registerEmployees(api, ctx);
  registerFiles(api, ctx);
  registerAdmin(api, ctx);
  registerNotifications(api, ctx);
  registerRequests(api, ctx);
  registerJobs(api, ctx);
}

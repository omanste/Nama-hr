/* Feature modules register their API routes here. New phases (attendance, KPIs, payroll) add a line. */
import { registerAuth } from "./auth.mjs";

export async function registerModules(api, ctx) {
  registerAuth(api, ctx);
}

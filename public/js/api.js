// JSON API client. Errors throw {status, error, message, field}; a 401 sends the user to the sign-in page.
async function call(method, path, body, headers = {}) {
  const opts = { method, headers: { ...headers }, credentials: "same-origin" };
  if (body instanceof Blob || body instanceof ArrayBuffer) opts.body = body;
  else if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opts); }
  catch { throw { status: 0, error: "offline", message: "offline" }; }
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : null;
  if (!res.ok) {
    const err = { status: res.status, ...(data || { error: "error" }) };
    if (res.status === 401 && !path.endsWith("/api/login")) { if (location.hash !== "#/login") location.hash = "#/login"; }
    if (res.status === 403 && err.error === "must_change_password") location.hash = "#/password";
    throw err;
  }
  return data;
}
export const api = {
  get: (p) => call("GET", p),
  post: (p, b = {}) => call("POST", p, b),
  put: (p, b = {}) => call("PUT", p, b),
  del: (p) => call("DELETE", p),
  upload: (p, file, headers = {}) => call("POST", p, file, { "content-type": file.type || "application/octet-stream", ...headers }),
};

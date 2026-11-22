// A phone for tests: a software WebAuthn authenticator (P-256 key, a minimal CBOR encoder) that "passes Face ID".
import crypto from "node:crypto";
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
export function phone() {
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


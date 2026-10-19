import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import vercelApi from "../api/lib/vercel-adapter.mjs";
import loginApi from "../api/auth/login.mjs";

async function invoke(api = vercelApi, { method = "GET", url = "/api/state", headers = {}, body } = {}) {
  const request = Readable.from([]);
  Object.assign(request, {
    method,
    url,
    headers: { host: "localhost", ...headers },
    ...(body !== undefined ? { body } : {})
  });
  const resultHeaders = {};
  const response = {
    setHeader(name, value) {
      resultHeaders[name.toLowerCase()] = value;
    },
    end(value) {
      this.body = value?.toString() || "";
    }
  };
  await api(request, response);
  return { status: response.statusCode, headers: resultHeaders, body: JSON.parse(response.body) };
}

test("Vercel adapter returns the shared API's unauthorized response", async () => {
  const response = await invoke();
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "unauthorized");
  assert.equal(response.headers["cache-control"], "no-store");
});

test("Vercel adapter rejects oversized request bodies", async () => {
  const response = await invoke(vercelApi, {
    method: "POST",
    url: "/api/auth/login",
    headers: { "content-length": "128001" },
    body: "{}"
  });
  assert.equal(response.status, 413);
  assert.equal(response.body.code, "payload_too_large");
});

test("explicit nested login route reaches the shared authentication handler", async () => {
  const previousPassword = process.env.FACTORY_OWNER_PASSWORD;
  const previousSecret = process.env.FACTORY_SESSION_SECRET;
  process.env.FACTORY_OWNER_PASSWORD = "test-owner-password-123";
  process.env.FACTORY_SESSION_SECRET = "test-session-secret-with-more-than-32-characters";
  try {
    const response = await invoke(loginApi, {
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "incorrect" })
    });
    assert.equal(response.status, 401);
    assert.equal(response.body.error, "Incorrect owner password.");
  } finally {
    if (previousPassword === undefined) delete process.env.FACTORY_OWNER_PASSWORD;
    else process.env.FACTORY_OWNER_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.FACTORY_SESSION_SECRET;
    else process.env.FACTORY_SESSION_SECRET = previousSecret;
  }
});

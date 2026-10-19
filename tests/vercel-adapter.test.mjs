import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import vercelApi from "../api/[...route].mjs";

async function invoke({ method = "GET", url = "/api/state", headers = {}, body } = {}) {
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
  await vercelApi(request, response);
  return { status: response.statusCode, headers: resultHeaders, body: JSON.parse(response.body) };
}

test("Vercel adapter returns the shared API's unauthorized response", async () => {
  const response = await invoke();
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "unauthorized");
  assert.equal(response.headers["cache-control"], "no-store");
});

test("Vercel adapter rejects oversized request bodies", async () => {
  const response = await invoke({
    method: "POST",
    url: "/api/auth/login",
    headers: { "content-length": "128001" },
    body: "{}"
  });
  assert.equal(response.status, 413);
  assert.equal(response.body.code, "payload_too_large");
});

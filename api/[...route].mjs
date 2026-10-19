import handler from "./handler.mjs";

const readBody = async (request) => {
  const contentLength = Number(request.headers["content-length"] || 0);
  if (contentLength > 128_000) {
    throw Object.assign(new Error("Request is too large."), { status: 413, code: "payload_too_large" });
  }
  if (request.body !== undefined) {
    const body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    if (Buffer.byteLength(body) > 128_000) {
      throw Object.assign(new Error("Request is too large."), { status: 413, code: "payload_too_large" });
    }
    return body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > 128_000) {
      throw Object.assign(new Error("Request is too large."), { status: 413, code: "payload_too_large" });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

export default async function vercelApi(request, response) {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    headers.delete("connection");
    const method = request.method || "GET";
    const hasBody = !["GET", "HEAD"].includes(method);
    const body = hasBody ? await readBody(request) : undefined;
    const host = request.headers.host || "localhost";
    const webRequest = new Request(new URL(request.url || "/", `https://${host}`), {
      method,
      headers,
      ...(body !== undefined ? { body } : {})
    });
    const result = await handler(webRequest);
    response.statusCode = result.status;
    result.headers.forEach((value, key) => response.setHeader(key, value));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    const known = Number.isInteger(error?.status) && Boolean(error?.code);
    if (!known) console.error("Vercel API adapter error", error);
    response.statusCode = known ? error.status : 500;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify({
      error: known ? error.message : "The factory could not complete that request.",
      code: known ? error.code : "internal_error"
    }));
  }
}

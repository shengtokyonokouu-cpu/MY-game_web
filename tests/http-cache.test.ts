import assert from "node:assert/strict";
import test from "node:test";
import { cached } from "../app/lib/http-cache.ts";
test("concurrent cache consumers get independent materialized bodies", async () => {
  let calls = 0;
  const producer = async () => { calls++; await Promise.resolve(); return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("shared news")); controller.close(); } }), { headers: { "Content-Type": "text/plain", "X-Source": "verified" } }); };
  const values = await Promise.all(Array.from({ length: 8 }, () => cached("concurrent-test", 60, producer)));
  assert.equal(calls, 1); assert.deepEqual(await Promise.all(values.map((value) => value.text())), Array(8).fill("shared news"));
  for (let i = 0; i < 2; i++) { const value = await cached("concurrent-test", 60, producer); assert.equal(await value.text(), "shared news"); assert.equal(value.headers.get("X-Source"), "verified"); }
  assert.equal(calls, 1);
});
test("failed and no-store producers do not poison subsequent requests", async () => {
  await assert.rejects(cached("retry-test", 60, async () => { throw new Error("upstream unavailable"); }));
  assert.equal(await (await cached("retry-test", 60, async () => new Response("recovered"))).text(), "recovered");
  for (const key of ["failure-test", "no-store-test"]) {
    let calls = 0; const producer = async () => { calls++; return new Response(String(calls), { status: key === "failure-test" ? 503 : 200, headers: { "Cache-Control": "no-store" } }); };
    await (await cached(key, 60, producer)).text(); const second = await cached(key, 60, producer); assert.equal(await second.text(), "2");
  }
});

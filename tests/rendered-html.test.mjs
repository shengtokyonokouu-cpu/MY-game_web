import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://release-signal.test/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Release Signal application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>发售信号｜个人新游雷达<\/title>/);
  assert.match(html, /<html[^>]+data-theme="light"/);
  assert.match(html, /发现下一款好游戏/);
  assert.match(html, /光与影：33号远征队/);
  assert.equal((html.match(/class="game-card"/g) || []).length, 12, "first page should contain usable game cards");
  assert.match(html, /\/covers\//);
  assert.match(html, /aria-label="游戏目录分页"/);
  assert.match(html, /我的游戏架/);
  assert.match(html, /设置与数据/);
  assert.match(html, /IP 频道/);
  assert.match(html, /我的关注/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /通知中心/);
  assert.match(html, /切换为深色主题/);
  assert.match(html, /property="og:image"[^>]+content="https?:\/\/[^"]+\/og-light\.png"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

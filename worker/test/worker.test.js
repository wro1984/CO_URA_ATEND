import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handle } from "../src/index.js";

// D1 de mentira em cima do SQLite do Node: só o que o Worker usa (prepare/bind/first/all/run).
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return {
    raw: db,
    prepare(sql) {
      let args = [];
      const st = db.prepare(sql);
      const o = {
        bind(...a) { args = a; return o; },
        async first() { return st.get(...args) ?? null; },
        async all() { return { results: st.all(...args) }; },
        async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes) } }; },
      };
      return o;
    },
  };
}

const CHAVE = "chave-de-teste-com-mais-de-16";
const ORIGEM = "https://wro1984.github.io";
const APP = "ura-atendimento";
const novoEnv = (extra = {}) => ({ DB: d1(), MAPI_CHAVE: CHAVE, ORIGENS_PERMITIDAS: ORIGEM, APPS: APP, ...extra });
const U = "https://x.workers.dev";
const DIA = "hist/f1a864c1/2026-06-18.22689b97519a.json";
const HORA = "hoje/f1a864c1/2026-11-04.08.97863b9ce7ff.json";

const get = (env, caminho, origem = ORIGEM) => handle(new Request(U + caminho, { headers: { Origin: origem } }), env);
const admin = (env, metodo, caminho, corpo, chave = CHAVE) => handle(new Request(U + caminho, {
  method: metodo, body: corpo, headers: { Authorization: `Bearer ${chave}` } }), env);
const put = (env, caminho, texto, chave) =>
  admin(env, "PUT", `/admin/arquivo?app=${APP}&caminho=${encodeURIComponent(caminho)}`, texto, chave);

test("MAPI grava, app lê do jeito que foi gravado, com cache certo e CORS do app", async () => {
  const env = novoEnv();
  assert.equal((await put(env, "dados.json", '{"app":"co-ura-atend","v":1}')).status, 200);
  assert.equal((await put(env, DIA, '{"dia":1}')).status, 200);
  let r = await get(env, `/${APP}/dados.json`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '{"app":"co-ura-atend","v":1}');
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGEM);
  r = await get(env, `/${APP}/${DIA}`);
  assert.match(r.headers.get("Cache-Control"), /immutable/);
  // regravar troca o conteúdo
  await put(env, "dados.json", '{"v":2}');
  assert.equal(await (await get(env, `/${APP}/dados.json`)).text(), '{"v":2}');
  // outra origem lê (o conteúdo é cifrado, como no GitHub), mas sem CORS liberado para o navegador dela
  r = await get(env, `/${APP}/dados.json`, "https://outro.site");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
});

test("lista e apaga; o dados.json nunca é apagado", async () => {
  const env = novoEnv();
  for (const c of ["dados.json", DIA, HORA]) await put(env, c, "{}");
  let l = await (await admin(env, "GET", `/admin/lista?app=${APP}`)).json();
  assert.deepEqual(l.caminhos, ["dados.json", DIA, HORA]);
  const a = await (await admin(env, "POST", "/admin/apagar", JSON.stringify({ app: APP, caminhos: [DIA, "dados.json", "../x"] }))).json();
  assert.equal(a.apagados, 1);
  l = await (await admin(env, "GET", `/admin/lista?app=${APP}`)).json();
  assert.deepEqual(l.caminhos, ["dados.json", HORA]);
  assert.equal((await get(env, `/${APP}/${DIA}`)).status, 404);
});

test("só o MAPI grava: chave errada, sem chave no Worker", async () => {
  assert.equal((await put(novoEnv(), "dados.json", "{}", "errada-errada-errada")).status, 401);
  assert.equal((await put(novoEnv({ MAPI_CHAVE: "" }), "dados.json", "{}")).status, 503);
  assert.equal((await admin(novoEnv(), "GET", "/admin/ping", undefined, "")).status, 401);
  const p = await (await admin(novoEnv(), "GET", "/admin/ping")).json();
  assert.equal(p.ok, true);
});

test("recusa caminho, app e conteúdo fora do formato", async () => {
  const env = novoEnv();
  for (const c of ["../dados.json", "index.html", "hist/a/b.json", "hist/x/2026-01-01.zz.json", "hist/a b/2026-01-01.abcdef.json"])
    assert.equal((await put(env, c, "{}")).status, 400, c);
  assert.equal((await admin(env, "PUT", "/admin/arquivo?app=outro&caminho=dados.json", "{}")).status, 404);
  assert.equal((await put(env, "dados.json", "<html>")).status, 400);
  assert.equal((await put(env, "dados.json", "{" + "a".repeat(1024 * 1024) + "}")).status, 413);
  assert.equal((await get(env, "/outro/dados.json")).status, 404);
  assert.equal((await get(env, `/${APP}/index.html`)).status, 404);
  assert.equal((await handle(new Request(U + `/${APP}/dados.json`, { method: "POST" }), env)).status, 404);
});

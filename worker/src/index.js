/**
 * Dados dos apps — Cloudflare Worker + D1. Guarda e entrega os arquivos CIFRADOS que o MAPI publica (hoje só o
 * URA Atendimento), no lugar do GitHub Pages: sem build e sem fila, o arquivo novo vale na hora.
 *
 * O Worker não abre nada: recebe e devolve o texto exatamente como o MAPI mandou (dados.json, hoje/…, hist/…, todos
 * cifrados). Quem pode ler é decidido pela criptografia de cada app, como no GitHub.
 *
 * Rotas públicas (o app):
 *   GET /<app>/<caminho>     o arquivo; dados.json sem cache, hist/ e hoje/ com cache longo (o nome muda quando muda)
 * Rotas do MAPI (Authorization: Bearer <MAPI_CHAVE>):
 *   GET  /admin/ping
 *   GET  /admin/lista?app=<app>                      {caminhos:[...]} (só os nomes)
 *   PUT  /admin/arquivo?app=<app>&caminho=<caminho>  corpo = o arquivo (texto JSON)
 *   POST /admin/apagar  {app, caminhos:[...]}
 *
 * Limites da conta gratuita: cerca de 100 mil chamadas por dia (somando os Workers da conta) e 10 ms de CPU por chamada.
 * Por isso nada aqui abre ou recalcula o conteúdo: só lê e grava a linha do banco.
 */

const VERSAO = "1.0.0";
const MAX_ARQUIVO = 1024 * 1024;           // 1 MB por arquivo (hoje: dados.json ~10 KB, um dia ~50 KB)
const MAX_APAGAR = 500;
// dados.json | hist/<id>/<dia>.<hash>.json | hoje/<id>/<dia>.<HH>.<hash>.json
const CAMINHO_RE = /^(dados\.json|(hist|hoje)\/[A-Za-z0-9_-]{1,64}\/[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{2})?\.[0-9a-f]{6,64}\.json)$/;
const APP_RE = /^[a-z0-9-]{1,40}$/;

// ---------- utilidades ----------
const enc = new TextEncoder();

async function sha256(texto) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function iguais(a, b) {                    // tempo constante (entradas de mesmo tamanho: hashes)
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const lista = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

function cors(request, env) {
  const origem = request.headers.get("Origin") || "";
  const ok = lista(env.ORIGENS_PERMITIDAS);
  const h = { "Vary": "Origin" };
  if (ok.includes("*") || ok.includes(origem)) {
    h["Access-Control-Allow-Origin"] = ok.includes("*") ? "*" : origem;
    h["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function json(corpo, status = 200, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

class Erro extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

function appOk(env, app) {
  return APP_RE.test(app || "") && lista(env.APPS).includes(app);
}

function conferir(env, app, caminho) {
  if (!appOk(env, app)) throw new Erro(404, "App não encontrado.");
  if (caminho != null && !CAMINHO_RE.test(caminho)) throw new Erro(400, "Caminho inválido.");
}

// ---------- rota pública ----------
async function entregar(request, env, app, caminho) {
  const c = cors(request, env);
  if (!appOk(env, app) || !CAMINHO_RE.test(caminho)) return json({ erro: "Não encontrado." }, 404, c);
  const r = await env.DB.prepare("SELECT conteudo FROM arquivos WHERE app = ? AND caminho = ?").bind(app, caminho).first();
  if (!r) return json({ erro: "Não encontrado." }, 404, c);
  const cache = caminho === "dados.json" ? "no-store" : "public, max-age=31536000, immutable";
  return new Response(r.conteudo, {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache, "X-Content-Type-Options": "nosniff", ...c },
  });
}

// ---------- rotas do MAPI ----------
async function autenticarMapi(request, env) {
  const segredo = String(env.MAPI_CHAVE || "");
  const enviado = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (segredo.length < 16) throw new Erro(503, "MAPI_CHAVE não configurada (mínimo 16 caracteres).");
  if (!iguais(await sha256(enviado), await sha256(segredo))) throw new Erro(401, "Chave inválida.");
}

async function adminPing(env) {
  const r = await env.DB.prepare("SELECT app, COUNT(*) AS arquivos, SUM(LENGTH(conteudo)) AS bytes FROM arquivos GROUP BY app").all();
  return { ok: true, versao: VERSAO, agora: new Date().toISOString(), apps: lista(env.APPS), uso: r.results || [] };
}

async function adminLista(env, app) {
  conferir(env, app, null);
  const r = await env.DB.prepare("SELECT caminho FROM arquivos WHERE app = ? ORDER BY caminho").bind(app).all();
  return { app, caminhos: (r.results || []).map((x) => x.caminho) };
}

async function adminArquivo(request, env, app, caminho) {
  conferir(env, app, caminho);
  const tam = Number(request.headers.get("Content-Length") || 0);
  if (tam > MAX_ARQUIVO) throw new Erro(413, "Arquivo grande demais.");
  const texto = await request.text();
  if (texto.length > MAX_ARQUIVO) throw new Erro(413, "Arquivo grande demais.");
  if (!texto.startsWith("{") || !texto.endsWith("}")) throw new Erro(400, "Arquivo inválido (esperado JSON).");
  await env.DB.prepare(
    `INSERT INTO arquivos (app, caminho, conteudo, atualizado_em) VALUES (?, ?, ?, ?)
     ON CONFLICT (app, caminho) DO UPDATE SET conteudo = excluded.conteudo, atualizado_em = excluded.atualizado_em`)
    .bind(app, caminho, texto, new Date().toISOString()).run();
  return { ok: true, caminho, bytes: texto.length };
}

async function adminApagar(request, env) {
  let c;
  try { c = JSON.parse(await request.text()); } catch (e) { throw new Erro(400, "Corpo inválido (esperado JSON)."); }
  const app = c && c.app;
  const caminhos = Array.isArray(c && c.caminhos) ? c.caminhos.map(String) : null;
  if (!caminhos || caminhos.length > MAX_APAGAR) throw new Erro(400, `Informe até ${MAX_APAGAR} caminhos.`);
  conferir(env, app, null);
  let apagados = 0;
  for (const caminho of caminhos) {
    if (!CAMINHO_RE.test(caminho) || caminho === "dados.json") continue;      // o dados.json só é trocado, nunca apagado
    const r = await env.DB.prepare("DELETE FROM arquivos WHERE app = ? AND caminho = ?").bind(app, caminho).run();
    apagados += r.meta?.changes || 0;
  }
  return { ok: true, apagados };
}

// ---------- entrada ----------
export async function handle(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env) });

    if (pathname.startsWith("/admin/")) {
      await autenticarMapi(request, env);
      const app = url.searchParams.get("app");
      if (pathname === "/admin/ping" && request.method === "GET") return json(await adminPing(env));
      if (pathname === "/admin/lista" && request.method === "GET") return json(await adminLista(env, app));
      if (pathname === "/admin/arquivo" && request.method === "PUT")
        return json(await adminArquivo(request, env, app, url.searchParams.get("caminho")));
      if (pathname === "/admin/apagar" && request.method === "POST") return json(await adminApagar(request, env));
      throw new Erro(404, "Rota não encontrada.");
    }

    if (request.method === "GET" || request.method === "HEAD") {
      if (pathname === "/") return json({ servico: "dados-dos-apps", versao: VERSAO });
      const m = pathname.match(/^\/([^/]+)\/(.+)$/);
      if (m) return await entregar(request, env, m[1], m[2]);
    }
    throw new Erro(404, "Rota não encontrada.");
  } catch (e) {
    const c = cors(request, env);
    if (e instanceof Erro) return json({ erro: e.message }, e.status, c);
    console.error("erro inesperado:", e && e.message);
    return json({ erro: "Erro interno." }, 500, c);
  }
}

export default { fetch: (request, env) => handle(request, env) };

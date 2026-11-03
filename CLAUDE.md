# CO_URA_ATEND — URA · Suporte B2C (produção)

App web instalável no celular (PWA) com os alarmes e as filas do Suporte B2C na URA (CO e TEL): telas **Alarmes**,
**Agora**, **Evolução** e **Skills**, com o histórico de 139 dias e o previsto pela mediana. É o app da **homologação**
(`vivo61991-tech/ura-atendimento`, v1.31.0) com a entrada de dados trocada: em vez de `pulse.json` e `historico.csv`
**abertos**, lê os arquivos **cifrados** que o MAPI publica, pelo **login do HUB**. Publicado pelo GitHub Pages em
<https://wro1984.github.io/CO_URA_ATEND/> a partir da branch `main`. **Todo push na `main` vai para o ar em cerca de
1 minuto**, para todos os usuários.

**Topo padrão dos apps**: botão de voltar ao HUB (`#btHub`) à esquerda, botões do app à direita.

Leia este arquivo inteiro antes de mudar qualquer coisa.

## Como funciona

```
Genesys Pulse ──► MAPI (pulse.py: leituras) ────┐
IPTBM (Oracle) ──► MAPI (ura_atend.py: 139 dias) ┴─► dados.json + hoje/… + hist/… CIFRADOS ──► este repo ──► app
                                                     (commit automático do MAPI)                         login do HUB
```

- O repositório e o site são **públicos**. Os números e os nomes das skills só existem aqui **cifrados**.
- Quem gera e publica tudo é o **MAPI** (repositório `wro1984/mapi5`, `ura_atend.py`, ver `URA_ATEND.md` de lá).
- **Não há chave própria**: o app abre com a credencial que o HUB dos apps guardou no IndexedDB `co-hub-acesso` deste
  endereço. Quem vê o app é definido no perfil do HUB (app `ura-atendimento`).

## Onde está o quê

| Arquivo | Papel | Igual à homologação? |
|---|---|---|
| `dados.js`, `graf.js`, `historico.js`, `alarmes.js` | contas, gráficos, histórico, alarmes | **sim** (copiar as versões novas de lá) |
| `app.js` | telas e atualização | sim, menos `carregar()` / `carregarHist()` (usam o `fonte.js`), a tela de acesso e sem a cópia aberta no `localStorage` |
| `index.html` | estrutura e estilos | sim, mais o botão do HUB, a seção `#pgAcesso` e os scripts `cripto.js` e `fonte.js`; endereços do `og:` deste site |
| `fonte.js` | **só aqui**: devolve ao app o mesmo `pulse.json` (horas fechadas + hora aberta) e o mesmo `historico.csv` (remontado dos dias) | — |
| `cripto.js` | **só aqui**: lê a credencial do HUB e abre os arquivos (AES-GCM + gzip) | — |
| `sw.js` | **só aqui**: cache só deste app | — |
| `dados.json`, `hoje/`, `hist/` | **gerados pelo MAPI — não editar** | — |

**Trazer uma versão nova da homologação:** copie `dados.js`, `graf.js`, `historico.js`, `alarmes.js` e os testes que não
usam dados reais. Em `app.js` e `index.html`, reaplique só as diferenças da tabela acima. Depois suba a versão (abaixo),
rode `npm test` e teste no navegador.

## Regras que não podem ser quebradas

1. **Nunca editar, apagar ou "consertar" o `dados.json` nem as pastas `hoje/` e `hist/`.** São do MAPI.
2. **Nunca commitar dados abertos nem segredos**: `pulse.json`, `historico.csv`, amostras reais (`tests/amostra.json`,
   `tests/historico_amostra.csv`), o SQL com os nomes das skills, prints, chaves. O histórico do git é público. Para
   testar, use `tests/fixtures/pacote.json` (inventado, gerado com as funções do MAPI).
3. **Nada aberto guardado no aparelho.** A homologação guardava o último `pulse.json` no `localStorage`; aqui não (e
   `usarCopia()` apaga essa cópia se existir). Sem rede, vale o `dados.json` cifrado no cache do service worker.
4. **Não mudar o formato da criptografia sozinho.** `cripto.js` e `fonte.js` têm que bater com `ura_atend.py`:
   - `dados.json`: `{app:"co-ura-atend", v:1, gerado_em, hub:{acessos:{id_hub:{salt, iv, ct}}}, dados:{z, iv, ct}}`;
     `id_hub` = SHA-256 de `"hub:" + MATRÍCULA`; `ct` do acesso = a chave dos dados cifrada com a chave do HUB;
   - `dados` = JSON `{pulse (só a hora aberta), partes:{HH: caminho}, hist:{hk, id, dias:{dia: caminho}, colunas}, aviso}`;
   - `hoje/<id>/<dia>.<HH>.<hash>.json` (uma hora fechada) e `hist/<id>/<dia>.<hash>.json` (um dia):
     `{app, v, …, z, iv, ct}` com a chave do histórico `hk`. Nunca mudam (conteúdo novo = nome novo); alguém saiu do
     app = chave nova = pasta nova;
   - `z: 1` = o conteúdo é gzip antes de cifrar (`DecompressionStream`: Chrome 80+, Safari 16.4+).
   Mudança aqui tem que ser feita **junto** no MAPI.
5. **A credencial do HUB só é LIDA**: nunca apagar, copiar ou criar o banco `co-hub-acesso`.
6. **O service worker só mexe no que é deste app**: caches que começam com `co-ura-atend-` e pedidos dentro de
   `/CO_URA_ATEND/`. `hoje/` e `hist/` vão no cache `co-ura-atend-hist` (cache primeiro, atravessa versões; o
   `fonte.js` apaga dele o que saiu da publicação).
7. **Não carregar nada de fora** (CSP `default-src 'self'`).

## Antes de cada push

1. **Versão igual** em `APP_VERSION` (`app.js`), `VERSAO` (`cripto.js`), `VERSION` (`sw.js`) e nos `?v=` do `index.html`.
2. Arquivo novo que o app usa? Inclua em `CORE` no `sw.js`.
3. `npm test` e teste no navegador em ~390 px, claro e escuro.
4. `git pull` antes do push (o MAPI faz commits a cada publicação). Use merge, não force-push.

## Testar localmente, sem dados reais

```
MAPI_DIR=../mapi5 python tests/gerar_fixture.py            # pessoa A0001 / lago-vento-pedra, tudo inventado
mkdir -p /tmp/site/CO_URA_ATEND && cp -r index.html *.js manifest.webmanifest icons /tmp/site/CO_URA_ATEND/
python - <<'P'
import json, os
fx = json.load(open('tests/fixtures/pacote.json')); b = '/tmp/site/CO_URA_ATEND'
json.dump(fx['pacote'], open(b + '/dados.json', 'w'))
for p, a in fx['arquivos'].items():
    os.makedirs(os.path.dirname(f'{b}/{p}'), exist_ok=True); json.dump(a, open(f'{b}/{p}', 'w'))
P
cd /tmp/site && python -m http.server 8000                  # http://localhost:8000/CO_URA_ATEND/
```

O dia de teste é 03/11/2026 até 10:10: no navegador, simule a data (Playwright `clock.install`). Sem a credencial do HUB
o app mostra "Entre pelo HUB": grave a credencial no IndexedDB (veja `credDoHub()` em `tests/cripto.test.js`).
**Não commite** os arquivos de teste no lugar dos publicados pelo MAPI.

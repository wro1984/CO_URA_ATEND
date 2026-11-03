# CO_URA_ATEND — URA Atendimento

App web instalável no celular (PWA) com o atendimento da URA (Suporte B2C): o **Agora** (Genesys Pulse: em espera, NS,
abandono, TMA, TME, agentes e o dia de hoje em blocos de 15 min) e o **Histórico** (um dia fechado dos últimos 90, do
IPTBM), sempre contra a **média das últimas 7 semanas no mesmo dia da semana**. Recorte Total / CO / TEL, por grupo da
tradutora e, ao abrir o grupo, por skill. Publicado pelo GitHub Pages em <https://wro1984.github.io/CO_URA_ATEND/> a
partir da branch `main`. **Todo push na `main` vai para o ar em cerca de 1 minuto**, para todos os usuários.

**Topo padrão dos apps** (igual nos outros): botão de voltar ao HUB (`#btHub`) à esquerda, botões do app à direita. No
desktop o topo e o menu de baixo ficam na coluna de 760 px do conteúdo.

Leia este arquivo inteiro antes de mudar qualquer coisa.

## Como funciona

```
Genesys Pulse ──► MAPI (pulse.py: leituras) ─┐
IPTBM (Oracle) ──► MAPI (ura_atend.py: 139 dias)┴─► dados.json + hist/<id>/<dia>.<hash>.json CIFRADOS ──► este repo ──► app
                                                     (commit automático do MAPI)                         login do HUB
```

- O repositório e o site são **públicos**. Os números e os nomes das skills só existem aqui **cifrados**.
- Quem gera e publica tudo é o **MAPI** (repositório `wro1984/mapi5`, `ura_atend.py`, ver `URA_ATEND.md` de lá).
- **Não há chave própria**: o app abre com a credencial que o HUB dos apps guardou no IndexedDB `co-hub-acesso` deste
  endereço. Quem vê o app é definido no perfil do HUB (app `ura-atendimento`).

## Regras que não podem ser quebradas

1. **Nunca editar, apagar ou "consertar" o `dados.json` nem a pasta `hist/`.** São sobrescritos pelo MAPI.
2. **Nunca commitar dados abertos nem segredos** (números reais, nomes reais de skills, prints, JSON decifrado, chaves).
   O histórico do git é público. Para testar, use `tests/fixtures/pacote.json` (inventado, gerado com as funções do MAPI).
3. **Não mudar o formato da criptografia sozinho.** `cripto.js` tem que bater com `ura_atend.py`:
   - `dados.json`: `{app:"co-ura-atend", v:1, gerado_em, hub:{acessos:{id_hub:{salt, iv, ct}}}, dados:{iv, ct}}`;
     `id_hub` = SHA-256 de `"hub:" + MATRÍCULA`; `ct` do acesso = a chave dos dados cifrada com a chave do HUB;
   - `dados.ct` = JSON `{agora, hoje, trad, hist:{hk, id, dias:{dia: caminho}}, colunas, desc_ura_s}`;
   - `hist/<id>/<AAAA-MM-DD>.<hash>.json` = `{app, v, dia, iv, ct}` cifrado com a **chave do histórico** `hk`. O arquivo
     de um dia **nunca muda** (conteúdo novo = nome novo); alguém saiu do app = chave nova = pasta nova.
   Mudança aqui tem que ser feita **junto** no MAPI.
4. **A credencial do HUB só é LIDA**: nunca apagar, copiar ou criar o banco `co-hub-acesso`.
5. **O service worker (`sw.js`) só mexe no que é deste app**: caches que começam com `co-ura-atend-` e pedidos dentro de
   `/CO_URA_ATEND/`. `hist/` vai no cache `co-ura-atend-hist` (cache primeiro, atravessa versões).
6. **Não carregar nada de fora** (CSP `default-src 'self'`).
7. Acesso perdido: o app apaga o `dados.json` e os dias do cache.

## Regras das contas (`calc.js`)

- Linha de dia: `[i_horario, i_skill, of, at, ab, a60, a300, se, st, fi, em]`.
- `of…st` somam no tempo e entre skills. `fi` (técnicos na fila no fim do bloco) soma entre skills e, em 30 min / 1 h,
  vale o **último retrato**; no dia inteiro, o **maior**. `em` (espera do mais antigo) é sempre o maior.
- **Qualidade só do CO** (atendidas, NS, abandono, TMA, TME, fila): na TEL toda chamada vem como abandonada e só o volume
  vale. No Total, volume de todos e qualidade do CO.
- NS = atendidas até 300 s ÷ atendidas (sem desconto de abandono curto). TME de hoje vem do Pulse (o Pulse não manda a
  espera somada por bloco).
- Agora (Pulse): agentes não se somam entre filas (o maior); EWT 10000 = sem agente (fica de fora).

## Antes de cada push

1. **Versão igual** em `APP_VERSION` (`app.js`), `VERSAO` (`cripto.js`), `VERSION` (`sw.js`) e nos `?v=` do `index.html`.
2. Arquivo novo que o app usa? Inclua em `CORE` no `sw.js`.
3. `npm test` e teste no navegador em ~390 px, claro e escuro.
4. `git pull` antes do push (o MAPI faz commits). Use merge, não force-push.

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

Sem a credencial do HUB no navegador o app mostra "Entre pelo HUB": sirva o HUB na raiz com um `hub.json` de teste da
mesma pessoa, ou grave a credencial no IndexedDB (veja `credDoHub()` em `tests/cripto.test.js`).

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | estrutura, estilos (paleta da empresa, modo escuro), CSP |
| `app.js` | telas Agora e Histórico, gráfico, grupos e skills, tabela por período; conferência a cada 2 min |
| `calc.js` | contas (blocos, períodos, médias, grupos, agora do Pulse); roda também no Node |
| `cripto.js` | lê a credencial do HUB, abre o `dados.json` e os dias |
| `sw.js` | cache offline só deste app |
| `manifest.webmanifest`, `icons/` | instalação no celular |
| `tests/` | criptografia (pacote do MAPI), contas e versões |
| `dados.json`, `hist/` | **gerados pelo MAPI — não editar** |

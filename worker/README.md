# Dados dos apps (Cloudflare Worker + D1)

Guarda e entrega os arquivos **cifrados** do URA Atendimento (`dados.json`, `hoje/…`, `hist/…`) no lugar do GitHub Pages.
O MAPI envia cada arquivo por um `PUT` e ele vale **na hora**: sem build, sem fila e sem o limite de ~10 publicações por
hora do Pages. O app continua no GitHub Pages (mesmo endereço e mesmo login do HUB) e lê os dados daqui (`config.js`).

O Worker **não abre nada**: devolve o texto exatamente como o MAPI mandou. Quem pode ler continua decidido pela
criptografia do app. Visão geral: `URA_ATEND.md` no repositório do MAPI.

Rotas: `GET /<app>/<caminho>` (app; `dados.json` sem cache, `hist/` e `hoje/` com cache longo) e `/admin/*` (só o MAPI,
com `MAPI_CHAVE`: `ping`, `lista`, `arquivo`, `apagar`).

## Publicar pelo painel da Cloudflare (conta gratuita, sem instalar nada)

Pode ser a mesma conta da caixa de entrada do Problemas Sistêmicos. Este é um **Worker separado**, com banco próprio.

1. **Banco:** *Storage & Databases → D1 → Create database*, nome `dados-dos-apps`. Na aba **Console**, rode o conteúdo de
   `schema.sql` (um comando só).
2. **Worker:** *Compute → Workers & Pages → Create → Hello World*, nome **`ura-atendimento-dados`** (o endereço vira
   `https://ura-atendimento-dados.<subdominio>.workers.dev`). **Edit code**, apague tudo, cole o `src/index.js` e
   **Deploy**. Abrir o endereço deve mostrar `{"servico":"dados-dos-apps","versao":"1.0.0"}`.
3. **Banco no Worker:** *Settings → Bindings → Add → D1 database*, variável **`DB`** (maiúsculas), banco `dados-dos-apps`.
4. **Variáveis** (*Settings → Variables and Secrets*):

   | Nome | Tipo | Valor |
   |---|---|---|
   | `MAPI_CHAVE` | **Secret** | chave longa e **nova** (não reaproveite a da caixa de entrada). PowerShell: `[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")`. Guarde para o `.env` do MAPI |
   | `ORIGENS_PERMITIDAS` | Texto | `https://wro1984.github.io` |
   | `APPS` | Texto | `ura-atendimento` |
5. **Testar a chave** (PowerShell): `Invoke-RestMethod https://<endereco>/admin/ping -Headers @{Authorization="Bearer SUA-CHAVE"}`
   deve voltar `ok: True`.
6. **Ligar no MAPI** (`.env`): `URA_ATEND_DESTINO=cloudflare`, `URA_ATEND_CF_URL=https://<endereco>` e
   `URA_ATEND_CF_CHAVE=<a chave>`. Reinicie o MAPI e use **Publicar agora** (a primeira vez envia os 139 dias).
7. **Ligar no app:** `config.js` com `dados: 'https://<endereco>/ura-atendimento/'` e o mesmo endereço no `connect-src` do
   `index.html` (já vem com `ura-atendimento-dados.wro-1984.workers.dev`; se o nome ou a conta forem outros, mude os dois).

**Voltar para o GitHub:** `URA_ATEND_DESTINO=github` no MAPI e `dados: ''` no `config.js`.

## Limites da conta gratuita (conferir no painel)

- **Chamadas:** cerca de 100 mil por dia, **somando os Workers da conta** (a caixa de entrada também conta). O app
  confere o `dados.json` a cada minuto com a tela aberta; os dias e as horas ficam guardados no aparelho e só os novos são
  baixados. Conta aproximada: pessoas × 60 por hora × horas de tela aberta. Ex.: 50 pessoas × 10 h ≈ 30 mil por dia.
- **Passou do limite:** as chamadas falham até o dia seguinte (o app mostra os últimos dados, cifrados no aparelho). Para
  folgar, a saída é aumentar o intervalo de conferência do app ou passar para o R2.
- **Banco D1:** 5 GB; o URA Atendimento usa poucos MB (139 dias de ~25 KB).

## Testes

`npm test` (Node 22+; usa um SQLite em memória no lugar do D1).

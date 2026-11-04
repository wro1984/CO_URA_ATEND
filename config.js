// Configuração do app (pública). `dados` = endereço dos arquivos cifrados que o MAPI publica (Worker da Cloudflare,
// pasta deste app). Vazio = o próprio site (GitHub Pages), como até a 2.0. Trocou o endereço? Mude também o
// `connect-src` da CSP no index.html (o teste confere) e o URA_ATEND_CF_URL do MAPI.
window.URAA_CONFIG = { dados: 'https://ura-atendimento-dados.wro-1984.workers.dev/ura-atendimento/' };

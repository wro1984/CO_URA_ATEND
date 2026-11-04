CREATE TABLE IF NOT EXISTS arquivos (app TEXT NOT NULL, caminho TEXT NOT NULL, conteudo TEXT NOT NULL, atualizado_em TEXT NOT NULL, PRIMARY KEY (app, caminho));

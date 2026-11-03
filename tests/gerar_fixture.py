"""Gera tests/fixtures/pacote.json com as funções do PRÓPRIO MAPI (ura_atend.py), com dados INVENTADOS.

    MAPI_DIR=/caminho/do/mapi5 python tests/gerar_fixture.py

Pessoa de teste: A0001 / lago-vento-pedra (a mesma do pacote de exemplo do HUB). Skills, grupos e números inventados.
Saída: o dados.json (pacote), os arquivos de dia (hoje é uma terça e há as 7 terças anteriores) e o conteúdo esperado.
"""
import base64
import json
import os
import random
import sys
from datetime import date, timedelta

sys.path.insert(0, os.environ["MAPI_DIR"])
import hub  # noqa: E402
import ura_atend  # noqa: E402

random.seed(7)
MAT, CHAVE = "A0001", "lago-vento-pedra"
salt = os.urandom(16)
pessoa = {"matricula": MAT, "salt": salt, "chave": hub.chave_do_codigo(CHAVE, salt), "push_secret": None}
SK = {"VQ_EXEMPLO_FIBRA_V1@SW_TESTE": ["FIBRA", "CO"], "VQ_EXEMPLO_FIBRA_V2@SW_TESTE": ["FIBRA", "CO"],
      "VQ_EXEMPLO_VOIP_V1@SW_TESTE": ["VOIP", "CO"], "VQ_EXEMPLO_TV_V1@SW_TESTE": ["TV", "CO"],
      "VQ_EXEMPLO_FIBRA_TEL@SW_TESTE": ["FIBRA", "TEL"]}
sk = {"todas": sorted(SK), "co": [s for s, a in SK.items() if a[1] == "CO"], "attrs": SK,
      "coluna_grupo": "SKILL_GRUPO", "coluna_direcao": "DIRECIONAMENTO"}
HOJE = date(2026, 11, 3)                       # terça


def linhas_do_dia(d, ate=None, fator=1.0):
    out = []
    for h in range(7, 22):
        for m in (0, 15, 30, 45):
            if ate and (h, m) >= ate:
                continue
            pico = 1 + (2 if 9 <= h <= 11 or 14 <= h <= 16 else 0)
            for s, (g, dr) in SK.items():
                of = max(0, int(random.gauss(4 * pico * fator, 2)))
                if not of:
                    continue
                if dr == "TEL":
                    out.append((f"{h:02d}:{m:02d}", s, of, 0, of, 0, 0, 0, 0, 0, 0))
                    continue
                at = max(0, of - random.randint(0, 2)); a300 = max(0, at - random.randint(0, 1))
                out.append((f"{h:02d}:{m:02d}", s, of, at, of - at, max(0, a300 - 1), a300, at * random.randint(20, 90),
                            at * random.randint(400, 700), random.randint(0, 4), random.randint(0, 300)))
    return out


dias = {}
for k in range(1, 8):
    d = HOJE - timedelta(days=7 * k)
    dias[d.isoformat()] = linhas_do_dia(d, fator=random.uniform(0.85, 1.1))
ontem = HOJE - timedelta(days=1)
dias[ontem.isoformat()] = linhas_do_dia(ontem)

hk = bytes(range(32))
hk_id = "a1b2c3d4"
desejados = {d: ura_atend.caminho_dia(hk_id, d, ura_atend.assinatura_dia(ls)) for d, ls in dias.items()}
arquivos = {desejados[d]: ura_atend.arquivo_dia(hk, d, ls) for d, ls in dias.items()}
hoje_linhas = [l for l in linhas_do_dia(HOJE, ate=(10, 30))]
hoje_linhas = [l[:7] + (None,) + l[8:] for l in hoje_linhas]          # hoje (Pulse): sem a espera somada
agora = {"em": "2026-11-03T10:31:00-03:00", "pulse_em": "2026-11-03T10:30:52",
         "c": ["espera", "mais_antiga", "logados", "disponiveis", "oferecidas", "atendidas", "abandono", "at60", "at300",
               "tma", "tme", "ewt"],
         "l": [[s, 3 if a[1] == "CO" else 0, 95 if a[1] == "CO" else 0, 12, 2, 150, 140 if a[1] == "CO" else 0,
                10 if a[1] == "CO" else 150, 120, 135 if a[1] == "CO" else 0, 520, 45, 60 if a[1] == "CO" else 10000]
               for s, a in SK.items()]}
online = {"agora": agora, "hoje": ura_atend.compactar(HOJE.isoformat(), hoje_linhas), "aviso": None}
conteudo = ura_atend.montar_conteudo(online, sk, hk, hk_id, desejados)
pacote = ura_atend.montar_pacote(conteudo, [pessoa])
esperado = json.loads(json.dumps(conteudo))
esperado["hist"].pop("hk")
saida = {"hub": {"matricula": MAT, "chave": CHAVE, "salt": base64.b64encode(salt).decode(), "iter": hub.ITERACOES},
         "pacote": pacote, "arquivos": arquivos, "esperado": esperado, "hk": base64.b64encode(hk).decode()}
aqui = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(aqui, "fixtures", "pacote.json"), "w", encoding="utf-8") as f:
    json.dump(saida, f, ensure_ascii=False)
print("gravado: tests/fixtures/pacote.json")

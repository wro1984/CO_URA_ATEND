"""Gera tests/fixtures/pacote.json com as funções do PRÓPRIO MAPI (ura_atend.py), com dados INVENTADOS.

    MAPI_DIR=/caminho/do/mapi5 python tests/gerar_fixture.py

Pessoa de teste: A0001 / lago-vento-pedra (a mesma do pacote de exemplo do HUB). Skills, grupos e números inventados.
Saída: o dados.json (pacote), os arquivos de hora fechada (hoje/…) e de dia (hist/…: hoje é uma terça, com as 7
terças anteriores e o dia de ontem), o conteúdo esperado e o pulse.json esperado (horas fechadas + hora aberta).
"""
import base64
import json
import os
import random
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.environ["MAPI_DIR"])
import hub  # noqa: E402
import ura_atend  # noqa: E402

random.seed(7)
MAT, CHAVE = "A0001", "lago-vento-pedra"
salt = os.urandom(16)
pessoa = {"matricula": MAT, "salt": salt, "chave": hub.chave_do_codigo(CHAVE, salt), "push_secret": None}
SK = {"VQ_COE_EXEMPLO_FIBRA_V1@SW_TESTE": ("FIBRA", "CO"), "VQ_COE_EXEMPLO_FIBRA_V2@SW_TESTE": ("FIBRA", "CO"),
      "VQ_COE_EXEMPLO_VOIP_V1@SW_TESTE": ("VOIP", "CO"), "VQ_COE_EXEMPLO_TV_V1@SW_TESTE": ("TV", "CO"),
      "VQ_COE_EXEMPLO_FIBRA_TEL@SW_TESTE": ("FIBRA", "TEL")}
HOJE = date(2026, 11, 3)                       # terça
METRICAS = [("Current_Calls", "Chamadas em Espera", "integer"), ("Curr_Max_Wait_Time", "Chamada Mais Antiga", "time"),
            ("Current_Logged_In", "Agentes Logados", "integer"), ("Current_Ready", "Agentes Disponíveis", "integer"),
            ("Distinct_Entered", "Oferecidas", "integer"), ("Answered", "Atendidas", "integer"),
            ("Average_Handle_Time", "TMA", "time"), ("Average_Wait_Time", "TME", "time"), ("EWT", "EWT", "time"),
            ("Answered_less_60s", "Atendidas < 60s", "integer"), ("Answered_less_300s", "Atendidas < 300s", "integer"),
            ("Abandoned", "Abandono", "integer")]


def linhas_do_dia(fator=1.0):
    out = []
    for h in range(7, 22):
        for m in (0, 15, 30, 45):
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
    dias[(HOJE - timedelta(days=7 * k)).isoformat()] = linhas_do_dia(random.uniform(0.85, 1.1))
dias[(HOJE - timedelta(days=1)).isoformat()] = linhas_do_dia()

# hoje no formato do Exportar JSON do Pulse: acumulados do dia, horas fechadas de 15 em 15, a hora aberta de 5 em 5
acum = {s: [0] * len(METRICAS) for s in SK}
leituras = []
marcas = [(h, m) for h in range(7, 10) for m in (0, 15, 30, 45)] + [(10, 0), (10, 5), (10, 10)]
for h, m in marcas:
    for s, (g, dr) in SK.items():
        v = acum[s]
        of = random.randint(2, 9)
        v[4] += of
        if dr == "CO":
            at = of - random.randint(0, 1)
            v[5] += at; v[9] += max(0, at - 1); v[10] += at; v[11] += of - at
            v[0], v[1], v[2], v[3] = random.randint(0, 3), random.randint(0, 200), 12, random.randint(0, 3)
            v[6], v[7], v[8] = random.randint(450, 600), random.randint(20, 80), random.randint(10, 90)
        else:
            v[11] += of; v[8] = 10000
    leituras.append({"horario": f"{h:02d}:{m:02d}", "coletado_em": f"{HOJE.isoformat()} {h:02d}:{m:02d}:0{random.randint(1, 9)}",
                     "origem": "auto", "valores": {s: list(v) for s, v in acum.items()}})
pulse_dia = {"dia": HOJE.isoformat(), "guid": "00000000-0000-0000-0000-000000000000",
             "metricas": [{"id": i, "label": l, "formato": f} for i, l, f in METRICAS],
             "colunas_tradutora": ["SKILL_GRUPO", "DIRECIONAMENTO"],
             "skills": {s: {"SKILL_GRUPO": g, "DIRECIONAMENTO": d} for s, (g, d) in SK.items()}, "leituras": leituras}
aberta, fechadas = ura_atend.separar_horas(pulse_dia, datetime(2026, 11, 3, 10, 12).astimezone())

hk, hk_id = bytes(range(32)), "a1b2c3d4"
cam_dias = {d: ura_atend.caminho_dia(hk_id, d, ura_atend.assinatura_dia(ls)) for d, ls in dias.items()}
partes = {hh: ura_atend.caminho_parte(hk_id, HOJE.isoformat(), hh, ura_atend.assinatura_obj(ls)) for hh, ls in fechadas.items()}
arquivos = {cam_dias[d]: ura_atend.arquivo_dia(hk, d, ls) for d, ls in dias.items()}
arquivos.update({partes[hh]: ura_atend.arquivo_parte(hk, HOJE.isoformat(), hh, ls) for hh, ls in fechadas.items()})
conteudo = ura_atend.montar_conteudo(aberta, partes, hk, hk_id, cam_dias)
pacote = ura_atend.montar_pacote(conteudo, [pessoa])
esperado = json.loads(json.dumps(conteudo))
esperado["hist"].pop("hk")
saida = {"hub": {"matricula": MAT, "chave": CHAVE, "salt": base64.b64encode(salt).decode(), "iter": hub.ITERACOES},
         "pacote": pacote, "arquivos": arquivos, "esperado": esperado, "pulse": pulse_dia,
         "historico_linhas": sum(len(ls) for ls in dias.values()), "hk": base64.b64encode(hk).decode()}
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "pacote.json"), "w", encoding="utf-8") as f:
    json.dump(saida, f, ensure_ascii=False)
print("gravado: tests/fixtures/pacote.json")

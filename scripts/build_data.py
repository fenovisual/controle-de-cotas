#!/usr/bin/env python3
"""
build_data.py — Converte os relatórios exportados do Sankhya no JSON que
alimenta o site de Controle de Cota.

Cada cliente pode ter cota de FENO, de PRÉ-SECADO, ou as duas — cada uma é
controlada separadamente, com extrato próprio.

Uso:
    python3 scripts/build_data.py \
        --cota data/raw/Cota_de_Compra_Por_Cliente.xlsx \
        --vendas data/raw/Relacao_Produto_Parceiro.xlsx \
        --produto data/raw/Produto.xlsx

Fluxo diário esperado:
    1. Baixar o relatório de vendas do Sankhya e salvar por cima do arquivo
       em data/raw/Relacao_Produto_Parceiro.xlsx
    2. Rodar este script
    3. git add, commit, push -> o GitHub Pages atualiza sozinho

Quando o mês vira (nova cota mensal):
    1. Substituir data/raw/Cota_de_Compra_Por_Cliente.xlsx pela cota do novo mês
       (com a coluna TIPO DA COTA preenchida: FENO ou PRÉ-SECADO)
    2. Zerar/substituir o relatório de vendas pelo do novo mês
    3. Rodar o script normalmente — ele detecta o mês pelas datas de venda e
       cria automaticamente um novo arquivo em data/history/, sem apagar os
       meses anteriores.

Sobre o arquivo Produto.xlsx:
    Mapeia cada código de produto vendido para sua categoria (FENO,
    PRÉ-SECADO, ou outras como MUDAS). Vendas de produtos fora de
    FENO/PRÉ-SECADO (mudas, gado etc.) são ignoradas no cálculo de cota.
    Só precisa ser atualizado se um produto novo for cadastrado no Sankhya.
"""

import argparse
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
HISTORY_DIR = DATA_DIR / "history"

CATEGORIAS_COTA = {"FENO", "PRÉ-SECADO"}

# Enquanto a planilha de cota não estiver completa para todo mundo, todo
# cliente é considerado como tendo essa cota padrão de Pré-secado até que
# uma linha explícita na planilha substitua esse valor.
COTA_PRESECADO_PADRAO_KG = 50_000


def carregar_cota(caminho: Path) -> pd.DataFrame:
    df = pd.read_excel(caminho, sheet_name=0)
    # Nomes de coluna no arquivo do Sankhya podem variar; usamos posição.
    df = df.iloc[:, :4]
    df.columns = ["codigo", "nome", "cota_kg", "categoria"]
    df["codigo"] = pd.to_numeric(df["codigo"], errors="coerce")
    df = df.dropna(subset=["codigo"])
    df["codigo"] = df["codigo"].astype(int)
    df["nome"] = df["nome"].astype(str).str.strip()
    df["cota_kg"] = pd.to_numeric(df["cota_kg"], errors="coerce").fillna(0)
    df["categoria"] = df["categoria"].astype(str).str.strip().str.upper()
    df["cota_padrao"] = False
    return df


def preencher_cota_presecado_padrao(cota: pd.DataFrame) -> pd.DataFrame:
    """Todo cliente que aparece na planilha de cota (em qualquer categoria)
    mas ainda não tem uma linha de PRÉ-SECADO recebe a cota padrão, até que
    a planilha seja atualizada com o valor real dele."""
    clientes = cota[["codigo", "nome"]].drop_duplicates(subset="codigo")
    tem_presecado = set(cota.loc[cota["categoria"] == "PRÉ-SECADO", "codigo"])
    faltantes = clientes[~clientes["codigo"].isin(tem_presecado)].copy()

    if faltantes.empty:
        return cota

    faltantes["cota_kg"] = COTA_PRESECADO_PADRAO_KG
    faltantes["categoria"] = "PRÉ-SECADO"
    faltantes["cota_padrao"] = True
    print(f"Aviso: {len(faltantes)} cliente(s) sem linha de PRÉ-SECADO na planilha — "
          f"assumindo cota padrão de {COTA_PRESECADO_PADRAO_KG:,.0f} kg até a planilha ser atualizada.".replace(",", "."))
    return pd.concat([cota, faltantes], ignore_index=True)


def carregar_produto(caminho: Path) -> dict:
    df = pd.read_excel(caminho, sheet_name=0)
    df = df.iloc[:, [0, 5]]
    df.columns = ["produto_codigo", "categoria"]
    df["produto_codigo"] = pd.to_numeric(df["produto_codigo"], errors="coerce")
    df = df.dropna(subset=["produto_codigo"])
    df["produto_codigo"] = df["produto_codigo"].astype(int)
    df["categoria"] = df["categoria"].astype(str).str.strip().str.upper()
    return dict(zip(df["produto_codigo"], df["categoria"]))


def carregar_vendas(caminho: Path, produto_por_codigo: dict) -> pd.DataFrame:
    # As duas primeiras linhas do relatório são título/metadados; o
    # cabeçalho real está na linha 3.
    df = pd.read_excel(caminho, sheet_name=0, skiprows=2)
    df = df.rename(columns={
        "Parceiro": "codigo",
        "Nome Parceiro": "nome",
        "Produto": "produto_codigo",
        "Quantidade": "quantidade_kg",
        "Apelido Vendedor": "representante",
        "Negociação": "data_negociacao",
    })
    df = df.dropna(subset=["codigo"])
    df["codigo"] = df["codigo"].astype(int)
    df["quantidade_kg"] = pd.to_numeric(df["quantidade_kg"], errors="coerce").fillna(0)
    df["representante"] = df["representante"].astype(str).str.strip()

    df["produto_codigo"] = pd.to_numeric(df["produto_codigo"], errors="coerce")
    df["categoria"] = df["produto_codigo"].map(produto_por_codigo)

    # Avisa sobre produtos vendidos que não batem com FENO/PRÉ-SECADO
    # (mudas, gado, produtos não cadastrados etc.) — essas linhas são
    # excluídas do cálculo de cota.
    fora_do_escopo = df[~df["categoria"].isin(CATEGORIAS_COTA)]
    if len(fora_do_escopo):
        nao_cadastrados = sorted(
            fora_do_escopo.loc[fora_do_escopo["categoria"].isna(), "produto_codigo"]
            .dropna().unique().tolist()
        )
        outras_categorias = sorted(
            fora_do_escopo.loc[fora_do_escopo["categoria"].notna(), "categoria"]
            .unique().tolist()
        )
        print(f"Aviso: {len(fora_do_escopo)} linha(s) de venda fora do escopo "
              f"de FENO/PRÉ-SECADO foram ignoradas.")
        if outras_categorias:
            print(f"  Categorias ignoradas: {', '.join(outras_categorias)}")
        if nao_cadastrados:
            print(f"  Códigos de produto sem cadastro em Produto.xlsx: {nao_cadastrados}")

    df = df[df["categoria"].isin(CATEGORIAS_COTA)].copy()
    return df


def detectar_mes(vendas: pd.DataFrame) -> str:
    if "data_negociacao" in vendas.columns and vendas["data_negociacao"].notna().any():
        data_max = pd.to_datetime(vendas["data_negociacao"]).max()
        return data_max.strftime("%Y-%m")
    return datetime.now().strftime("%Y-%m")


def montar_json(cota: pd.DataFrame, vendas: pd.DataFrame, mes: str) -> dict:
    consumo = vendas.groupby(["codigo", "categoria"]).agg(
        consumido_kg=("quantidade_kg", "sum"),
    ).reset_index()

    # Representante de cada cliente = o vendedor mais recorrente nas vendas
    # dele (independente da categoria — é o mesmo representante para o
    # cliente todo).
    rep_por_cliente = (
        vendas.groupby(["codigo", "representante"])
        .size()
        .reset_index(name="qtd")
        .sort_values("qtd", ascending=False)
        .drop_duplicates("codigo")
        .set_index("codigo")["representante"]
    )

    base = cota.merge(consumo, on=["codigo", "categoria"], how="left")
    base["consumido_kg"] = base["consumido_kg"].fillna(0)
    base["representante"] = base["codigo"].map(rep_por_cliente).fillna("Sem vendas no mês")
    base["saldo_kg"] = (base["cota_kg"] - base["consumido_kg"]).round(2)
    base["percentual"] = base.apply(
        lambda r: round((r["consumido_kg"] / r["cota_kg"]) * 100, 1) if r["cota_kg"] > 0 else 0,
        axis=1,
    )

    # Extrato por cliente+categoria: saldo inicial (cota) -> saldo após cada
    # compra daquela categoria, em ordem cronológica.
    vendas_ordenadas = vendas.dropna(subset=["codigo"]).copy()
    tem_data = "data_negociacao" in vendas_ordenadas.columns
    if tem_data:
        vendas_ordenadas["data_negociacao"] = pd.to_datetime(
            vendas_ordenadas["data_negociacao"], errors="coerce"
        )
        vendas_ordenadas = vendas_ordenadas.sort_values(["codigo", "categoria", "data_negociacao"])
    else:
        vendas_ordenadas = vendas_ordenadas.sort_values(["codigo", "categoria"])

    cota_por_chave = base.set_index(["codigo", "categoria"])["cota_kg"].to_dict()
    extrato_por_chave = {}
    for (codigo, categoria), grupo in vendas_ordenadas.groupby(["codigo", "categoria"]):
        saldo = cota_por_chave.get((codigo, categoria), 0)
        transacoes = []
        for _, linha in grupo.iterrows():
            saldo_antes = saldo
            quantidade = float(linha["quantidade_kg"])
            dentro_kg = max(min(saldo_antes, quantidade), 0)
            fora_kg = round(quantidade - dentro_kg, 2)
            dentro_kg = round(dentro_kg, 2)
            saldo = round(saldo - quantidade, 2)
            data_fmt = (
                linha["data_negociacao"].strftime("%d/%m/%Y")
                if tem_data and pd.notna(linha["data_negociacao"])
                else None
            )
            transacoes.append({
                "data": data_fmt,
                "quantidade_kg": round(quantidade, 2),
                "dentro_cota_kg": dentro_kg,
                "fora_cota_kg": fora_kg,
                "saldo_apos_kg": saldo,
            })
        extrato_por_chave[(codigo, categoria)] = transacoes

    linhas_categoria = base.sort_values("percentual", ascending=False).to_dict("records")
    for c in linhas_categoria:
        c["cota_kg"] = round(float(c["cota_kg"]), 2)
        c["consumido_kg"] = round(float(c["consumido_kg"]), 2)
        c["transacoes"] = extrato_por_chave.get((c["codigo"], c["categoria"]), [])
        c["cota_padrao"] = bool(c.get("cota_padrao", False))

    # Consolida as linhas por categoria em uma linha por cliente, com FENO e
    # PRÉ-SECADO como sub-blocos dentro da mesma linha.
    chave_por_categoria = {"FENO": "feno", "PRÉ-SECADO": "presecado"}
    clientes_por_codigo = {}
    for c in linhas_categoria:
        codigo = c["codigo"]
        if codigo not in clientes_por_codigo:
            clientes_por_codigo[codigo] = {
                "codigo": codigo,
                "nome": c["nome"],
                "representante": c["representante"],
                "feno": None,
                "presecado": None,
            }
        chave = chave_por_categoria.get(c["categoria"])
        if chave:
            clientes_por_codigo[codigo][chave] = {
                "cota_kg": c["cota_kg"],
                "consumido_kg": c["consumido_kg"],
                "saldo_kg": c["saldo_kg"],
                "percentual": c["percentual"],
                "cota_padrao": c["cota_padrao"],
                "transacoes": c["transacoes"],
            }

    def pior_percentual(c):
        valores = [b["percentual"] for b in (c["feno"], c["presecado"]) if b is not None]
        return max(valores) if valores else 0

    clientes = sorted(clientes_por_codigo.values(), key=pior_percentual, reverse=True)

    representantes = sorted(base["representante"].unique().tolist())
    categorias = sorted(base["categoria"].unique().tolist())

    return {
        "mes": mes,
        "gerado_em": datetime.now(timezone.utc).isoformat(),
        "representantes": representantes,
        "categorias": categorias,
        "clientes": clientes,
    }


def atualizar_indice_historico():
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    meses = sorted(p.stem for p in HISTORY_DIR.glob("*.json") if p.stem != "index")
    (HISTORY_DIR / "index.json").write_text(
        json.dumps({"meses": meses}, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def tratar_clientes_sem_cota(cota: pd.DataFrame, vendas: pd.DataFrame) -> pd.DataFrame:
    """Clientes que compraram mas não têm NENHUMA linha na planilha de cota
    (nem Feno, nem Pré-secado) — geralmente clientes novos ainda não
    cadastrados. Para quem só comprou Pré-secado, aplicamos a cota padrão
    (mesma regra dos demais). Para quem comprou Feno sem ter cota
    cadastrada, não inventamos um valor — só avisamos no terminal para
    revisão manual (pode ser cliente novo ou código duplicado no Sankhya)."""
    clientes_cota = set(cota["codigo"])
    clientes_venda = (
        vendas[["codigo", "nome", "categoria"]]
        .drop_duplicates(subset=["codigo", "categoria"])
    )
    orfaos = clientes_venda[~clientes_venda["codigo"].isin(clientes_cota)]

    if orfaos.empty:
        return cota

    orfaos_presecado = orfaos[orfaos["categoria"] == "PRÉ-SECADO"].copy()
    orfaos_feno = orfaos[orfaos["categoria"] == "FENO"]

    if not orfaos_presecado.empty:
        orfaos_presecado["cota_kg"] = COTA_PRESECADO_PADRAO_KG
        orfaos_presecado["cota_padrao"] = True
        orfaos_presecado = orfaos_presecado[["codigo", "nome", "cota_kg", "categoria", "cota_padrao"]]
        print(f"Aviso: {len(orfaos_presecado)} cliente(s) compraram Pré-secado sem estar "
              f"na planilha de cota — incluídos com a cota padrão de "
              f"{COTA_PRESECADO_PADRAO_KG:,.0f} kg.".replace(",", "."))
        cota = pd.concat([cota, orfaos_presecado], ignore_index=True)

    if not orfaos_feno.empty:
        nomes = ", ".join(f"{r.nome} (#{r.codigo})" for r in orfaos_feno.itertuples())
        print(f"ATENÇÃO: {len(orfaos_feno)} cliente(s) compraram Feno mas não têm "
              f"NENHUMA cota cadastrada — não aparecem no site até serem revisados "
              f"e cadastrados na planilha (pode ser cliente novo ou código duplicado):")
        print(f"  {nomes}")

    return cota


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cota", required=True, type=Path)
    parser.add_argument("--vendas", required=True, type=Path)
    parser.add_argument("--produto", required=True, type=Path)
    args = parser.parse_args()

    if not args.cota.exists():
        sys.exit(f"Arquivo de cota não encontrado: {args.cota}")
    if not args.vendas.exists():
        sys.exit(f"Arquivo de vendas não encontrado: {args.vendas}")
    if not args.produto.exists():
        sys.exit(f"Arquivo de produto não encontrado: {args.produto}")

    produto_por_codigo = carregar_produto(args.produto)
    cota = carregar_cota(args.cota)
    vendas = carregar_vendas(args.vendas, produto_por_codigo)
    cota = tratar_clientes_sem_cota(cota, vendas)
    cota = preencher_cota_presecado_padrao(cota)
    mes = detectar_mes(vendas)

    resultado = montar_json(cota, vendas, mes)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)

    (DATA_DIR / "current.json").write_text(
        json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (HISTORY_DIR / f"{mes}.json").write_text(
        json.dumps(resultado, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    atualizar_indice_historico()

    print(f"OK — mês {mes}: {len(resultado['clientes'])} clientes, "
          f"{len(resultado['representantes'])} representantes, "
          f"categorias: {', '.join(resultado['categorias'])}.")
    print(f"Gerado: data/current.json e data/history/{mes}.json")


if __name__ == "__main__":
    main()

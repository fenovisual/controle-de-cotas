# Controle de Cota — Feno Visual

Site estático para os representantes acompanharem, pelo celular ou PC, o
consumo da cota de compra de cada cliente — separado por **Feno** e
**Pré-secado**.

## Estrutura

```
cota-site/
├── index.html          site
├── style.css
├── app.js
├── data/
│   ├── raw/             coloque aqui os arquivos baixados do Sankhya
│   │   ├── Cota_de_Compra_Por_Cliente.xlsx   (cota por cliente + categoria)
│   │   ├── Relacao_Produto_Parceiro.xlsx     (vendas do período)
│   │   └── Produto.xlsx                      (produto -> categoria)
│   ├── current.json      gerado automaticamente (mês corrente)
│   └── history/          um .json por mês, gerado automaticamente
│       ├── index.json
│       └── 2026-07.json
└── scripts/
    └── build_data.py    script de conversão
```

## Uso diário

1. No Sankhya, exporte o relatório de vendas e salve por cima de
   `data/raw/Relacao_Produto_Parceiro.xlsx`.
2. Rode:
   ```bash
   python3 scripts/build_data.py \
     --cota data/raw/Cota_de_Compra_Por_Cliente.xlsx \
     --vendas data/raw/Relacao_Produto_Parceiro.xlsx \
     --produto data/raw/Produto.xlsx
   ```
3. Confira que o terminal mostrou `OK — mês ...` com o número de linhas
   esperado. Se aparecer um aviso sobre "produto(s) fora do escopo", vale
   dar uma olhada — normalmente é venda de outra linha (mudas, gado) ou
   produto novo ainda sem categoria em `Produto.xlsx`.
4. `git add . && git commit -m "Atualiza cota do dia" && git push`
5. Em 1–2 minutos o GitHub Pages já reflete os dados novos — não precisa
   fazer mais nada.

## Sobre o arquivo Produto.xlsx

Mapeia cada código de produto vendido para sua categoria (FENO,
PRÉ-SECADO, ou outras como MUDAS). Só precisa ser atualizado quando um
produto novo for cadastrado no Sankhya — não muda todo dia. Vendas de
produtos fora de FENO/PRÉ-SECADO são automaticamente ignoradas no
cálculo de cota (não entram no "comprado" nem no extrato).

## Quando o mês vira

1. Substitua `data/raw/Cota_de_Compra_Por_Cliente.xlsx` pela cota do novo
   mês (mantendo a coluna `TIPO DA COTA` com FENO ou PRÉ-SECADO em cada
   linha).
2. Substitua `data/raw/Relacao_Produto_Parceiro.xlsx` pelo relatório de
   vendas já zerado para o novo mês.
3. Rode o mesmo comando do passo a passo diário. O script detecta o mês
   pelas datas das vendas e cria um novo arquivo em `data/history/`
   automaticamente — os meses anteriores continuam acessíveis no seletor
   "Período" do site, sem precisar apagar nada.

## Publicar no GitHub Pages (primeira vez)

1. Crie um repositório no GitHub (pode ser privado, se preferir) e suba
   esta pasta inteira.
2. Em **Settings → Pages**, em "Source" escolha a branch `main` e a pasta
   `/ (root)`.
3. Aguarde alguns minutos — o GitHub mostra o link do site em
   **Settings → Pages** (algo como
   `https://seu-usuario.github.io/nome-do-repo/`).
4. Envie esse link para os representantes. A tela já abre com os botões de
   nome — cada um clica no próprio nome e vê só os clientes dele.

## Observações

- Um cliente com cota de Feno **e** Pré-secado aparece como duas linhas
  na tabela, cada uma com sua etiqueta, seu extrato e seu saldo
  independente — filtre por categoria (Feno / Pré-secado / Todos) para
  focar em uma delas.
- Clientes sem nenhuma venda registrada no mês, numa categoria, aparecem
  no grupo **"Sem vendas no mês"** até a primeira compra ser lançada no
  Sankhya.
- O percentual pode passar de 100% — isso é esperado quando o cliente
  compra acima da cota; a linha fica destacada em vermelho nesse caso.
- Os dados não são sensíveis, então o filtro por representante é só um
  filtro visual (sem senha) — qualquer pessoa com o link vê todos os
  clientes se quiser, mas o fluxo normal é cada um clicar no próprio nome.

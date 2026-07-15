const state = {
  data: null,
  repAtivo: null,
  busca: "",
  ordenacao: "percentual-desc",
  expandidos: new Set(),
};

const el = {
  monthSelect: document.getElementById("month-select"),
  repList: document.getElementById("rep-list"),
  search: document.getElementById("search"),
  searchClear: document.getElementById("search-clear"),
  sortSelect: document.getElementById("sort-select"),
  tbody: document.getElementById("client-tbody"),
  emptyState: document.getElementById("empty-state"),
  generatedAt: document.getElementById("generated-at"),
};

async function init() {
  ajustarAlturaTopbar();
  window.addEventListener("resize", ajustarAlturaTopbar);
  observarAlturasFixas();

  // Fontes web carregam de forma assíncrona e podem mudar a altura dos
  // blocos fixos depois da primeira medição — recalcula quando estiverem prontas.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(ajustarAlturaTopbar);
  }

  const meses = await carregarIndiceMeses();
  preencherSeletorMeses(meses);

  el.monthSelect.addEventListener("change", () => carregarMes(el.monthSelect.value));
  el.search.addEventListener("input", (e) => {
    state.busca = e.target.value.trim().toLowerCase();
    el.searchClear.hidden = e.target.value.length === 0;
    render();
  });
  el.searchClear.addEventListener("click", () => {
    el.search.value = "";
    state.busca = "";
    el.searchClear.hidden = true;
    el.search.focus();
    render();
  });
  el.sortSelect.addEventListener("change", (e) => {
    state.ordenacao = e.target.value;
    render();
  });

  const mesAtual = meses.length ? meses[meses.length - 1] : null;
  await carregarMes(mesAtual);
}

function ajustarAlturaTopbar() {
  const topbar = document.querySelector(".topbar");
  const reps = document.querySelector(".reps");
  const controls = document.querySelector(".controls");
  if (topbar) {
    document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
  }
  if (reps) {
    document.documentElement.style.setProperty("--reps-h", `${reps.offsetHeight}px`);
  }
  if (controls) {
    document.documentElement.style.setProperty("--controls-h", `${controls.offsetHeight}px`);
  }
}

let resizeObserverFixo = null;
function observarAlturasFixas() {
  if (typeof ResizeObserver === "undefined") return;
  if (resizeObserverFixo) resizeObserverFixo.disconnect();
  resizeObserverFixo = new ResizeObserver(() => ajustarAlturaTopbar());
  [".topbar", ".reps", ".controls"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) resizeObserverFixo.observe(el);
  });
}

async function carregarIndiceMeses() {
  try {
    const res = await fetch("data/history/index.json", { cache: "no-store" });
    if (!res.ok) return [];
    const json = await res.json();
    return json.meses || [];
  } catch {
    return [];
  }
}

function preencherSeletorMeses(meses) {
  el.monthSelect.innerHTML = "";
  if (!meses.length) {
    const opt = document.createElement("option");
    opt.textContent = "Atual";
    opt.value = "";
    el.monthSelect.appendChild(opt);
    return;
  }
  meses.forEach((mes) => {
    const opt = document.createElement("option");
    opt.value = mes;
    opt.textContent = formatarMes(mes);
    el.monthSelect.appendChild(opt);
  });
  el.monthSelect.value = meses[meses.length - 1];
}

function formatarMes(mesISO) {
  const [ano, mes] = mesISO.split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[parseInt(mes, 10) - 1]}/${ano.slice(2)}`;
}

async function carregarMes(mes) {
  const caminho = mes ? `data/history/${mes}.json` : "data/current.json";
  const res = await fetch(caminho, { cache: "no-store" });
  state.data = await res.json();
  state.repAtivo = null;
  state.expandidos = new Set();
  render();
}

function render() {
  atualizarRodape();
  renderReps();
  renderTable();
  ajustarAlturaTopbar();
}

function atualizarRodape() {
  el.generatedAt.textContent = new Date(state.data.gerado_em).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function renderReps() {
  const { representantes } = state.data;
  el.repList.innerHTML = "";
  el.repList.appendChild(criarBotaoRep("Todos", null));
  representantes.forEach((rep) => el.repList.appendChild(criarBotaoRep(rep, rep)));
}

function criarBotaoRep(label, valor) {
  const btn = document.createElement("button");
  btn.className = "rep-btn" + (state.repAtivo === valor ? " is-active" : "");
  btn.textContent = label;
  btn.addEventListener("click", () => {
    state.repAtivo = valor;
    render();
  });
  return btn;
}

function renderTable() {
  let lista = state.data.clientes.slice();

  if (state.repAtivo) {
    lista = lista.filter((c) => c.representante === state.repAtivo);
  }
  if (state.busca) {
    lista = lista.filter(
      (c) =>
        c.nome.toLowerCase().includes(state.busca) ||
        String(c.codigo).includes(state.busca)
    );
  }

  lista = ordenar(lista, state.ordenacao);

  el.tbody.innerHTML = "";
  el.emptyState.hidden = lista.length > 0;

  lista.forEach((c, index) => {
    criarLinhasCliente(c, index).forEach((tr) => el.tbody.appendChild(tr));
    el.tbody.appendChild(criarLinhaExtrato(c, index));
  });
}

// Para ordenação por categoria: clientes sem cota naquela categoria vão
// sempre para o fim da lista, independente da direção escolhida.
function valorOrdenacao(c, categoria, campo) {
  const bloco = c[categoria];
  if (!bloco) return null;
  return bloco[campo];
}

function ordenar(lista, criterio) {
  const copia = lista.slice();
  const semValorPorUltimo = (a, b, valA, valB, asc) => {
    if (valA === null && valB === null) return 0;
    if (valA === null) return 1;
    if (valB === null) return -1;
    return asc ? valA - valB : valB - valA;
  };

  switch (criterio) {
    case "percentual-asc":
      return copia.sort((a, b) => semValorPorUltimo(a, b, valorOrdenacao(a, "feno", "percentual"), valorOrdenacao(b, "feno", "percentual"), true));
    case "saldo-asc":
      return copia.sort((a, b) => semValorPorUltimo(a, b, valorOrdenacao(a, "feno", "saldo_kg"), valorOrdenacao(b, "feno", "saldo_kg"), true));
    case "percentual-desc-presecado":
      return copia.sort((a, b) => semValorPorUltimo(a, b, valorOrdenacao(a, "presecado", "percentual"), valorOrdenacao(b, "presecado", "percentual"), false));
    case "percentual-asc-presecado":
      return copia.sort((a, b) => semValorPorUltimo(a, b, valorOrdenacao(a, "presecado", "percentual"), valorOrdenacao(b, "presecado", "percentual"), true));
    case "saldo-asc-presecado":
      return copia.sort((a, b) => semValorPorUltimo(a, b, valorOrdenacao(a, "presecado", "saldo_kg"), valorOrdenacao(b, "presecado", "saldo_kg"), true));
    case "nome-asc":
      return copia.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    case "percentual-desc":
    default:
      return copia.sort((a, b) => semValorPorUltimo(a, b, valorOrdenacao(a, "feno", "percentual"), valorOrdenacao(b, "feno", "percentual"), false));
  }
}

function classesPercentual(pct) {
  if (pct >= 100) return { pct: "pct--over", gauge: "is-over" };
  if (pct >= 80) return { pct: "pct--warn", gauge: "is-warn" };
  return { pct: "pct--ok", gauge: "" };
}

function badgeDisponivel(bloco, pctClasse) {
  if (bloco.saldo_kg > 0) {
    const variante = pctClasse === "pct--warn" ? "warn" : "ok";
    return `<span class="status-badge status-badge--${variante}">${formatarKg(bloco.saldo_kg)} na cota</span>`;
  }
  if (bloco.saldo_kg === 0) {
    return `<span class="status-badge status-badge--warn">Cota esgotada</span>`;
  }
  return `<span class="status-badge status-badge--over">${formatarKg(Math.abs(bloco.saldo_kg))} fora da cota</span>`;
}

function rotuloCategoria(chave) {
  return chave === "feno" ? "Feno" : "Pré-secado";
}

function criarSubLinhaCategoria(c, chave, bloco, opcoes) {
  const tr = document.createElement("tr");
  const classeCat = chave === "feno" ? "cat-row--feno" : "cat-row--presecado";
  const classeGrupo = opcoes.temAmbas ? (opcoes.primeira ? " client-row--top" : " client-row--bottom") : "";
  tr.className = `client-row ${classeCat}${classeGrupo}` + (opcoes.rowAlt ? " row-alt" : "");
  tr.dataset.id = c.codigo;
  if (state.expandidos.has(c.codigo)) tr.classList.add("is-expanded");

  let celulasCompartilhadas = "";
  let celulaExpand = "";
  if (opcoes.primeira) {
    const rowspanAttr = opcoes.temAmbas ? ' rowspan="2"' : "";
    celulasCompartilhadas = `
      <td class="col-name"${rowspanAttr}>
        <div class="client-name">${escapeHtml(c.nome)}</div>
        <div class="client-code">#${c.codigo}</div>
      </td>
      <td class="col-rep"${rowspanAttr}><span class="rep-tag">${escapeHtml(c.representante)}</span></td>
    `;
    celulaExpand = `
      <td class="col-expand"${rowspanAttr}>
        <button class="expand-btn" aria-label="Ver extrato de ${escapeHtml(c.nome)}" aria-expanded="${state.expandidos.has(c.codigo)}">
          <svg viewBox="0 0 12 8" fill="none"><path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </td>
    `;
  }

  const tagClasse = chave === "feno" ? "cat-tag--feno" : "cat-tag--presecado";

  if (!bloco) {
    tr.innerHTML = `
      ${celulasCompartilhadas}
      <td class="col-tipo cat-cell ${classeCat}"><span class="cat-tag ${tagClasse}">${rotuloCategoria(chave)}</span></td>
      <td class="col-num cat-cell ${classeCat} col-sem-cota" colspan="4"><span class="sem-cota">Sem cota de ${rotuloCategoria(chave)} cadastrada</span></td>
      ${celulaExpand}
    `;
    tr.addEventListener("click", () => toggleExtrato(c.codigo));
    return tr;
  }

  const { pct, gauge } = classesPercentual(bloco.percentual);
  const largura = Math.min(Math.max(bloco.percentual, 0), 100);

  tr.innerHTML = `
    ${celulasCompartilhadas}
    <td class="col-tipo cat-cell ${classeCat}"><span class="cat-tag ${tagClasse}">${rotuloCategoria(chave)}</span></td>
    <td class="col-num cat-cell ${classeCat}" data-label="Cota">${formatarKg(bloco.cota_kg)}</td>
    <td class="col-num cat-cell ${classeCat}" data-label="Comprado">${formatarKg(bloco.consumido_kg)}</td>
    <td class="col-num col-saldo cat-cell ${classeCat} ${pct}" data-label="Saldo">${formatarKg(bloco.saldo_kg)}</td>
    <td class="col-progress cat-cell ${classeCat}">
      <div class="progress-cell__row">
        <div class="gauge"><div class="gauge__fill ${gauge}" style="width:${largura}%"></div></div>
        <span class="pct-value ${pct}">${bloco.percentual.toFixed(0)}%</span>
      </div>
    </td>
    <td class="col-status cat-cell ${classeCat}">${badgeDisponivel(bloco, pct)}</td>
    ${celulaExpand}
  `;

  tr.addEventListener("click", () => toggleExtrato(c.codigo));
  return tr;
}

function criarLinhasCliente(c, index) {
  const temFeno = !!c.feno;
  const temPresecado = !!c.presecado;
  const temAmbas = temFeno && temPresecado;
  const rowAlt = index % 2 === 1;

  const linhas = [];
  if (temFeno) {
    linhas.push(criarSubLinhaCategoria(c, "feno", c.feno, { primeira: true, temAmbas, rowAlt }));
  }
  if (temPresecado) {
    linhas.push(criarSubLinhaCategoria(c, "presecado", c.presecado, {
      primeira: !temFeno,
      temAmbas,
      rowAlt,
    }));
  }
  return linhas;
}

function montarExtratoCategoria(rotulo, dotClasse, bloco) {
  if (!bloco) {
    return `
      <div class="ledger__bloco">
        <p class="ledger__subtitle"><span class="cat-dot ${dotClasse}"></span>${rotulo}</p>
        <p class="ledger-empty">Este cliente não tem cota de ${rotulo} cadastrada.</p>
      </div>
    `;
  }

  if (!bloco.transacoes || bloco.transacoes.length === 0) {
    return `
      <div class="ledger__bloco">
        <p class="ledger__subtitle"><span class="cat-dot ${dotClasse}"></span>${rotulo}</p>
        <p class="ledger-empty">Nenhuma compra registrada neste período. Saldo inicial: <strong>${formatarKg(bloco.cota_kg)}</strong>.</p>
      </div>
    `;
  }

  const linhas = bloco.transacoes.map((t) => {
    const pctNaData = bloco.cota_kg > 0 ? ((bloco.cota_kg - t.saldo_apos_kg) / bloco.cota_kg) * 100 : 0;
    const { pct } = classesPercentual(pctNaData);
    const temFora = t.fora_cota_kg > 0;
    return `
      <div class="ledger-row2 ${temFora ? "row-split" : ""}">
        <div class="ledger-cell">${t.data || "—"}</div>
        <div class="ledger-cell num">${formatarKg(t.quantidade_kg)}</div>
        <div class="ledger-cell num pct--ok">${formatarKg(t.dentro_cota_kg)}</div>
        <div class="ledger-cell num ${temFora ? "pct--over" : ""}">${temFora ? formatarKg(t.fora_cota_kg) : "—"}</div>
        <div class="ledger-cell num ${pct}">${formatarKg(t.saldo_apos_kg)}</div>
      </div>
    `;
  }).join("");

  return `
    <div class="ledger__bloco">
      <p class="ledger__subtitle"><span class="cat-dot ${dotClasse}"></span>${rotulo}</p>
      <div class="ledger-scroll">
      <div class="ledger-table">
        <div class="ledger-row2 ledger-head">
          <div class="ledger-cell">Data</div>
          <div class="ledger-cell num">Compra</div>
          <div class="ledger-cell num">Dentro</div>
          <div class="ledger-cell num">Fora</div>
          <div class="ledger-cell num">Saldo após</div>
        </div>
        <div class="ledger-row2 row-inicial">
          <div class="ledger-cell">Saldo inicial (cota do mês)</div>
          <div class="ledger-cell num">—</div>
          <div class="ledger-cell num">—</div>
          <div class="ledger-cell num">—</div>
          <div class="ledger-cell num">${formatarKg(bloco.cota_kg)}</div>
        </div>
        ${linhas}
      </div>
      </div>
    </div>
  `;
}

function criarLinhaExtrato(c, index) {
  const tr = document.createElement("tr");
  tr.className = "ledger-row" + (index % 2 === 1 ? " row-alt" : "");
  tr.dataset.idExtrato = c.codigo;
  if (state.expandidos.has(c.codigo)) tr.classList.add("is-open");

  const td = document.createElement("td");
  td.colSpan = 9;

  td.innerHTML = `
    <div class="ledger">
      <p class="ledger__title">Extrato de compras</p>
      <p class="ledger__hint">O que exceder o saldo disponível no momento da compra é sempre cobrado fora da cota — mesmo que a cota ainda não estivesse estourada antes dela.</p>
      <div class="ledger__grid">
        ${montarExtratoCategoria("Feno", "cat-dot--feno", c.feno)}
        ${montarExtratoCategoria("Pré-secado", "cat-dot--presecado", c.presecado)}
      </div>
    </div>
  `;

  tr.appendChild(td);
  return tr;
}

function toggleExtrato(codigo) {
  if (state.expandidos.has(codigo)) {
    state.expandidos.delete(codigo);
  } else {
    state.expandidos.add(codigo);
  }
  const clientRow = el.tbody.querySelector(`tr.client-row[data-id="${codigo}"]`);
  const ledgerRow = el.tbody.querySelector(`tr.ledger-row[data-id-extrato="${codigo}"]`);
  const isOpen = state.expandidos.has(codigo);
  if (clientRow) {
    clientRow.classList.toggle("is-expanded", isOpen);
    const btn = clientRow.querySelector(".expand-btn");
    if (btn) btn.setAttribute("aria-expanded", String(isOpen));
  }
  if (ledgerRow) ledgerRow.classList.toggle("is-open", isOpen);
}

function formatarKg(valor) {
  return `${Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();

// =========================================================================
// CIPA BOXER - Plano de Ação
// Ações vêm das reuniões (ATA), inspeções e acidentes, ou são lançadas à mão.
// =========================================================================

let acoesCache = [];
let filtroPrazo = null; // "vencidas" | "7" | "30" | "mais"
const CORES_STATUS = { "Em andamento": "#f59e0b", Atrasada: "#dc2626", "Concluída": "#16a34a" };
const ROTULO_FAIXA = { vencidas: "vencidas", 7: "vencem em até 7 dias", 30: "vencem em 8 a 30 dias", mais: "vencem em mais de 30 dias" };
const ORDEM_PRIO = { Alta: 0, "Média": 1, Baixa: 2 };

document.addEventListener("DOMContentLoaded", async () => {
  if (!(await telaPronta())) return;

  // Só editores adicionam ações à mão
  if (!acesso.editor) {
    const p = document.getElementById("painel-nova-acao");
    if (p) p.style.display = "none";
  }

  document.getElementById("nova-tema").innerHTML = opcoesLista(TEMAS_ACAO, "Outros");
  document.getElementById("nova-prioridade").innerHTML = opcoesLista(PRIORIDADES, "Média");
  document.getElementById("filtro-origem").innerHTML = '<option value="todas">Todas</option>' + opcoesLista(ORIGENS_ACAO);
  document.getElementById("filtro-tema").innerHTML = '<option value="todas">Todos</option>' + opcoesLista(TEMAS_ACAO);
  document.getElementById("filtro-prioridade").innerHTML = '<option value="todas">Todas</option>' + opcoesLista(PRIORIDADES);

  document.getElementById("btn-add-manual").addEventListener("click", adicionarAcaoManual);
  document.getElementById("btn-export-plano-pdf").addEventListener("click", exportarPlanoPDF);
  ["filtro-status", "filtro-origem", "filtro-tema", "filtro-prioridade", "ordenar-por"].forEach((id) =>
    document.getElementById(id).addEventListener("change", renderTabelaAcoes)
  );
  document.getElementById("busca-acao").addEventListener("input", renderTabelaAcoes);
  document.querySelectorAll(".kpi").forEach((k) => k.addEventListener("click", () => filtrarPor(k.dataset.status)));
  document.getElementById("chip-filtro-prazo").addEventListener("click", () => {
    filtroPrazo = null;
    renderPainel(acoesCache);
    renderTabelaAcoes();
  });

  carregarMembrosDatalist();
  carregarAcoes();
});

// ---------------- Membros (autocomplete do responsável; texto livre também vale) ----------------
async function carregarMembrosDatalist() {
  try {
    const { data, error } = await supabaseClient.from("cipa_membros").select("nome").eq("ativo", true).order("nome");
    if (error) throw error;
    document.getElementById("lista-membros-plano").innerHTML = (data || []).map((m) => `<option value="${escHtml(m.nome)}"></option>`).join("");
  } catch (err) {
    console.error(err);
  }
}

// ---------------- Carregar ações ----------------
async function carregarAcoes() {
  try {
    const { data, error } = await supabaseClient.from("cipa_acoes").select("*");
    if (error) throw error;
    acoesCache = data || [];

    // Confronta prazo/conclusão com a data de hoje e mantém o status sempre correto
    const atualizacoes = [];
    acoesCache.forEach((a) => {
      const correto = statusAcao(a);
      if (a.status !== correto) {
        a.status = correto;
        atualizacoes.push({ id: a.id, status: correto });
      }
    });
    if (acesso.editor) {
      for (const u of atualizacoes) {
        await supabaseClient.from("cipa_acoes").update({ status: u.status, updated_at: new Date().toISOString() }).eq("id", u.id);
      }
    }
    renderIndicadores(acoesCache);
    renderTabelaAcoes();
  } catch (err) {
    console.error(err);
    showToast("Erro ao carregar ações: " + err.message, "error");
  }
}

// ---------------- Indicadores ----------------
function renderIndicadores(lista) {
  document.getElementById("ind-total").textContent = lista.length;
  document.getElementById("ind-andamento").textContent = lista.filter((a) => a.status === "Em andamento").length;
  document.getElementById("ind-atrasada").textContent = lista.filter((a) => a.status === "Atrasada").length;
  document.getElementById("ind-concluida").textContent = lista.filter((a) => a.status === "Concluída").length;
  renderPainel(lista);
}

function filtrarPor(status, busca = "", origem = "todas", manterPrazo = false) {
  if (!manterPrazo) filtroPrazo = null;
  document.getElementById("filtro-status").value = status;
  document.getElementById("busca-acao").value = busca;
  document.getElementById("filtro-origem").value = origem;
  renderTabelaAcoes();
  document.querySelectorAll(".kpi").forEach((k) => k.classList.toggle("aberto", k.dataset.status === status && !busca && origem === "todas"));
  document.getElementById("painel-tabela").scrollIntoView({ behavior: "smooth", block: "start" });
}

function donutSVG(partes, total) {
  const r = 52, c = 2 * Math.PI * r;
  let off = 0;
  const arcos = partes
    .filter((p) => p.v > 0)
    .map((p) => {
      const len = (p.v / total) * c;
      const el = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${p.cor}" stroke-width="20" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)" data-status="${escHtml(p.k)}" class="arco"><title>${escHtml(p.k)}: ${p.v}</title></circle>`;
      off += len;
      return el;
    })
    .join("");
  const pct = total ? Math.round(((partes.find((p) => p.k === "Concluída") || { v: 0 }).v / total) * 100) : 0;
  return `<svg viewBox="0 0 140 140" class="donut"><circle r="${r}" cx="70" cy="70" fill="none" stroke="#eceef1" stroke-width="20"/>${arcos}
    <text x="70" y="68" text-anchor="middle" class="donut-pct">${pct}%</text><text x="70" y="86" text-anchor="middle" class="donut-lbl">concluído</text></svg>`;
}

function barrasEmpilhadas(grupos, attrs) {
  const max = Math.max(1, ...grupos.map((g) => g.total));
  return grupos
    .map(
      (g) => `<div class="barra-linha" ${attrs(g)} title="Clique para ver as ações">
        <span class="barra-rotulo">${escHtml(g.nome)}</span>
        <span class="barra-trilho">${["Atrasada", "Em andamento", "Concluída"]
          .map((st) => (g[st] ? `<i style="width:${(g[st] / max) * 100}%;background:${CORES_STATUS[st]}" title="${st}: ${g[st]}"></i>` : ""))
          .join("")}</span>
        <span class="barra-valor">${g.total}</span>
      </div>`
    )
    .join("");
}

function agrupar(lista, chave) {
  const m = {};
  lista.forEach((a) => {
    const k = chave(a) || "Sem responsável";
    m[k] = m[k] || { nome: k, total: 0 };
    m[k].total++;
    m[k][a.status] = (m[k][a.status] || 0) + 1;
  });
  return Object.values(m).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

function nomeCurto(n) {
  const p = String(n || "").trim().split(/\s+/);
  return p.length > 2 ? p[0] + " " + p[p.length - 1] : n;
}

function renderPainel(lista) {
  const total = lista.length;
  const partes = ["Em andamento", "Atrasada", "Concluída"].map((k) => ({ k, v: lista.filter((a) => a.status === k).length, cor: CORES_STATUS[k] }));
  document.getElementById("donut-status").innerHTML = total ? donutSVG(partes, total) : '<div class="empty-state small">Sem ações.</div>';
  document.getElementById("legenda-status").innerHTML = partes
    .map((p) => `<div class="leg-item" data-status="${p.k}"><span class="leg-cor" style="background:${p.cor}"></span>${p.k}<b>${p.v}</b></div>`)
    .join("");
  document.querySelectorAll("#legenda-status .leg-item, #donut-status .arco").forEach((el) => el.addEventListener("click", () => filtrarPor(el.dataset.status)));

  // Prazos das ações em aberto
  const abertas = lista.filter((a) => a.status !== "Concluída" && a.prazo);
  const faixas = [
    { k: "vencidas", rotulo: "Vencidas", n: abertas.filter((a) => diasAte(a.prazo) < 0).length, cls: "danger" },
    { k: "7", rotulo: "Vencem em até 7 dias", n: abertas.filter((a) => diasAte(a.prazo) >= 0 && diasAte(a.prazo) <= 7).length, cls: "warn" },
    { k: "30", rotulo: "Vencem em 8 a 30 dias", n: abertas.filter((a) => diasAte(a.prazo) > 7 && diasAte(a.prazo) <= 30).length, cls: "info" },
    { k: "mais", rotulo: "Mais de 30 dias", n: abertas.filter((a) => diasAte(a.prazo) > 30).length, cls: "muted" },
  ];
  const prox = abertas.map((a) => a.prazo).sort()[0];
  document.getElementById("proximos-prazos").innerHTML = abertas.length
    ? `<div class="faixas-prazo">${faixas
        .map((f) => `<button class="faixa ${f.cls} ${filtroPrazo === f.k ? "ativa" : ""}" data-faixa="${f.k}"><b>${f.n}</b><span>${f.rotulo}</span></button>`)
        .join("")}</div>
      <div class="small text-muted mt-16">Próximo vencimento: <b>${formatarDataBR(prox)}</b> (${abertas.filter((a) => a.prazo === prox).length} ação(ões)) · clique numa faixa para ver as ações na tabela.</div>`
    : '<div class="empty-state small">Nenhuma ação em aberto. 🎉</div>';
  document.querySelectorAll(".faixa").forEach((el) =>
    el.addEventListener("click", () => {
      filtroPrazo = filtroPrazo === el.dataset.faixa ? null : el.dataset.faixa;
      renderPainel(acoesCache);
      filtrarPor("todas", "", "todas", true);
    })
  );

  // Por responsável e por origem
  const porResp = agrupar(lista, (a) => a.responsavel);
  document.getElementById("por-responsavel").innerHTML = porResp.length
    ? barrasEmpilhadas(porResp.map((g) => ({ ...g, completo: g.nome, nome: nomeCurto(g.nome) })), (g) => `data-busca="${escHtml(g.completo)}"`)
    : '<div class="empty-state small">Sem ações.</div>';
  document.querySelectorAll("#por-responsavel .barra-linha").forEach((el) => el.addEventListener("click", () => filtrarPor("todas", el.dataset.busca)));

  const porOrigem = agrupar(lista, (a) => a.origem);
  document.getElementById("por-origem").innerHTML = porOrigem.length ? barrasEmpilhadas(porOrigem, (g) => `data-origem="${escHtml(g.nome)}"`) : '<div class="empty-state small">Sem ações.</div>';
  document.querySelectorAll("#por-origem .barra-linha").forEach((el) => el.addEventListener("click", () => filtrarPor("todas", "", el.dataset.origem)));
}

// ---------------- Filtro + ordenação ----------------
function obterListaFiltradaOrdenada() {
  const v = (id) => document.getElementById(id).value;
  const filtroStatus = v("filtro-status");
  const filtroOrigem = v("filtro-origem");
  const filtroTema = v("filtro-tema");
  const filtroPrio = v("filtro-prioridade");
  const ordenarPor = v("ordenar-por");
  const busca = v("busca-acao").trim().toLowerCase();
  const chip = document.getElementById("chip-filtro-prazo");
  if (chip) {
    chip.style.display = filtroPrazo ? "inline-flex" : "none";
    chip.innerHTML = filtroPrazo ? `Prazo: ${ROTULO_FAIXA[filtroPrazo]} <b>✕</b>` : "";
  }

  let lista = [...acoesCache];
  if (filtroPrazo) {
    lista = lista.filter((a) => {
      if (a.status === "Concluída" || !a.prazo) return false;
      const d = diasAte(a.prazo);
      return filtroPrazo === "vencidas" ? d < 0 : filtroPrazo === "7" ? d >= 0 && d <= 7 : filtroPrazo === "30" ? d > 7 && d <= 30 : d > 30;
    });
  }
  if (filtroOrigem !== "todas") lista = lista.filter((a) => a.origem === filtroOrigem);
  if (filtroStatus !== "todas") lista = lista.filter((a) => a.status === filtroStatus);
  if (filtroTema !== "todas") lista = lista.filter((a) => a.tema === filtroTema);
  if (filtroPrio !== "todas") lista = lista.filter((a) => (a.prioridade || "Média") === filtroPrio);
  if (busca) {
    lista = lista.filter((a) => [a.descricao, a.responsavel, a.local, a.observacao].some((t) => (t || "").toLowerCase().includes(busca)));
  }

  const prio = (a) => ORDEM_PRIO[a.prioridade || "Média"] ?? 1;
  lista.sort((a, b) => {
    if (ordenarPor === "tema") return ordemTema(a.tema) - ordemTema(b.tema) || prio(a) - prio(b) || (a.prazo || "9").localeCompare(b.prazo || "9");
    if (ordenarPor === "prazo") return (a.prazo || "9").localeCompare(b.prazo || "9");
    if (ordenarPor === "prioridade") return prio(a) - prio(b) || (a.prazo || "9").localeCompare(b.prazo || "9");
    if (ordenarPor === "status") return (a.status || "").localeCompare(b.status || "") || (a.prazo || "9").localeCompare(b.prazo || "9");
    if (ordenarPor === "responsavel") return (a.responsavel || "").localeCompare(b.responsavel || "", "pt-BR");
    return 0;
  });
  return lista;
}

// ---------------- Origem (com link para a tela de origem) ----------------
function origemInfo(a) {
  if (a.ata_id) return { rotulo: "Reunião (ATA)", href: "reuniao.html?ata=" + encodeURIComponent(a.ata_id) };
  if (a.inspecao_id) return { rotulo: "Inspeção", href: "inspecoes.html?inspecao=" + encodeURIComponent(a.inspecao_id) };
  if (a.acidente_id) return { rotulo: "Acidente", href: "acidentes.html?acidente=" + encodeURIComponent(a.acidente_id) };
  return null;
}
function badgeOrigem(a) {
  let html = `<span class="badge badge-muted">${escHtml(a.origem)}</span>`;
  const o = origemInfo(a);
  if (o) html += `<a class="link-origem" href="${o.href}">↗ ver ${escHtml(o.rotulo.toLowerCase())}</a>`;
  return html;
}
function prioClasse(p) {
  return "prio-" + String(p || "Média").replace("é", "e");
}

// ---------------- Tabela ----------------
function renderTabelaAcoes() {
  const lista = obterListaFiltradaOrdenada();
  const tbody = document.getElementById("tabela-acoes-body");
  const empty = document.getElementById("acoes-plano-empty");
  const agruparTema = document.getElementById("ordenar-por").value === "tema";
  tbody.innerHTML = "";

  if (lista.length === 0) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  let temaAtual = null;
  lista.forEach((a) => {
    if (agruparTema && a.tema !== temaAtual) {
      temaAtual = a.tema;
      const n = lista.filter((x) => x.tema === temaAtual).length;
      const tr = document.createElement("tr");
      tr.className = "linha-tema";
      tr.innerHTML = `<td colspan="8"><div class="tema-cab">${escHtml(temaAtual || "Sem tema")} · ${n}</div></td>`;
      tbody.appendChild(tr);
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-desc">
        <select class="campo-inline sel-tema tema-${ordemTema(a.tema)}" data-id="${a.id}" data-campo="tema" title="Tema">${opcoesLista(TEMAS_ACAO, a.tema)}</select>
        <textarea class="campo-inline campo-desc" data-id="${a.id}" data-campo="descricao" rows="1">${escHtml(a.descricao)}</textarea>
        <div class="campo-extra"><span title="Local">📍</span><textarea class="campo-inline" data-id="${a.id}" data-campo="local" rows="1" placeholder="Local">${escHtml(a.local)}</textarea></div>
        <div class="campo-extra"><span title="Observação">📝</span><textarea class="campo-inline" data-id="${a.id}" data-campo="observacao" rows="1" placeholder="Observação">${escHtml(a.observacao)}</textarea></div>
      </td>
      <td class="col-resp"><textarea class="campo-inline campo-resp" data-id="${a.id}" data-campo="responsavel" rows="1" title="${escHtml(a.responsavel)}">${escHtml(a.responsavel)}</textarea></td>
      <td><input type="date" class="campo-inline" data-id="${a.id}" data-campo="prazo" value="${a.prazo || ""}" style="border:none;background:transparent;" /></td>
      <td><input type="date" class="campo-inline" data-id="${a.id}" data-campo="data_conclusao" value="${a.data_conclusao || ""}" style="border:none;background:transparent;" /></td>
      <td><select class="campo-inline sel-prio ${prioClasse(a.prioridade)}" data-id="${a.id}" data-campo="prioridade" title="Prioridade">${opcoesLista(PRIORIDADES, a.prioridade || "Média")}</select></td>
      <td>${badgeStatus(a.status)}</td>
      <td>${badgeOrigem(a)}</td>
      <td><button class="btn btn-secondary btn-excluir-acao" data-id="${a.id}">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  });

  // Ajusta a altura das caixas de texto ao conteúdo (nada fica cortado)
  const autoAltura = (el) => {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };
  tbody.querySelectorAll("textarea.campo-inline").forEach((t) => {
    autoAltura(t);
    t.addEventListener("input", () => autoAltura(t));
    t.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        t.blur();
      }
    });
  });
  tbody.querySelectorAll(".campo-inline").forEach((input) => {
    input.addEventListener("change", (e) => atualizarCampoAcao(e.target.dataset.id, e.target.dataset.campo, e.target.value));
  });
  tbody.querySelectorAll(".btn-excluir-acao").forEach((btn) => btn.addEventListener("click", () => excluirAcao(btn.dataset.id)));
}

// ---------------- Edição direta na tabela ----------------
async function atualizarCampoAcao(id, campo, valor) {
  try {
    const acao = acoesCache.find((a) => a.id === id);
    if (campo === "descricao" && !String(valor).trim()) {
      showToast("A descrição não pode ficar vazia.", "error");
      renderTabelaAcoes();
      return;
    }
    const payload = { [campo]: String(valor).trim() === "" ? null : valor, updated_at: new Date().toISOString() };
    if (campo === "tema" || campo === "prioridade") payload[campo] = valor;
    if (acao) {
      acao[campo] = payload[campo];
      const novo = statusAcao(acao);
      if (novo !== acao.status) {
        acao.status = novo;
        payload.status = novo;
      }
    }
    const { error } = await supabaseClient.from("cipa_acoes").update(payload).eq("id", id);
    if (error) throw error;
    renderIndicadores(acoesCache);
    renderTabelaAcoes();
  } catch (err) {
    showToast("Erro ao atualizar: " + err.message, "error");
    carregarAcoes();
  }
}

// ---------------- Adicionar manualmente ----------------
async function adicionarAcaoManual() {
  const descricao = document.getElementById("nova-descricao").value.trim();
  const responsavel = document.getElementById("nova-responsavel").value.trim();
  const prazo = document.getElementById("nova-prazo").value;
  if (!descricao || !responsavel || !prazo) {
    showToast("Preencha descrição, responsável e prazo.", "error");
    return;
  }
  const btn = document.getElementById("btn-add-manual");
  btn.disabled = true;
  try {
    const payload = {
      descricao,
      responsavel,
      prazo,
      status: statusAcao({ prazo, data_conclusao: null }),
      origem: "Manual",
      tema: document.getElementById("nova-tema").value || "Outros",
      prioridade: document.getElementById("nova-prioridade").value || "Média",
      local: document.getElementById("nova-local").value.trim() || null,
      observacao: document.getElementById("nova-observacao").value.trim() || null,
    };
    const { error } = await supabaseClient.from("cipa_acoes").insert(payload);
    if (error) throw error;
    showToast("Ação adicionada!", "success");
    ["nova-descricao", "nova-responsavel", "nova-prazo", "nova-local", "nova-observacao"].forEach((id) => (document.getElementById(id).value = ""));
    carregarAcoes();
  } catch (err) {
    showToast("Erro ao adicionar ação: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

async function excluirAcao(id) {
  if (!confirmarExclusao("Excluir esta ação do Plano de Ação?")) return;
  try {
    const { error } = await supabaseClient.from("cipa_acoes").delete().eq("id", id);
    if (error) throw error;
    showToast("Ação excluída.", "success");
    carregarAcoes();
  } catch (err) {
    showToast("Erro ao excluir: " + err.message, "error");
  }
}

// ---------------- Exportar PDF ----------------
async function exportarPlanoPDF() {
  const lista = obterListaFiltradaOrdenada();
  if (lista.length === 0) {
    showToast("Não há ações para exportar.", "error");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  const y = await cabecalhoPdf(doc, "Plano de Ação da CIPA", [`${lista.length} ação(ões) · filtros atuais da tela`]);

  doc.autoTable({
    startY: y,
    head: [["Tema", "Descrição", "Local", "Responsável", "Prioridade", "Prazo", "Conclusão", "Status", "Origem"]],
    body: lista.map((a) => [
      a.tema || "",
      a.descricao + (a.observacao ? "\nObs.: " + a.observacao : ""),
      a.local || "-",
      a.responsavel || "-",
      a.prioridade || "Média",
      formatarDataBR(a.prazo),
      formatarDataBR(a.data_conclusao),
      a.status,
      a.origem,
    ]),
    styles: { fontSize: 8 },
    headStyles: CORES_TABELA_PDF,
    columnStyles: { 1: { cellWidth: 70 } },
    margin: { left: 14, right: 14, bottom: 16 },
  });
  rodapePdf(doc);
  doc.save("cipa-boxer-plano-de-acao.pdf");
}

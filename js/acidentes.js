// =========================================================================
// CIPA BOXER - Acidentes e incidentes (acesso restrito a editores da CIPA)
// =========================================================================
const TIPOS_ACIDENTE = ["Típico", "Trajeto", "Doença ocupacional", "Quase acidente"];
let acidentesCache = [];
let setoresAcid = [];

document.addEventListener("DOMContentLoaded", async () => {
  mostrarAvisoConfiguracao();
  if (!(await telaPronta())) return;
  if (!acesso.editor) {
    document.getElementById("area-restrita").style.display = "block";
    return;
  }
  document.getElementById("area-acidentes").style.display = "block";
  document.getElementById("acid-tipo").innerHTML = opcoesLista(TIPOS_ACIDENTE, "Típico");
  document.getElementById("filtro-tipo").innerHTML = '<option value="todos">Todos</option>' + opcoesLista(TIPOS_ACIDENTE, "");
  document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => abrirAba(b.dataset.tab)));
  ["filtro-ano", "filtro-tipo", "filtro-status"].forEach((id) => document.getElementById(id).addEventListener("change", renderTabela));
  document.getElementById("busca-acidente").addEventListener("input", renderTabela);
  document.getElementById("btn-salvar-acidente").addEventListener("click", salvarAcidente);
  document.getElementById("btn-cancelar-acidente").addEventListener("click", limparForm);
  document.getElementById("btn-export-acidentes-pdf").addEventListener("click", exportarPdfLista);
  document.getElementById("acid-data").value = hojeISOLocal();
  await carregar();
  const alvo = new URLSearchParams(location.search).get("acidente");
  if (alvo) {
    const a = acidentesCache.find((x) => x.id === alvo);
    if (a) editarAcidente(a.id);
  }
});

function abrirAba(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("tab-registros").style.display = tab === "registros" ? "" : "none";
  document.getElementById("tab-nova").style.display = tab === "nova" ? "" : "none";
}

async function carregar() {
  const { data, error } = await supabaseClient.from("cipa_acidentes").select("*").order("data_ocorrencia", { ascending: false });
  if (error) {
    console.error(error);
    return showToast("Não foi possível carregar os registros.", "error");
  }
  acidentesCache = data || [];
  setoresAcid = [...new Set(acidentesCache.map((a) => a.setor).filter(Boolean).concat(SETORES_PADRAO))];
  document.getElementById("lista-setores-acid").innerHTML = setoresAcid.map((s) => `<option value="${escHtml(s)}"></option>`).join("");
  const anos = [...new Set(acidentesCache.map((a) => a.data_ocorrencia.slice(0, 4)).concat([String(new Date().getFullYear())]))].sort().reverse();
  const sel = document.getElementById("filtro-ano");
  const atual = sel.value || String(new Date().getFullYear());
  sel.innerHTML = '<option value="todos">Todos</option>' + anos.map((a) => `<option ${a === atual ? "selected" : ""}>${a}</option>`).join("");
  renderIndicadores();
  renderTabela();
}

function renderIndicadores() {
  const ano = String(new Date().getFullYear());
  const doAno = acidentesCache.filter((a) => a.data_ocorrencia.startsWith(ano));
  const reais = doAno.filter((a) => a.tipo !== "Quase acidente");
  const afast = reais.filter((a) => a.com_afastamento);
  document.getElementById("ind-ano").textContent = reais.length;
  document.getElementById("ind-afast").textContent = afast.length;
  document.getElementById("ind-dias").textContent = afast.reduce((s, a) => s + (a.dias_afastamento || 0), 0);
  document.getElementById("ind-quase").textContent = doAno.length - reais.length;
  const ult = acidentesCache.filter((a) => a.com_afastamento && a.tipo !== "Quase acidente").map((a) => a.data_ocorrencia).sort().pop();
  document.getElementById("ind-sem").textContent = ult ? Math.max(0, -diasAte(ult)) : "–";
}

function filtrados() {
  const ano = document.getElementById("filtro-ano").value;
  const tipo = document.getElementById("filtro-tipo").value;
  const st = document.getElementById("filtro-status").value;
  const q = normalizarNome(document.getElementById("busca-acidente").value);
  return acidentesCache.filter((a) => {
    if (ano !== "todos" && !a.data_ocorrencia.startsWith(ano)) return false;
    if (tipo !== "todos" && a.tipo !== tipo) return false;
    if (st !== "todos" && a.status !== st) return false;
    if (q && !normalizarNome([a.setor, a.local, a.descricao, a.colaborador].join(" ")).includes(q)) return false;
    return true;
  });
}

function badgeSituacaoAcid(s) {
  const c = s === "Concluído" ? "badge-ok" : s === "Em investigação" ? "badge-warn" : "badge-danger";
  return `<span class="badge ${c}">${escHtml(s)}</span>`;
}

function renderTabela() {
  const lista = filtrados();
  document.getElementById("acidentes-vazio").style.display = lista.length ? "none" : "block";
  document.getElementById("tabela-acidentes").innerHTML = lista
    .map(
      (a) => `<tr>
      <td>${formatarDataBR(a.data_ocorrencia)}${a.hora ? `<div class="small text-muted">${escHtml(a.hora.slice(0, 5))}</div>` : ""}</td>
      <td><span class="badge ${a.tipo === "Quase acidente" ? "badge-muted" : "badge-cipa"}">${escHtml(a.tipo)}</span></td>
      <td>${escHtml(a.setor || "-")}<div class="small text-muted">${escHtml(a.local || "")}</div></td>
      <td style="max-width:320px;">${escHtml((a.descricao || "").slice(0, 140))}${(a.descricao || "").length > 140 ? "…" : ""}</td>
      <td>${a.com_afastamento ? `<span class="badge badge-danger">${a.dias_afastamento || 0} dia(s)</span>` : '<span class="text-muted">Não</span>'}</td>
      <td>${a.cat_emitida ? `<span class="badge badge-ok">${escHtml(a.cat_numero || "Emitida")}</span>` : '<span class="text-muted">-</span>'}</td>
      <td>${badgeSituacaoAcid(a.status)}</td>
      <td style="white-space:nowrap;">
        <button class="btn-mini" data-ver="${a.id}">Editar</button>
        <button class="btn-mini btn-gerar-pdf" data-pdf="${a.id}">PDF</button>
        <button class="btn-mini" data-del="${a.id}" style="color:var(--danger);">🗑</button>
      </td></tr>`
    )
    .join("");
  document.querySelectorAll("[data-ver]").forEach((b) => (b.onclick = () => editarAcidente(b.dataset.ver)));
  document.querySelectorAll("[data-pdf]").forEach((b) => (b.onclick = () => pdfAcidente(b.dataset.pdf)));
  document.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => excluirAcidente(b.dataset.del)));
}

function limparForm() {
  document.getElementById("titulo-form").textContent = "Novo registro";
  ["acid-id", "acid-hora", "acid-colab", "acid-funcao", "acid-setor", "acid-local", "acid-desc", "acid-parte", "acid-dias", "acid-catnum", "acid-causa", "acid-medidas"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("acid-data").value = hojeISOLocal();
  document.getElementById("acid-tipo").value = "Típico";
  document.getElementById("acid-status").value = "Aberto";
  document.getElementById("acid-afast").checked = false;
  document.getElementById("acid-cat").checked = false;
  document.getElementById("acid-arquivo").value = "";
  document.getElementById("acid-arquivo-atual").innerHTML = "";
  document.getElementById("btn-salvar-acidente").dataset.arquivo = "";
}

async function editarAcidente(id) {
  const a = acidentesCache.find((x) => x.id === id);
  if (!a) return;
  abrirAba("nova");
  document.getElementById("titulo-form").textContent = "Editar registro";
  const set = (k, v) => (document.getElementById(k).value = v ?? "");
  set("acid-id", a.id);
  set("acid-data", a.data_ocorrencia);
  set("acid-hora", a.hora ? a.hora.slice(0, 5) : "");
  set("acid-tipo", a.tipo);
  set("acid-status", a.status);
  set("acid-colab", a.colaborador);
  set("acid-funcao", a.funcao);
  set("acid-setor", a.setor);
  set("acid-local", a.local);
  set("acid-desc", a.descricao);
  set("acid-parte", a.parte_corpo);
  set("acid-dias", a.dias_afastamento);
  set("acid-catnum", a.cat_numero);
  set("acid-causa", a.causa_raiz);
  set("acid-medidas", a.medidas);
  document.getElementById("acid-afast").checked = !!a.com_afastamento;
  document.getElementById("acid-cat").checked = !!a.cat_emitida;
  document.getElementById("acid-arquivo").value = "";
  document.getElementById("acid-arquivo-atual").innerHTML = a.arquivo_url ? `Anexo atual: <a href="#" data-arquivo="${escHtml(a.arquivo_url)}" style="color:var(--brand-red);font-weight:700;">abrir</a> (enviar outro substitui)` : "";
  document.getElementById("btn-salvar-acidente").dataset.arquivo = a.arquivo_url || "";
  // ações já geradas a partir deste registro
  const { data: acoes } = await supabaseClient.from("cipa_acoes").select("id,descricao,prazo,data_conclusao,status").eq("acidente_id", a.id);
  let box = document.getElementById("acoes-do-acidente");
  if (!box) {
    box = document.createElement("div");
    box.id = "acoes-do-acidente";
    box.className = "mt-16";
    document.getElementById("btn-salvar-acidente").parentElement.before(box);
  }
  box.innerHTML = `<h4 style="margin:0 0 8px;">Ações geradas no Plano de Ação</h4>` +
    ((acoes || []).length
      ? (acoes || []).map((x) => `<div class="small" style="padding:4px 0;">${badgeStatus(statusAcao(x))} ${escHtml(x.descricao)} <span class="text-muted">(prazo ${formatarDataBR(x.prazo)})</span></div>`).join("")
      : '<div class="small text-muted">Nenhuma ainda.</div>') +
    `<div class="row mt-16"><button class="btn btn-outline" id="btn-gerar-acao-acid">+ Gerar ação a partir das medidas</button></div>`;
  document.getElementById("btn-gerar-acao-acid").onclick = () => gerarAcaoDoAcidente(a.id);
}

async function gerarAcaoDoAcidente(id) {
  const a = acidentesCache.find((x) => x.id === id);
  if (!a) return;
  const corpo = `<div class="field"><label>O que será feito *</label><textarea id="ga-desc" rows="3">${escHtml(a.medidas || "")}</textarea></div>
    <div class="form-grid mt-16">
      <div class="field"><label>Responsável</label><input type="text" id="ga-resp" /></div>
      <div class="field"><label>Prazo *</label><input type="date" id="ga-prazo" value="${somarDias(hojeISOLocal(), 15)}" /></div>
      <div class="field"><label>Tema</label><select id="ga-tema">${opcoesLista(TEMAS_ACAO, "Condições do ambiente")}</select></div>
      <div class="field"><label>Prioridade</label><select id="ga-prio">${opcoesLista(PRIORIDADES, "Alta")}</select></div>
    </div>
    <div class="row mt-16"><button class="btn btn-primary" id="ga-ok">Criar ação</button></div>`;
  abrirModalHtml("Nova ação a partir do acidente", corpo, 560);
  document.getElementById("ga-ok").onclick = async () => {
    const desc = document.getElementById("ga-desc").value.trim();
    const prazo = document.getElementById("ga-prazo").value;
    if (!desc || !prazo) return showToast("Informe a ação e o prazo.", "error");
    const { error } = await supabaseClient.from("cipa_acoes").insert({
      acidente_id: a.id, descricao: desc, responsavel: document.getElementById("ga-resp").value.trim() || null, prazo,
      status: prazo < hojeISOLocal() ? "Atrasada" : "Em andamento", origem: "Acidente",
      tema: document.getElementById("ga-tema").value, prioridade: document.getElementById("ga-prio").value, local: a.setor || a.local || null,
    });
    if (error) return showToast("Não foi possível criar a ação: " + error.message, "error");
    fecharModalHtml();
    showToast("Ação criada no Plano de Ação.", "success");
    editarAcidente(a.id);
  };
}

async function salvarAcidente() {
  const g = (id) => document.getElementById(id).value.trim();
  const data = g("acid-data");
  const desc = g("acid-desc");
  if (!data || !desc) return showToast("Informe a data e o que aconteceu.", "error");
  const btn = document.getElementById("btn-salvar-acidente");
  btn.disabled = true;
  try {
    let arquivo = btn.dataset.arquivo || null;
    const f = document.getElementById("acid-arquivo").files[0];
    if (f) arquivo = await anexarArquivoPrivadoCipa(f);
    const afast = document.getElementById("acid-afast").checked;
    const reg = {
      data_ocorrencia: data, hora: g("acid-hora") || null, tipo: g("acid-tipo"), status: g("acid-status"),
      colaborador: g("acid-colab") || null, funcao: g("acid-funcao") || null, setor: g("acid-setor") || null, local: g("acid-local") || null,
      descricao: desc, parte_corpo: g("acid-parte") || null, com_afastamento: afast,
      dias_afastamento: afast && g("acid-dias") !== "" ? parseInt(g("acid-dias"), 10) : null,
      cat_emitida: document.getElementById("acid-cat").checked, cat_numero: g("acid-catnum") || null,
      causa_raiz: g("acid-causa") || null, medidas: g("acid-medidas") || null, arquivo_url: arquivo, updated_at: new Date().toISOString(),
    };
    const id = g("acid-id");
    const r = id ? await supabaseClient.from("cipa_acidentes").update(reg).eq("id", id).select("id").single() : await supabaseClient.from("cipa_acidentes").insert(reg).select("id").single();
    if (r.error) throw r.error;
    showToast("Registro salvo.", "success");
    await carregar();
    editarAcidente(r.data.id);
  } catch (e) {
    console.error(e);
    showToast("Não foi possível salvar: " + (e.message || e), "error");
  }
  btn.disabled = false;
}

async function excluirAcidente(id) {
  if (!confirmarExclusao("Excluir este registro de acidente?")) return;
  const { error } = await supabaseClient.from("cipa_acidentes").delete().eq("id", id);
  if (error) return showToast("Não foi possível excluir.", "error");
  showToast("Registro excluído.", "success");
  limparForm();
  carregar();
}

async function pdfAcidente(id) {
  const a = acidentesCache.find((x) => x.id === id);
  if (!a) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = await cabecalhoPdf(doc, "REGISTRO DE ACIDENTE / INCIDENTE", [`Ocorrência em ${formatarDataBR(a.data_ocorrencia)}${a.hora ? " às " + a.hora.slice(0, 5) : ""}`]);
  const linhas = [
    ["Tipo", a.tipo], ["Situação", a.status], ["Colaborador", a.colaborador || "-"], ["Função", a.funcao || "-"],
    ["Setor / local", [a.setor, a.local].filter(Boolean).join(" · ") || "-"], ["Descrição", a.descricao],
    ["Parte do corpo", a.parte_corpo || "-"], ["Afastamento", a.com_afastamento ? `Sim, ${a.dias_afastamento || 0} dia(s)` : "Não"],
    ["CAT", a.cat_emitida ? `Emitida ${a.cat_numero || ""}` : "Não emitida"], ["Causa raiz", a.causa_raiz || "-"], ["Medidas", a.medidas || "-"],
  ];
  doc.autoTable({ startY: y, body: linhas, theme: "grid", styles: { fontSize: 9, cellPadding: 2.5 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 38, fillColor: [244, 245, 247] } } });
  y = doc.lastAutoTable.finalY + 26;
  doc.setFontSize(9);
  doc.line(20, y, 90, y); doc.line(120, y, 190, y);
  doc.text("Presidente da CIPA", 55, y + 5, { align: "center" });
  doc.text("Responsável pela investigação", 155, y + 5, { align: "center" });
  rodapePdf(doc);
  doc.save(`acidente_${a.data_ocorrencia}.pdf`);
}

async function exportarPdfLista() {
  const lista = filtrados();
  if (!lista.length) return showToast("Nada para exportar.", "error");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const y = await cabecalhoPdf(doc, "ACIDENTES E INCIDENTES", [`${lista.length} registro(s)`]);
  doc.autoTable({
    startY: y, head: [["Data", "Tipo", "Setor / Local", "Descrição", "Afast.", "CAT", "Situação"]],
    body: lista.map((a) => [formatarDataBR(a.data_ocorrencia), a.tipo, [a.setor, a.local].filter(Boolean).join(" · "), a.descricao, a.com_afastamento ? `${a.dias_afastamento || 0} d` : "Não", a.cat_emitida ? "Sim" : "-", a.status]),
    headStyles: CORES_TABELA_PDF, styles: { fontSize: 8 }, columnStyles: { 3: { cellWidth: 95 } },
  });
  rodapePdf(doc);
  doc.save("acidentes_cipa.pdf");
}

// =========================================================================
// CIPA BOXER - SIPAT (Semana Interna de Prevenção de Acidentes)
// =========================================================================

const TIPOS_ATIV = ["Palestra", "Treinamento", "Dinâmica", "Campanha", "Simulado", "Outros"];
const STATUS_ATIV = ["Planejada", "Realizada", "Cancelada"];

let gestao = null;
let edicoes = [];
let edicao = null; // edição exibida na Programação
let atividades = [];
let editandoId = null; // edição aberta no formulário (aba Nova)
let nomesResp = [];
const $ = (id) => document.getElementById(id);
const CHAVE_EDICAO = "cipa_sipat_edicao";

document.addEventListener("DOMContentLoaded", async () => {
  mostrarAvisoConfiguracao();
  if (!(await telaPronta())) return;
  configurarAbas();
  const r = await montarSeletorGestao($("seletor-gestao"), (g) => {
    gestao = g;
    carregarEdicoes();
  });
  gestao = r.atual;
  nomesResp = (await membrosAtivos(null, hojeISOLocal())).map((m) => m.nome);
  $("lista-resp-sipat").innerHTML = nomesResp.map((n) => `<option value="${escHtml(n)}"></option>`).join("");
  $("filtro-edicao").addEventListener("change", () => {
    edicao = edicoes.find((e) => e.id === $("filtro-edicao").value) || null;
    try { localStorage.setItem(CHAVE_EDICAO, edicao ? edicao.id : ""); } catch (e) {}
    carregarAtividades();
  });
  $("btn-editar-edicao").addEventListener("click", () => abrirFormulario(edicao));
  $("btn-reset-edicao").addEventListener("click", () => abrirFormulario(null));
  $("btn-salvar-edicao").addEventListener("click", salvarEdicao);
  $("btn-excluir-edicao").addEventListener("click", excluirEdicao);
  $("btn-add-atividade").addEventListener("click", () => abrirAtividade(null));
  $("btn-pdf-sipat").addEventListener("click", exportarPdf);
  abrirFormulario(null, true);
  carregarEdicoes();
});

function configurarAbas() {
  const botoes = document.querySelectorAll(".tab-btn");
  botoes.forEach((btn) =>
    btn.addEventListener("click", () => {
      botoes.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-content").forEach((s) => (s.style.display = "none"));
      $("tab-" + btn.dataset.tab).style.display = "block";
    })
  );
}
const irParaAba = (nome) => document.querySelector(`.tab-btn[data-tab="${nome}"]`).click();

// ---------------- Edições ----------------
async function carregarEdicoes(manterId) {
  const { data, error } = await supabaseClient.from("cipa_sipat").select("*").order("ano", { ascending: false }).order("created_at", { ascending: false });
  if (error) {
    console.error(error);
    showToast("Não foi possível carregar as edições.", "error");
  }
  // mostra as da gestão escolhida e as sem gestão definida
  edicoes = (data || []).filter((e) => !gestao || !e.gestao_id || e.gestao_id === gestao.id);
  let lembrada = manterId || null;
  if (!lembrada) {
    try { lembrada = localStorage.getItem(CHAVE_EDICAO); } catch (e) {}
  }
  edicao = edicoes.find((e) => e.id === lembrada) || edicoes[0] || null;
  $("filtro-edicao").innerHTML = edicoes.length
    ? edicoes.map((e) => `<option value="${e.id}" ${edicao && e.id === edicao.id ? "selected" : ""}>SIPAT ${e.ano}${e.tema ? " — " + escHtml(e.tema) : ""}</option>`).join("")
    : '<option value="">(nenhuma edição)</option>';
  await carregarAtividades();
}

async function carregarAtividades() {
  atividades = [];
  if (edicao) {
    const { data, error } = await supabaseClient.from("cipa_sipat_atividades").select("*").eq("sipat_id", edicao.id).order("data", { nullsFirst: false }).order("hora");
    if (error) console.error(error);
    atividades = data || [];
  }
  renderProgramacao();
  renderTabelaAtividades();
}

// ---------------- Programação ----------------
const dataLonga = (iso) => `${formatarDataBR(iso)} · ${DIAS_SEMANA[dataDeISO(iso).getDay()]}`;
function periodoTexto(e) {
  if (e.data_inicio && e.data_fim) return `${formatarDataBR(e.data_inicio)} a ${formatarDataBR(e.data_fim)}`;
  if (e.data_inicio) return `a partir de ${formatarDataBR(e.data_inicio)}`;
  return "Período não definido";
}
function badgeTipo(t) {
  return `<span class="badge badge-cipa">${escHtml(t)}</span>`;
}

function renderProgramacao() {
  const vazio = $("sipat-vazio");
  if (!edicao) {
    vazio.style.display = "block";
    vazio.textContent = 'Nenhuma edição da SIPAT cadastrada para esta gestão. Use a aba "Nova edição / atividades" para criar a primeira.';
    $("sipat-conteudo").style.display = "none";
    return;
  }
  vazio.style.display = "none";
  $("sipat-conteudo").style.display = "block";
  $("ed-titulo").textContent = `SIPAT ${edicao.ano}${edicao.tema ? " — " + edicao.tema : ""}`;
  $("ed-periodo").textContent = "📅 " + periodoTexto(edicao);
  $("ed-obs").textContent = edicao.observacao || "";

  const total = atividades.length;
  const real = atividades.filter((a) => a.status === "Realizada").length;
  const plan = atividades.filter((a) => a.status === "Planejada").length;
  const validas = atividades.filter((a) => a.status !== "Cancelada").length;
  $("ind-atividades").textContent = total;
  $("ind-realizadas").textContent = real;
  $("ind-planejadas").textContent = plan;
  $("ind-pct").textContent = validas ? Math.round((real / validas) * 100) + "%" : "0%";

  const lista = $("atividades-lista");
  if (!atividades.length) {
    lista.innerHTML = '<div class="empty-state">Nenhuma atividade cadastrada ainda.</div>';
    return;
  }
  const grupos = new Map();
  atividades.forEach((a) => {
    const k = a.data || "sem-data";
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  });
  lista.innerHTML = [...grupos.entries()]
    .map(([k, itens]) => `<div class="dia-cab">${k === "sem-data" ? "Sem data definida" : escHtml(dataLonga(k))}</div>` +
      itens.map((a) => `<div class="ativ-linha ${a.status === "Cancelada" ? "cancelada" : ""}">
        <div class="ativ-hora">${escHtml(a.hora || "--:--")}</div>
        <div>
          <div class="ativ-titulo">${escHtml(a.titulo)} ${badgeTipo(a.tipo)}</div>
          <div class="ativ-meta">${a.responsavel ? `<span>👤 ${escHtml(a.responsavel)}</span>` : ""}${a.local ? `<span>📍 ${escHtml(a.local)}</span>` : ""}${a.observacao ? `<span>📝 ${escHtml(a.observacao)}</span>` : ""}</div>
        </div>
        <div class="ativ-status">
          ${acesso.editor
            ? STATUS_ATIV.map((s) => `<button class="btn-mini ${a.status === s ? "ativo-" + s.toLowerCase() : ""}" data-status="${s}" data-id="${a.id}">${s}</button>`).join("")
            : `<span class="badge ${a.status === "Realizada" ? "badge-ok" : a.status === "Cancelada" ? "badge-muted" : "badge-warn"}">${a.status}</span>`}
        </div></div>`).join(""))
    .join("");
  lista.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => mudarStatus(b.dataset.id, b.dataset.status)));
}

async function mudarStatus(id, status) {
  const { error } = await supabaseClient.from("cipa_sipat_atividades").update({ status }).eq("id", id);
  if (error) return showToast("Não foi possível alterar: " + error.message, "error");
  const a = atividades.find((x) => x.id === id);
  if (a) a.status = status;
  renderProgramacao();
  renderTabelaAtividades();
}

// ---------------- Formulário da edição ----------------
function abrirFormulario(e, silencioso) {
  editandoId = e ? e.id : null;
  $("sp-ano").value = e ? e.ano : new Date().getFullYear();
  $("sp-tema").value = e ? e.tema || "" : "";
  $("sp-inicio").value = e ? e.data_inicio || "" : "";
  $("sp-fim").value = e ? e.data_fim || "" : "";
  $("sp-obs").value = e ? e.observacao || "" : "";
  $("form-titulo").textContent = e ? `Editar SIPAT ${e.ano}` : "Nova edição da SIPAT";
  $("btn-excluir-edicao").style.display = e ? "" : "none";
  renderTabelaAtividades();
  if (!silencioso) irParaAba("nova");
}

async function salvarEdicao() {
  const ano = Number($("sp-ano").value);
  if (!ano || ano < 2000) return showToast("Informe o ano da SIPAT.", "error");
  const ini = $("sp-inicio").value || null;
  const fim = $("sp-fim").value || null;
  if (ini && fim && fim < ini) return showToast("A data final não pode ser anterior à inicial.", "error");
  const corpo = { ano, tema: $("sp-tema").value.trim() || null, data_inicio: ini, data_fim: fim, observacao: $("sp-obs").value.trim() || null };
  let id = editandoId;
  if (id) {
    const { error } = await supabaseClient.from("cipa_sipat").update(corpo).eq("id", id);
    if (error) return showToast("Não foi possível salvar: " + error.message, "error");
  } else {
    const { data, error } = await supabaseClient.from("cipa_sipat").insert({ ...corpo, gestao_id: gestao ? gestao.id : null }).select().single();
    if (error) return showToast("Não foi possível salvar: " + error.message, "error");
    id = data.id;
  }
  showToast("Edição salva! Agora você pode adicionar as atividades.", "success");
  try { localStorage.setItem(CHAVE_EDICAO, id); } catch (e) {}
  await carregarEdicoes(id);
  abrirFormulario(edicoes.find((e) => e.id === id) || null, true);
}

async function excluirEdicao() {
  if (!editandoId) return;
  const e = edicoes.find((x) => x.id === editandoId);
  if (!confirmarExclusao(`Excluir a SIPAT ${e ? e.ano : ""} e todas as suas atividades?`)) return;
  const { error } = await supabaseClient.from("cipa_sipat").delete().eq("id", editandoId);
  if (error) return showToast("Não foi possível excluir: " + error.message, "error");
  showToast("Edição excluída.", "success");
  await carregarEdicoes();
  abrirFormulario(null, true);
  irParaAba("programacao");
}

// ---------------- Atividades (aba Nova) ----------------
function renderTabelaAtividades() {
  const doForm = editandoId ? atividades.filter(() => edicao && edicao.id === editandoId) : [];
  $("atividades-hint").style.display = editandoId ? "none" : "block";
  $("btn-add-atividade").style.display = editandoId ? "" : "none";
  $("atividades-tabela").innerHTML = doForm.length
    ? doForm.map((a) => `<tr>
        <td>${a.data ? formatarDataBR(a.data) : "-"}</td><td>${escHtml(a.hora || "-")}</td><td><b>${escHtml(a.titulo)}</b></td>
        <td>${badgeTipo(a.tipo)}</td><td>${escHtml(a.responsavel || "-")}</td><td>${escHtml(a.local || "-")}</td>
        <td><span class="badge ${a.status === "Realizada" ? "badge-ok" : a.status === "Cancelada" ? "badge-muted" : "badge-warn"}">${a.status}</span></td>
        <td style="white-space:nowrap;"><button class="btn-mini" data-editar="${a.id}">✏️ Editar</button> <button class="btn-mini" data-excluir="${a.id}">🗑️</button></td></tr>`).join("")
    : editandoId ? '<tr><td colspan="8" class="small text-muted">Nenhuma atividade ainda. Clique em "+ Atividade".</td></tr>' : "";
  $("atividades-tabela").querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => abrirAtividade(b.dataset.editar)));
  $("atividades-tabela").querySelectorAll("[data-excluir]").forEach((b) => b.addEventListener("click", () => excluirAtividade(b.dataset.excluir)));
}

function abrirAtividade(id) {
  if (!acesso.editor || !editandoId) return;
  const ed = edicoes.find((e) => e.id === editandoId);
  const a = id ? atividades.find((x) => x.id === id) : { titulo: "", tipo: "Palestra", data: ed && ed.data_inicio ? ed.data_inicio : "", hora: "", responsavel: "", local: "", status: "Planejada", observacao: "" };
  const m = abrirModalHtml(id ? "Editar atividade" : "Nova atividade", `
    <div class="form-grid">
      <div class="field field-full"><label>Título *</label><input type="text" id="at-titulo" value="${escHtml(a.titulo)}" /></div>
      <div class="field"><label>Tipo</label><select id="at-tipo">${opcoesLista(TIPOS_ATIV, a.tipo)}</select></div>
      <div class="field"><label>Situação</label><select id="at-status">${opcoesLista(STATUS_ATIV, a.status)}</select></div>
      <div class="field"><label>Data</label><input type="date" id="at-data" value="${escHtml(a.data || "")}" /></div>
      <div class="field"><label>Hora</label><input type="time" id="at-hora" value="${escHtml(a.hora || "")}" /></div>
      <div class="field"><label>Responsável</label><input type="text" id="at-resp" list="lista-resp-sipat" value="${escHtml(a.responsavel || "")}" /></div>
      <div class="field"><label>Local</label><input type="text" id="at-local" value="${escHtml(a.local || "")}" /></div>
      <div class="field field-full"><label>Observação</label><textarea id="at-obs" rows="2">${escHtml(a.observacao || "")}</textarea></div>
    </div>
    <div class="row mt-16"><button class="btn btn-primary" id="at-salvar">💾 Salvar</button><button class="btn btn-secondary" id="at-cancelar">Cancelar</button></div>`);
  m.querySelector("#at-cancelar").onclick = fecharModalHtml;
  m.querySelector("#at-salvar").onclick = async () => {
    const titulo = m.querySelector("#at-titulo").value.trim();
    if (!titulo) return showToast("Informe o título da atividade.", "error");
    const corpo = {
      titulo,
      tipo: m.querySelector("#at-tipo").value,
      status: m.querySelector("#at-status").value,
      data: m.querySelector("#at-data").value || null,
      hora: m.querySelector("#at-hora").value || null,
      responsavel: m.querySelector("#at-resp").value.trim() || null,
      local: m.querySelector("#at-local").value.trim() || null,
      observacao: m.querySelector("#at-obs").value.trim() || null,
    };
    const q = id ? supabaseClient.from("cipa_sipat_atividades").update(corpo).eq("id", id) : supabaseClient.from("cipa_sipat_atividades").insert({ ...corpo, sipat_id: editandoId });
    const { error } = await q;
    if (error) return showToast("Não foi possível salvar: " + error.message, "error");
    fecharModalHtml();
    showToast("Atividade salva.", "success");
    if (!edicao || edicao.id !== editandoId) {
      edicao = edicoes.find((e) => e.id === editandoId) || edicao;
      $("filtro-edicao").value = edicao ? edicao.id : "";
    }
    carregarAtividades();
  };
}

async function excluirAtividade(id) {
  const a = atividades.find((x) => x.id === id);
  if (!a || !confirmarExclusao(`Excluir a atividade "${a.titulo}"?`)) return;
  const { error } = await supabaseClient.from("cipa_sipat_atividades").delete().eq("id", id);
  if (error) return showToast("Não foi possível excluir: " + error.message, "error");
  showToast("Atividade excluída.", "success");
  carregarAtividades();
}

// ---------------- PDF ----------------
async function exportarPdf() {
  if (!edicao) return showToast("Nenhuma edição selecionada.", "error");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  const linhas = [periodoTexto(edicao)];
  if (edicao.tema) linhas.unshift(`Tema: ${edicao.tema}`);
  const y = await cabecalhoPdf(doc, `SIPAT ${edicao.ano} — PROGRAMAÇÃO`, linhas);
  doc.autoTable({
    startY: y,
    head: [["Data", "Hora", "Atividade", "Tipo", "Responsável", "Local", "Situação"]],
    body: atividades.map((a) => [a.data ? dataLonga(a.data) : "Sem data", a.hora || "-", a.titulo, a.tipo, a.responsavel || "-", a.local || "-", a.status]),
    styles: { fontSize: 9 },
    headStyles: CORES_TABELA_PDF,
    margin: { left: 14, right: 14 },
  });
  rodapePdf(doc);
  doc.save(`sipat-${edicao.ano}-programacao.pdf`);
}

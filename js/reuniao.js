// =========================================================================
// CIPA BOXER - Reunião e ATA
// Registro da reunião (pauta, deliberações, ações, presença), histórico,
// PDF para assinatura e anexo da ATA assinada. As ações vão para o Plano de Ação.
// =========================================================================

const CHAVE_RASCUNHO = "cipa_rascunho_ata_v1";

let GESTOES = [];
let MEMBROS = []; // membros listados na presença (da gestão na data da reunião)
let MEMBROS_EXTRAS = []; // em edição: quem já constava na presença da ATA salva
let E = novoEstado(); // estado do formulário
let ACOES_DB = {}; // ações já gravadas desta ATA (id -> linha), em edição
let historicoCache = [];
let presencasPorAta = {};
let rascunhoTimer = null;

function novoEstado() {
  return {
    editId: null,
    editData: null,
    gestaoId: null,
    tipo: "Ordinária",
    data: hojeISOLocal(),
    hora: "",
    local: "",
    revisaoPlano: true,
    planoResumo: null,
    pauta: [""],
    deliberacoes: "",
    encerramento: "",
    acoes: [],
    presenca: {},
  };
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!(await telaPronta())) return;
  setupTabs();
  const params = new URLSearchParams(location.search);

  if (acesso.editor) await iniciarNova(params);
  await carregarHistorico();

  const ataParam = params.get("ata");
  if (ataParam) {
    document.querySelector('.tab-btn[data-tab="historico"]').click();
    const el = document.getElementById("ata-" + ataParam);
    if (el) {
      el.classList.add("destaque");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      abrirDetalhe(ataParam);
    }
  }
});

function setupTabs() {
  const botoes = document.querySelectorAll(".tab-btn");
  botoes.forEach((btn) =>
    btn.addEventListener("click", () => {
      botoes.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-content").forEach((s) => (s.style.display = "none"));
      document.getElementById("tab-" + btn.dataset.tab).style.display = "block";
      if (btn.dataset.tab === "historico") carregarHistorico();
    })
  );
}

// =========================================================================
// NOVA REUNIÃO
// =========================================================================
async function iniciarNova(params) {
  // Autocomplete de responsáveis
  const { data: todos } = await supabaseClient.from("cipa_membros").select("nome").eq("ativo", true).order("nome");
  document.getElementById("lista-membros-ata").innerHTML = (todos || []).map((m) => `<option value="${escHtml(m.nome)}"></option>`).join("");

  // Gestão
  const sel = await montarSeletorGestao(document.getElementById("seletor-gestao"), async (g) => {
    E.gestaoId = g.id;
    aplicarPadroesDaGestao(g);
    await recarregarMembros();
    refletirNoFormulario(false);
    agendarRascunho();
  });
  GESTOES = sel.gestoes;
  E.gestaoId = sel.atual ? sel.atual.id : null;
  if (sel.atual) aplicarPadroesDaGestao(sel.atual);

  const dataUrl = params.get("data");
  if (dataUrl && /^\d{4}-\d{2}-\d{2}$/.test(dataUrl)) E.data = dataUrl;

  // Rascunho guardado (não vale se a pessoa abriu a tela com ?data=)
  const rasc = lerRascunho();
  if (rasc && (!dataUrl || rasc.editId)) {
    E = Object.assign(novoEstado(), rasc);
    const g = GESTOES.find((x) => x.id === E.gestaoId);
    if (!g && GESTOES.length) E.gestaoId = (escolherGestao(GESTOES) || {}).id || null;
    if (E.editId) await prepararEdicaoDoRascunho();
  }

  ligarEventosFormulario();
  await recarregarMembros();
  refletirNoFormulario(true);
  carregarResumoPlano();
}

function aplicarPadroesDaGestao(g) {
  if (!E.hora && g.reuniao_hora) E.hora = g.reuniao_hora;
  if (!E.local && g.reuniao_local) E.local = g.reuniao_local;
}

function ligarEventosFormulario() {
  const id = (x) => document.getElementById(x);
  id("ata-tipo").addEventListener("change", (e) => {
    E.tipo = e.target.value;
    atualizarPrevia();
    agendarRascunho();
  });
  id("ata-data").addEventListener("change", async (e) => {
    E.data = e.target.value || hojeISOLocal();
    await recarregarMembros();
    renderPresenca();
    atualizarPrevia();
    agendarRascunho();
  });
  id("ata-hora").addEventListener("input", (e) => ((E.hora = e.target.value), atualizarPrevia(), agendarRascunho()));
  id("ata-local").addEventListener("input", (e) => ((E.local = e.target.value), atualizarPrevia(), agendarRascunho()));
  id("ata-revisao-plano").addEventListener("change", (e) => ((E.revisaoPlano = e.target.checked), atualizarPrevia(), agendarRascunho()));
  id("ata-deliberacoes").addEventListener("input", (e) => ((E.deliberacoes = e.target.value), atualizarPrevia(), agendarRascunho()));
  id("ata-encerramento").addEventListener("input", (e) => ((E.encerramento = e.target.value), atualizarPrevia(), agendarRascunho()));
  id("btn-novo-item-pauta").addEventListener("click", () => {
    E.pauta.push("");
    renderPauta(true);
    agendarRascunho();
  });
  id("btn-nova-acao").addEventListener("click", () => {
    E.acoes.push({ id: null, descricao: "", responsavel: "", prazo: "", tema: "Outros", prioridade: "Média" });
    renderAcoes(true);
    agendarRascunho();
  });
  id("btn-salvar-ata").addEventListener("click", salvarAta);
  id("btn-limpar-rascunho").addEventListener("click", (ev) => {
    ev.preventDefault();
    if (!confirm("Descartar o rascunho e começar uma reunião em branco?")) return;
    reiniciarFormulario();
  });
}

// Preenche os campos a partir do estado E
function refletirNoFormulario(primeira) {
  const id = (x) => document.getElementById(x);
  id("ata-tipo").value = E.tipo;
  id("ata-data").value = E.data;
  id("ata-hora").value = E.hora || "";
  id("ata-local").value = E.local || "";
  id("ata-revisao-plano").checked = !!E.revisaoPlano;
  id("ata-deliberacoes").value = E.deliberacoes || "";
  id("ata-encerramento").value = E.encerramento || "";
  const sel = document.getElementById("filtro-gestao");
  if (sel && E.gestaoId) sel.value = E.gestaoId;
  renderPauta();
  renderAcoes();
  renderPresenca();
  atualizarAvisoEdicao();
  atualizarPrevia();
  atualizarStatusRascunho();
}

// ---------------- Pauta ----------------
function renderPauta(focarUltimo) {
  const box = document.getElementById("pauta-lista");
  if (!E.pauta.length) E.pauta = [""];
  box.innerHTML = E.pauta
    .map(
      (t, i) => `<div class="pauta-item"><span class="small text-muted" style="min-width:22px;">${i + 1}.</span>
        <input type="text" data-i="${i}" value="${escHtml(t)}" placeholder="Assunto da pauta" />
        <button type="button" class="btn btn-secondary btn-rm-pauta" data-i="${i}" title="Remover item">✕</button></div>`
    )
    .join("");
  box.querySelectorAll("input").forEach((inp) =>
    inp.addEventListener("input", () => {
      E.pauta[Number(inp.dataset.i)] = inp.value;
      atualizarPrevia();
      agendarRascunho();
    })
  );
  box.querySelectorAll(".btn-rm-pauta").forEach((b) =>
    b.addEventListener("click", () => {
      E.pauta.splice(Number(b.dataset.i), 1);
      renderPauta();
      atualizarPrevia();
      agendarRascunho();
    })
  );
  if (focarUltimo) {
    const ins = box.querySelectorAll("input");
    if (ins.length) ins[ins.length - 1].focus();
  }
}

// ---------------- Resumo do Plano de Ação (para a pauta) ----------------
async function carregarResumoPlano() {
  const box = document.getElementById("plano-resumo");
  try {
    const { data, error } = await supabaseClient.from("cipa_acoes").select("descricao,responsavel,prazo,data_conclusao").is("data_conclusao", null).order("prazo", { ascending: true, nullsFirst: false });
    if (error) throw error;
    const abertas = data || [];
    const atrasadas = abertas.filter((a) => a.prazo && a.prazo < hojeISOLocal());
    const atual = { abertas: abertas.length, atrasadas: atrasadas.length };
    if (!E.editId || !E.planoResumo) E.planoResumo = atual;
    const lista = [...atrasadas, ...abertas.filter((a) => !atrasadas.includes(a))].slice(0, 6);
    box.innerHTML = abertas.length
      ? `<b>${abertas.length}</b> ação(ões) em aberto, <b style="color:var(--danger);">${atrasadas.length}</b> atrasada(s). <a href="plano-acao.html" style="color:var(--brand-red);font-weight:700;">Abrir Plano de Ação</a>
         <ul>${lista.map((a) => `<li>${escHtml(a.descricao)} <span class="text-muted">— ${escHtml(a.responsavel || "sem responsável")}${a.prazo ? ", prazo " + formatarDataBR(a.prazo) : ""}${a.prazo && a.prazo < hojeISOLocal() ? ' <b style="color:var(--danger);">(atrasada)</b>' : ""}</span></li>`).join("")}${abertas.length > lista.length ? `<li class="text-muted">e mais ${abertas.length - lista.length}...</li>` : ""}</ul>`
      : "Nenhuma ação em aberto no Plano de Ação.";
    atualizarPrevia();
  } catch (err) {
    console.error(err);
    box.textContent = "Não foi possível consultar o Plano de Ação.";
  }
}

// ---------------- Ações decididas ----------------
function renderAcoes(focarUltima) {
  const box = document.getElementById("acoes-lista");
  document.getElementById("acoes-vazio").style.display = E.acoes.length ? "none" : "block";
  box.innerHTML = E.acoes
    .map(
      (a, i) => `<div class="acao-linha" data-i="${i}">
        <div class="field"><label>Ação *</label><input type="text" data-c="descricao" value="${escHtml(a.descricao)}" placeholder="O que precisa ser feito?" /></div>
        <div class="field"><label>Responsável *</label><input type="text" data-c="responsavel" list="lista-membros-ata" value="${escHtml(a.responsavel)}" placeholder="Nome" /></div>
        <div class="field"><label>Prazo *</label><input type="date" data-c="prazo" value="${escHtml(a.prazo)}" /></div>
        <div class="field"><label>Tema</label><select data-c="tema">${opcoesLista(TEMAS_ACAO, a.tema)}</select></div>
        <div class="field"><label>Prioridade</label><select data-c="prioridade">${opcoesLista(PRIORIDADES, a.prioridade)}</select></div>
        <button type="button" class="btn btn-secondary btn-rm-acao" title="Remover ação">✕</button>
      </div>`
    )
    .join("");
  box.querySelectorAll(".acao-linha").forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelectorAll("[data-c]").forEach((campo) => {
      const ev = campo.tagName === "SELECT" || campo.type === "date" ? "change" : "input";
      campo.addEventListener(ev, () => {
        E.acoes[i][campo.dataset.c] = campo.value;
        atualizarPrevia();
        agendarRascunho();
      });
    });
    row.querySelector(".btn-rm-acao").addEventListener("click", () => {
      E.acoes.splice(i, 1);
      renderAcoes();
      atualizarPrevia();
      agendarRascunho();
    });
  });
  if (focarUltima) {
    const ins = box.querySelectorAll('input[data-c="descricao"]');
    if (ins.length) ins[ins.length - 1].focus();
  }
}

// ---------------- Presença ----------------
async function recarregarMembros() {
  const lista = await membrosAtivos(E.gestaoId, E.data);
  const mapa = new Map();
  lista.forEach((m) => mapa.set(m.id, m));
  MEMBROS_EXTRAS.forEach((m) => mapa.set(m.id, mapa.get(m.id) || m));
  MEMBROS = ordenarMembros([...mapa.values()]);
  MEMBROS.forEach((m) => {
    if (!E.presenca[m.id]) E.presenca[m.id] = { presente: true, justificativa: "" };
  });
}

function rotuloMembro(m) {
  const partes = [];
  if (m.cargo_cipa) partes.push(m.cargo_cipa);
  partes.push(m.tipo === "Apoio" || m.representacao === "Apoio" ? "Apoio" : `${m.representacao} · ${m.tipo}`);
  return partes.join(" · ");
}

function renderPresenca() {
  const box = document.getElementById("presenca-lista");
  if (!MEMBROS.length) {
    box.innerHTML = '<div class="empty-state small" style="grid-column:1/-1;">Nenhum membro ativo encontrado para esta gestão e data. Cadastre em <a href="membros.html" style="color:var(--brand-red);font-weight:700;">Membros e Mandato</a>.</div>';
    resumoPresenca();
    return;
  }
  box.innerHTML = MEMBROS.map((m) => {
    const p = E.presenca[m.id] || { presente: true, justificativa: "" };
    return `<div class="presenca-item ${p.presente ? "" : "ausente"}" data-id="${m.id}">
      <label class="presenca-check"><input type="checkbox" ${p.presente ? "checked" : ""} />
        <span><b>${escHtml(m.nome)}</b><br><span class="small text-muted">${escHtml(rotuloMembro(m))}</span></span></label>
      <input type="text" class="txt-justificativa" placeholder="Motivo da ausência (opcional)" value="${escHtml(p.justificativa || "")}" style="${p.presente ? "display:none;" : ""}" />
    </div>`;
  }).join("");
  box.querySelectorAll(".presenca-item").forEach((item) => {
    const id = item.dataset.id;
    const chk = item.querySelector("input[type=checkbox]");
    const txt = item.querySelector(".txt-justificativa");
    chk.addEventListener("change", () => {
      E.presenca[id].presente = chk.checked;
      item.classList.toggle("ausente", !chk.checked);
      txt.style.display = chk.checked ? "none" : "";
      if (chk.checked) E.presenca[id].justificativa = "";
      resumoPresenca();
      atualizarPrevia();
      agendarRascunho();
    });
    txt.addEventListener("input", () => {
      E.presenca[id].justificativa = txt.value;
      atualizarPrevia();
      agendarRascunho();
    });
  });
  resumoPresenca();
}

function resumoPresenca() {
  const pres = MEMBROS.filter((m) => (E.presenca[m.id] || {}).presente !== false).length;
  document.getElementById("presenca-resumo").innerHTML = `<b>${pres}</b> presente(s) · <b>${MEMBROS.length - pres}</b> ausente(s)`;
}

// =========================================================================
// TEXTO DA ATA (usado na prévia, no conteúdo salvo e no PDF)
// =========================================================================
function dataExtenso(iso) {
  const d = dataDeISO(iso);
  return `${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()} de ${d.getFullYear()} (${DIAS_SEMANA[d.getDay()]})`;
}

// e = estado; membros = lista [{id,nome,cargo_cipa,representacao,tipo}]
function partesAta(e, membros) {
  const gestao = GESTOES.find((g) => g.id === e.gestaoId);
  const presentes = membros.filter((m) => (e.presenca[m.id] || {}).presente !== false);
  const ausentes = membros.filter((m) => (e.presenca[m.id] || {}).presente === false);
  const quando = `Aos ${dataExtenso(e.data)}${e.hora ? ", às " + e.hora : ""}${e.local ? ", em " + e.local : ""}`;
  const abertura = `${quando}, reuniu-se a Comissão Interna de Prevenção de Acidentes (CIPA) da Boxer Soldas${gestao ? ", gestão " + gestao.nome : ""}, em reunião ${e.tipo.toLowerCase()}, com a presença de ${presentes.length} membro(s) e ${ausentes.length} ausência(s), conforme registrado abaixo.`;
  const pauta = [];
  if (e.revisaoPlano) {
    const r = e.planoResumo;
    pauta.push("Revisão do Plano de Ação" + (r ? ` (${r.abertas} ação(ões) em aberto, ${r.atrasadas} atrasada(s))` : ""));
  }
  (e.pauta || []).map((t) => t.trim()).filter(Boolean).forEach((t) => pauta.push(t));
  const acoes = (e.acoes || [])
    .filter((a) => a.descricao && a.descricao.trim())
    .map((a) => `${a.descricao.trim()} — Responsável: ${a.responsavel || "a definir"} — Prazo: ${a.prazo ? formatarDataBR(a.prazo) : "a definir"} — Prioridade: ${a.prioridade || "Média"} — Tema: ${a.tema || "Outros"}`);
  return {
    titulo: "ATA DA REUNIÃO DA CIPA BOXER",
    subtitulo: `Reunião ${e.tipo}${gestao ? " · Gestão " + gestao.nome : ""}`,
    abertura,
    presentes: presentes.map((m) => `${m.nome} (${rotuloMembro(m)})`),
    ausentes: ausentes.map((m) => `${m.nome}${(e.presenca[m.id] || {}).justificativa ? " — " + e.presenca[m.id].justificativa : ""}`),
    pauta,
    deliberacoes: (e.deliberacoes || "").trim(),
    acoes,
    encerramento: (e.encerramento || "").trim(),
    fecho: "Nada mais havendo a tratar, a reunião foi encerrada. A presente ata será assinada pelos membros presentes.",
  };
}

function textoAta(p) {
  const L = [];
  L.push(p.titulo, p.subtitulo, "", p.abertura, "");
  L.push("PRESENTES");
  L.push(...(p.presentes.length ? p.presentes.map((x) => "- " + x) : ["- Nenhum registro"]));
  L.push("", "AUSENTES");
  L.push(...(p.ausentes.length ? p.ausentes.map((x) => "- " + x) : ["- Nenhum"]));
  L.push("", "PAUTA");
  L.push(...(p.pauta.length ? p.pauta.map((x, i) => `${i + 1}. ${x}`) : ["- Sem itens registrados"]));
  L.push("", "DISCUSSÃO E DELIBERAÇÕES", p.deliberacoes || "- Sem registro");
  if (p.acoes.length) {
    L.push("", "AÇÕES DEFINIDAS");
    L.push(...p.acoes.map((x, i) => `${i + 1}. ${x}`));
  }
  L.push("", "ENCERRAMENTO");
  if (p.encerramento) L.push(p.encerramento);
  L.push(p.fecho);
  return L.join("\n");
}

function atualizarPrevia() {
  const el = document.getElementById("ata-previa");
  if (!el) return;
  el.textContent = textoAta(partesAta(E, MEMBROS));
}

// =========================================================================
// RASCUNHO (guardado só neste computador)
// =========================================================================
function lerRascunho() {
  try {
    const t = localStorage.getItem(CHAVE_RASCUNHO);
    return t ? JSON.parse(t) : null;
  } catch (e) {
    return null;
  }
}
function estadoTemConteudo() {
  return (
    !!E.editId ||
    !!E.deliberacoes.trim() ||
    !!E.encerramento.trim() ||
    E.acoes.length > 0 ||
    E.pauta.some((t) => t.trim()) ||
    Object.values(E.presenca).some((p) => p.presente === false)
  );
}
function agendarRascunho() {
  clearTimeout(rascunhoTimer);
  rascunhoTimer = setTimeout(guardarRascunho, 600);
}
function guardarRascunho() {
  try {
    if (!estadoTemConteudo()) {
      localStorage.removeItem(CHAVE_RASCUNHO);
    } else {
      localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(E));
    }
  } catch (e) {}
  atualizarStatusRascunho();
}
function limparRascunho() {
  clearTimeout(rascunhoTimer);
  try {
    localStorage.removeItem(CHAVE_RASCUNHO);
  } catch (e) {}
}
function atualizarStatusRascunho() {
  const st = document.getElementById("rascunho-status");
  const lk = document.getElementById("btn-limpar-rascunho");
  if (!st) return;
  const tem = estadoTemConteudo();
  st.textContent = tem ? "💾 Rascunho salvo às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  lk.style.display = tem ? "inline" : "none";
}

function reiniciarFormulario() {
  limparRascunho();
  const gestaoId = E.gestaoId;
  E = novoEstado();
  E.gestaoId = gestaoId;
  ACOES_DB = {};
  MEMBROS_EXTRAS = [];
  const g = GESTOES.find((x) => x.id === gestaoId);
  if (g) aplicarPadroesDaGestao(g);
  recarregarMembros().then(() => {
    refletirNoFormulario(false);
    carregarResumoPlano();
  });
}

// =========================================================================
// SALVAR (nova ou edição)
// =========================================================================
function validarFormulario() {
  if (!E.data) return "Informe a data da reunião.";
  for (const [i, a] of E.acoes.entries()) {
    const preenchida = a.descricao.trim() || a.responsavel.trim() || a.prazo;
    if (!preenchida) continue;
    if (!a.descricao.trim() || !a.responsavel.trim() || !a.prazo) return `Ação ${i + 1}: preencha a descrição, o responsável e o prazo (ou remova a ação).`;
  }
  return null;
}

async function salvarAta() {
  const erro = validarFormulario();
  if (erro) return showToast(erro, "error");
  const acoesValidas = E.acoes.filter((a) => a.descricao.trim());
  const btn = document.getElementById("btn-salvar-ata");
  btn.disabled = true;
  let ataId = E.editId;
  const novaAta = !E.editId;
  try {
    const partes = partesAta(E, MEMBROS);
    const registro = {
      versao: 1,
      pauta: E.pauta.map((t) => t.trim()).filter(Boolean),
      revisaoPlano: !!E.revisaoPlano,
      planoResumo: E.planoResumo || null,
      deliberacoes: E.deliberacoes,
      encerramento: E.encerramento,
      acaoIds: [],
    };
    const payload = {
      gestao_id: E.gestaoId || null,
      tipo: E.tipo,
      data_reuniao: E.data,
      hora: E.hora.trim() || null,
      local: E.local.trim() || null,
      pauta: partes.pauta.join("\n"),
      conteudo: textoAta(partes),
      registro,
    };

    if (novaAta) {
      const { data, error } = await supabaseClient.from("cipa_atas").insert(payload).select("id").single();
      if (error) throw error;
      ataId = data.id;
    } else {
      const { error } = await supabaseClient.from("cipa_atas").update(payload).eq("id", ataId);
      if (error) throw error;
    }

    // Presença (upsert não mexe no campo "assinado")
    const linhas = MEMBROS.map((m) => {
      const p = E.presenca[m.id] || { presente: true };
      return { ata_id: ataId, membro_id: m.id, presente: p.presente !== false, justificativa: p.presente === false ? (p.justificativa || "").trim() || null : null };
    });
    if (linhas.length) {
      const { error } = await supabaseClient.from("cipa_ata_presencas").upsert(linhas, { onConflict: "ata_id,membro_id" });
      if (error) throw error;
    }

    // Ações: atualiza as que já existiam, cria as novas, apaga as retiradas
    const idsMantidos = [];
    for (const a of acoesValidas) {
      const base = {
        descricao: a.descricao.trim(),
        responsavel: a.responsavel.trim(),
        prazo: a.prazo,
        tema: a.tema || "Outros",
        prioridade: a.prioridade || "Média",
        updated_at: new Date().toISOString(),
      };
      if (a.id && ACOES_DB[a.id]) {
        const { error } = await supabaseClient
          .from("cipa_acoes")
          .update({ ...base, status: statusAcao({ prazo: a.prazo, data_conclusao: ACOES_DB[a.id].data_conclusao }) })
          .eq("id", a.id);
        if (error) throw error;
        idsMantidos.push(a.id);
      } else {
        const { data, error } = await supabaseClient
          .from("cipa_acoes")
          .insert({ ...base, ata_id: ataId, origem: "Reunião", status: statusAcao({ prazo: a.prazo, data_conclusao: null }) })
          .select("id")
          .single();
        if (error) throw error;
        a.id = data.id;
        idsMantidos.push(data.id);
      }
    }
    const removidas = Object.keys(ACOES_DB).filter((id) => !idsMantidos.includes(id));
    if (removidas.length) {
      const { error } = await supabaseClient.from("cipa_acoes").delete().in("id", removidas);
      if (error) throw error;
    }
    registro.acaoIds = idsMantidos;
    await supabaseClient.from("cipa_atas").update({ registro }).eq("id", ataId);

    showToast(novaAta ? "ATA salva!" : "Alterações salvas!", "success");
    reiniciarFormulario();
    document.querySelector('.tab-btn[data-tab="historico"]').click();
  } catch (err) {
    console.error(err);
    // Desfaz uma ATA nova que ficou pela metade
    if (novaAta && ataId) {
      try {
        await supabaseClient.from("cipa_acoes").delete().eq("ata_id", ataId);
        await supabaseClient.from("cipa_atas").delete().eq("id", ataId);
      } catch (e) {}
      E.acoes.forEach((a) => (a.id = null));
    }
    showToast("Erro ao salvar a ATA: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// =========================================================================
// EDIÇÃO DE ATA JÁ SALVA
// =========================================================================
async function buscarAtaCompleta(ataId) {
  const [a, p, ac] = await Promise.all([
    supabaseClient.from("cipa_atas").select("*").eq("id", ataId).single(),
    supabaseClient.from("cipa_ata_presencas").select("*, membro:cipa_membros(*)").eq("ata_id", ataId),
    supabaseClient.from("cipa_acoes").select("*").eq("ata_id", ataId).order("created_at"),
  ]);
  if (a.error) throw a.error;
  if (p.error) throw p.error;
  if (ac.error) throw ac.error;
  return { ata: a.data, presencas: p.data || [], acoes: ac.data || [] };
}

function estadoDeAta(ata, presencas, acoes) {
  const reg = ata.registro || {};
  const e = novoEstado();
  e.editId = ata.id;
  e.editData = ata.data_reuniao;
  e.gestaoId = ata.gestao_id;
  e.tipo = ata.tipo;
  e.data = ata.data_reuniao;
  e.hora = ata.hora || "";
  e.local = ata.local || "";
  e.revisaoPlano = reg.revisaoPlano !== undefined ? !!reg.revisaoPlano : false;
  e.planoResumo = reg.planoResumo || null;
  e.pauta = Array.isArray(reg.pauta) ? [...reg.pauta] : String(ata.pauta || "").split("\n").filter((t) => t && !t.startsWith("Revisão do Plano de Ação"));
  e.deliberacoes = reg.deliberacoes !== undefined ? reg.deliberacoes : ata.conteudo || "";
  e.encerramento = reg.encerramento || "";
  e.acoes = acoes.map((a) => ({ id: a.id, descricao: a.descricao, responsavel: a.responsavel || "", prazo: a.prazo || "", tema: a.tema || "Outros", prioridade: a.prioridade || "Média" }));
  presencas.forEach((p) => (e.presenca[p.membro_id] = { presente: p.presente, justificativa: p.justificativa || "" }));
  return e;
}

async function iniciarEdicao(ataId) {
  const emAndamento = estadoTemConteudo();
  if (emAndamento) {
    const msg = E.editId ? "Você já está editando outra ATA. Descartar essas alterações e abrir esta?" : "Há um rascunho de nova reunião em andamento. Ele será substituído pela ATA que você quer editar. Continuar?";
    if (!confirm(msg)) return;
  }
  try {
    const { ata, presencas, acoes } = await buscarAtaCompleta(ataId);
    E = estadoDeAta(ata, presencas, acoes);
    ACOES_DB = {};
    acoes.forEach((a) => (ACOES_DB[a.id] = a));
    MEMBROS_EXTRAS = presencas.map((p) => p.membro).filter(Boolean);
    await recarregarMembros();
    refletirNoFormulario(false);
    guardarRascunho();
    document.querySelector('.tab-btn[data-tab="nova"]').click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    showToast("Não foi possível abrir a ATA: " + err.message, "error");
  }
}

// Rascunho que era uma edição: recarrega as ações gravadas e os membros da ATA
async function prepararEdicaoDoRascunho() {
  try {
    const { presencas, acoes } = await buscarAtaCompleta(E.editId);
    ACOES_DB = {};
    acoes.forEach((a) => (ACOES_DB[a.id] = a));
    MEMBROS_EXTRAS = presencas.map((p) => p.membro).filter(Boolean);
  } catch (err) {
    // a ATA pode ter sido excluída: volta a uma reunião nova
    console.error(err);
    E.editId = null;
    E.editData = null;
    E.acoes.forEach((a) => (a.id = null));
  }
}

function atualizarAvisoEdicao() {
  const sec = document.getElementById("tab-nova");
  const btn = document.getElementById("btn-salvar-ata");
  let av = document.getElementById("aviso-edicao");
  btn.textContent = E.editId ? "💾 Salvar alterações" : "💾 Salvar ATA";
  if (!E.editId) return av && av.remove();
  if (!av) {
    av = document.createElement("div");
    av.id = "aviso-edicao";
    av.className = "aviso-edicao";
    sec.prepend(av);
  }
  av.innerHTML = `✏️ Você está <b>editando a ATA de ${formatarDataBR(E.editData)}</b>, que já foi salva. As alterações só valem quando você clicar em <b>Salvar alterações</b>.
    <button type="button" class="btn btn-secondary" id="btn-cancelar-edicao">Cancelar edição</button>`;
  av.querySelector("#btn-cancelar-edicao").onclick = () => {
    if (!confirm("Cancelar a edição? A ATA continua como estava.")) return;
    reiniciarFormulario();
  };
}

// =========================================================================
// HISTÓRICO
// =========================================================================
async function carregarHistorico() {
  const lista = document.getElementById("historico-lista");
  try {
    if (!GESTOES.length) GESTOES = await carregarGestoes();
    const [a, p] = await Promise.all([
      supabaseClient.from("cipa_atas").select("*").order("data_reuniao", { ascending: false }),
      supabaseClient.from("cipa_ata_presencas").select("ata_id,presente"),
    ]);
    if (a.error) throw a.error;
    historicoCache = a.data || [];
    presencasPorAta = {};
    (p.data || []).forEach((x) => {
      const r = (presencasPorAta[x.ata_id] = presencasPorAta[x.ata_id] || { presentes: 0, ausentes: 0 });
      x.presente ? r.presentes++ : r.ausentes++;
    });
    preencherFiltroAno();
    renderHistorico();
  } catch (err) {
    console.error(err);
    lista.innerHTML = "";
    showToast("Erro ao carregar o histórico: " + err.message, "error");
  }
}

function preencherFiltroAno() {
  const sel = document.getElementById("filtro-ano");
  const atual = sel.value;
  const anos = [...new Set(historicoCache.map((a) => a.data_reuniao.slice(0, 4)))].sort().reverse();
  sel.innerHTML = '<option value="todos">Todos</option>' + anos.map((y) => `<option ${y === atual ? "selected" : ""}>${y}</option>`).join("");
  if (!sel.dataset.ligado) {
    sel.dataset.ligado = "1";
    sel.addEventListener("change", renderHistorico);
    document.getElementById("filtro-tipo").addEventListener("change", renderHistorico);
  }
}

function renderHistorico() {
  const ano = document.getElementById("filtro-ano").value;
  const tipo = document.getElementById("filtro-tipo").value;
  const lista = historicoCache.filter((a) => (ano === "todos" || a.data_reuniao.startsWith(ano)) && (tipo === "todos" || a.tipo === tipo));
  const box = document.getElementById("historico-lista");
  document.getElementById("historico-empty").style.display = lista.length ? "none" : "block";
  box.innerHTML = lista
    .map((a) => {
      const pr = presencasPorAta[a.id] || { presentes: 0, ausentes: 0 };
      const g = GESTOES.find((x) => x.id === a.gestao_id);
      return `<div class="historico-ata" id="ata-${a.id}" data-id="${a.id}">
        <div class="historico-cab">
          <div>
            <h4>ATA ${escHtml(a.tipo)} — ${formatarDataBR(a.data_reuniao)}${a.hora ? " · " + escHtml(a.hora) : ""}</h4>
            <div class="small text-muted">${a.local ? escHtml(a.local) + " · " : ""}${g ? "Gestão " + escHtml(g.nome) + " · " : ""}<b>${pr.presentes}</b> presente(s) · <b>${pr.ausentes}</b> ausente(s)</div>
          </div>
          <div>${a.arquivo_assinado_url ? '<span class="badge badge-ok">ATA assinada anexada</span>' : '<span class="badge badge-warn">Aguardando ATA assinada</span>'}</div>
        </div>
        <div class="historico-acoes">
          <a href="#" class="btn btn-secondary btn-ver" data-id="${a.id}">👁️ Ver detalhes</a>
          <button class="btn btn-outline btn-gerar-pdf" data-id="${a.id}">📄 Gerar PDF</button>
          <label class="btn btn-secondary" style="cursor:pointer;margin:0;">📎 Anexar assinada
            <input type="file" accept="application/pdf,image/*" class="input-upload-assinada" data-id="${a.id}" style="display:none;" /></label>
          ${a.arquivo_assinado_url ? `<a href="${escHtml(a.arquivo_assinado_url)}" target="_blank" rel="noopener" class="btn btn-secondary">📂 Ver assinada</a>` : ""}
          <button class="btn btn-secondary btn-editar" data-id="${a.id}">✏️ Editar</button>
          <button class="btn btn-secondary btn-excluir" data-id="${a.id}">🗑️ Excluir</button>
        </div>
        <div class="historico-detalhe" style="display:none;"></div>
      </div>`;
    })
    .join("");
  box.querySelectorAll(".btn-ver").forEach((b) => b.addEventListener("click", (ev) => (ev.preventDefault(), abrirDetalhe(b.dataset.id))));
  box.querySelectorAll(".btn-gerar-pdf").forEach((b) => b.addEventListener("click", () => gerarPdfAta(b.dataset.id, b)));
  box.querySelectorAll(".input-upload-assinada").forEach((i) => i.addEventListener("change", (e) => anexarAssinada(e, i.dataset.id)));
  box.querySelectorAll(".btn-editar").forEach((b) => b.addEventListener("click", () => iniciarEdicao(b.dataset.id)));
  box.querySelectorAll(".btn-excluir").forEach((b) => b.addEventListener("click", () => excluirAta(b.dataset.id)));
}

async function abrirDetalhe(ataId) {
  const card = document.getElementById("ata-" + ataId);
  if (!card) return;
  const det = card.querySelector(".historico-detalhe");
  if (det.style.display !== "none" && det.dataset.carregado) {
    det.style.display = "none";
    return;
  }
  det.style.display = "block";
  det.innerHTML = '<p class="small text-muted">Carregando...</p>';
  try {
    const { ata, presencas, acoes } = await buscarAtaCompleta(ataId);
    const pres = presencas.filter((p) => p.presente).sort((x, y) => (x.membro?.nome || "").localeCompare(y.membro?.nome || "", "pt-BR"));
    const aus = presencas.filter((p) => !p.presente).sort((x, y) => (x.membro?.nome || "").localeCompare(y.membro?.nome || "", "pt-BR"));
    det.dataset.carregado = "1";
    det.innerHTML = `
      <h5>Texto da ATA</h5><pre class="ata-previa" style="margin-top:0;">${escHtml(ata.conteudo)}</pre>
      <h5>Presentes (${pres.length})</h5><div class="lista-nomes">${pres.map((p) => `<span class="nome-chip">${escHtml(p.membro?.nome || "—")}</span>`).join("") || '<span class="small text-muted">Nenhum registro.</span>'}</div>
      <h5>Ausentes (${aus.length})</h5><div class="lista-nomes">${aus.map((p) => `<span class="nome-chip ausente">${escHtml(p.membro?.nome || "—")}${p.justificativa ? " — " + escHtml(p.justificativa) : ""}</span>`).join("") || '<span class="small text-muted">Nenhum.</span>'}</div>
      <h5>Ações geradas (${acoes.length})</h5>
      ${
        acoes.length
          ? `<div class="table-wrap"><table><thead><tr><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Prioridade</th><th>Status</th></tr></thead><tbody>${acoes
              .map((a) => `<tr><td>${escHtml(a.descricao)}</td><td>${escHtml(a.responsavel || "-")}</td><td>${formatarDataBR(a.prazo)}</td><td>${badgePrioridade(a.prioridade)}</td><td>${badgeStatus(statusAcao(a))}</td></tr>`)
              .join("")}</tbody></table></div><p class="small mt-16"><a href="plano-acao.html" style="color:var(--brand-red);font-weight:700;">Abrir Plano de Ação</a></p>`
          : '<span class="small text-muted">Nenhuma ação nesta reunião.</span>'
      }`;
  } catch (err) {
    det.innerHTML = `<p class="small" style="color:var(--danger);">Não foi possível carregar: ${escHtml(err.message)}</p>`;
  }
}

// ---------------- Anexar ATA assinada ----------------
async function anexarAssinada(ev, ataId) {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    showToast("Enviando arquivo...");
    const url = await anexarArquivoCipa(file);
    const { error } = await supabaseClient.from("cipa_atas").update({ arquivo_assinado_url: url }).eq("id", ataId);
    if (error) throw error;
    showToast("ATA assinada anexada!", "success");
    carregarHistorico();
  } catch (err) {
    showToast("Erro ao anexar: " + err.message, "error");
  } finally {
    ev.target.value = "";
  }
}

// ---------------- Excluir ----------------
async function excluirAta(ataId) {
  const a = historicoCache.find((x) => x.id === ataId);
  if (!a) return;
  if (!confirmarExclusao(`Excluir a ATA de ${formatarDataBR(a.data_reuniao)} e a lista de presença?`)) return;
  try {
    const { count } = await supabaseClient.from("cipa_acoes").select("id", { count: "exact", head: true }).eq("ata_id", ataId);
    if (count) {
      const tambem = confirm(`Esta ATA gerou ${count} ação(ões) no Plano de Ação.\n\nOK = excluir também as ações\nCancelar = manter as ações no Plano (sem ligação com a ATA)`);
      if (tambem) {
        const { error } = await supabaseClient.from("cipa_acoes").delete().eq("ata_id", ataId);
        if (error) throw error;
      }
    }
    const { error } = await supabaseClient.from("cipa_atas").delete().eq("id", ataId);
    if (error) throw error;
    if (E.editId === ataId) reiniciarFormulario();
    showToast("ATA excluída.", "success");
    carregarHistorico();
  } catch (err) {
    showToast("Erro ao excluir: " + err.message, "error");
  }
}

// =========================================================================
// PDF
// =========================================================================
async function gerarPdfAta(ataId, btn) {
  if (btn) btn.disabled = true;
  try {
    const { ata, presencas, acoes } = await buscarAtaCompleta(ataId);
    const e = estadoDeAta(ata, presencas, acoes);
    const membros = ordenarMembros(presencas.map((p) => p.membro).filter(Boolean));
    const partes = partesAta(e, membros);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const larg = doc.internal.pageSize.getWidth();
    const alt = doc.internal.pageSize.getHeight();
    const mx = 14;
    let y = await cabecalhoPdf(doc, partes.titulo, [partes.subtitulo, `${formatarDataBR(ata.data_reuniao)}${ata.hora ? " · " + ata.hora : ""}${ata.local ? " · " + ata.local : ""}`]);

    const garantir = (h) => {
      if (y + h > alt - 18) {
        doc.addPage();
        y = 18;
      }
    };
    const titulo = (t) => {
      garantir(14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...COR_MARCA);
      doc.text(t, mx, y);
      y += 5.5;
      doc.setTextColor(40, 40, 40);
    };
    const paragrafo = (texto, indent = 0) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(40, 40, 40);
      doc.splitTextToSize(texto, larg - 2 * mx - indent).forEach((linha) => {
        garantir(6);
        doc.text(linha, mx + indent, y);
        y += 5;
      });
    };

    paragrafo(partes.abertura);
    y += 3;
    titulo("PAUTA");
    if (partes.pauta.length) partes.pauta.forEach((t, i) => paragrafo(`${i + 1}. ${t}`, 2));
    else paragrafo("Sem itens registrados.", 2);
    y += 3;
    titulo("DISCUSSÃO E DELIBERAÇÕES");
    paragrafo(partes.deliberacoes || "Sem registro.");
    y += 3;

    if (partes.acoes.length) {
      titulo("AÇÕES DEFINIDAS");
      doc.autoTable({
        startY: y,
        head: [["#", "Ação", "Responsável", "Prazo", "Prioridade"]],
        body: e.acoes.filter((a) => a.descricao).map((a, i) => [i + 1, a.descricao, a.responsavel || "a definir", a.prazo ? formatarDataBR(a.prazo) : "a definir", a.prioridade || "Média"]),
        styles: { fontSize: 8.5 },
        headStyles: CORES_TABELA_PDF,
        columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 78 } },
        margin: { left: mx, right: mx, bottom: 16 },
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    titulo("ENCERRAMENTO");
    if (partes.encerramento) paragrafo(partes.encerramento);
    paragrafo(partes.fecho);
    y += 4;

    // Assinaturas: só os presentes
    const presentesLista = membros.filter((m) => (e.presenca[m.id] || {}).presente !== false);
    garantir(30);
    titulo(`LISTA DE PRESENÇA E ASSINATURAS (${presentesLista.length} presente(s))`);
    doc.autoTable({
      startY: y,
      head: [["Nome", "Função na CIPA", "Assinatura"]],
      body: presentesLista.map((m) => [m.nome, rotuloMembro(m), ""]),
      styles: { fontSize: 9, minCellHeight: 12, valign: "middle" },
      headStyles: CORES_TABELA_PDF,
      columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 55 } },
      margin: { left: mx, right: mx, bottom: 16 },
    });
    y = doc.lastAutoTable.finalY + 6;

    const ausentesLista = membros.filter((m) => (e.presenca[m.id] || {}).presente === false);
    if (ausentesLista.length) {
      titulo("AUSENTES");
      ausentesLista.forEach((m) => paragrafo(`- ${m.nome}${e.presenca[m.id].justificativa ? " — " + e.presenca[m.id].justificativa : ""}`, 2));
    }

    rodapePdf(doc);
    doc.save(`ata-cipa-boxer-${ata.data_reuniao}.pdf`);
  } catch (err) {
    console.error(err);
    showToast("Erro ao gerar o PDF: " + err.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

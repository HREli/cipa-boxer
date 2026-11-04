// =========================================================================
// CIPA BOXER - Inspeções de Segurança (EPI, ergonomia, ambiente, máquinas, emergência)
// =========================================================================

const CHECKLIST = [
  {
    grupo: "EPI",
    tema: "EPI e EPC",
    itens: [
      "Uso correto dos EPIs pelos colaboradores",
      "EPIs com CA (Certificado de Aprovação) e dentro da validade",
      "Estado de conservação dos EPIs",
      "Máscara de solda com escurecimento adequado ao processo",
      "Luvas, avental e perneira de raspa em bom estado",
      "Óculos de proteção e protetor auricular disponíveis e em uso",
    ],
  },
  {
    grupo: "Ergonomia",
    tema: "Riscos ergonômicos e psicossociais",
    itens: [
      "Postura nos postos de trabalho",
      "Altura e ajuste de bancadas e cadeiras",
      "Levantamento manual de cargas (peso, auxílio mecânico)",
      "Pausas e revezamento nas tarefas repetitivas",
      "Iluminação adequada no posto de trabalho",
      "Monitores e teclados bem posicionados (administrativo)",
    ],
  },
  {
    grupo: "Condições do ambiente",
    tema: "Condições do ambiente",
    itens: [
      "Organização e limpeza",
      "Pisos e passagens livres e em bom estado",
      "Iluminação geral",
      "Ventilação e exaustão de fumos de solda",
      "Ruído",
      "Temperatura e conforto térmico",
      "Sinalização de segurança",
    ],
  },
  {
    grupo: "Máquinas e instalações elétricas",
    tema: "Máquinas e equipamentos",
    itens: [
      "Proteções de máquinas e partes móveis",
      "Aterramento, fios e tomadas em bom estado",
      "Quadros elétricos sinalizados e fechados",
      "Ferramentas em bom estado",
      "Cilindros de gás fixados e armazenados corretamente",
      "Biombos e cortinas de solda",
    ],
  },
  {
    grupo: "Emergência",
    tema: "Emergência e incêndio",
    itens: [
      "Saídas de emergência desimpedidas",
      "Extintores e hidrantes acessíveis e sinalizados",
      "Kit de primeiros socorros completo",
      "Lava-olhos e chuveiro de emergência (quando aplicável)",
    ],
  },
];
const PRAZO_POR_RISCO = { Alto: 7, Médio: 15, Baixo: 30 };
const PRIORIDADE_POR_RISCO = { Alto: "Alta", Médio: "Média", Baixo: "Baixa" };
const DIAS_EM_DIA = 35;

let membros = [];
let membroNome = {};
let gestao = null;
let inspecoes = [];
let acoesPorId = {};
let editId = null;
let achadosForm = [];
let achadosRemovidos = [];
const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  mostrarAvisoConfiguracao();
  if (!(await telaPronta())) return;
  configurarAbas();
  gestao = escolherGestao(await carregarGestoes());
  await carregarMembros();
  await carregarInspecoes();
  prepararFormulario();
  ["filtro-setor", "filtro-de", "filtro-ate", "filtro-resultado"].forEach((id) => $(id).addEventListener("change", renderHistorico));
  $("btn-salvar-insp").addEventListener("click", () => salvarTudo(false));
  $("btn-cancelar-insp").addEventListener("click", () => {
    resetarFormulario();
    ativarAba("historico");
  });
  $("btn-add-achado").addEventListener("click", () => {
    achadosForm.push(novoAchado());
    renderAchados();
  });
  $("btn-nc-achados").addEventListener("click", ncParaAchados);
  $("btn-gerar-todas").addEventListener("click", gerarTodasAcoes);
  const alvo = new URLSearchParams(location.search).get("inspecao");
  if (alvo) verInspecao(alvo);
});

// ---------------- Abas ----------------
function ativarAba(nome) {
  const btn = document.querySelector(`.tab-btn[data-tab="${nome}"]`);
  if (btn) btn.click();
}
function configurarAbas() {
  const botoes = document.querySelectorAll(".tab-btn");
  botoes.forEach((btn) =>
    btn.addEventListener("click", () => {
      botoes.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-content").forEach((s) => (s.style.display = "none"));
      $("tab-" + btn.dataset.tab).style.display = "block";
      if (btn.dataset.tab === "cobertura") renderCobertura();
      if (btn.dataset.tab === "historico") renderHistorico();
    })
  );
}

// ---------------- Dados ----------------
async function carregarMembros() {
  const { data: todos } = await supabaseClient.from("cipa_membros").select("id,nome");
  (todos || []).forEach((m) => (membroNome[m.id] = m.nome));
  membros = ordenarMembros(await membrosAtivos(gestao ? gestao.id : null, hojeISOLocal()));
}
const nomeMembro = (id) => (id && membroNome[id]) || "-";

async function carregarInspecoes() {
  const [ri, ra, rc] = await Promise.all([
    supabaseClient.from("cipa_inspecoes").select("*").order("data_inspecao", { ascending: false }),
    supabaseClient.from("cipa_achados").select("*").order("created_at"),
    supabaseClient.from("cipa_acoes").select("*").not("inspecao_id", "is", null),
  ]);
  if (ri.error) {
    console.error(ri.error);
    showToast("Não foi possível carregar as inspeções.", "error");
  }
  acoesPorId = {};
  (rc.data || []).forEach((a) => (acoesPorId[a.id] = a));
  const achPorInsp = {};
  (ra.data || []).forEach((a) => (achPorInsp[a.inspecao_id] = achPorInsp[a.inspecao_id] || []).push(a));
  inspecoes = (ri.data || []).map((i) => ({ ...i, achados: achPorInsp[i.id] || [], acoes: (rc.data || []).filter((a) => a.inspecao_id === i.id) }));
  montarFiltroSetor();
  montarListaSetores();
  renderHistorico();
}

function setoresUsados() {
  return [...new Set(inspecoes.map((i) => i.setor).filter(Boolean))];
}
function todosSetores() {
  const set = new Set([...SETORES_PADRAO, ...setoresUsados()]);
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
function montarListaSetores() {
  $("lista-setores").innerHTML = todosSetores().map((s) => `<option value="${escHtml(s)}"></option>`).join("");
  $("lista-resp").innerHTML = membros.map((m) => `<option value="${escHtml(m.nome)}"></option>`).join("");
}
function montarFiltroSetor() {
  const sel = $("filtro-setor");
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todos</option>' + setoresUsados().sort((a, b) => a.localeCompare(b, "pt-BR")).map((s) => `<option ${s === atual ? "selected" : ""}>${escHtml(s)}</option>`).join("");
}

// ---------------- Resumo do checklist ----------------
function resumoItens(itens) {
  const r = { c: 0, nc: 0, na: 0, total: 0, pct: null };
  (itens || []).forEach((i) => {
    if (i.situacao === "C") r.c++;
    else if (i.situacao === "NC") r.nc++;
    else if (i.situacao === "NA") r.na++;
  });
  r.total = r.c + r.nc;
  r.pct = r.total ? Math.round((r.c / r.total) * 100) : null;
  return r;
}
const chaveItem = (g, i) => `${g}|${i}`;

// ---------------- Formulário ----------------
function prepararFormulario() {
  $("insp-data").value = hojeISOLocal();
  const opcoes = '<option value="">Selecione...</option>' + membros.map((m) => `<option value="${m.id}">${escHtml(m.nome)}</option>`).join("");
  $("insp-inspetor1").innerHTML = opcoes;
  $("insp-inspetor2").innerHTML = '<option value="">(nenhum)</option>' + membros.map((m) => `<option value="${m.id}">${escHtml(m.nome)}</option>`).join("");
  renderChecklist({});
  renderAchados();
}

// Monta o checklist; `respostas` = { "grupo|item": "C" | "NC" | "NA" }
function renderChecklist(respostas) {
  const grupos = CHECKLIST.map((g) => ({ ...g, itens: [...g.itens] }));
  // itens antigos (editando) que não existem mais na lista padrão ficam num grupo à parte
  const conhecidos = new Set(CHECKLIST.flatMap((g) => g.itens.map((i) => chaveItem(g.grupo, i))));
  const extras = Object.keys(respostas).filter((k) => !conhecidos.has(k));
  if (extras.length) {
    const outros = { grupo: "Outros itens", tema: "Outros", itens: [] };
    extras.forEach((k) => outros.itens.push(k.split("|").slice(1).join("|")));
    grupos.push(outros);
  }
  let n = 0;
  $("checklist-form").innerHTML = grupos
    .map(
      (g) => `<div class="checklist-grupo">${escHtml(g.grupo)}</div>` +
        g.itens
          .map((item) => {
            const nome = "it" + n++;
            const k = chaveItem(g.grupo, item);
            const v = respostas[k] || "";
            const opc = (val, cls, rot) => `<label class="${cls} ${v === val ? "sel" : ""}"><input type="radio" name="${nome}" value="${val}" ${v === val ? "checked data-was='1'" : ""} />${rot}</label>`;
            return `<div class="checklist-linha" data-grupo="${escHtml(g.grupo)}" data-item="${escHtml(item)}">
              <div>${escHtml(item)}</div>
              <div class="checklist-opcoes">${opc("C", "c", "C")}${opc("NC", "nc", "NC")}${opc("NA", "na", "N/A")}</div></div>`;
          })
          .join("")
    )
    .join("");
  $("checklist-form").querySelectorAll("input[type=radio]").forEach((inp) =>
    inp.addEventListener("click", () => {
      const linha = inp.closest(".checklist-linha");
      if (inp.dataset.was === "1") {
        inp.checked = false;
        inp.dataset.was = "0";
      } else {
        linha.querySelectorAll("input").forEach((x) => (x.dataset.was = "0"));
        inp.dataset.was = "1";
      }
      linha.querySelectorAll("label").forEach((l) => l.classList.toggle("sel", l.querySelector("input").checked));
      atualizarResumoForm();
    })
  );
  atualizarResumoForm();
}

function coletarItens() {
  const out = [];
  $("checklist-form").querySelectorAll(".checklist-linha").forEach((linha) => {
    const marcado = linha.querySelector("input:checked");
    if (marcado) out.push({ grupo: linha.dataset.grupo, item: linha.dataset.item, situacao: marcado.value });
  });
  return out;
}
function atualizarResumoForm() {
  const itens = coletarItens();
  const r = resumoItens(itens);
  const total = $("checklist-form").querySelectorAll(".checklist-linha").length;
  $("resumo-checklist").innerHTML = `<span>Respondidos: <b>${itens.length}</b> de ${total}</span>
    <span class="res-c">Conformes: <b>${r.c}</b></span><span class="res-nc">Não conformes: <b>${r.nc}</b></span>
    <span class="res-na">N/A: <b>${r.na}</b></span><span>Conformidade: <b>${r.pct == null ? "-" : r.pct + "%"}</b></span>`;
}

// ---------------- Achados ----------------
function temaDoAchado(a) {
  if (a.grupo) {
    const g = CHECKLIST.find((x) => x.grupo === a.grupo);
    if (g) return g.tema;
  }
  const txt = (a.descricao || "").toLowerCase();
  const g = CHECKLIST.find((x) => x.itens.some((i) => txt.includes(i.toLowerCase())));
  return g ? g.tema : "Condições do ambiente";
}
function novoAchado(extra = {}) {
  return { id: null, descricao: "", risco: "Médio", acao_id: null, grupo: "", prazo: somarDias(hojeISOLocal(), PRAZO_POR_RISCO.Médio), responsavel: "", ...extra };
}

function renderAchados() {
  const box = $("achados-form");
  $("achados-vazio").style.display = achadosForm.length ? "none" : "block";
  box.innerHTML = achadosForm
    .map((a, i) => {
      const acao = a.acao_id ? acoesPorId[a.acao_id] : null;
      const lado = a.acao_id
        ? `<div><span class="badge badge-ok">Ação gerada</span> ${acao ? badgeStatus(statusAcao(acao)) : ""}<div class="small text-muted">${acao ? "Prazo: " + formatarDataBR(acao.prazo) : ""}</div></div>`
        : `<div><button type="button" class="btn btn-outline" data-gerar="${i}">⚡ Gerar ação</button></div>`;
      return `<div class="item-dinamico" data-i="${i}">
        <div class="achado-grid">
          <div class="field"><label>Descrição do achado</label><textarea data-campo="descricao" rows="2" placeholder="O que foi encontrado?">${escHtml(a.descricao)}</textarea></div>
          <div class="field"><label>Risco</label><select data-campo="risco">${opcoesLista(["Alto", "Médio", "Baixo"], a.risco)}</select></div>
          <div class="field"><label>Prazo da ação</label><input type="date" data-campo="prazo" value="${escHtml(a.prazo || "")}" ${a.acao_id ? "disabled" : ""} /></div>
          <div class="field"><label>Responsável</label><input type="text" data-campo="responsavel" list="lista-resp" value="${escHtml(a.responsavel || "")}" ${a.acao_id ? "disabled" : ""} placeholder="Nome" /></div>
        </div>
        <div class="row justify-between mt-16">${lado}<button type="button" class="btn btn-secondary" data-remover="${i}">🗑️ Remover achado</button></div>
      </div>`;
    })
    .join("");
  box.querySelectorAll("[data-campo]").forEach((el) =>
    el.addEventListener("input", () => {
      const i = Number(el.closest(".item-dinamico").dataset.i);
      const campo = el.dataset.campo;
      achadosForm[i][campo] = el.value;
      if (campo === "risco" && !achadosForm[i].acao_id) {
        achadosForm[i].prazo = somarDias(hojeISOLocal(), PRAZO_POR_RISCO[el.value] || 15);
        el.closest(".item-dinamico").querySelector('[data-campo="prazo"]').value = achadosForm[i].prazo;
      }
    })
  );
  box.querySelectorAll("[data-gerar]").forEach((b) => b.addEventListener("click", () => gerarAcao(Number(b.dataset.gerar))));
  box.querySelectorAll("[data-remover]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = Number(b.dataset.remover);
      const a = achadosForm[i];
      if (a.id && !confirm("Remover este achado? A ação já gerada (se houver) continua no Plano de Ação.")) return;
      if (a.id) achadosRemovidos.push(a.id);
      achadosForm.splice(i, 1);
      renderAchados();
    })
  );
}

function ncParaAchados() {
  let novos = 0;
  $("checklist-form").querySelectorAll(".checklist-linha").forEach((linha) => {
    const marcado = linha.querySelector("input:checked");
    if (!marcado || marcado.value !== "NC") return;
    const desc = `Não conformidade: ${linha.dataset.item}`;
    if (achadosForm.some((a) => a.descricao === desc)) return;
    achadosForm.push(novoAchado({ descricao: desc, grupo: linha.dataset.grupo }));
    novos++;
  });
  renderAchados();
  showToast(novos ? `${novos} achado(s) criado(s) a partir das não conformidades.` : "Não há novas não conformidades para transformar.", novos ? "success" : "");
}

// ---------------- Salvar ----------------
async function salvarTudo(silencioso) {
  const data = $("insp-data").value;
  const setor = $("insp-setor").value.trim();
  const ins1 = $("insp-inspetor1").value;
  const ins2 = $("insp-inspetor2").value;
  if (!data || !setor) {
    showToast("Informe a data e o setor.", "error");
    return null;
  }
  if (!ins1) {
    showToast("Escolha ao menos o inspetor 1.", "error");
    return null;
  }
  if (ins1 && ins1 === ins2) {
    showToast("Os dois inspetores precisam ser pessoas diferentes.", "error");
    return null;
  }
  if (achadosForm.some((a) => !a.descricao.trim())) {
    showToast("Há achado sem descrição. Preencha ou remova.", "error");
    return null;
  }
  const payload = {
    gestao_id: gestao ? gestao.id : null,
    data_inspecao: data,
    setor,
    inspetor1_id: ins1 || null,
    inspetor2_id: ins2 || null,
    itens: coletarItens(),
    observacoes: $("insp-obs").value.trim() || null,
  };
  try {
    if (editId) {
      const { error } = await supabaseClient.from("cipa_inspecoes").update(payload).eq("id", editId);
      if (error) throw error;
    } else {
      const { data: row, error } = await supabaseClient.from("cipa_inspecoes").insert(payload).select().single();
      if (error) throw error;
      editId = row.id;
    }
    if (achadosRemovidos.length) {
      const { error } = await supabaseClient.from("cipa_achados").delete().in("id", achadosRemovidos);
      if (error) throw error;
      achadosRemovidos = [];
    }
    for (const a of achadosForm) {
      const corpo = { inspecao_id: editId, descricao: a.descricao.trim(), risco: a.risco };
      if (a.id) {
        const { error } = await supabaseClient.from("cipa_achados").update(corpo).eq("id", a.id);
        if (error) throw error;
      } else {
        const { data: novo, error } = await supabaseClient.from("cipa_achados").insert(corpo).select().single();
        if (error) throw error;
        a.id = novo.id;
      }
    }
  } catch (err) {
    console.error(err);
    showToast("Erro ao salvar: " + (err.message || err), "error");
    return null;
  }
  if (!silencioso) {
    showToast("Inspeção salva!", "success");
    resetarFormulario();
    await carregarInspecoes();
    ativarAba("historico");
  } else {
    marcarEdicao(`Inspeção salva (${formatarDataBR(data)} · ${setor}). Você pode continuar editando.`);
  }
  return editId;
}

// ---------------- Gerar ações ----------------
async function criarAcaoDoAchado(a, setor) {
  const { data: acao, error } = await supabaseClient
    .from("cipa_acoes")
    .insert({
      inspecao_id: editId,
      descricao: a.descricao.trim(),
      responsavel: (a.responsavel || "").trim() || null,
      prazo: a.prazo || somarDias(hojeISOLocal(), PRAZO_POR_RISCO[a.risco] || 15),
      origem: "Inspeção",
      tema: temaDoAchado(a),
      prioridade: PRIORIDADE_POR_RISCO[a.risco] || "Média",
      local: setor,
      status: "Em andamento",
    })
    .select()
    .single();
  if (error) throw error;
  const { error: e2 } = await supabaseClient.from("cipa_achados").update({ acao_id: acao.id }).eq("id", a.id);
  if (e2) throw e2;
  a.acao_id = acao.id;
  acoesPorId[acao.id] = acao;
}

async function gerarAcao(i) {
  const a = achadosForm[i];
  if (!a || !a.descricao.trim()) return showToast("Descreva o achado antes de gerar a ação.", "error");
  const id = await salvarTudo(true);
  if (!id) return;
  try {
    await criarAcaoDoAchado(achadosForm[i], $("insp-setor").value.trim());
    showToast("Ação criada no Plano de Ação.", "success");
    renderAchados();
  } catch (err) {
    console.error(err);
    showToast("Não foi possível criar a ação: " + (err.message || err), "error");
  }
}

async function gerarTodasAcoes() {
  const pend = achadosForm.filter((a) => !a.acao_id);
  if (!pend.length) return showToast("Não há achados sem ação.", "error");
  const id = await salvarTudo(true);
  if (!id) return;
  let n = 0;
  try {
    for (const a of achadosForm) {
      if (a.acao_id) continue;
      await criarAcaoDoAchado(a, $("insp-setor").value.trim());
      n++;
    }
    showToast(`${n} ação(ões) criada(s) no Plano de Ação.`, "success");
  } catch (err) {
    console.error(err);
    showToast("Erro ao criar ações: " + (err.message || err), "error");
  }
  renderAchados();
}

// ---------------- Edição ----------------
function marcarEdicao(texto) {
  const av = $("aviso-edicao");
  av.style.display = texto ? "block" : "none";
  av.innerHTML = texto ? "✏️ " + escHtml(texto) : "";
  $("insp-titulo-form").textContent = editId ? "Editar inspeção de segurança" : "Nova inspeção de segurança";
}
function resetarFormulario() {
  editId = null;
  achadosForm = [];
  achadosRemovidos = [];
  $("insp-data").value = hojeISOLocal();
  $("insp-setor").value = "";
  $("insp-inspetor1").value = "";
  $("insp-inspetor2").value = "";
  $("insp-obs").value = "";
  renderChecklist({});
  renderAchados();
  marcarEdicao("");
}

function editarInspecao(id) {
  const insp = inspecoes.find((i) => i.id === id);
  if (!insp) return;
  resetarFormulario();
  editId = id;
  $("insp-data").value = insp.data_inspecao;
  $("insp-setor").value = insp.setor;
  // inspetor que saiu da CIPA não está na lista: acrescenta para não perder o vínculo
  [["insp-inspetor1", insp.inspetor1_id], ["insp-inspetor2", insp.inspetor2_id]].forEach(([sel, mid]) => {
    const el = $(sel);
    if (mid && ![...el.options].some((o) => o.value === mid)) el.insertAdjacentHTML("beforeend", `<option value="${mid}">${escHtml(nomeMembro(mid))}</option>`);
    el.value = mid || "";
  });
  $("insp-obs").value = insp.observacoes || "";
  const resp = {};
  (insp.itens || []).forEach((i) => (resp[chaveItem(i.grupo, i.item)] = i.situacao));
  renderChecklist(resp);
  achadosForm = insp.achados.map((a) => {
    const acao = a.acao_id ? acoesPorId[a.acao_id] : null;
    return novoAchado({ id: a.id, descricao: a.descricao, risco: a.risco, acao_id: a.acao_id, prazo: acao ? acao.prazo : somarDias(hojeISOLocal(), PRAZO_POR_RISCO[a.risco] || 15), responsavel: acao ? acao.responsavel || "" : "" });
  });
  renderAchados();
  marcarEdicao(`Editando a inspeção de ${formatarDataBR(insp.data_inspecao)} · ${insp.setor}. Clique em "Salvar inspeção" para gravar as alterações.`);
  ativarAba("nova");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------- Histórico ----------------
function filtrarInspecoes() {
  const setor = $("filtro-setor").value;
  const de = $("filtro-de").value;
  const ate = $("filtro-ate").value;
  const res = $("filtro-resultado").value;
  return inspecoes.filter((i) => {
    if (setor && i.setor !== setor) return false;
    if (de && i.data_inspecao < de) return false;
    if (ate && i.data_inspecao > ate) return false;
    const r = resumoItens(i.itens);
    if (res === "nc" && !(r.nc > 0 || i.achados.length)) return false;
    if (res === "ok" && (r.nc > 0 || i.achados.length)) return false;
    if (res === "acoes" && !i.acoes.some((a) => statusAcao(a) !== "Concluída")) return false;
    return true;
  });
}

function renderHistorico() {
  const lista = filtrarInspecoes();
  $("historico-vazio").style.display = lista.length ? "none" : "block";
  const totalNC = lista.reduce((s, i) => s + resumoItens(i.itens).nc, 0);
  $("historico-resumo").textContent = `${lista.length} inspeção(ões) · ${totalNC} não conformidade(s) registrada(s)`;
  $("historico-lista").innerHTML = lista
    .map((i) => {
      const r = resumoItens(i.itens);
      const bConf = r.pct == null ? '<span class="badge badge-muted">Sem checklist</span>' : `<span class="badge ${r.pct >= 90 ? "badge-ok" : r.pct >= 70 ? "badge-warn" : "badge-danger"}">${r.pct}% conforme</span>`;
      const st = contarPor(i.acoes, (a) => statusAcao(a));
      const acoesTxt = i.acoes.length
        ? [["Em andamento", "badge-warn"], ["Atrasada", "badge-danger"], ["Concluída", "badge-ok"]].filter(([s]) => st.get(s)).map(([s, c]) => `<span class="badge ${c}">${st.get(s)} ${s.toLowerCase()}${st.get(s) > 1 && s !== "Em andamento" ? "s" : ""}</span>`).join(" ")
        : '<span class="small text-muted">Nenhuma ação gerada</span>';
      return `<div class="panel insp-card" data-id="${i.id}">
        <div class="row justify-between">
          <div>
            <h3 style="margin:0;">${escHtml(i.setor)} <span class="small text-muted">· ${formatarDataBR(i.data_inspecao)}</span></h3>
            <div class="small text-muted">Inspetores: ${escHtml(nomeMembro(i.inspetor1_id))}${i.inspetor2_id ? " e " + escHtml(nomeMembro(i.inspetor2_id)) : ""}</div>
          </div>
          <div class="row">${bConf} <span class="badge ${r.nc ? "badge-danger" : "badge-ok"}">${r.nc} NC</span> <span class="badge badge-muted">${i.achados.length} achado(s)</span></div>
        </div>
        <div class="resumo-acoes">${acoesTxt}</div>
        <div class="row mt-16">
          <a href="#" class="btn btn-outline" data-ver="${i.id}">👁️ Ver</a>
          <button class="btn btn-outline" data-editar="${i.id}">✏️ Editar</button>
          <button class="btn btn-outline btn-gerar-pdf" data-pdf="${i.id}">📄 Gerar PDF</button>
          <label class="btn btn-outline">📎 Anexar assinada<input type="file" accept=".pdf,image/*" data-anexar="${i.id}" style="display:none;" /></label>
          ${i.arquivo_assinado_url ? `<a class="btn btn-secondary" href="${escHtml(i.arquivo_assinado_url)}" target="_blank" rel="noopener">✅ Ver assinada</a>` : '<span class="badge badge-warn">Aguardando assinada</span>'}
          <button class="btn btn-secondary" data-excluir="${i.id}">🗑️ Excluir</button>
        </div>
      </div>`;
    })
    .join("");
  const raiz = $("historico-lista");
  raiz.querySelectorAll("[data-ver]").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); verInspecao(b.dataset.ver); }));
  raiz.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => editarInspecao(b.dataset.editar)));
  raiz.querySelectorAll("[data-pdf]").forEach((b) => b.addEventListener("click", () => gerarPdfInspecao(b.dataset.pdf)));
  raiz.querySelectorAll("[data-excluir]").forEach((b) => b.addEventListener("click", () => excluirInspecao(b.dataset.excluir)));
  raiz.querySelectorAll("[data-anexar]").forEach((inp) => inp.addEventListener("change", () => anexarAssinada(inp.dataset.anexar, inp)));
}

async function excluirInspecao(id) {
  const i = inspecoes.find((x) => x.id === id);
  if (!i || !confirmarExclusao(`Excluir a inspeção de ${formatarDataBR(i.data_inspecao)} (${i.setor})? Os achados serão apagados; as ações já geradas continuam no Plano de Ação.`)) return;
  const { error } = await supabaseClient.from("cipa_inspecoes").delete().eq("id", id);
  if (error) return showToast("Não foi possível excluir: " + error.message, "error");
  showToast("Inspeção excluída.", "success");
  await carregarInspecoes();
}

async function anexarAssinada(id, input) {
  const file = input.files[0];
  if (!file) return;
  try {
    showToast("Enviando arquivo...");
    const url = await anexarArquivoCipa(file);
    const { error } = await supabaseClient.from("cipa_inspecoes").update({ arquivo_assinado_url: url }).eq("id", id);
    if (error) throw error;
    showToast("Inspeção assinada anexada.", "success");
    await carregarInspecoes();
  } catch (err) {
    console.error(err);
    showToast("Erro ao anexar: " + (err.message || err), "error");
  }
}

// ---------------- Ver (detalhe) ----------------
function verInspecao(id) {
  const i = inspecoes.find((x) => x.id === id);
  if (!i) return;
  const grupos = [...new Set((i.itens || []).map((x) => x.grupo))];
  const rot = { C: '<span class="res-c">Conforme</span>', NC: '<span class="res-nc">Não conforme</span>', NA: '<span class="res-na">N/A</span>' };
  const checklist = grupos.length
    ? grupos.map((g) => `<div class="checklist-grupo">${escHtml(g)}</div>` + i.itens.filter((x) => x.grupo === g).map((x) => `<div class="checklist-linha"><div>${escHtml(x.item)}</div><div>${rot[x.situacao] || "-"}</div></div>`).join("")).join("")
    : '<p class="small text-muted">Checklist não preenchido.</p>';
  const achados = i.achados.length
    ? i.achados.map((a) => {
        const ac = a.acao_id ? acoesPorId[a.acao_id] : null;
        return `<div class="item-dinamico"><b>${escHtml(a.descricao)}</b> <span class="badge ${a.risco === "Alto" ? "badge-danger" : a.risco === "Médio" ? "badge-warn" : "badge-muted"}">Risco ${escHtml(a.risco)}</span>
          <div class="small text-muted mt-16" style="margin-top:6px;">${ac ? `Ação: ${escHtml(ac.responsavel || "sem responsável")} · prazo ${formatarDataBR(ac.prazo)} ${badgeStatus(statusAcao(ac))}` : "Sem ação gerada"}</div></div>`;
      }).join("")
    : '<p class="small text-muted">Nenhum achado.</p>';
  abrirModalHtml(`${escHtml(i.setor)} · ${formatarDataBR(i.data_inspecao)}`, `
    <p class="small text-muted" style="margin-top:0;">Inspetores: ${escHtml(nomeMembro(i.inspetor1_id))}${i.inspetor2_id ? " e " + escHtml(nomeMembro(i.inspetor2_id)) : ""}</p>
    <h4 style="margin:6px 0;">Checklist</h4>${checklist}
    <h4 style="margin:16px 0 6px;">Achados</h4>${achados}
    ${i.observacoes ? `<h4 style="margin:16px 0 6px;">Observações</h4><div class="conteudo-ata">${escHtml(i.observacoes)}</div>` : ""}`, 760);
}

// ---------------- PDF ----------------
async function gerarPdfInspecao(id) {
  const i = inspecoes.find((x) => x.id === id);
  if (!i) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const marginX = 14;
  let y = await cabecalhoPdf(doc, "INSPEÇÃO DE SEGURANÇA DA CIPA", [`Setor: ${i.setor}`, `Data: ${formatarDataBR(i.data_inspecao)}`]);
  const r = resumoItens(i.itens);
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(`Conformes: ${r.c}   Não conformes: ${r.nc}   N/A: ${r.na}   Conformidade: ${r.pct == null ? "-" : r.pct + "%"}`, marginX, y);
  y += 5;

  const rotPdf = { C: "Conforme", NC: "NÃO CONFORME", NA: "N/A" };
  const corpo = [];
  [...new Set((i.itens || []).map((x) => x.grupo))].forEach((g) => {
    corpo.push([{ content: g, colSpan: 2, styles: { fillColor: [253, 232, 232], textColor: [143, 5, 5], fontStyle: "bold" } }]);
    i.itens.filter((x) => x.grupo === g).forEach((x) => corpo.push([x.item, rotPdf[x.situacao] || "-"]));
  });
  if (corpo.length) {
    doc.autoTable({
      startY: y,
      head: [["Item verificado", "Resultado"]],
      body: corpo,
      styles: { fontSize: 9 },
      headStyles: CORES_TABELA_PDF,
      columnStyles: { 1: { cellWidth: 38 } },
      margin: { left: marginX, right: marginX },
      didParseCell: (d) => {
        if (d.section === "body" && d.column.index === 1 && d.cell.raw === "NÃO CONFORME") d.cell.styles.textColor = [220, 38, 38];
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  if (i.achados.length) {
    doc.autoTable({
      startY: y,
      head: [["Achado", "Risco", "Ação / responsável / prazo"]],
      body: i.achados.map((a) => {
        const ac = a.acao_id ? acoesPorId[a.acao_id] : null;
        return [a.descricao, a.risco, ac ? `${ac.responsavel || "sem responsável"} · até ${formatarDataBR(ac.prazo)} (${statusAcao(ac)})` : "Sem ação gerada"];
      }),
      styles: { fontSize: 9 },
      headStyles: CORES_TABELA_PDF,
      columnStyles: { 1: { cellWidth: 20 } },
      margin: { left: marginX, right: marginX },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  if (y > 255) {
    doc.addPage();
    y = 20;
  }
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Observações:", marginX, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  const linhas = doc.splitTextToSize(i.observacoes || "Nenhuma.", 180);
  doc.text(linhas, marginX, y);
  y += linhas.length * 5 + 8;
  if (y > 245) {
    doc.addPage();
    y = 20;
  }
  doc.autoTable({
    startY: y,
    head: [["Inspetor", "Assinatura"]],
    body: [[nomeMembro(i.inspetor1_id), ""], ...(i.inspetor2_id ? [[nomeMembro(i.inspetor2_id), ""]] : [])],
    styles: { fontSize: 10, minCellHeight: 14 },
    headStyles: CORES_TABELA_PDF,
    margin: { left: marginX, right: marginX },
  });
  rodapePdf(doc);
  doc.save(`inspecao-cipa-${i.setor.replace(/[^\w]+/g, "-").toLowerCase()}-${i.data_inspecao}.pdf`);
}

// ---------------- Cobertura ----------------
function renderCobertura() {
  const hoje = hojeISOLocal();
  const umAnoAtras = somarDias(hoje, -365);
  const linhas = todosSetores().map((s) => {
    const lista = inspecoes.filter((i) => i.setor === s);
    const ultima = lista.length ? lista.map((i) => i.data_inspecao).sort().pop() : null;
    const dias = ultima ? -diasAte(ultima) : null;
    return { setor: s, ultima, dias, ultAno: lista.filter((i) => i.data_inspecao >= umAnoAtras).length };
  });
  linhas.sort((a, b) => (b.dias ?? 99999) - (a.dias ?? 99999));
  const emDia = linhas.filter((l) => l.dias != null && l.dias <= DIAS_EM_DIA).length;
  $("cob-total").textContent = linhas.length;
  $("cob-ok").textContent = emDia;
  $("cob-atrasados").textContent = linhas.length - emDia;
  $("cob-body").innerHTML = linhas
    .map((l) => {
      const badge = l.dias == null ? '<span class="badge badge-danger">Sem inspeção</span>' : l.dias <= DIAS_EM_DIA ? '<span class="badge badge-ok">Em dia</span>' : '<span class="badge badge-danger">Atrasada</span>';
      return `<tr><td><b>${escHtml(l.setor)}</b></td><td>${l.ultima ? formatarDataBR(l.ultima) : "-"}</td><td>${l.dias == null ? "-" : l.dias + " dia(s)"}</td><td>${l.ultAno}</td><td>${badge}</td></tr>`;
    })
    .join("");
}

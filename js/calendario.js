// =========================================================================
// CIPA BOXER - Calendário de reuniões mensais, DQS, eventos e campanhas
// =========================================================================

let gestaoCal = null;
let agendaMap = new Map(); // mes (YYYY-MM-01) -> linha de cipa_reunioes_agenda
let atasCal = [];
let presencasPorAta = new Map();
let eventosCal = [];
let filtroSituacaoMes = "todas";

const CATEGORIAS_EVENTO = ["Reunião", "Eleição", "SIPAT", "DQS", "Treinamento", "Inspeção", "Campanha", "Outros"];
const classeCategoria = (c) => "cat-" + String(c).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

document.addEventListener("DOMContentLoaded", async () => {
  if (!(await telaPronta())) return;
  setupTabs();
  ["filtro-categoria", "filtro-periodo"].forEach((id) => document.getElementById(id).addEventListener("change", renderEventos));
  document.getElementById("busca-evento").addEventListener("input", renderEventos);
  document.getElementById("btn-novo-evento").addEventListener("click", () => abrirFormEvento(null));
  document.getElementById("btn-gerar-dqs").addEventListener("click", abrirGerarDqs);

  const sel = await montarSeletorGestao(document.getElementById("seletor-gestao"), async (g) => {
    gestaoCal = g;
    await carregarDados();
  });
  gestaoCal = sel.atual;
  await carregarDados();
});

function setupTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-content").forEach((sec) => (sec.style.display = "none"));
      document.getElementById("tab-" + btn.dataset.tab).style.display = "block";
    });
  });
}

// ---------------- Carregamento ----------------
async function carregarDados() {
  const g = gestaoCal;
  agendaMap = new Map();
  atasCal = [];
  presencasPorAta = new Map();
  if (g) {
    const [ag, atas] = await Promise.all([
      supabaseClient.from("cipa_reunioes_agenda").select("*").eq("gestao_id", g.id),
      supabaseClient.from("cipa_atas").select("id,tipo,data_reuniao,hora,local,arquivo_assinado_url,gestao_id").gte("data_reuniao", g.inicio).lte("data_reuniao", g.fim).order("data_reuniao"),
    ]);
    if (ag.error) console.error(ag.error);
    if (atas.error) console.error(atas.error);
    (ag.data || []).forEach((r) => agendaMap.set(String(r.mes).slice(0, 10), r));
    atasCal = atas.data || [];
    if (atasCal.length) {
      const { data: pres, error } = await supabaseClient
        .from("cipa_ata_presencas")
        .select("ata_id,presente,justificativa,membro:cipa_membros(nome)")
        .in("ata_id", atasCal.map((a) => a.id));
      if (error) console.error(error);
      (pres || []).forEach((p) => {
        if (!presencasPorAta.has(p.ata_id)) presencasPorAta.set(p.ata_id, []);
        presencasPorAta.get(p.ata_id).push(p);
      });
    }
  }
  const { data: ev, error: errEv } = await supabaseClient.from("cipa_eventos").select("*").order("data_inicio");
  if (errEv) console.error(errEv);
  eventosCal = ev || [];
  renderReunioes();
  renderEventos();
}

// ---------------- Reuniões mensais ----------------
function montarMeses() {
  const g = gestaoCal;
  if (!g) return [];
  const hoje = hojeISOLocal();
  return mesesDaGestao(g).map((mes) => {
    const ag = agendaMap.get(mes) || null;
    const padrao = dataPadraoReuniao(g, mes);
    const data = (ag && ag.data) || padrao;
    const ordinarias = atasCal.filter((a) => a.tipo === "Ordinária" && a.data_reuniao.slice(0, 7) === mes.slice(0, 7));
    const extras = atasCal.filter((a) => a.tipo === "Extraordinária" && a.data_reuniao.slice(0, 7) === mes.slice(0, 7));
    const ata = ordinarias[0] || null;
    const foraDoMandato = !ag && !ata && (padrao < g.inicio || padrao > g.fim);
    let situ;
    if (ag && (ag.situacao === "Cancelada" || ag.situacao === "Não necessária")) situ = "cinza";
    else if (ata || (ag && ag.situacao === "Realizada")) situ = "realizada";
    else if (data < hoje) situ = "atrasada";
    else situ = "prevista";
    if (foraDoMandato) situ = "cinza";
    return { mes, ag, padrao, data, ata, extras, situ, foraDoMandato, hora: (ag && ag.hora) || g.reuniao_hora || "", local: (ag && ag.local) || g.reuniao_local || "" };
  });
}

function resumoPresenca(ata) {
  const lista = presencasPorAta.get(ata.id) || [];
  return { presentes: lista.filter((p) => p.presente), ausentes: lista.filter((p) => !p.presente), total: lista.length };
}

function renderReunioes() {
  const g = gestaoCal;
  const box = document.getElementById("meses");
  const resumo = document.getElementById("resumo-ano");
  if (!g) {
    resumo.innerHTML = "";
    box.innerHTML = '<div class="panel empty-state">Cadastre uma gestão em Membros → Gestões para ver o calendário de reuniões.</div>';
    document.getElementById("regra-reuniao").textContent = "";
    return;
  }
  const ordem = g.reuniao_ordem === 5 ? "última" : `${g.reuniao_ordem}ª`;
  document.getElementById("regra-reuniao").innerHTML = `Regra da gestão: reunião ordinária na <b>${ordem} ${escHtml(DIAS_SEMANA[g.reuniao_dia_semana])}</b> do mês${g.reuniao_hora ? " às <b>" + escHtml(g.reuniao_hora) + "</b>" : ""}${g.reuniao_local ? " · " + escHtml(g.reuniao_local) : ""}. Use ✏️ para remarcar. A situação <b>Realizada</b> é marcada sozinha quando a ATA é registrada no sistema; se a reunião aconteceu sem ATA, marque manualmente. Clique nos números de presentes e ausentes para ver os nomes.`;

  const meses = montarMeses();
  const validos = meses.filter((m) => m.situ !== "cinza");
  const realizadas = meses.filter((m) => m.situ === "realizada");
  const atrasadas = meses.filter((m) => m.situ === "atrasada");
  let pres = 0, tot = 0;
  meses.forEach((m) => {
    if (m.ata) {
      const r = resumoPresenca(m.ata);
      pres += r.presentes.length;
      tot += r.total;
    }
  });
  resumo.innerHTML = `
    <div class="indicator-card total clicavel kpi ${filtroSituacaoMes === "todas" ? "aberto" : ""}" data-sit="todas"><div class="value">${validos.length}</div><div class="label">Reuniões previstas</div></div>
    <div class="indicator-card concluida clicavel kpi ${filtroSituacaoMes === "realizada" ? "aberto" : ""}" data-sit="realizada"><div class="value">${realizadas.length}<span class="de"> de ${validos.length}</span></div><div class="label">Realizadas</div></div>
    <div class="indicator-card atrasada clicavel kpi ${filtroSituacaoMes === "atrasada" ? "aberto" : ""}" data-sit="atrasada"><div class="value">${atrasadas.length}</div><div class="label">Sem ATA / não realizadas</div></div>
    <div class="indicator-card andamento"><div class="value">${tot ? Math.round((pres / tot) * 100) + "%" : "-"}</div><div class="label">Presença média</div></div>`;
  resumo.querySelectorAll(".kpi").forEach((k) =>
    k.addEventListener("click", () => {
      filtroSituacaoMes = filtroSituacaoMes === k.dataset.sit ? "todas" : k.dataset.sit;
      renderReunioes();
    })
  );

  const mostrar = filtroSituacaoMes === "todas" ? meses : meses.filter((m) => m.situ === filtroSituacaoMes);
  const mesAtual = hojeISOLocal().slice(0, 7);
  box.innerHTML = mostrar.map((m) => cartaoMes(m, mesAtual)).join("") || '<div class="panel empty-state">Nenhuma reunião nesta situação.</div>';
  box.querySelectorAll(".num-pres").forEach((b) => b.addEventListener("click", () => abrirNomes(b)));
  box.querySelectorAll(".btn-editar-ag").forEach((b) => b.addEventListener("click", () => abrirFormAgenda(b.dataset.mes)));
}

function cartaoMes(m, mesAtual) {
  const d = dataDeISO(m.mes);
  const rotuloSit = { prevista: "Prevista", realizada: "Realizada", atrasada: "Sem ATA", cinza: m.foraDoMandato ? "Fora do mandato" : m.ag ? m.ag.situacao : "-" }[m.situ];
  const quando = m.foraDoMandato
    ? `Data padrão (${formatarDataBR(m.padrao)}) fora do período da gestão`
    : `${formatarDataBR(m.data)} · ${DIAS_SEMANA[dataDeISO(m.data).getDay()]}${m.hora ? " às " + escHtml(m.hora) : ""}${m.local ? " · " + escHtml(m.local) : ""}`;
  const remarcada = m.ag && m.ag.data && m.ag.data !== m.padrao ? '<span class="tag-remarcada">remarcada</span>' : "";
  let corpo = "";
  if (m.ata) {
    const r = resumoPresenca(m.ata);
    const alvo = `pl-${m.ata.id}`;
    corpo = `<div class="pres-nums">
        <button class="num-pres ok" data-ata="${m.ata.id}" data-modo="presentes" data-alvo="${alvo}"><b>${r.presentes.length}</b> presentes ▾</button>
        <button class="num-pres ${r.ausentes.length ? "falta" : ""}" data-ata="${m.ata.id}" data-modo="ausentes" data-alvo="${alvo}"><b>${r.ausentes.length}</b> ausentes ▾</button>
        ${m.ata.arquivo_assinado_url ? `<a class="badge badge-ok" href="${escHtml(m.ata.arquivo_assinado_url)}" target="_blank" rel="noopener">ATA assinada</a>` : '<span class="badge badge-warn">Aguardando ATA assinada</span>'}
      </div>
      <div class="pres-lista" id="${alvo}" style="display:none;"></div>`;
  }
  const acoesLinha = [];
  if (m.ata) acoesLinha.push(`<a class="btn-mini" href="reuniao.html?ata=${m.ata.id}">Ver ATA</a>`);
  else if (acesso.editor && m.situ !== "cinza") acoesLinha.push(`<a class="btn-mini" href="reuniao.html?data=${m.data}">Registrar ATA</a>`);
  acoesLinha.push(`<button class="btn-mini btn-editar-ag" data-mes="${m.mes}" title="Remarcar ou marcar exceção">✏️</button>`);
  const extras = m.extras.length
    ? `<div class="extra-ata">Extraordinárias no mês: ${m.extras.map((a) => `<a href="reuniao.html?ata=${a.id}" style="color:var(--brand-red);font-weight:700;">${formatarDataBR(a.data_reuniao)}</a>`).join(", ")}</div>`
    : "";
  return `<div class="mes-card ${m.mes.slice(0, 7) === mesAtual ? "atual" : ""} ${m.foraDoMandato ? "fora" : ""}">
    <div class="mes-head"><h3>${MESES[d.getMonth()]} <span class="mes-ano">${d.getFullYear()}</span></h3><span class="badge st-badge-${m.situ}">${escHtml(rotuloSit)}</span></div>
    <div class="reuniao-bloco ${m.situ === "cinza" ? "st-cinza" : ""}">
      <div class="reuniao-linha">
        <div class="reuniao-texto"><div class="reuniao-nome">Reunião ordinária ${remarcada}</div><div class="reuniao-quando">${quando}</div></div>
        <div class="row" style="gap:6px;">${acoesLinha.join("")}</div>
      </div>
      ${m.ag && m.ag.observacao ? `<div class="reuniao-obs">${escHtml(m.ag.observacao)}</div>` : ""}
      ${corpo}${extras}
    </div></div>`;
}

function abrirNomes(btn) {
  const alvo = document.getElementById(btn.dataset.alvo);
  const chave = btn.dataset.modo;
  if (alvo.dataset.aberto === chave && alvo.style.display !== "none") {
    alvo.style.display = "none";
    alvo.dataset.aberto = "";
    return;
  }
  const lista = presencasPorAta.get(btn.dataset.ata) || [];
  const sel = lista.filter((p) => (chave === "presentes" ? p.presente : !p.presente));
  alvo.innerHTML = sel.length
    ? sel
        .map((p) => `<span class="pessoa-chip ${p.presente ? "" : "ausente"}">${escHtml((p.membro && p.membro.nome) || "?")}${!p.presente && p.justificativa ? ` <i>· ${escHtml(p.justificativa)}</i>` : ""}</span>`)
        .join("")
    : '<span class="small text-muted">Ninguém nesta lista.</span>';
  alvo.style.display = "flex";
  alvo.dataset.aberto = chave;
}

function abrirFormAgenda(mes) {
  const g = gestaoCal;
  if (!g || !acesso.editor) return;
  const ag = agendaMap.get(mes) || null;
  const padrao = dataPadraoReuniao(g, mes);
  const sit = ag ? ag.situacao : "Agendada";
  const modal = abrirModalHtml(
    `Remarcar · ${nomeMesAno(mes)}`,
    `<div class="field"><label>Situação</label><select id="ag-situacao">
        <option value="Agendada" ${sit === "Agendada" ? "selected" : ""}>Agendada</option>
        <option value="Realizada" ${sit === "Realizada" ? "selected" : ""}>Realizada (registro fora do sistema)</option>
        <option value="Não necessária" ${sit === "Não necessária" ? "selected" : ""}>Não haverá (não necessária)</option>
        <option value="Cancelada" ${sit === "Cancelada" ? "selected" : ""}>Cancelada</option></select></div>
    <div class="field mt-16"><label>Data</label><input type="date" id="ag-data" value="${escHtml((ag && ag.data) || padrao)}" />
      <div class="small text-muted" style="margin-top:4px;">Data padrão da gestão: ${formatarDataBR(padrao)}</div></div>
    <div class="row mt-16">
      <div class="field" style="flex:1;min-width:140px;"><label>Horário</label><input type="text" id="ag-hora" placeholder="${escHtml(g.reuniao_hora || "Ex.: 14:00")}" value="${escHtml((ag && ag.hora) || "")}" /></div>
      <div class="field" style="flex:2;min-width:180px;"><label>Local</label><input type="text" id="ag-local" placeholder="${escHtml(g.reuniao_local || "Ex.: Sala de reuniões")}" value="${escHtml((ag && ag.local) || "")}" /></div>
    </div>
    <div class="field mt-16"><label>Observação</label><input type="text" id="ag-obs" placeholder="Ex.: excepcionalmente na quinta-feira" value="${escHtml((ag && ag.observacao) || "")}" /></div>
    <div class="row mt-16">
      <button class="btn btn-primary" id="ag-salvar">Salvar</button>
      ${ag ? '<button class="btn btn-secondary" id="ag-padrao">Voltar ao padrão</button>' : ""}
      <button class="btn btn-secondary" id="ag-cancelar">Cancelar</button>
    </div>`,
    480
  );
  modal.querySelector("#ag-cancelar").onclick = fecharModalHtml;
  modal.querySelector("#ag-salvar").onclick = async () => {
    const dados = {
      gestao_id: g.id,
      mes,
      situacao: modal.querySelector("#ag-situacao").value,
      data: modal.querySelector("#ag-data").value || null,
      hora: modal.querySelector("#ag-hora").value.trim() || null,
      local: modal.querySelector("#ag-local").value.trim() || null,
      observacao: modal.querySelector("#ag-obs").value.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabaseClient.from("cipa_reunioes_agenda").upsert(dados, { onConflict: "gestao_id,mes" });
    if (error) return showToast("Não foi possível salvar: " + error.message, "error");
    showToast("Calendário atualizado.", "success");
    fecharModalHtml();
    await carregarDados();
  };
  const pad = modal.querySelector("#ag-padrao");
  if (pad)
    pad.onclick = async () => {
      if (!confirm("Voltar ao padrão da gestão (apaga a remarcação deste mês)?")) return;
      const { error } = await supabaseClient.from("cipa_reunioes_agenda").delete().eq("gestao_id", g.id).eq("mes", mes);
      if (error) return showToast("Não foi possível voltar ao padrão: " + error.message, "error");
      showToast("Voltou ao padrão.", "success");
      fecharModalHtml();
      await carregarDados();
    };
}

// ---------------- Eventos (DQS, campanhas...) ----------------
function renderEventos() {
  const g = gestaoCal;
  const cat = document.getElementById("filtro-categoria").value;
  const per = document.getElementById("filtro-periodo").value;
  const busca = normalizarNome(document.getElementById("busca-evento").value);
  const hoje = hojeISOLocal();
  const lista = eventosCal.filter((e) => {
    if (cat !== "todas" && e.categoria !== cat) return false;
    if (per === "gestao" && g && (e.data_inicio < g.inicio || e.data_inicio > g.fim)) return false;
    if (per === "futuros" && (e.data_fim || e.data_inicio) < hoje) return false;
    if (busca && !normalizarNome(e.titulo + " " + (e.observacao || "")).includes(busca)) return false;
    return true;
  });
  document.getElementById("eventos-empty").style.display = lista.length ? "none" : "block";
  const tbody = document.getElementById("tabela-eventos-body");
  tbody.innerHTML = lista
    .map((e) => {
      const passado = (e.data_fim || e.data_inicio) < hoje;
      const periodo = e.data_fim && e.data_fim !== e.data_inicio ? `${formatarDataBR(e.data_inicio)} a ${formatarDataBR(e.data_fim)}` : formatarDataBR(e.data_inicio);
      return `<tr class="${passado ? "evento-passado" : ""}">
        <td style="white-space:nowrap;"><b>${periodo}</b><div class="small text-muted">${DIAS_SEMANA[dataDeISO(e.data_inicio).getDay()]}</div></td>
        <td><span class="badge ${classeCategoria(e.categoria)}">${escHtml(e.categoria)}</span></td>
        <td>${escHtml(e.titulo)}</td>
        <td class="small text-muted">${escHtml(e.observacao || "")}</td>
        <td style="white-space:nowrap;"><button class="btn-mini btn-editar-ev" data-id="${e.id}" title="Editar">✏️</button> <button class="btn-mini btn-excluir-ev" data-id="${e.id}" title="Excluir">🗑️</button></td>
      </tr>`;
    })
    .join("");
  tbody.querySelectorAll(".btn-editar-ev").forEach((b) => b.addEventListener("click", () => abrirFormEvento(b.dataset.id)));
  tbody.querySelectorAll(".btn-excluir-ev").forEach((b) =>
    b.addEventListener("click", async () => {
      const e = eventosCal.find((x) => x.id === b.dataset.id);
      if (!e || !confirmarExclusao(`Excluir o evento "${e.titulo}"?`)) return;
      const { error } = await supabaseClient.from("cipa_eventos").delete().eq("id", e.id);
      if (error) return showToast("Não foi possível excluir: " + error.message, "error");
      showToast("Evento excluído.", "success");
      await carregarDados();
    })
  );
}

function abrirFormEvento(id) {
  if (!acesso.editor) return;
  const e = id ? eventosCal.find((x) => x.id === id) : { categoria: "DQS", data_inicio: hojeISOLocal() };
  const modal = abrirModalHtml(
    id ? "Editar evento" : "Novo evento",
    `<div class="form-grid">
      <div class="field field-full"><label>Título *</label><input type="text" id="ev-titulo" value="${escHtml(e.titulo || "")}" placeholder="Ex.: DQS - Diálogo Quinzenal de Segurança" /></div>
      <div class="field"><label>Categoria</label><select id="ev-cat">${opcoesLista(CATEGORIAS_EVENTO, e.categoria)}</select></div>
      <div class="field"><label>Data (início) *</label><input type="date" id="ev-ini" value="${escHtml(e.data_inicio || "")}" /></div>
      <div class="field"><label>Data final (se durar mais de um dia)</label><input type="date" id="ev-fim" value="${escHtml(e.data_fim || "")}" /></div>
      <div class="field field-full"><label>Observação</label><input type="text" id="ev-obs" value="${escHtml(e.observacao || "")}" /></div>
    </div>
    <div class="row mt-16"><button class="btn btn-primary" id="ev-salvar">Salvar</button><button class="btn btn-secondary" id="ev-cancelar">Cancelar</button></div>`,
    600
  );
  modal.querySelector("#ev-cancelar").onclick = fecharModalHtml;
  modal.querySelector("#ev-salvar").onclick = async () => {
    const dados = {
      titulo: modal.querySelector("#ev-titulo").value.trim(),
      categoria: modal.querySelector("#ev-cat").value,
      data_inicio: modal.querySelector("#ev-ini").value,
      data_fim: modal.querySelector("#ev-fim").value || null,
      observacao: modal.querySelector("#ev-obs").value.trim() || null,
    };
    if (!dados.titulo) return showToast("Informe o título.", "error");
    if (!dados.data_inicio) return showToast("Informe a data.", "error");
    if (dados.data_fim && dados.data_fim < dados.data_inicio) return showToast("A data final precisa ser depois da inicial.", "error");
    const q = id ? supabaseClient.from("cipa_eventos").update(dados).eq("id", id) : supabaseClient.from("cipa_eventos").insert(dados);
    const { error } = await q;
    if (error) return showToast("Não foi possível salvar: " + error.message, "error");
    showToast("Evento salvo.", "success");
    fecharModalHtml();
    await carregarDados();
  };
}

// ---------------- Gerar DQS quinzenais ----------------
function datasDqs(inicio, fim, diaSemana) {
  const out = [];
  if (!inicio || !fim || inicio > fim) return out;
  const d = dataDeISO(inicio);
  while (d.getDay() !== diaSemana) d.setDate(d.getDate() + 1);
  while (isoDeData(d) <= fim) {
    out.push(isoDeData(d));
    d.setDate(d.getDate() + 14);
  }
  return out;
}
function abrirGerarDqs() {
  if (!acesso.editor) return;
  const g = gestaoCal;
  const hoje = hojeISOLocal();
  const ini = g && g.inicio > hoje ? g.inicio : hoje;
  const fim = g ? g.fim : somarDias(hoje, 365);
  const modal = abrirModalHtml(
    "Gerar DQS quinzenais",
    `<p class="small text-muted" style="margin-top:0;">Cria um evento de DQS (Diálogo Quinzenal de Segurança) a cada 14 dias, no dia da semana escolhido. Datas que já têm DQS cadastrado são puladas.</p>
    <div class="form-grid">
      <div class="field"><label>Começar em</label><input type="date" id="dqs-ini" value="${ini}" /></div>
      <div class="field"><label>Até</label><input type="date" id="dqs-fim" value="${fim}" /></div>
      <div class="field"><label>Dia da semana</label><select id="dqs-dia">${DIAS_SEMANA.map((d, i) => `<option value="${i}" ${i === dataDeISO(ini).getDay() ? "selected" : ""}>${d}</option>`).join("")}</select></div>
      <div class="field"><label>Título</label><input type="text" id="dqs-titulo" value="DQS - Diálogo Quinzenal de Segurança" /></div>
    </div>
    <div class="field mt-16"><label>Datas que serão criadas</label><div class="dica-dqs" id="dqs-previa"></div></div>
    <div class="row mt-16"><button class="btn btn-primary" id="dqs-criar">Criar eventos</button><button class="btn btn-secondary" id="dqs-cancelar">Cancelar</button></div>`,
    560
  );
  const calc = () => {
    const ja = new Set(eventosCal.filter((e) => e.categoria === "DQS").map((e) => e.data_inicio));
    const todas = datasDqs(modal.querySelector("#dqs-ini").value, modal.querySelector("#dqs-fim").value, Number(modal.querySelector("#dqs-dia").value));
    const novas = todas.filter((d) => !ja.has(d));
    modal.querySelector("#dqs-previa").innerHTML = novas.length
      ? `<b>${novas.length} data(s)</b>${todas.length - novas.length ? ` (${todas.length - novas.length} já existente(s) pulada(s))` : ""}:<br>${novas.map((d) => formatarDataBR(d)).join(" · ")}`
      : "Nenhuma data nova neste período.";
    return novas;
  };
  ["dqs-ini", "dqs-fim", "dqs-dia"].forEach((id) => modal.querySelector("#" + id).addEventListener("change", calc));
  calc();
  modal.querySelector("#dqs-cancelar").onclick = fecharModalHtml;
  modal.querySelector("#dqs-criar").onclick = async () => {
    const novas = calc();
    const titulo = modal.querySelector("#dqs-titulo").value.trim() || "DQS - Diálogo Quinzenal de Segurança";
    if (!novas.length) return showToast("Nenhuma data nova para criar.", "error");
    if (!confirm(`Criar ${novas.length} evento(s) de DQS, de ${formatarDataBR(novas[0])} a ${formatarDataBR(novas[novas.length - 1])}?`)) return;
    const { error } = await supabaseClient.from("cipa_eventos").insert(novas.map((d) => ({ titulo, categoria: "DQS", data_inicio: d })));
    if (error) return showToast("Não foi possível criar: " + error.message, "error");
    showToast(`${novas.length} DQS criados.`, "success");
    fecharModalHtml();
    await carregarDados();
  };
}

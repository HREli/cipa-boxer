// =========================================================================
// CIPA BOXER - Cronograma geral: todas as responsabilidades da CIPA num só
// lugar (reuniões, DQS, inspeções, treinamentos, SIPAT, campanhas, eleição),
// com painel por tipo: previstas, realizadas, atrasadas e % cumprido.
// =========================================================================

const TIPOS_CRONO = [
  { tipo: "Reunião ordinária", icone: "📅" },
  { tipo: "Reunião extraordinária", icone: "⚡" },
  { tipo: "DQS", icone: "💬" },
  { tipo: "Inspeção", icone: "🔎" },
  { tipo: "Treinamento", icone: "🎓" },
  { tipo: "SIPAT", icone: "🦺" },
  { tipo: "Campanha", icone: "📣" },
  { tipo: "Eleição", icone: "🗳️" },
  { tipo: "Outros", icone: "📌" },
];
const ICONE_TIPO = Object.fromEntries(TIPOS_CRONO.map((t) => [t.tipo, t.icone]));
const ROTULO_SITU = { realizada: "Realizada", prevista: "Prevista", atrasada: "Atrasada", cancelada: "Cancelada" };
let cronoExtras = { inspecoes: [], etapas: [], sipat: [] };
let filtroTipoCrono = "todos";

async function carregarExtrasCronograma(g) {
  cronoExtras = { inspecoes: [], etapas: [], sipat: [] };
  if (!g) return;
  const [insp, et, sp] = await Promise.all([
    supabaseClient.from("cipa_inspecoes").select("id,data_inspecao,setor").gte("data_inspecao", g.inicio).lte("data_inspecao", g.fim),
    supabaseClient.from("cipa_eleicao_etapas").select("*").eq("gestao_id", g.id).order("ordem"),
    supabaseClient.from("cipa_sipat").select("id,ano,tema,atividades:cipa_sipat_atividades(id,data,hora,titulo,tipo,responsavel,status)").eq("gestao_id", g.id),
  ]);
  [insp, et, sp].forEach((r) => r.error && console.error(r.error));
  cronoExtras = { inspecoes: insp.data || [], etapas: et.data || [], sipat: sp.data || [] };
}

function situPorData(feita, cancelada, data) {
  if (cancelada) return "cancelada";
  if (feita) return "realizada";
  return data && data < hojeISOLocal() ? "atrasada" : "prevista";
}

function tipoDoEvento(cat) {
  if (["DQS", "Inspeção", "Treinamento", "SIPAT", "Campanha", "Eleição"].includes(cat)) return cat;
  return "Outros";
}

// Junta tudo numa lista única
function itensCronograma() {
  const g = gestaoCal;
  if (!g) return [];
  const itens = [];
  // reuniões ordinárias (regra da gestão + remarcações + ATAs)
  montarMeses().forEach((m) => {
    if (m.foraDoMandato) return;
    const situ = m.situ === "cinza" ? "cancelada" : m.situ;
    itens.push({
      tipo: "Reunião ordinária",
      titulo: `Reunião ordinária de ${nomeMesAno(m.mes)}`,
      data: m.ata ? m.ata.data_reuniao : m.data,
      situ,
      resp: "",
      obs: m.ag && m.ag.observacao ? m.ag.observacao : "",
      link: m.ata ? `reuniao.html?ata=${m.ata.id}` : `reuniao.html?data=${m.data}`,
      origem: m.ata ? "ATA registrada" : m.ag && m.ag.situacao === "Realizada" ? "marcada como realizada" : "",
    });
  });
  // extraordinárias (NR-5): entram quando a ATA é registrada
  atasCal
    .filter((a) => a.tipo === "Extraordinária")
    .forEach((a) => itens.push({ tipo: "Reunião extraordinária", titulo: "Reunião extraordinária", data: a.data_reuniao, situ: "realizada", resp: "", obs: "", link: `reuniao.html?ata=${a.id}`, origem: "ATA registrada" }));
  // eventos cadastrados (DQS, treinamentos, campanhas, inspeções programadas...)
  const inspPorMes = {};
  cronoExtras.inspecoes.forEach((i) => (inspPorMes[i.data_inspecao.slice(0, 7)] = inspPorMes[i.data_inspecao.slice(0, 7)] || []).push(i));
  eventosCal
    .filter((e) => e.data_inicio >= g.inicio && e.data_inicio <= g.fim)
    .sort((a, b) => a.data_inicio.localeCompare(b.data_inicio))
    .forEach((e) => {
      const tipo = tipoDoEvento(e.categoria);
      let feita = e.situacao === "Realizada";
      let origem = feita ? (e.data_realizada ? "realizada em " + formatarDataBR(e.data_realizada) : "") : "";
      // inspeção programada: conta como feita quando há inspeção registrada no mesmo mês
      if (tipo === "Inspeção" && !feita && e.situacao !== "Cancelada") {
        const lista = inspPorMes[e.data_inicio.slice(0, 7)] || [];
        const usada = lista.shift();
        if (usada) {
          feita = true;
          origem = `inspeção registrada em ${formatarDataBR(usada.data_inspecao)}${usada.setor ? " · " + usada.setor : ""}`;
        }
      }
      itens.push({
        tipo,
        titulo: e.titulo,
        data: e.data_inicio,
        fim: e.data_fim,
        situ: situPorData(feita, e.situacao === "Cancelada", e.data_fim || e.data_inicio),
        resp: e.responsavel || "",
        obs: e.observacao || "",
        eventoId: e.id,
        marcadaManual: e.situacao === "Realizada",
        origem,
      });
    });
  // inspeções registradas sem programação
  Object.values(inspPorMes).flat().forEach((i) =>
    itens.push({ tipo: "Inspeção", titulo: `Inspeção de segurança${i.setor ? " · " + i.setor : ""}`, data: i.data_inspecao, situ: "realizada", resp: "", obs: "", link: "inspecoes.html", origem: "registrada (não programada)" })
  );
  // SIPAT: atividades da programação
  cronoExtras.sipat.forEach((s) =>
    (s.atividades || []).forEach((a) =>
      itens.push({ tipo: "SIPAT", titulo: `${a.titulo}${s.ano ? ` (SIPAT ${s.ano})` : ""}`, data: a.data, situ: situPorData(a.status === "Realizada", a.status === "Cancelada", a.data), resp: a.responsavel || "", obs: a.tipo || "", link: "sipat.html", origem: "programação da SIPAT" })
    )
  );
  // eleição: etapas do processo eleitoral
  cronoExtras.etapas
    .filter((e) => e.data_prevista || e.data_realizada)
    .forEach((e) =>
      itens.push({ tipo: "Eleição", titulo: e.etapa, data: e.data_prevista || e.data_realizada, situ: situPorData(!!e.data_realizada, false, e.data_prevista), resp: e.responsavel || "", obs: e.referencia || "", link: "eleicao.html", origem: e.data_realizada ? "concluída em " + formatarDataBR(e.data_realizada) : "" })
    );
  return itens.filter((i) => i.data).sort((a, b) => a.data.localeCompare(b.data));
}

function resumoPorTipo(itens) {
  const r = {};
  itens.forEach((i) => {
    const x = (r[i.tipo] = r[i.tipo] || { previstas: 0, realizadas: 0, atrasadas: 0, avencer: 0, canceladas: 0 });
    if (i.situ === "cancelada") return x.canceladas++;
    x.previstas++;
    if (i.situ === "realizada") x.realizadas++;
    else if (i.situ === "atrasada") x.atrasadas++;
    else x.avencer++;
  });
  return r;
}
const pct = (x) => (x.realizadas + x.atrasadas ? Math.round((x.realizadas / (x.realizadas + x.atrasadas)) * 100) : null);

function renderCronograma() {
  const box = document.getElementById("crono-painel");
  if (!box) return;
  const g = gestaoCal;
  if (!g) {
    box.innerHTML = '<div class="panel empty-state">Cadastre uma gestão em Membros → Gestões para montar o cronograma.</div>';
    document.getElementById("crono-tabela").innerHTML = "";
    return;
  }
  const itens = itensCronograma();
  const res = resumoPorTipo(itens);
  const total = Object.values(res).reduce((t, x) => ({ previstas: t.previstas + x.previstas, realizadas: t.realizadas + x.realizadas, atrasadas: t.atrasadas + x.atrasadas, avencer: t.avencer + x.avencer }), { previstas: 0, realizadas: 0, atrasadas: 0, avencer: 0 });
  const cartao = (chave, nome, icone, x) => {
    const p = pct(x);
    const cor = p === null ? "#9ca3af" : p >= 90 ? "#15803d" : p >= 70 ? "#b45309" : "#b91c1c";
    return `<button type="button" class="crono-card kpi ${filtroTipoCrono === chave ? "aberto" : ""}" data-tipo="${escHtml(chave)}">
      <div class="crono-card-top"><span class="crono-ic">${icone}</span><span class="crono-nome">${escHtml(nome)}</span><span class="crono-pct" style="color:${cor}">${p === null ? "–" : p + "%"}</span></div>
      <div class="crono-barra"><i style="width:${x.previstas ? (x.realizadas / x.previstas) * 100 : 0}%;"></i><b style="width:${x.previstas ? (x.atrasadas / x.previstas) * 100 : 0}%;"></b></div>
      <div class="crono-nums"><span><b>${x.previstas}</b> previstas</span><span class="ok"><b>${x.realizadas}</b> realizadas</span><span class="atr"><b>${x.atrasadas}</b> atrasadas</span><span class="prev"><b>${x.avencer}</b> a vencer</span></div>
    </button>`;
  };
  box.innerHTML =
    cartao("todos", "Todas as atividades", "📋", total) +
    TIPOS_CRONO.filter((t) => res[t.tipo]).map((t) => cartao(t.tipo, t.tipo, t.icone, res[t.tipo])).join("");
  box.querySelectorAll(".crono-card").forEach((c) =>
    c.addEventListener("click", () => {
      filtroTipoCrono = c.dataset.tipo === filtroTipoCrono ? "todos" : c.dataset.tipo;
      document.getElementById("filtro-crono-tipo").value = filtroTipoCrono;
      renderCronograma();
    })
  );

  // filtros
  const selTipo = document.getElementById("filtro-crono-tipo");
  const tiposComItens = TIPOS_CRONO.filter((t) => res[t.tipo]).map((t) => t.tipo);
  selTipo.innerHTML = `<option value="todos">Todos os tipos</option>` + tiposComItens.map((t) => `<option ${t === filtroTipoCrono ? "selected" : ""}>${escHtml(t)}</option>`).join("");
  const selMes = document.getElementById("filtro-crono-mes");
  const mesSel = selMes.value || "todos";
  selMes.innerHTML = `<option value="todos">Todos os meses</option>` + mesesDaGestao(g).map((m) => `<option value="${m.slice(0, 7)}" ${m.slice(0, 7) === mesSel ? "selected" : ""}>${nomeMesAno(m)}</option>`).join("");
  const situ = document.getElementById("filtro-crono-situ").value;
  const busca = normalizarNome(document.getElementById("busca-crono").value);
  const lista = itens.filter(
    (i) =>
      (filtroTipoCrono === "todos" || i.tipo === filtroTipoCrono) &&
      (mesSel === "todos" || i.data.slice(0, 7) === mesSel) &&
      (situ === "todas" || i.situ === situ) &&
      (!busca || normalizarNome(i.titulo + " " + i.resp + " " + i.obs).includes(busca))
  );
  const hojeM = hojeISOLocal().slice(0, 7);
  let mesAnt = null;
  const linhas = lista
    .map((i) => {
      let cab = "";
      if (i.data.slice(0, 7) !== mesAnt) {
        mesAnt = i.data.slice(0, 7);
        cab = `<tr class="crono-mes ${mesAnt === hojeM ? "atual" : ""}"><td colspan="7">${nomeMesAno(mesAnt + "-01")}${mesAnt === hojeM ? " · mês atual" : ""}</td></tr>`;
      }
      const quando = i.fim && i.fim !== i.data ? `${formatarDataBR(i.data)} a ${formatarDataBR(i.fim)}` : formatarDataBR(i.data);
      let chk;
      if (i.eventoId && i.situ !== "cancelada")
        chk = `<input type="checkbox" class="chk-crono" data-id="${i.eventoId}" ${i.situ === "realizada" ? "checked" : ""} ${i.situ === "realizada" && !i.marcadaManual ? "disabled" : ""} title="Marque quando a atividade for feita" />`;
      else chk = `<input type="checkbox" class="chk-crono-auto" ${i.situ === "realizada" ? "checked" : ""} disabled title="Atualiza sozinho a partir do registro" />`;
      const acao = i.eventoId ? `<button class="btn-mini btn-editar-ev" data-id="${i.eventoId}" title="Editar">✏️</button>` : i.link ? `<a class="btn-mini" href="${i.link}" title="Abrir">↗</a>` : "";
      return `${cab}<tr class="crono-linha situ-${i.situ}">
        <td style="white-space:nowrap;"><b>${quando}</b><div class="small text-muted">${DIAS_SEMANA[dataDeISO(i.data).getDay()]}</div></td>
        <td><span class="badge crono-tipo">${ICONE_TIPO[i.tipo] || "📌"} ${escHtml(i.tipo)}</span></td>
        <td>${escHtml(i.titulo)}${i.origem ? `<div class="small text-muted">${escHtml(i.origem)}</div>` : ""}${i.obs ? `<div class="small text-muted">${escHtml(i.obs)}</div>` : ""}</td>
        <td class="small">${escHtml(i.resp || "-")}</td>
        <td><span class="badge st-badge-${i.situ === "cancelada" ? "cinza" : i.situ}">${ROTULO_SITU[i.situ]}</span></td>
        <td class="col-centro">${chk}</td>
        <td style="white-space:nowrap;">${acao}</td>
      </tr>`;
    })
    .join("");
  document.getElementById("crono-tabela").innerHTML = lista.length
    ? `<div class="table-wrap"><table class="crono-tab"><thead><tr><th>Data</th><th>Tipo</th><th>Atividade</th><th>Responsável</th><th>Situação</th><th class="col-centro">Realizada</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>`
    : '<div class="empty-state">Nenhuma atividade com esses filtros.</div>';
  const tab = document.getElementById("crono-tabela");
  tab.querySelectorAll(".chk-crono").forEach((c) => c.addEventListener("change", () => marcarEventoRealizado(c)));
  tab.querySelectorAll(".btn-editar-ev").forEach((b) => b.addEventListener("click", () => abrirFormEvento(b.dataset.id)));
  if (typeof aplicarLeitura === "function" && !acesso.editor) aplicarLeitura(tab);
}

async function marcarEventoRealizado(c) {
  const feito = c.checked;
  const { error } = await supabaseClient
    .from("cipa_eventos")
    .update({ situacao: feito ? "Realizada" : "Prevista", data_realizada: feito ? hojeISOLocal() : null })
    .eq("id", c.dataset.id);
  if (error) {
    c.checked = !feito;
    return showToast("Não foi possível salvar: " + error.message, "error");
  }
  const e = eventosCal.find((x) => x.id === c.dataset.id);
  if (e) Object.assign(e, { situacao: feito ? "Realizada" : "Prevista", data_realizada: feito ? hojeISOLocal() : null });
  showToast(feito ? "Atividade marcada como realizada." : "Marcação retirada.", "success");
  renderCronograma();
  renderEventos();
}

document.addEventListener("DOMContentLoaded", () => {
  ["filtro-crono-tipo", "filtro-crono-mes", "filtro-crono-situ"].forEach((id) =>
    document.getElementById(id).addEventListener("change", (e) => {
      if (id === "filtro-crono-tipo") filtroTipoCrono = e.target.value;
      renderCronograma();
    })
  );
  document.getElementById("busca-crono").addEventListener("input", renderCronograma);
  document.getElementById("btn-nova-atividade").addEventListener("click", () => abrirFormEvento(null));
});

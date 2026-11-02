// =========================================================================
// CIPA BOXER - Dashboard
// =========================================================================
document.addEventListener("DOMContentLoaded", async () => {
  mostrarAvisoConfiguracao();
  if (!(await telaPronta())) return;
  const { atual } = await montarSeletorGestao(document.getElementById("seletor-gestao"), (g) => montar(g));
  await montar(atual);
});

function barraProgresso(rotulo, feito, total, detalhe) {
  const pct = total ? Math.round((feito / total) * 100) : 0;
  return `<div class="progress-item"><div class="progress-label"><span>${escHtml(rotulo)}</span><span class="pct">${total ? pct + "%" : "-"} <span class="small text-muted">${escHtml(detalhe || `${feito} de ${total}`)}</span></span></div>
    <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div></div>`;
}
function alerta(icone, titulo, sub, href, cor) {
  return `<a class="alert-item" href="${href}" style="display:flex;gap:10px;align-items:flex-start;">
    <span>${icone}</span><div><div class="titulo" ${cor ? `style="color:${cor}"` : ""}>${escHtml(titulo)}</div><div class="sub">${escHtml(sub)}</div></div></a>`;
}

async function montar(g) {
  const hoje = hojeISOLocal();
  const [mem, acoes, insp, atas, agenda, etapas] = await Promise.all([
    supabaseClient.from("cipa_membros").select("*"),
    supabaseClient.from("cipa_acoes").select("id,prazo,data_conclusao,descricao,responsavel"),
    supabaseClient.from("cipa_inspecoes").select("id,data_inspecao,setor"),
    supabaseClient.from("cipa_atas").select("id,data_reuniao,gestao_id"),
    g ? supabaseClient.from("cipa_reunioes_agenda").select("*").eq("gestao_id", g.id) : Promise.resolve({ data: [] }),
    g ? supabaseClient.from("cipa_eleicao_etapas").select("*").eq("gestao_id", g.id).order("ordem") : Promise.resolve({ data: [] }),
  ]);
  const membros = (mem.data || []).filter((m) => m.ativo && m.representacao !== "Apoio" && (!g || !m.gestao_id || m.gestao_id === g.id));
  document.getElementById("k-membros").textContent = membros.length;

  // Ações
  const abertas = (acoes.data || []).filter((a) => !a.data_conclusao);
  const atrasadas = abertas.filter((a) => a.prazo && a.prazo < hoje);
  const concluidas = (acoes.data || []).length - abertas.length;
  document.getElementById("k-atrasadas").textContent = atrasadas.length;
  document.getElementById("k-abertas").textContent = abertas.length - atrasadas.length;

  // Inspeções no mês
  const mesAtual = hoje.slice(0, 7);
  const inspMes = (insp.data || []).filter((i) => i.data_inspecao.startsWith(mesAtual));
  document.getElementById("k-inspecoes").textContent = inspMes.length;

  // Reuniões: uma por mês da gestão até hoje
  let previstas = 0, realizadas = 0, mesAtualSituacao = "";
  if (g) {
    const agendaPorMes = new Map((agenda.data || []).map((x) => [x.mes, x]));
    mesesDaGestao(g).forEach((mes) => {
      const ex = agendaPorMes.get(mes);
      const data = (ex && ex.data) || dataPadraoReuniao(g, mes);
      const temAta = (atas.data || []).some((a) => a.data_reuniao.slice(0, 7) === mes.slice(0, 7));
      const dispensada = ex && (ex.situacao === "Cancelada" || ex.situacao === "Não necessária");
      if (data <= hoje && !dispensada) {
        previstas++;
        if (temAta || (ex && ex.situacao === "Realizada")) realizadas++;
      }
      if (mes.slice(0, 7) === mesAtual) mesAtualSituacao = temAta || (ex && ex.situacao === "Realizada") ? "Realizada" : data < hoje ? "Atrasada" : "Prevista para " + formatarDataBR(data);
    });
  }
  document.getElementById("k-reunioes").innerHTML = `${realizadas}<span class="de"> / ${previstas}</span>`;

  // Dias sem acidente (só editores leem a tabela)
  let semAcid = "–";
  if (acesso.editor) {
    const { data } = await supabaseClient.from("cipa_acidentes").select("data_ocorrencia,com_afastamento,tipo").eq("com_afastamento", true).neq("tipo", "Quase acidente").order("data_ocorrencia", { ascending: false }).limit(1);
    if (data && data.length) semAcid = Math.max(0, -diasAte(data[0].data_ocorrencia));
  }
  document.getElementById("k-sem").textContent = semAcid;

  // Cobertura de inspeção: setores padrão inspecionados nos últimos 35 dias
  const setores = [...new Set(SETORES_PADRAO.concat((insp.data || []).map((i) => i.setor)))];
  const recentes = setores.filter((s) => (insp.data || []).some((i) => i.setor === s && diasAte(i.data_inspecao) >= -35));

  document.getElementById("progressos").innerHTML =
    barraProgresso("Plano de Ação concluído", concluidas, (acoes.data || []).length) +
    barraProgresso("Reuniões mensais realizadas", realizadas, previstas) +
    barraProgresso("Setores inspecionados (últimos 35 dias)", recentes.length, setores.length);

  // Alertas
  const itens = [];
  if (g) {
    const dias = diasAte(g.fim);
    if (dias < 0) itens.push(alerta("⛔", "Mandato encerrado", `A gestão "${g.nome}" terminou em ${formatarDataBR(g.fim)}.`, "membros.html", "var(--danger)"));
    else if (dias <= 90) itens.push(alerta("🗳️", `Mandato termina em ${dias} dia(s)`, `Fim em ${formatarDataBR(g.fim)}. Acompanhe o cronograma da eleição.`, "eleicao.html", dias <= 60 ? "var(--danger)" : "#92400e"));
    const prox = (etapas.data || []).filter((e) => !e.data_realizada && e.data_prevista).sort((a, b) => a.data_prevista.localeCompare(b.data_prevista));
    if (prox.length && dias >= -60) {
      const e = prox[0];
      const d = diasAte(e.data_prevista);
      itens.push(alerta(d < 0 ? "⚠️" : "📌", `Eleição: ${e.etapa}`, d < 0 ? `Atrasada ${-d} dia(s) (prevista ${formatarDataBR(e.data_prevista)})` : `Em ${d} dia(s) (${formatarDataBR(e.data_prevista)})`, "eleicao.html", d < 0 ? "var(--danger)" : ""));
    }
  } else itens.push(alerta("ℹ️", "Nenhuma gestão cadastrada", "Cadastre o mandato em Membros → Gestões para ativar o calendário e a eleição.", "membros.html"));
  if (mesAtualSituacao) itens.push(alerta(mesAtualSituacao === "Atrasada" ? "⚠️" : "📅", `Reunião deste mês: ${mesAtualSituacao}`, "Calendário de reuniões ordinárias da CIPA.", "calendario.html", mesAtualSituacao === "Atrasada" ? "var(--danger)" : ""));
  atrasadas.sort((a, b) => a.prazo.localeCompare(b.prazo)).slice(0, 5).forEach((a) => itens.push(alerta("⏰", a.descricao, `Prazo ${formatarDataBR(a.prazo)}${a.responsavel ? " · " + a.responsavel : ""} · ${-diasAte(a.prazo)} dia(s) de atraso`, "plano-acao.html", "var(--danger)")));
  if (atrasadas.length > 5) itens.push(alerta("…", `Mais ${atrasadas.length - 5} ação(ões) atrasada(s)`, "Veja todas no Plano de Ação.", "plano-acao.html"));
  const estab = membros.filter((m) => m.estabilidade_ate && diasAte(m.estabilidade_ate) >= 0 && diasAte(m.estabilidade_ate) <= 60);
  if (estab.length) itens.push(alerta("🛡️", `${estab.length} membro(s) com estabilidade terminando em até 60 dias`, estab.map((m) => m.nome).join(", "), "membros.html"));
  if (!inspMes.length && mesAtual) itens.push(alerta("🔍", "Nenhuma inspeção registrada neste mês", "Registre as inspeções de segurança do mês.", "inspecoes.html"));
  document.getElementById("alertas").innerHTML = itens.length ? itens.join("") : '<div class="empty-state">Nenhum alerta. Tudo em dia.</div>';
}

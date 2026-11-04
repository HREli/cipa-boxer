// =========================================================================
// CIPA BOXER - Eleição da CIPA (cronograma do processo eleitoral, NR-5)
// =========================================================================

let gestao = null;
let etapas = [];
const $ = (id) => document.getElementById(id);

// Datas relativas ao último dia do mandato (fim). Prazos sugeridos; editáveis.
function modeloEtapas(fim) {
  const abertura = somarDias(fim, -50); // edital com no mínimo 45 dias de antecedência
  const encerramento = somarDias(abertura, 15); // inscrições por no mínimo 15 dias
  return [
    { etapa: "Convocação da eleição pelo empregador", referencia: "Mínimo de 60 dias antes do término do mandato", data_prevista: somarDias(fim, -60), responsavel: "Empregador" },
    { etapa: "Constituição da Comissão Eleitoral (CE) pelo presidente e vice", referencia: "Em até 55 dias antes do término do mandato", data_prevista: somarDias(fim, -55), responsavel: "Presidente e vice da CIPA" },
    { etapa: "Publicação do edital de convocação e abertura das inscrições", referencia: "Edital com mínimo de 45 dias de antecedência; inscrição por no mínimo 15 dias", data_prevista: abertura, responsavel: "Comissão Eleitoral" },
    { etapa: "Encerramento das inscrições", referencia: "Período mínimo de inscrição: 15 dias", data_prevista: encerramento, responsavel: "Comissão Eleitoral" },
    { etapa: "Divulgação da lista de candidatos", referencia: "Antes da eleição, em locais de fácil acesso", data_prevista: somarDias(encerramento, 1), responsavel: "Comissão Eleitoral" },
    { etapa: "Eleição (voto secreto, em dia normal de trabalho)", referencia: "Mínimo de 30 dias antes do término do mandato", data_prevista: somarDias(fim, -31), responsavel: "Comissão Eleitoral" },
    { etapa: "Apuração dos votos e ata da eleição", referencia: "Em horário normal de trabalho, com representantes do empregador e dos empregados", data_prevista: somarDias(fim, -31), responsavel: "Comissão Eleitoral" },
    { etapa: "Posse dos novos membros", referencia: "No primeiro dia após o término do mandato anterior", data_prevista: somarDias(fim, 1), responsavel: "Presidente da CIPA" },
    { etapa: "Treinamento dos membros", referencia: "Até 30 dias após a posse (conferir prazo na NR-5 vigente com o SESMT)", data_prevista: somarDias(fim, 31), responsavel: "SESMT / RH" },
    { etapa: "Guarda da documentação da eleição", referencia: "Por no mínimo 5 anos", data_prevista: null, responsavel: "RH" },
  ];
}

document.addEventListener("DOMContentLoaded", async () => {
  mostrarAvisoConfiguracao();
  if (!(await telaPronta())) return;
  const r = await montarSeletorGestao($("seletor-gestao"), (g) => {
    gestao = g;
    carregar();
  });
  gestao = r.atual;
  $("btn-gerar-cronograma").addEventListener("click", gerarCronograma);
  $("btn-add-etapa").addEventListener("click", () => abrirEdicao(null));
  $("btn-pdf-eleicao").addEventListener("click", exportarPdf);
  if (!gestao) {
    $("etapas-vazio").style.display = "block";
    $("etapas-vazio").textContent = "Cadastre uma gestão (mandato) em Membros e Mandato para montar o cronograma da eleição.";
    return;
  }
  carregar();
});

async function carregar() {
  const { data, error } = await supabaseClient.from("cipa_eleicao_etapas").select("*").eq("gestao_id", gestao.id).order("ordem").order("created_at");
  if (error) {
    console.error(error);
    showToast("Não foi possível carregar o cronograma.", "error");
  }
  etapas = data || [];
  render();
}

// Próxima etapa = a não realizada com a menor data prevista que ainda não passou
function proximaEtapa() {
  const hoje = hojeISOLocal();
  return etapas.filter((e) => !e.data_realizada && e.data_prevista && e.data_prevista >= hoje).sort((a, b) => a.data_prevista.localeCompare(b.data_prevista) || a.ordem - b.ordem)[0] || null;
}
function statusEtapa(e, prox) {
  if (e.data_realizada) return "Concluída";
  if (e.data_prevista && e.data_prevista < hojeISOLocal()) return "Atrasada";
  if (prox && e.id === prox.id) return "Próxima";
  return "Prevista";
}
function badgeEtapa(st) {
  const c = { Concluída: "badge-ok", Atrasada: "badge-danger", Próxima: "badge-warn", Prevista: "badge-muted" }[st];
  return `<span class="badge ${c}">${st}</span>`;
}

function render() {
  const prox = proximaEtapa();
  const hoje = hojeISOLocal();
  const concl = etapas.filter((e) => e.data_realizada).length;
  const atras = etapas.filter((e) => statusEtapa(e, prox) === "Atrasada").length;
  $("ind-etapas").textContent = etapas.length;
  $("ind-concluidas").textContent = concl;
  $("ind-atrasadas").textContent = atras;
  if (prox) {
    const d = diasAte(prox.data_prevista);
    $("ind-proxima").textContent = formatarDataBR(prox.data_prevista).slice(0, 5);
    $("lbl-proxima").textContent = `Próxima: ${prox.etapa.length > 34 ? prox.etapa.slice(0, 33) + "…" : prox.etapa} (${d === 0 ? "hoje" : "em " + d + " dia(s)"})`;
  } else {
    $("ind-proxima").textContent = etapas.length && concl === etapas.length ? "✔" : "-";
    $("lbl-proxima").textContent = etapas.length && concl === etapas.length ? "Processo concluído" : "Sem próxima etapa com data";
  }
  const faltam = diasAte(gestao.fim);
  $("barra-mandato").innerHTML = `<span>Mandato: <b>${formatarDataBR(gestao.inicio)}</b> a <b>${formatarDataBR(gestao.fim)}</b></span>
    <span class="badge ${faltam < 0 ? "badge-muted" : faltam <= 90 ? "badge-warn" : "badge-ok"}">${faltam < 0 ? "Mandato encerrado há " + -faltam + " dia(s)" : "Faltam " + faltam + " dia(s) para o fim do mandato"}</span>`;

  $("btn-gerar-cronograma").style.display = etapas.length ? "none" : "";
  const vazio = $("etapas-vazio");
  vazio.style.display = etapas.length ? "none" : "block";
  vazio.textContent = "Nenhuma etapa cadastrada. Use \"Gerar cronograma pela NR-5\" para criar as etapas a partir do fim do mandato.";

  $("etapas-lista").innerHTML = etapas
    .map((e, idx) => {
      const st = statusEtapa(e, prox);
      const cls = st === "Concluída" ? "feita" : st === "Atrasada" ? "atrasada" : st === "Próxima" ? "proxima" : "";
      return `<div class="etapa-linha ${cls}">
        <div class="etapa-num">${st === "Concluída" ? "✓" : idx + 1}</div>
        <div class="etapa-corpo">
          <div class="etapa-nome">${escHtml(e.etapa)} ${badgeEtapa(st)}</div>
          ${e.referencia ? `<div class="etapa-ref">${escHtml(e.referencia)}</div>` : ""}
          <div class="etapa-meta">
            <span>Prevista: <b>${e.data_prevista ? formatarDataBR(e.data_prevista) : "sem data"}</b></span>
            <span>Realizada: <b>${e.data_realizada ? formatarDataBR(e.data_realizada) : "-"}</b></span>
            ${e.responsavel ? `<span>Responsável: <b>${escHtml(e.responsavel)}</b></span>` : ""}
          </div>
          ${e.observacao ? `<div class="etapa-ref" style="margin-top:4px;">📝 ${escHtml(e.observacao)}</div>` : ""}
        </div>
        <div class="etapa-acoes">
          <button class="btn btn-outline" data-concluir="${e.id}">${e.data_realizada ? "↩️ Reabrir" : "✅ Concluir"}</button>
          <button class="btn btn-outline" data-editar="${e.id}">✏️ Editar</button>
          <button class="btn btn-secondary" data-excluir="${e.id}">🗑️</button>
        </div>
      </div>`;
    })
    .join("");
  const raiz = $("etapas-lista");
  raiz.querySelectorAll("[data-concluir]").forEach((b) => b.addEventListener("click", () => alternarConclusao(b.dataset.concluir)));
  raiz.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => abrirEdicao(b.dataset.editar)));
  raiz.querySelectorAll("[data-excluir]").forEach((b) => b.addEventListener("click", () => excluir(b.dataset.excluir)));
}

async function gerarCronograma() {
  if (!gestao || etapas.length) return;
  if (!confirm(`Gerar o cronograma da eleição com base no fim do mandato (${formatarDataBR(gestao.fim)})? Você poderá ajustar cada data depois.`)) return;
  const linhas = modeloEtapas(gestao.fim).map((e, i) => ({ ...e, gestao_id: gestao.id, ordem: i + 1 }));
  const { error } = await supabaseClient.from("cipa_eleicao_etapas").insert(linhas);
  if (error) return showToast("Não foi possível gerar: " + error.message, "error");
  showToast("Cronograma gerado!", "success");
  carregar();
}

async function alternarConclusao(id) {
  const e = etapas.find((x) => x.id === id);
  if (!e) return;
  const { error } = await supabaseClient.from("cipa_eleicao_etapas").update({ data_realizada: e.data_realizada ? null : hojeISOLocal() }).eq("id", id);
  if (error) return showToast("Não foi possível atualizar: " + error.message, "error");
  carregar();
}

async function excluir(id) {
  const e = etapas.find((x) => x.id === id);
  if (!e || !confirmarExclusao(`Excluir a etapa "${e.etapa}"?`)) return;
  const { error } = await supabaseClient.from("cipa_eleicao_etapas").delete().eq("id", id);
  if (error) return showToast("Não foi possível excluir: " + error.message, "error");
  showToast("Etapa excluída.", "success");
  carregar();
}

function abrirEdicao(id) {
  if (!acesso.editor) return;
  const e = id ? etapas.find((x) => x.id === id) : { etapa: "", referencia: "", data_prevista: "", data_realizada: "", responsavel: "", observacao: "" };
  const m = abrirModalHtml(id ? "Editar etapa" : "Nova etapa", `
    <div class="form-grid">
      <div class="field field-full"><label>Etapa *</label><input type="text" id="et-etapa" value="${escHtml(e.etapa)}" /></div>
      <div class="field field-full"><label>Referência / regra</label><input type="text" id="et-ref" value="${escHtml(e.referencia || "")}" /></div>
      <div class="field"><label>Data prevista</label><input type="date" id="et-prev" value="${escHtml(e.data_prevista || "")}" /></div>
      <div class="field"><label>Data realizada</label><input type="date" id="et-real" value="${escHtml(e.data_realizada || "")}" /></div>
      <div class="field field-full"><label>Responsável</label><input type="text" id="et-resp" value="${escHtml(e.responsavel || "")}" /></div>
      <div class="field field-full"><label>Observação</label><textarea id="et-obs" rows="3">${escHtml(e.observacao || "")}</textarea></div>
    </div>
    <div class="row mt-16"><button class="btn btn-primary" id="et-salvar">💾 Salvar</button><button class="btn btn-secondary" id="et-cancelar">Cancelar</button></div>`);
  m.querySelector("#et-cancelar").onclick = fecharModalHtml;
  m.querySelector("#et-salvar").onclick = async () => {
    const etapa = m.querySelector("#et-etapa").value.trim();
    if (!etapa) return showToast("Informe o nome da etapa.", "error");
    const corpo = {
      etapa,
      referencia: m.querySelector("#et-ref").value.trim() || null,
      data_prevista: m.querySelector("#et-prev").value || null,
      data_realizada: m.querySelector("#et-real").value || null,
      responsavel: m.querySelector("#et-resp").value.trim() || null,
      observacao: m.querySelector("#et-obs").value.trim() || null,
    };
    const q = id
      ? supabaseClient.from("cipa_eleicao_etapas").update(corpo).eq("id", id)
      : supabaseClient.from("cipa_eleicao_etapas").insert({ ...corpo, gestao_id: gestao.id, ordem: etapas.reduce((mx, x) => Math.max(mx, x.ordem || 0), 0) + 1 });
    const { error } = await q;
    if (error) return showToast("Não foi possível salvar: " + error.message, "error");
    fecharModalHtml();
    showToast("Etapa salva.", "success");
    carregar();
  };
}

async function exportarPdf() {
  if (!gestao || !etapas.length) return showToast("Não há etapas para exportar.", "error");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  const y = await cabecalhoPdf(doc, "CRONOGRAMA DA ELEIÇÃO DA CIPA", [gestao.nome, `Término do mandato: ${formatarDataBR(gestao.fim)}`]);
  const prox = proximaEtapa();
  doc.autoTable({
    startY: y,
    head: [["#", "Etapa", "Referência", "Prevista", "Realizada", "Responsável", "Situação"]],
    body: etapas.map((e, i) => [i + 1, e.etapa, e.referencia || "", e.data_prevista ? formatarDataBR(e.data_prevista) : "sem data", e.data_realizada ? formatarDataBR(e.data_realizada) : "-", e.responsavel || "", statusEtapa(e, prox)]),
    styles: { fontSize: 8.5 },
    headStyles: CORES_TABELA_PDF,
    columnStyles: { 0: { cellWidth: 8 }, 3: { cellWidth: 22 }, 4: { cellWidth: 22 }, 6: { cellWidth: 22 } },
    margin: { left: 14, right: 14 },
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === 6) {
        if (d.cell.raw === "Atrasada") d.cell.styles.textColor = [220, 38, 38];
        if (d.cell.raw === "Concluída") d.cell.styles.textColor = [22, 163, 74];
      }
    },
  });
  const fy = doc.lastAutoTable.finalY + 6;
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text("Prazos sugeridos a partir da NR-5; confirme com o SESMT/jurídico e ajuste conforme o edital.", 14, fy);
  rodapePdf(doc);
  doc.save(`cronograma-eleicao-cipa-${gestao.nome.replace(/[^\w]+/g, "-").toLowerCase()}.pdf`);
}

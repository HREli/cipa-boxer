// =========================================================================
// CIPA BOXER - Membros e Mandato (quadro, lista, novo membro, gestões)
// =========================================================================

let gestoes = [];
let gestaoAtual = null;
let membros = [];
let statusIdent = null; // Map membro_id -> completo (só editores consultam; os dados não vêm para a tela)

document.addEventListener("DOMContentLoaded", async () => {
  if (!(await telaPronta())) return;
  setupTabs();
  document.getElementById("btn-print-quadro").addEventListener("click", () => window.print());
  document.getElementById("btn-export-pdf").addEventListener("click", exportarPdfMembros);
  ["busca-membro", "filtro-representacao", "filtro-tipo", "filtro-situacao"].forEach((id) =>
    document.getElementById(id).addEventListener(id.startsWith("busca") ? "input" : "change", renderLista)
  );
  document.getElementById("form-novo-membro").innerHTML = camposMembro("nm", {});
  ligarCamposMembro("nm");
  document.getElementById("btn-salvar-novo").addEventListener("click", salvarNovoMembro);
  document.getElementById("btn-nova-gestao").addEventListener("click", () => abrirFormGestao(null));
  if (!acesso.editor) document.querySelectorAll(".col-ident").forEach((el) => (el.style.display = "none"));

  const sel = await montarSeletorGestao(document.getElementById("seletor-gestao"), (g) => {
    gestaoAtual = g;
    renderTudo();
  });
  gestoes = sel.gestoes;
  gestaoAtual = sel.atual;
  await carregarTudo();
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
async function carregarTudo() {
  gestoes = await carregarGestoes();
  if (gestaoAtual) gestaoAtual = gestoes.find((g) => g.id === gestaoAtual.id) || escolherGestao(gestoes);
  const { data, error } = await supabaseClient.from("cipa_membros").select("*").order("nome");
  if (error) {
    console.error(error);
    showToast("Não foi possível carregar os membros.", "error");
    membros = [];
  } else membros = data || [];
  await carregarStatusIdent();
  renderTudo();
}

async function carregarStatusIdent() {
  statusIdent = null;
  if (!acesso.editor) return;
  try {
    const { data, error } = await supabaseClient.functions.invoke("cipa-acesso", { body: { acao: "identificacao_status" } });
    if (error || !data || data.erro) throw error || new Error(data && data.erro);
    statusIdent = new Map(data.status.map((s) => [s.membro_id, s.completo]));
  } catch (e) {
    console.error(e);
  }
}

function renderTudo() {
  renderIndicadores();
  renderQuadro();
  renderLista();
  renderGestoes();
}

// Membros que pertencem à gestão escolhida (apoio sem gestão vale para todas)
function dagestao(m) {
  if (!gestaoAtual) return true;
  return !m.gestao_id || m.gestao_id === gestaoAtual.id;
}
function nomeGestao(id) {
  const g = gestoes.find((x) => x.id === id);
  return g ? g.nome : "-";
}
function iniciais(nome) {
  const p = String(nome || "?").trim().split(/\s+/);
  return ((p[0] || "")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
function avatarHtml(m, extra = "") {
  if (m.foto_url) return `<img class="avatar ${extra}" src="${escHtml(m.foto_url)}" alt="${escHtml(m.nome)}" loading="lazy" />`;
  return `<div class="avatar ${extra} avatar-ini">${escHtml(iniciais(m.nome))}</div>`;
}

// ---------------- Indicadores ----------------
function renderIndicadores() {
  const ativos = membros.filter((m) => m.ativo && dagestao(m));
  document.getElementById("ind-ativos").textContent = ativos.length;
  document.getElementById("ind-titulares").textContent = ativos.filter((m) => m.tipo === "Titular").length;
  document.getElementById("ind-suplentes").textContent = ativos.filter((m) => m.tipo === "Suplente").length;
  const el = document.getElementById("ind-dias");
  if (gestaoAtual) {
    const d = diasAte(gestaoAtual.fim);
    el.textContent = d < 0 ? "Encerrado" : d;
    el.style.color = d <= 90 ? "var(--danger)" : "";
  } else el.textContent = "-";
}

// ---------------- Quadro (organograma) ----------------
function cartaoOrg(m, classe) {
  const rep = m.representacao === "Empregador" ? "Empregador" : m.representacao === "Empregados" ? "Empregados" : "Apoio";
  return `<div class="org-card ${classe}">
    ${m.cargo_cipa && ["Presidente", "Vice-presidente", "Secretário"].includes(m.cargo_cipa) ? `<div class="cargo-tag">${escHtml(m.cargo_cipa)}</div>` : ""}
    ${avatarHtml(m)}
    <div class="nome">${escHtml(m.nome)}</div>
    <div class="info">${escHtml(m.funcao || m.departamento || "")}</div>
    <div class="org-badges"><span class="badge badge-${m.tipo === "Suplente" ? "suplente" : rep === "Empregador" ? "empregador" : "empregados"} papel">${escHtml(m.tipo === "Apoio" ? "Apoio" : rep + " · " + m.tipo)}</span></div>
  </div>`;
}
function linhaOrg(rotulo, lista, classe, vazio) {
  return `<div class="org-row-label">${escHtml(rotulo)} <span class="org-count">${lista.length}</span></div>
    <div class="org-row">${lista.length ? lista.map((m) => cartaoOrg(m, classe)).join("") : `<div class="org-vazio">${escHtml(vazio)}</div>`}</div>`;
}
function renderQuadro() {
  const box = document.getElementById("orgchart-container");
  const ativos = ordenarMembros(membros.filter((m) => m.ativo && dagestao(m)));
  if (!ativos.length) {
    box.innerHTML = '<div class="empty-state">Nenhum membro ativo nesta gestão. Use a aba Novo membro para cadastrar.</div>';
    return;
  }
  const topo = ativos.filter((m) => ["Presidente", "Vice-presidente", "Secretário"].includes(m.cargo_cipa));
  const resto = ativos.filter((m) => !topo.includes(m));
  const cls = { Presidente: "presidente", "Vice-presidente": "vice", Secretário: "secretario" };
  let html = `<div class="org-row-label">Coordenação da CIPA <span class="org-count">${topo.length}</span></div><div class="org-row">${
    topo.length ? topo.map((m) => cartaoOrg(m, cls[m.cargo_cipa])).join("") : '<div class="org-vazio">Presidente, vice-presidente e secretário ainda não definidos.</div>'
  }</div>`;
  const grupo = (rep, tipo) => resto.filter((m) => m.representacao === rep && m.tipo === tipo);
  html += linhaOrg("Representantes do Empregador · Titulares", grupo("Empregador", "Titular"), "empregador", "Sem titulares do empregador.");
  html += linhaOrg("Representantes do Empregador · Suplentes", grupo("Empregador", "Suplente"), "suplente", "Sem suplentes do empregador.");
  html += linhaOrg("Representantes dos Empregados · Titulares", grupo("Empregados", "Titular"), "empregados", "Sem titulares eleitos pelos empregados.");
  html += linhaOrg("Representantes dos Empregados · Suplentes", grupo("Empregados", "Suplente"), "suplente", "Sem suplentes eleitos pelos empregados.");
  const apoio = resto.filter((m) => m.representacao === "Apoio" || m.tipo === "Apoio");
  if (apoio.length) html += linhaOrg("Apoio (RH / SESMT)", apoio, "suplente", "");
  box.innerHTML = html;
}

async function exportarPdfMembros() {
  if (!window.jspdf) return showToast("Biblioteca de PDF não carregou.", "error");
  const ativos = ordenarMembros(membros.filter((m) => m.ativo && dagestao(m)));
  if (!ativos.length) return showToast("Não há membros ativos para listar.", "error");
  const doc = new window.jspdf.jsPDF({ orientation: "landscape" });
  const linhas = [];
  if (gestaoAtual) linhas.push(`${gestaoAtual.nome} · ${formatarDataBR(gestaoAtual.inicio)} a ${formatarDataBR(gestaoAtual.fim)}`);
  const y = await cabecalhoPdf(doc, "QUADRO DE MEMBROS DA CIPA", linhas);
  doc.autoTable({
    startY: y,
    head: [["Nome", "Cargo na CIPA", "Representação", "Tipo", "Departamento", "Função"]],
    body: ativos.map((m) => [m.nome, m.cargo_cipa || "-", m.representacao, m.tipo, m.departamento || "-", m.funcao || "-"]),
    headStyles: CORES_TABELA_PDF,
    styles: { fontSize: 9 },
  });
  rodapePdf(doc);
  doc.save("Quadro_CIPA.pdf");
}

// ---------------- Lista ----------------
function badgeEstabilidade(m) {
  if (!m.estabilidade_ate) return '<span class="text-muted small">-</span>';
  const d = diasAte(m.estabilidade_ate);
  if (d < 0) return `<span class="badge badge-muted" title="Encerrada em ${formatarDataBR(m.estabilidade_ate)}">Encerrada</span>`;
  if (d <= 60) return `<span class="badge badge-warn" title="Até ${formatarDataBR(m.estabilidade_ate)}">Vence em ${d} d</span>`;
  return `<span class="badge badge-ok">Até ${formatarDataBR(m.estabilidade_ate)}</span>`;
}
function badgeIdent(m) {
  if (statusIdent === null) return '<span class="text-muted small">-</span>';
  return statusIdent.get(m.id) ? '<span class="badge badge-ok">Cadastrado</span>' : '<span class="badge badge-warn">Pendente</span>';
}
function renderLista() {
  const tbody = document.getElementById("tabela-membros-body");
  const busca = normalizarNome(document.getElementById("busca-membro").value);
  const rep = document.getElementById("filtro-representacao").value;
  const tipo = document.getElementById("filtro-tipo").value;
  const sit = document.getElementById("filtro-situacao").value;
  const lista = ordenarMembros(membros.filter((m) => dagestao(m))).filter((m) => {
    if (rep !== "todas" && m.representacao !== rep) return false;
    if (tipo !== "todos" && m.tipo !== tipo) return false;
    if (sit === "ativos" && !m.ativo) return false;
    if (sit === "inativos" && m.ativo) return false;
    if (busca && !normalizarNome([m.nome, m.departamento, m.funcao, m.cargo_cipa].join(" ")).includes(busca)) return false;
    return true;
  });
  document.getElementById("membros-empty").style.display = lista.length ? "none" : "block";
  tbody.innerHTML = lista
    .map((m) => {
      const situ = acesso.editor
        ? `<button class="btn-situacao ${m.ativo ? "ativo" : "inativo"}" data-id="${m.id}" title="${m.ativo ? "Clique para registrar a saída" : "Clique para reativar"}">${m.ativo ? "Ativo" : "Inativo"}</button>`
        : `<span class="badge ${m.ativo ? "badge-ok" : "badge-muted"}">${m.ativo ? "Ativo" : "Inativo"}</span>`;
      const saida = !m.ativo && m.data_saida ? `<div class="small text-muted">Saiu em ${formatarDataBR(m.data_saida)}${m.motivo_saida ? " · " + escHtml(m.motivo_saida) : ""}</div>` : "";
      return `<tr class="${m.ativo ? "" : "linha-inativa"}">
        <td><div class="row" style="flex-wrap:nowrap;">${avatarHtml(m, "avatar-sm")}<div><b>${escHtml(m.nome)}</b>${saida}</div></div></td>
        <td><span class="badge badge-${m.representacao === "Empregador" ? "empregador" : m.representacao === "Empregados" ? "empregados" : "suplente"}">${escHtml(m.representacao)}</span> <span class="small text-muted">${escHtml(m.tipo)}</span></td>
        <td>${escHtml(m.cargo_cipa || "-")}</td>
        <td>${escHtml(m.departamento || "-")}<div class="small text-muted">${escHtml(m.funcao || "")}</div></td>
        <td>${badgeEstabilidade(m)}</td>
        <td class="col-ident" ${acesso.editor ? "" : 'style="display:none;"'}>${badgeIdent(m)}</td>
        <td>${situ}</td>
        <td><button class="btn-mini btn-editar-membro" data-id="${m.id}" title="Editar">✏️</button></td>
      </tr>`;
    })
    .join("");
  tbody.querySelectorAll(".btn-editar-membro").forEach((b) => b.addEventListener("click", () => abrirEdicaoMembro(b.dataset.id)));
  tbody.querySelectorAll(".btn-situacao").forEach((b) => b.addEventListener("click", () => alternarSituacao(b.dataset.id)));
}

// ---------------- Formulário de membro (novo e edição) ----------------
function opcoesGestaoSel(sel) {
  return `<option value="">(sem gestão: vale para todas)</option>` + gestoes.map((g) => `<option value="${g.id}" ${g.id === sel ? "selected" : ""}>${escHtml(g.nome)}</option>`).join("");
}
function camposMembro(p, m) {
  const gSel = m.gestao_id !== undefined ? m.gestao_id : gestaoAtual ? gestaoAtual.id : "";
  return `<div class="form-grid">
    <div class="field field-full"><label>Nome completo *</label><input type="text" id="${p}-nome" value="${escHtml(m.nome || "")}" /></div>
    <div class="field"><label>Gestão</label><select id="${p}-gestao">${opcoesGestaoSel(gSel)}</select></div>
    <div class="field"><label>Representação *</label><select id="${p}-rep">${opcoesLista(["Empregador", "Empregados", "Apoio"], m.representacao || "Empregados")}</select></div>
    <div class="field"><label>Tipo *</label><select id="${p}-tipo">${opcoesLista(["Titular", "Suplente", "Apoio"], m.tipo || "Titular")}</select></div>
    <div class="field"><label>Cargo na CIPA</label><select id="${p}-cargo"><option value="">(nenhum)</option>${opcoesLista(CARGOS_CIPA, m.cargo_cipa)}</select></div>
    <div class="field"><label>Departamento</label><input type="text" id="${p}-depto" value="${escHtml(m.departamento || "")}" /></div>
    <div class="field"><label>Função</label><input type="text" id="${p}-funcao" value="${escHtml(m.funcao || "")}" /></div>
    <div class="field"><label>Entrou na CIPA em</label><input type="date" id="${p}-entrada" value="${escHtml(m.data_entrada || "")}" /></div>
    <div class="field"><label>Estabilidade até</label><input type="date" id="${p}-estab" value="${escHtml(m.estabilidade_ate || "")}" />
      <div class="small text-muted" style="margin-top:4px;">Preencha conforme orientação do SESMT ou do jurídico.</div></div>
    <div class="field field-full"><label>Foto</label><input type="file" id="${p}-foto" accept="image/*" />${m.foto_url ? `<div class="small text-muted" style="margin-top:4px;">Já tem foto. Escolha outra só para trocar.</div>` : ""}</div>
    <div class="field field-full"><label>Observação</label><input type="text" id="${p}-obs" value="${escHtml(m.observacao || "")}" /></div>
  </div>`;
}
function ligarCamposMembro(p) {
  const rep = document.getElementById(p + "-rep");
  const tipo = document.getElementById(p + "-tipo");
  const cargo = document.getElementById(p + "-cargo");
  const sincronizar = (origem) => {
    if (origem === "rep" && rep.value === "Apoio") tipo.value = "Apoio";
    if (origem === "tipo" && tipo.value === "Apoio") rep.value = "Apoio";
    if (origem === "rep" && rep.value !== "Apoio" && tipo.value === "Apoio") tipo.value = "Titular";
    if (origem === "tipo" && tipo.value !== "Apoio" && rep.value === "Apoio") rep.value = "Empregados";
    cargo.disabled = rep.value === "Apoio";
    if (cargo.disabled) cargo.value = "";
  };
  rep.addEventListener("change", () => sincronizar("rep"));
  tipo.addEventListener("change", () => sincronizar("tipo"));
  sincronizar("rep");
}
function lerCamposMembro(p) {
  const v = (s) => document.getElementById(`${p}-${s}`).value.trim();
  return {
    nome: v("nome").toUpperCase(),
    gestao_id: v("gestao") || null,
    representacao: v("rep"),
    tipo: v("tipo"),
    cargo_cipa: v("cargo") || null,
    departamento: v("depto") || null,
    funcao: v("funcao") || null,
    data_entrada: v("entrada") || null,
    estabilidade_ate: v("estab") || null,
    observacao: v("obs") || null,
  };
}
async function enviarFoto(p) {
  const f = document.getElementById(p + "-foto").files[0];
  if (!f) return undefined;
  return uploadArquivo(BUCKET_FOTOS, f, "cipa/");
}

async function salvarNovoMembro() {
  const dados = lerCamposMembro("nm");
  if (!dados.nome) return showToast("Informe o nome do membro.", "error");
  const btn = document.getElementById("btn-salvar-novo");
  btn.disabled = true;
  try {
    const foto = await enviarFoto("nm");
    if (foto) dados.foto_url = foto;
    const { error } = await supabaseClient.from("cipa_membros").insert(dados);
    if (error) throw error;
    showToast("Membro cadastrado.", "success");
    document.getElementById("form-novo-membro").innerHTML = camposMembro("nm", {});
    ligarCamposMembro("nm");
    await carregarTudo();
    document.querySelector('.tab-btn[data-tab="lista"]').click();
  } catch (e) {
    console.error(e);
    showToast("Não foi possível cadastrar: " + (e.message || e), "error");
  }
  btn.disabled = false;
}

// ---------------- Edição em modal ----------------
function abrirEdicaoMembro(id) {
  const m = membros.find((x) => x.id === id);
  if (!m) return;
  const identBloco = acesso.editor
    ? `<div class="ident-box">
        <b>Identificação para o acesso ao app (CPF e data de nascimento)</b>
        <p class="small text-muted" style="margin:4px 0 10px;">${statusIdent && statusIdent.get(m.id) ? "Já cadastrada. Os dados ficam protegidos e não aparecem aqui; preencha só para corrigir." : "Ainda não cadastrada. Sem ela, esta pessoa não consegue entrar no app."}</p>
        <div class="linha-form">
          <div class="field"><label>CPF</label><input type="text" id="ed-cpf" inputmode="numeric" placeholder="000.000.000-00" /></div>
          <div class="field"><label>Data de nascimento</label><input type="date" id="ed-nasc" /></div>
        </div>
        <div class="row mt-16"><button class="btn btn-dark" id="ed-salvar-ident">Salvar identificação</button></div>
      </div>`
    : "";
  const modal = abrirModalHtml(`Editar · ${escHtml(m.nome)}`, `${camposMembro("ed", m)}${identBloco}
    <div class="row mt-16"><button class="btn btn-primary" id="ed-salvar">Salvar alterações</button><button class="btn btn-secondary" id="ed-cancelar">Cancelar</button></div>`, 720);
  ligarCamposMembro("ed");
  modal.querySelector("#ed-cancelar").onclick = fecharModalHtml;
  modal.querySelector("#ed-salvar").onclick = async () => {
    const dados = lerCamposMembro("ed");
    if (!dados.nome) return showToast("Informe o nome do membro.", "error");
    const btn = modal.querySelector("#ed-salvar");
    btn.disabled = true;
    try {
      const foto = await enviarFoto("ed");
      if (foto) dados.foto_url = foto;
      dados.updated_at = new Date().toISOString();
      const { error } = await supabaseClient.from("cipa_membros").update(dados).eq("id", id);
      if (error) throw error;
      showToast("Membro atualizado.", "success");
      fecharModalHtml();
      await carregarTudo();
    } catch (e) {
      console.error(e);
      showToast("Não foi possível salvar: " + (e.message || e), "error");
      btn.disabled = false;
    }
  };
  if (!acesso.editor) return;
  const cpf = modal.querySelector("#ed-cpf");
  cpf.addEventListener("input", () => {
    const d = cpfDigitos(cpf.value).slice(0, 11);
    cpf.value = d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  });
  modal.querySelector("#ed-salvar-ident").onclick = async () => {
    const d = cpfDigitos(cpf.value);
    const nascimento = modal.querySelector("#ed-nasc").value;
    if (d.length !== 11) return showToast("Informe o CPF completo.", "error");
    if (!nascimento) return showToast("Informe a data de nascimento.", "error");
    const btn = modal.querySelector("#ed-salvar-ident");
    btn.disabled = true;
    try {
      const { data, error } = await supabaseClient.functions.invoke("cipa-acesso", { body: { acao: "salvar_identificacao", membro_id: id, cpf: d, nascimento } });
      if (error) {
        let msg = error.message;
        try {
          msg = (await error.context.json()).erro || msg;
        } catch (e) {}
        throw new Error(msg);
      }
      if (data && data.erro) throw new Error(data.erro);
      showToast("Identificação salva.", "success");
      cpf.value = "";
      modal.querySelector("#ed-nasc").value = "";
      await carregarStatusIdent();
      renderLista();
    } catch (e) {
      showToast(e.message || "Não foi possível salvar.", "error");
    }
    btn.disabled = false;
  };
}

// ---------------- Ativo / Inativo ----------------
function alternarSituacao(id) {
  if (!acesso.editor) return;
  const m = membros.find((x) => x.id === id);
  if (!m) return;
  if (!m.ativo) {
    if (!confirm(`Reativar ${m.nome}?`)) return;
    return gravarSituacao(id, { ativo: true, data_saida: null, motivo_saida: null }, "Membro reativado.");
  }
  const modal = abrirModalHtml(
    `Saída da CIPA · ${escHtml(m.nome)}`,
    `<p class="small text-muted" style="margin-top:0;">Não apague o cadastro: as reuniões anteriores continuam com o nome da pessoa. A partir da data de saída ela deixa de aparecer no quadro e nas listas de presença.</p>
    <div class="field"><label>Data de saída *</label><input type="date" id="sai-data" value="${hojeISOLocal()}" /></div>
    <div class="field mt-16"><label>Motivo</label><input type="text" id="sai-motivo" placeholder="Ex.: pediu demissão, fim do mandato" /></div>
    <div class="row mt-16"><button class="btn btn-primary" id="sai-ok">Registrar saída</button><button class="btn btn-secondary" id="sai-cancelar">Cancelar</button></div>`,
    460
  );
  modal.querySelector("#sai-cancelar").onclick = fecharModalHtml;
  modal.querySelector("#sai-ok").onclick = () => {
    const data = modal.querySelector("#sai-data").value;
    if (!data) return showToast("Informe a data de saída.", "error");
    gravarSituacao(id, { ativo: false, data_saida: data, motivo_saida: modal.querySelector("#sai-motivo").value.trim() || null }, "Saída registrada.");
  };
}
async function gravarSituacao(id, campos, msg) {
  const { error } = await supabaseClient.from("cipa_membros").update({ ...campos, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return showToast("Não foi possível salvar: " + error.message, "error");
  showToast(msg, "success");
  fecharModalHtml();
  await carregarTudo();
}

// ---------------- Gestões ----------------
function textoRegraReuniao(g) {
  const ordem = g.reuniao_ordem === 5 ? "Última" : `${g.reuniao_ordem}ª`;
  return `${ordem} ${DIAS_SEMANA[g.reuniao_dia_semana]} do mês${g.reuniao_hora ? " às " + g.reuniao_hora : ""}${g.reuniao_local ? " · " + g.reuniao_local : ""}`;
}
function renderGestoes() {
  const box = document.getElementById("lista-gestoes");
  if (!gestoes.length) {
    box.innerHTML = '<div class="empty-state">Nenhuma gestão cadastrada. Clique em "+ Nova gestão" para criar a primeira.</div>';
    return;
  }
  box.innerHTML = gestoes
    .map((g) => {
      const dias = diasAte(g.fim);
      const qtd = membros.filter((m) => m.ativo && m.gestao_id === g.id).length;
      const aviso =
        g.ativa && dias >= 0 && dias <= 90
          ? `<div class="aviso-sensivel" style="margin:10px 0 0;">O mandato termina em <b>${dias} dia(s)</b>. Confira o cronograma da <a href="eleicao.html" style="color:var(--brand-red);font-weight:700;">eleição e posse</a>.</div>`
          : "";
      const fim = dias < 0 ? `<span class="badge badge-muted">Encerrada</span>` : `<span class="badge ${dias <= 90 ? "badge-warn" : "badge-ok"}">${dias} dia(s) até o fim</span>`;
      return `<div class="gestao-card ${g.ativa ? "atual" : ""}">
        <div class="row justify-between">
          <div><h4>${escHtml(g.nome)} ${g.ativa ? '<span class="badge badge-cipa">Gestão atual</span>' : ""}</h4>
            <div class="gestao-info">${formatarDataBR(g.inicio)} a ${formatarDataBR(g.fim)} · ${fim}<br>Reunião mensal: ${escHtml(textoRegraReuniao(g))}<br>${qtd} membro(s) ativo(s) cadastrado(s) nesta gestão${g.observacao ? "<br>" + escHtml(g.observacao) : ""}</div></div>
          <div class="row">
            ${g.ativa ? "" : `<button class="btn-mini btn-ativar-gestao" data-id="${g.id}">Marcar como atual</button>`}
            <button class="btn-mini btn-editar-gestao" data-id="${g.id}" title="Editar">✏️</button>
          </div>
        </div>${aviso}</div>`;
    })
    .join("");
  box.querySelectorAll(".btn-editar-gestao").forEach((b) => b.addEventListener("click", () => abrirFormGestao(b.dataset.id)));
  box.querySelectorAll(".btn-ativar-gestao").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Marcar esta gestão como a atual? As outras deixam de ser a atual.")) return;
      await definirGestaoAtiva(b.dataset.id);
      showToast("Gestão atual atualizada.", "success");
      await carregarTudo();
    })
  );
}
async function definirGestaoAtiva(id) {
  const r1 = await supabaseClient.from("cipa_gestoes").update({ ativa: false }).neq("id", id).eq("ativa", true);
  if (r1.error) throw r1.error;
  const r2 = await supabaseClient.from("cipa_gestoes").update({ ativa: true }).eq("id", id);
  if (r2.error) throw r2.error;
}
function abrirFormGestao(id) {
  const g = id ? gestoes.find((x) => x.id === id) : { reuniao_ordem: 3, reuniao_dia_semana: 3, ativa: !gestoes.length };
  const ordens = [[1, "1ª"], [2, "2ª"], [3, "3ª"], [4, "4ª"], [5, "Última"]];
  const modal = abrirModalHtml(
    id ? "Editar gestão" : "Nova gestão",
    `<div class="form-grid">
      <div class="field field-full"><label>Nome da gestão *</label><input type="text" id="g-nome" placeholder="Ex.: Gestão 2026/2027" value="${escHtml(g.nome || "")}" /></div>
      <div class="field"><label>Início do mandato *</label><input type="date" id="g-inicio" value="${escHtml(g.inicio || "")}" /></div>
      <div class="field"><label>Fim do mandato *</label><input type="date" id="g-fim" value="${escHtml(g.fim || "")}" /></div>
      <div class="field"><label>Reunião mensal: qual semana</label><select id="g-ordem">${ordens.map(([v, t]) => `<option value="${v}" ${v === g.reuniao_ordem ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="field"><label>Dia da semana</label><select id="g-dia">${DIAS_SEMANA.map((d, i) => `<option value="${i}" ${i === g.reuniao_dia_semana ? "selected" : ""}>${d}</option>`).join("")}</select></div>
      <div class="field"><label>Horário</label><input type="text" id="g-hora" placeholder="Ex.: 14:00" value="${escHtml(g.reuniao_hora || "")}" /></div>
      <div class="field"><label>Local</label><input type="text" id="g-local" placeholder="Ex.: Sala de reuniões" value="${escHtml(g.reuniao_local || "")}" /></div>
      <div class="field field-full"><label>Observação</label><input type="text" id="g-obs" value="${escHtml(g.observacao || "")}" /></div>
      <div class="field field-full"><label class="check-line"><input type="checkbox" id="g-ativa" ${g.ativa ? "checked" : ""} /> Esta é a gestão atual</label></div>
    </div>
    <div class="row mt-16"><button class="btn btn-primary" id="g-salvar">Salvar gestão</button><button class="btn btn-secondary" id="g-cancelar">Cancelar</button></div>`,
    640
  );
  const ini = modal.querySelector("#g-inicio");
  const fim = modal.querySelector("#g-fim");
  ini.addEventListener("change", () => {
    if (!fim.value && ini.value) fim.value = somarDias(isoMaisUmAno(ini.value), -1);
  });
  modal.querySelector("#g-cancelar").onclick = fecharModalHtml;
  modal.querySelector("#g-salvar").onclick = async () => {
    const dados = {
      nome: modal.querySelector("#g-nome").value.trim(),
      inicio: ini.value,
      fim: fim.value,
      reuniao_ordem: Number(modal.querySelector("#g-ordem").value),
      reuniao_dia_semana: Number(modal.querySelector("#g-dia").value),
      reuniao_hora: modal.querySelector("#g-hora").value.trim() || null,
      reuniao_local: modal.querySelector("#g-local").value.trim() || null,
      observacao: modal.querySelector("#g-obs").value.trim() || null,
      ativa: modal.querySelector("#g-ativa").checked,
    };
    if (!dados.nome) return showToast("Informe o nome da gestão.", "error");
    if (!dados.inicio || !dados.fim) return showToast("Informe o início e o fim do mandato.", "error");
    if (dados.fim <= dados.inicio) return showToast("O fim do mandato precisa ser depois do início.", "error");
    const btn = modal.querySelector("#g-salvar");
    btn.disabled = true;
    try {
      let idFinal = id;
      if (id) {
        const { error } = await supabaseClient.from("cipa_gestoes").update(dados).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabaseClient.from("cipa_gestoes").insert(dados).select("id").single();
        if (error) throw error;
        idFinal = data.id;
      }
      if (dados.ativa) await definirGestaoAtiva(idFinal);
      showToast("Gestão salva.", "success");
      fecharModalHtml();
      if (!id || !gestaoAtual) lembrarGestao(idFinal);
      const sel = await montarSeletorGestao(document.getElementById("seletor-gestao"), (x) => {
        gestaoAtual = x;
        renderTudo();
      });
      gestaoAtual = sel.atual;
      await carregarTudo();
    } catch (e) {
      console.error(e);
      showToast("Não foi possível salvar: " + (e.message || e), "error");
      btn.disabled = false;
    }
  };
}
function isoMaisUmAno(iso) {
  const d = dataDeISO(iso);
  d.setFullYear(d.getFullYear() + 1);
  return isoDeData(d);
}

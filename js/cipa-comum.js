// =========================================================================
// CIPA BOXER - Funções comuns às telas (gestão ativa, temas, status, modal)
// Carregar DEPOIS de supabaseClient.js e ANTES de acesso.js
// =========================================================================

const TEMAS_ACAO = [
  "Condições do ambiente",
  "EPI e EPC",
  "Treinamento e conscientização",
  "Riscos ergonômicos e psicossociais",
  "Máquinas e equipamentos",
  "Emergência e incêndio",
  "Outros",
];
const PRIORIDADES = ["Alta", "Média", "Baixa"];
const ORIGENS_ACAO = ["Manual", "Reunião", "Inspeção", "Acidente", "Eleição / SIPAT"];
const CARGOS_CIPA = ["Presidente", "Vice-presidente", "Secretário", "Membro"];
const SETORES_PADRAO = ["Administrativo - Térreo", "Administrativo - 1º andar", "Administrativo - 2º andar", "Produção / Soldagem", "Almoxarifado", "Expedição", "Refeitório", "Área externa"];
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DIAS_SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function opcoesLista(lista, sel) {
  return lista.map((t) => `<option ${t === sel ? "selected" : ""}>${escHtml(t)}</option>`).join("");
}
function ordemTema(t) {
  const i = TEMAS_ACAO.indexOf(t);
  return i < 0 ? TEMAS_ACAO.length : i;
}

// Situação da ação: concluída se tem data de conclusão; atrasada se o prazo já passou
function statusAcao(a) {
  if (a.data_conclusao) return "Concluída";
  if (a.prazo && a.prazo < hojeISOLocal()) return "Atrasada";
  return "Em andamento";
}
function badgeStatus(st) {
  const c = st === "Concluída" ? "badge-ok" : st === "Atrasada" ? "badge-danger" : "badge-warn";
  return `<span class="badge ${c}">${escHtml(st)}</span>`;
}
function badgePrioridade(p) {
  const c = p === "Alta" ? "badge-danger" : p === "Baixa" ? "badge-muted" : "badge-warn";
  return `<span class="badge ${c}">${escHtml(p || "Média")}</span>`;
}

// ---------------- Datas ----------------
function isoDeData(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dataDeISO(iso) {
  return new Date(String(iso).slice(0, 10) + "T00:00:00");
}
function somarDias(iso, dias) {
  const d = dataDeISO(iso);
  d.setDate(d.getDate() + dias);
  return isoDeData(d);
}
function nomeMesAno(iso) {
  const d = dataDeISO(iso);
  return `${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}
// n-ésimo dia da semana do mês (ordem 5 = último). Ex.: 3ª quarta-feira => (ano, mes0, 3, 3)
function nesimoDiaSemana(ano, mes0, ordem, diaSemana) {
  if (ordem >= 5) {
    const d = new Date(ano, mes0 + 1, 0);
    while (d.getDay() !== diaSemana) d.setDate(d.getDate() - 1);
    return isoDeData(d);
  }
  const d = new Date(ano, mes0, 1);
  while (d.getDay() !== diaSemana) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 7 * (ordem - 1));
  return isoDeData(d);
}
// Meses (1º dia de cada mês) cobertos pela gestão
function mesesDaGestao(g) {
  const out = [];
  const ini = dataDeISO(g.inicio);
  const fim = dataDeISO(g.fim);
  const d = new Date(ini.getFullYear(), ini.getMonth(), 1);
  while (d <= fim) {
    out.push(isoDeData(d));
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}
function dataPadraoReuniao(g, mesISO) {
  const d = dataDeISO(mesISO);
  return nesimoDiaSemana(d.getFullYear(), d.getMonth(), g.reuniao_ordem || 3, g.reuniao_dia_semana ?? 3);
}

// ---------------- Gestão (mandato) ativa ----------------
const CHAVE_GESTAO = "cipa_gestao_escolhida";
async function carregarGestoes() {
  const { data, error } = await supabaseClient.from("cipa_gestoes").select("*").order("inicio", { ascending: false });
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}
function escolherGestao(gestoes) {
  if (!gestoes.length) return null;
  let id = null;
  try {
    id = localStorage.getItem(CHAVE_GESTAO);
  } catch (e) {}
  return gestoes.find((g) => g.id === id) || gestoes.find((g) => g.ativa) || gestoes[0];
}
function lembrarGestao(id) {
  try {
    localStorage.setItem(CHAVE_GESTAO, id);
  } catch (e) {}
}
// Monta um <select> com as gestões dentro de `el`; chama onChange(gestao) ao trocar
async function montarSeletorGestao(el, onChange) {
  const gestoes = await carregarGestoes();
  let atual = escolherGestao(gestoes);
  if (!el) return { gestoes, atual };
  if (!gestoes.length) {
    el.innerHTML = '<span class="small text-muted">Nenhuma gestão cadastrada. Crie em <a href="membros.html" style="color:var(--brand-red);font-weight:700;">Membros → Gestões</a>.</span>';
    return { gestoes, atual: null };
  }
  el.innerHTML = `<label class="small text-muted" style="font-weight:700;">Gestão</label>
    <select id="filtro-gestao" style="min-width:200px;">${gestoes.map((g) => `<option value="${g.id}" ${atual && g.id === atual.id ? "selected" : ""}>${escHtml(g.nome)}${g.ativa ? " (atual)" : ""}</option>`).join("")}</select>`;
  el.querySelector("select").addEventListener("change", (e) => {
    atual = gestoes.find((g) => g.id === e.target.value);
    lembrarGestao(atual.id);
    if (onChange) onChange(atual);
  });
  return { gestoes, atual };
}

// Membros ativos da gestão na data (sem cadastro de gestão: todos os ativos)
async function membrosAtivos(gestaoId, dataISO) {
  let q = supabaseClient.from("cipa_membros").select("*").order("nome");
  const { data, error } = await q;
  if (error) {
    console.error(error);
    return [];
  }
  return (data || []).filter((m) => {
    if (gestaoId && m.gestao_id && m.gestao_id !== gestaoId) return false;
    if (m.representacao === "Apoio" && !m.gestao_id) return true;
    if (!m.ativo && !(m.data_saida && dataISO && m.data_saida >= dataISO)) return false;
    if (dataISO && m.data_saida && m.data_saida < dataISO) return false;
    if (dataISO && m.data_entrada && m.data_entrada > dataISO) return false;
    return true;
  });
}
function ordemMembro(m) {
  const cargo = CARGOS_CIPA.indexOf(m.cargo_cipa);
  const rep = m.representacao === "Empregador" ? 0 : m.representacao === "Empregados" ? 1 : 2;
  const tipo = m.tipo === "Titular" ? 0 : m.tipo === "Suplente" ? 1 : 2;
  return [cargo < 0 ? 9 : cargo, rep, tipo];
}
function ordenarMembros(lista) {
  return [...lista].sort((a, b) => {
    const x = ordemMembro(a), y = ordemMembro(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

// ---------------- Modal simples ----------------
function abrirModalHtml(titulo, corpoHtml, largura = 640) {
  fecharModalHtml();
  const m = document.createElement("div");
  m.id = "modal-cipa";
  m.className = "modal-backdrop";
  m.style.display = "flex";
  m.innerHTML = `<div class="modal" style="max-width:${largura}px;width:100%;max-height:90vh;overflow:auto;">
    <div class="modal-header"><h3 style="margin:0;">${titulo}</h3><button class="modal-close" data-fechar>✕</button></div>
    <div id="modal-cipa-corpo">${corpoHtml}</div></div>`;
  document.body.appendChild(m);
  m.querySelector("[data-fechar]").onclick = fecharModalHtml;
  return m;
}
function fecharModalHtml() {
  const m = document.getElementById("modal-cipa");
  if (m) m.remove();
}

// Pergunta de confirmação antes de excluir
function confirmarExclusao(texto) {
  return confirm((texto || "Excluir este registro?") + "\n\nEssa ação não tem volta.");
}

// Dias sem acidente com afastamento etc. usam hojeISOLocal() e diasAte() de supabaseClient.js

// Envia anexo (público: ata/inspeção assinadas) com prefixo cipa/
async function anexarArquivoCipa(file) {
  return uploadArquivo(BUCKET_DOCUMENTOS, file, "cipa/");
}
// Anexo com dados pessoais (CAT, laudo): bucket privado
async function anexarArquivoPrivadoCipa(file) {
  return uploadPrivado(file, "cipa/");
}

// Garante que só quem entrou usa a tela; devolve false se ainda na portaria
async function telaPronta() {
  if (typeof acessoPronto !== "undefined") await acessoPronto;
  if (!CONFIGURADO) return false;
  return !!(typeof acesso !== "undefined" && acesso.logado);
}

// Registra rótulo do filtro de ação para dashboards
function contarPor(lista, fn) {
  const m = new Map();
  lista.forEach((x) => m.set(fn(x), (m.get(fn(x)) || 0) + 1));
  return m;
}

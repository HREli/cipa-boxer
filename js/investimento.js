// =========================================================================
// CIPA BOXER - Planejamento das atividades (significado, responsáveis,
// texto formatado) e painel de Investimento (custos por campanha e por mês)
// =========================================================================

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const moeda = (v) => (v === null || v === undefined || v === "" ? "—" : BRL.format(Number(v)));
const numOuNulo = (v) => {
  const t = String(v || "").trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const valorCampo = (v) => (v === null || v === undefined ? "" : String(Number(v).toFixed(2)).replace(".", ","));

// "Janeiro Branco - Conscientização..." vira título + significado quando o significado ainda não foi preenchido
function partesTitulo(e) {
  if (e.significado && e.significado.trim()) return { titulo: e.titulo, sig: e.significado };
  const m = String(e.titulo || "").match(/^(.{2,60}?)\s+[-–—]\s+(.+)$/);
  return m ? { titulo: m[1], sig: m[2] } : { titulo: e.titulo, sig: "" };
}

// Texto formatado: só marcações simples, sem atributos
const TAGS_OK = ["B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "H4", "P", "BR", "DIV"];
function limparHtml(html) {
  const doc = new DOMParser().parseFromString("<div>" + (html || "") + "</div>", "text/html");
  const limpar = (no) => {
    [...no.childNodes].forEach((f) => {
      if (f.nodeType === 3) return;
      if (f.nodeType !== 1 || !TAGS_OK.includes(f.tagName)) {
        if (f.nodeType === 1 && !["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(f.tagName)) {
          limpar(f);
          f.replaceWith(...f.childNodes);
        } else f.remove();
        return;
      }
      [...f.attributes].forEach((a) => f.removeAttribute(a.name));
      limpar(f);
    });
  };
  const raiz = doc.body.firstChild;
  limpar(raiz);
  return raiz.innerHTML.trim();
}
function textoParaHtml(t) {
  return escHtml(t || "").replace(/\n/g, "<br>");
}

const EMOJIS = ["✅", "📌", "🎯", "🧠", "💬", "📣", "🧰", "👥", "📅", "⚠️", "💡", "🩺", "🚧", "🔥", "⭐", "❤️"];
function montarEditor(cont, html) {
  cont.innerHTML = `<div class="ed-barra">
      <button type="button" data-cmd="bold" title="Negrito"><b>B</b></button>
      <button type="button" data-cmd="italic" title="Itálico"><i>I</i></button>
      <button type="button" data-cmd="insertUnorderedList" title="Tópicos">• Tópicos</button>
      <button type="button" data-cmd="insertOrderedList" title="Numeração">1. Numeração</button>
      <button type="button" data-cmd="titulo" title="Subtítulo">Título</button>
      <span class="ed-emoji-wrap"><button type="button" data-cmd="emoji" title="Inserir ícone">😀 Ícone</button>
        <span class="ed-emojis" style="display:none;">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}</span></span>
      <button type="button" data-cmd="undo" title="Desfazer">↶</button>
      <button type="button" data-cmd="redo" title="Refazer">↷</button>
    </div>
    <div class="ed-area" contenteditable="true" spellcheck="true">${limparHtml(html) || ""}</div>`;
  const area = cont.querySelector(".ed-area");
  const pop = cont.querySelector(".ed-emojis");
  cont.querySelectorAll(".ed-barra [data-cmd]").forEach((b) =>
    b.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      const c = b.dataset.cmd;
      if (c === "emoji") return (pop.style.display = pop.style.display === "none" ? "flex" : "none");
      area.focus();
      if (c === "titulo") {
        const atual = document.queryCommandValue("formatBlock").toLowerCase();
        document.execCommand("formatBlock", false, atual === "h4" ? "div" : "h4");
      } else document.execCommand(c, false, null);
    })
  );
  pop.querySelectorAll("[data-emoji]").forEach((b) =>
    b.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      area.focus();
      document.execCommand("insertText", false, b.dataset.emoji + " ");
      pop.style.display = "none";
    })
  );
  return () => limparHtml(area.innerHTML);
}

let NOMES_MEMBROS = null;
async function listaMembrosHtml() {
  if (!NOMES_MEMBROS) {
    const { data } = await supabaseClient.from("cipa_membros").select("nome").eq("ativo", true).order("nome");
    NOMES_MEMBROS = (data || []).map((m) => m.nome);
  }
  return `<datalist id="dl-membros-ev">${NOMES_MEMBROS.map((n) => `<option value="${escHtml(n)}"></option>`).join("")}</datalist>`;
}

// ---------------- Painel de Investimento ----------------
function renderInvestimento() {
  const box = document.getElementById("invest-painel");
  if (!box) return;
  const g = gestaoCal;
  const cat = document.getElementById("filtro-invest-cat").value;
  const lista = eventosCal.filter((e) => (!g || (e.data_inicio >= g.inicio && e.data_inicio <= g.fim)) && (cat === "todas" || e.categoria === cat) && e.situacao !== "Cancelada");
  const comCusto = lista.filter((e) => e.custo_previsto != null || e.custo_real != null);
  const soma = (l, c) => l.reduce((t, e) => t + (Number(e[c]) || 0), 0);
  const prev = soma(comCusto, "custo_previsto");
  const real = soma(comCusto, "custo_real");
  const mesAtual = hojeISOLocal().slice(0, 7);
  const doMes = soma(comCusto.filter((e) => e.data_inicio.slice(0, 7) === mesAtual), "custo_real");
  // por campanha (título sem o significado)
  const grupos = {};
  comCusto.forEach((e) => {
    const t = partesTitulo(e).titulo;
    const k = t + "|" + e.categoria;
    const x = (grupos[k] = grupos[k] || { titulo: t, categoria: e.categoria, prev: 0, real: 0, n: 0 });
    x.prev += Number(e.custo_previsto) || 0;
    x.real += Number(e.custo_real) || 0;
    x.n++;
  });
  const linhas = Object.values(grupos).sort((a, b) => b.real - a.real || b.prev - a.prev);
  const maior = linhas[0];
  // por mês
  const meses = g ? mesesDaGestao(g) : [];
  const porMes = meses.map((m) => {
    const l = comCusto.filter((e) => e.data_inicio.slice(0, 7) === m.slice(0, 7));
    return { m, prev: soma(l, "custo_previsto"), real: soma(l, "custo_real") };
  });
  const max = Math.max(1, ...porMes.map((x) => Math.max(x.prev, x.real)));
  if (!comCusto.length) {
    box.innerHTML = `<div class="panel empty-state">Nenhum custo lançado ${cat === "todas" ? "" : "em " + escHtml(cat) + " "}nesta gestão. Para lançar, abra a atividade no ✏️ (aba DQS, eventos e campanhas) e preencha <b>Investimento</b>.</div>`;
    return;
  }
  box.innerHTML = `
    <div class="indicators">
      <div class="indicator-card concluida"><div class="value" style="font-size:1.5rem;">${moeda(real)}</div><div class="label">Investido (realizado)</div></div>
      <div class="indicator-card total"><div class="value" style="font-size:1.5rem;">${moeda(prev)}</div><div class="label">Previsto${prev ? ` · ${Math.round((real / prev) * 100)}% utilizado` : ""}</div></div>
      <div class="indicator-card andamento"><div class="value" style="font-size:1.5rem;">${moeda(doMes)}</div><div class="label">Realizado neste mês</div></div>
      <div class="indicator-card"><div class="value" style="font-size:1.1rem;color:var(--grafite);">${maior ? escHtml(maior.titulo) : "—"}</div><div class="label">Maior investimento${maior ? " · " + moeda(maior.real || maior.prev) : ""}</div></div>
    </div>
    <div class="invest-grid">
      <div class="panel">
        <h3 style="margin-top:0;">Custo por mês</h3>
        <div class="invest-barras">${porMes
          .map(
            (x) => `<div class="invest-mes" title="${nomeMesAno(x.m)}: previsto ${moeda(x.prev)}, realizado ${moeda(x.real)}">
              <div class="invest-par"><i class="prev" style="height:${(x.prev / max) * 100}%"></i><i class="real" style="height:${(x.real / max) * 100}%"></i></div>
              <span>${MESES[dataDeISO(x.m).getMonth()].slice(0, 3)}</span></div>`
          )
          .join("")}</div>
        <div class="small text-muted"><i class="leg prev"></i> previsto &nbsp; <i class="leg real"></i> realizado</div>
      </div>
      <div class="panel">
        <h3 style="margin-top:0;">Custo por campanha / atividade</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Campanha</th><th>Tipo</th><th class="num">Previsto</th><th class="num">Realizado</th></tr></thead>
          <tbody>${linhas.map((x) => `<tr><td>${escHtml(x.titulo)}${x.n > 1 ? ` <span class="small text-muted">(${x.n})</span>` : ""}</td><td><span class="badge ${classeCategoria(x.categoria)}">${escHtml(x.categoria)}</span></td><td class="num">${moeda(x.prev)}</td><td class="num"><b>${moeda(x.real)}</b></td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="2"><b>Total</b></td><td class="num"><b>${moeda(prev)}</b></td><td class="num"><b>${moeda(real)}</b></td></tr></tfoot>
        </table></div>
      </div>
    </div>`;
}

document.addEventListener("DOMContentLoaded", () => {
  const f = document.getElementById("filtro-invest-cat");
  if (f) f.addEventListener("change", renderInvestimento);
});

// ---------------- Classificação: Obrigatória (Lei 15.377/2026) x Complementar ----------------
const CLASSIF_OPCOES = ["Obrigatória", "Complementar", "Não se aplica"];
const RE_OBRIGATORIA = /vacin|hpv|c[âa]ncer|mama|pr[óo]stata|colo do [úu]tero|outubro rosa|novembro azul|mar[çc]o lil[áa]s/i;
const CATS_CAMPANHA = ["Campanha", "DQS", "SIPAT", "Treinamento", "Outros"];
// Sugere quando não foi escolhida: temas de vacinação, HPV e cânceres de mama, colo do útero e próstata = obrigatória
function classifSugerida(e) {
  const texto = [e.titulo, e.significado].join(" ");
  if (RE_OBRIGATORIA.test(texto)) return "Obrigatória";
  if (CATS_CAMPANHA.includes(e.categoria)) return "Complementar";
  return "Não se aplica";
}
function classifDe(e) {
  return e.classificacao || classifSugerida(e);
}
function seloClassif(c) {
  if (c === "Obrigatória") return '<span class="badge selo-obrig" title="Lei nº 15.377/2026 · art. 169-A da CLT">⚖️ Obrigatória</span>';
  if (c === "Complementar") return '<span class="badge selo-compl">Complementar</span>';
  return "";
}

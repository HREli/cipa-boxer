// =========================================================================
// CIPA BOXER - Controle de acesso
// Editores (presidente, secretaria e quem a administradora autorizar) entram com CPF + senha e editam.
// Demais membros da CIPA apenas visualizam: botões e campos de edição ficam ocultos.
// =========================================================================

const DOMINIO_ACESSO = "cipa.boxersoldas.app";
const acesso = { editor: false, admin: false, nome: "", logado: false, nomeVisual: "" };
// Esconde a página até saber se a pessoa já entrou (o login vem antes de tudo)
document.documentElement.classList.add("verificando-acesso");

// Elementos que continuam funcionando no modo "somente visualizar"
const LIVRES = [
  ".tab-btn", "[id^=filtro]", "[id^=busca]", "#ordenar-por", "#ano-anterior", "#ano-seguinte",
  ".kpi", ".faixa", ".num-pres", ".chip-filtro", "#btn-fechar-detalhe", ".modal-close",
  "button[id*=pdf]", "button[id*=export]", "#btn-print-quadro", ".btn-gerar-pdf", "#btn-modelo",
  "#btn-acesso", "#modal-acesso *", ".btn-situacao", ".nivel-btn",
].join(",");
const ABAS_EDICAO = ["nova", "novo", "importar", "fotos", "lote", "gestoes-edicao"];

function aplicarLeitura(raiz = document) {
  if (acesso.editor) return;
  raiz.querySelectorAll("button, input, select, textarea, label.btn").forEach((el) => {
    if (el.matches(LIVRES) || el.closest("#modal-acesso")) return;
    if (el.tagName === "BUTTON" || el.matches("label.btn") || el.type === "file") el.classList.add("oculto-leitura");
    else el.disabled = true;
  });
  raiz.querySelectorAll(".tab-btn").forEach((b) => {
    if (ABAS_EDICAO.includes(b.dataset.tab)) b.classList.add("oculto-leitura");
  });
}

function cpfDigitos(v) {
  return String(v || "").replace(/\D/g, "");
}

async function verificarAcesso() {
  if (!CONFIGURADO) return;
  const { data } = await supabaseClient.auth.getSession();
  if (data && data.session) {
    acesso.logado = true;
    const { data: eu } = await supabaseClient.rpc("meu_acesso_cipa");
    if (eu && eu.length) Object.assign(acesso, { editor: true, admin: !!eu[0].admin, nome: eu[0].nome });
    else {
      const bid = data.session.user && data.session.user.user_metadata && data.session.user.user_metadata.membro_id;
      if (bid) {
        const { data: b } = await supabaseClient.from("cipa_membros").select("nome").eq("id", bid).maybeSingle();
        acesso.nomeVisual = (b && b.nome) || "";
      }
    }
  }
}

function montarBotaoAcesso() {
  const top = document.querySelector(".topbar");
  if (!top) return;
  const btn = document.createElement("button");
  btn.id = "btn-acesso";
  btn.className = "btn-acesso";
  btn.innerHTML = acesso.editor
    ? `👤 ${escHtml(acesso.nome.split(" ")[0])}${acesso.admin ? " · admin" : ""}`
    : `👁️ ${escHtml((acesso.nomeVisual || "Visualização").split(" ")[0])}`;
  btn.title = acesso.editor ? "Você pode editar. Clique para sair ou gerenciar acessos." : "Somente visualização. Clique para sair ou entrar como editor.";
  const back = top.querySelector(".back-link");
  top.insertBefore(btn, back || null);
  if (!back) btn.style.marginLeft = "auto";
  btn.addEventListener("click", abrirModalAcesso);
  if (!acesso.editor) {
    const faixa = document.createElement("div");
    faixa.className = "faixa-leitura";
    faixa.innerHTML = '👁️ Modo <b>somente visualização</b>. Editores: clique no seu nome, no topo, e em <b>Entrar como editor</b> para editar.';
    const cont = document.querySelector(".container");
    if (cont) cont.prepend(faixa);
  }
}

function abrirModalAcesso() {
  let m = document.getElementById("modal-acesso");
  if (!m) {
    m = document.createElement("div");
    m.id = "modal-acesso";
    m.className = "modal-backdrop";
    document.body.appendChild(m);
    // Fecha só pelo ✕ (clicar fora não fecha mais, para não perder o que foi digitado)
  }
  m.style.display = "flex";
  if (acesso.editor) return telaLogado(m);
  if (acesso.logado) return telaVisualizador(m);
  telaEntrar(m);
}

// Uma tela para entrar e outra para criar/trocar a senha (primeiro acesso ou esqueci)
function telaEntrar(m, modo = "entrar") {
  const criar = modo === "criar";
  m.innerHTML = `<div class="modal" style="max-width:400px;">
    <div class="modal-header"><h3 style="margin:0;">${criar ? "Criar ou trocar minha senha" : "Entrar para editar"}</h3><button class="modal-close" data-fechar>✕</button></div>
    <p class="small text-muted" style="margin-top:0;">${
      criar
        ? "Para o primeiro acesso ou se esqueceu a senha. Confirme seus dados e escolha a senha nova."
        : "Acesso dos editores autorizados da CIPA."
    }</p>
    <div class="field"><label>CPF</label><input type="text" id="ac-cpf" inputmode="numeric" placeholder="000.000.000-00" autocomplete="username" /></div>
    ${criar ? '<div class="field mt-16"><label>Data de nascimento</label><input type="date" id="ac-nasc" /></div>' : ""}
    <div class="field mt-16"><label>${criar ? "Nova senha (mínimo 6 caracteres)" : "Senha"}</label><input type="password" id="ac-senha" autocomplete="${criar ? "new-password" : "current-password"}" /></div>
    ${criar ? '<div class="field mt-16"><label>Repita a nova senha</label><input type="password" id="ac-senha2" autocomplete="new-password" /></div>' : ""}
    <div class="row mt-16"><button class="btn btn-primary" id="ac-ok">${criar ? "Salvar senha e entrar" : "Entrar"}</button></div>
    <p class="small mt-16"><a href="#" id="ac-trocar" style="color:var(--brand-red);font-weight:600;">${criar ? "← Voltar para entrar" : "Primeiro acesso ou esqueci minha senha"}</a></p>
    <div id="ac-erro" class="small" style="color:var(--danger);"></div>
  </div>`;
  m.querySelector("[data-fechar]").onclick = () => (m.style.display = "none");
  m.querySelector("#ac-trocar").onclick = (e) => {
    e.preventDefault();
    telaEntrar(m, criar ? "entrar" : "criar");
  };
  const cpf = m.querySelector("#ac-cpf");
  cpf.addEventListener("input", () => {
    const d = cpfDigitos(cpf.value).slice(0, 11);
    cpf.value = d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  });
  m.querySelectorAll("input").forEach((i) => i.addEventListener("keydown", (e) => e.key === "Enter" && m.querySelector("#ac-ok").click()));
  cpf.focus();
  m.querySelector("#ac-ok").onclick = async () => {
    const erro = m.querySelector("#ac-erro");
    const btn = m.querySelector("#ac-ok");
    erro.textContent = "";
    const d = cpfDigitos(cpf.value);
    const senha = m.querySelector("#ac-senha").value;
    if (d.length !== 11) return (erro.textContent = "Informe o CPF completo.");
    if (!senha) return (erro.textContent = "Informe a senha.");
    btn.disabled = true;
    try {
      if (criar) {
        const nascimento = m.querySelector("#ac-nasc").value;
        if (!nascimento) throw new Error("Informe a data de nascimento.");
        if (senha.length < 6) throw new Error("A senha precisa ter pelo menos 6 caracteres.");
        if (senha !== m.querySelector("#ac-senha2").value) throw new Error("As senhas não conferem.");
        const { data, error } = await supabaseClient.functions.invoke("cipa-acesso", { body: { acao: "esqueci", cpf: d, nascimento, senha } });
        if (error) {
          let msg = error.message;
          try {
            msg = (await error.context.json()).erro || msg;
          } catch (e) {}
          throw new Error(msg);
        }
        if (data && data.erro) throw new Error(data.erro);
      }
      const { error } = await supabaseClient.auth.signInWithPassword({ email: `${d}@${DOMINIO_ACESSO}`, password: senha });
      if (error) throw new Error(criar ? "Senha salva, mas não foi possível entrar. Tente entrar de novo." : "CPF ou senha incorretos.");
      if (!criar) return location.reload();
      m.innerHTML = `<div class="modal" style="max-width:400px;text-align:center;">
        <h3 style="margin-top:0;">✅ Senha salva!</h3>
        <p>Você já está conectado como editor. Use esta senha nos próximos acessos.</p>
        <div class="row mt-16" style="justify-content:center;"><button class="btn btn-primary" id="ac-continuar">Continuar</button></div>
      </div>`;
      m.querySelector("#ac-continuar").onclick = () => location.reload();
    } catch (e) {
      erro.textContent = e.message;
      btn.disabled = false;
    }
  };
}

function telaVisualizador(m) {
  m.innerHTML = `<div class="modal" style="max-width:420px;">
    <div class="modal-header"><h3 style="margin:0;">👁️ ${escHtml(acesso.nomeVisual || "Visualização")}</h3><button class="modal-close" data-fechar>✕</button></div>
    <p class="small text-muted" style="margin-top:0;">Você está consultando o app no modo <b>somente visualização</b>.</p>
    <div class="row mt-16">
      <button class="btn btn-primary" id="ac-lider">🔒 Entrar como editor</button>
      <button class="btn btn-secondary" id="ac-sair">Sair</button>
    </div>
  </div>`;
  m.querySelector("[data-fechar]").onclick = () => (m.style.display = "none");
  m.querySelector("#ac-lider").onclick = () => telaEntrar(m);
  m.querySelector("#ac-sair").onclick = async () => {
    await supabaseClient.auth.signOut();
    location.reload();
  };
}

// Tela de entrada: aparece antes de qualquer conteúdo para quem ainda não entrou
function mostrarPortaria() {
  const p = document.createElement("div");
  p.id = "portaria";
  p.innerHTML = `<div class="portaria-caixa">
    <img src="${typeof LOGO_PRETA_URL !== "undefined" ? LOGO_PRETA_URL : ""}" alt="Boxer Soldas" class="portaria-logo" />
    <div class="portaria-tag">CIPA</div>
    <h2>Entrar no app</h2>
    <p class="small text-muted">Membro da CIPA: entre com o seu CPF e a sua data de nascimento.</p>
    <div class="field"><label>CPF</label><input type="text" id="pt-cpf" inputmode="numeric" placeholder="000.000.000-00" autocomplete="username" /></div>
    <div class="field mt-16"><label>Data de nascimento</label><input type="date" id="pt-nasc" /></div>
    <button class="btn btn-primary mt-16" id="pt-ok" style="width:100%;justify-content:center;">Entrar</button>
    <div id="pt-erro" class="small" style="color:var(--danger);margin-top:10px;"></div>
    <div class="portaria-lider"><a href="#" id="pt-lider">🔒 Sou editor: entrar com senha para editar</a></div>
  </div>`;
  document.body.appendChild(p);
  document.documentElement.classList.remove("verificando-acesso");
  document.documentElement.classList.add("na-portaria");
  const cpf = p.querySelector("#pt-cpf");
  cpf.addEventListener("input", () => {
    const d = cpfDigitos(cpf.value).slice(0, 11);
    cpf.value = d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  });
  p.querySelectorAll("input").forEach((i) => i.addEventListener("keydown", (e) => e.key === "Enter" && p.querySelector("#pt-ok").click()));
  p.querySelector("#pt-lider").onclick = (e) => {
    e.preventDefault();
    abrirModalAcesso();
  };
  p.querySelector("#pt-ok").onclick = async () => {
    const erro = p.querySelector("#pt-erro");
    const btn = p.querySelector("#pt-ok");
    erro.textContent = "";
    const d = cpfDigitos(cpf.value);
    const nascimento = p.querySelector("#pt-nasc").value;
    if (d.length !== 11) return (erro.textContent = "Informe o CPF completo.");
    if (!nascimento) return (erro.textContent = "Informe a data de nascimento.");
    btn.disabled = true;
    btn.textContent = "Entrando...";
    try {
      const { data, error } = await supabaseClient.functions.invoke("cipa-acesso", { body: { acao: "entrar_membro", cpf: d, nascimento } });
      if (error) {
        let msg = error.message;
        try {
          msg = (await error.context.json()).erro || msg;
        } catch (e) {}
        throw new Error(msg);
      }
      if (!data || data.erro) throw new Error((data && data.erro) || "Não foi possível entrar.");
      const r = await supabaseClient.auth.signInWithPassword({ email: data.email, password: data.senha });
      if (r.error) throw new Error("Não foi possível entrar. Tente de novo.");
      location.reload();
    } catch (e) {
      erro.textContent = e.message;
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  };
  cpf.focus();
}

async function telaLogado(m) {
  m.innerHTML = `<div class="modal" style="max-width:520px;">
    <div class="modal-header"><h3 style="margin:0;">👤 ${escHtml(acesso.nome)}</h3><button class="modal-close" data-fechar>✕</button></div>
    <p class="small text-muted" style="margin-top:0;">Você está com acesso de <b>edição</b>${acesso.admin ? " e é <b>administrador(a)</b> dos acessos" : ""}.</p>
    <div id="ac-admin"></div>
    <div class="row mt-16"><button class="btn btn-secondary" id="ac-sair">Sair</button></div>
  </div>`;
  m.querySelector("[data-fechar]").onclick = () => (m.style.display = "none");
  m.querySelector("#ac-sair").onclick = async () => {
    await supabaseClient.auth.signOut();
    location.reload();
  };
  if (!acesso.admin) return;
  const box = m.querySelector("#ac-admin");
  box.innerHTML = '<p class="small">Carregando acessos...</p>';
  const { data, error } = await supabaseClient.functions.invoke("cipa-acesso", { body: { acao: "listar" } });
  if (error || !data || data.erro) return (box.innerHTML = '<p class="small" style="color:var(--danger)">Não foi possível carregar os acessos.</p>');
  const { data: mem } = await supabaseClient.from("cipa_membros").select("id,nome,ativo").eq("ativo", true).order("nome");
  const jaEditor = new Set(data.editores.map((e) => e.membro_id));
  const candidatos = (mem || []).filter((x) => !jaEditor.has(x.id));
  box.innerHTML = `<h4 style="margin:6px 0 8px;">Quem pode editar</h4>${data.editores
    .map(
      (e) => `<div class="acesso-linha"><div><b>${escHtml(e.nome)}</b><div class="small text-muted">${escHtml(e.funcao || "")}${e.admin ? " · administrador(a)" : ""}${e.ativo ? "" : " · desativado"}</div></div>
        <div class="row" style="gap:6px;">
          <span class="badge ${e.cadastrado ? "badge-ok" : "badge-warn"}">${e.cadastrado ? "Senha criada" : "Aguardando 1º acesso"}</span>
          ${e.cadastrado ? `<button class="btn-mini btn-redefinir" data-id="${e.membro_id}" title="A pessoa cria nova senha no primeiro acesso">Redefinir senha</button>` : ""}
          <button class="btn-mini btn-alternar-editor" data-id="${e.membro_id}" data-ativo="${e.ativo ? 1 : 0}">${e.ativo ? "Retirar" : "Reativar"}</button>
        </div></div>`
    )
    .join("")}
    <h4 style="margin:16px 0 8px;">Incluir novo editor</h4>
    <div class="row"><select id="ac-novo-editor" style="flex:1;min-width:200px;"><option value="">Escolha um membro da CIPA...</option>${candidatos.map((c) => `<option value="${c.id}">${escHtml(c.nome)}</option>`).join("")}</select>
    <button class="btn btn-primary" id="ac-add-editor">Incluir</button></div>
    <p class="small text-muted">O membro precisa ter CPF e data de nascimento cadastrados (aba Membros). Depois ele cria a própria senha em "Primeiro acesso ou esqueci minha senha".</p>`;
  box.querySelectorAll(".btn-redefinir").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Redefinir o acesso? A pessoa precisará criar uma nova senha em 'Primeiro acesso'.")) return;
      const { data: r } = await supabaseClient.functions.invoke("cipa-acesso", { body: { acao: "redefinir", membro_id: b.dataset.id } });
      if (r && r.ok) {
        showToast("Acesso redefinido.", "success");
        telaLogado(m);
      } else showToast("Não foi possível redefinir.", "error");
    })
  );
  box.querySelectorAll(".btn-alternar-editor").forEach((b) =>
    b.addEventListener("click", async () => {
      const ativar = b.dataset.ativo !== "1";
      if (!ativar && !confirm("Retirar a permissão de edição desta pessoa?")) return;
      const { data: r } = await supabaseClient.functions.invoke("cipa-acesso", { body: { acao: "definir_editor", membro_id: b.dataset.id, editor: ativar } });
      if (r && r.ok) {
        showToast(ativar ? "Editor reativado." : "Editor retirado.", "success");
        telaLogado(m);
      } else showToast((r && r.erro) || "Não foi possível alterar.", "error");
    })
  );
  const add = box.querySelector("#ac-add-editor");
  if (add)
    add.addEventListener("click", async () => {
      const id = box.querySelector("#ac-novo-editor").value;
      if (!id) return showToast("Escolha um membro.", "error");
      const { data: r } = await supabaseClient.functions.invoke("cipa-acesso", { body: { acao: "definir_editor", membro_id: id, editor: true, admin: false } });
      if (r && r.ok) {
        showToast("Editor incluído.", "success");
        telaLogado(m);
      } else showToast((r && r.erro) || "Não foi possível incluir.", "error");
    });
};

// Inicialização: roda antes do conteúdo das páginas ser montado
const acessoPronto = (async () => {
  try {
    await verificarAcesso();
  } catch (e) {
    console.error(e);
  }
})();

document.addEventListener("DOMContentLoaded", async () => {
  await acessoPronto;
  // Login antes de tudo: quem não entrou vê só a tela de entrada
  if (CONFIGURADO && !acesso.logado) return mostrarPortaria();
  document.documentElement.classList.remove("verificando-acesso");
  // espera as telas montarem (os scripts de cada página rodam depois deste)
  await new Promise((r) => setTimeout(r, 0));
  document.body.classList.toggle("leitura", !acesso.editor);
  montarBotaoAcesso();
  aplicarLeitura();
  // Se a aba aberta por padrão é de edição (ex.: "Nova reunião"), abre a primeira aba de consulta
  if (!acesso.editor && document.querySelector(".tab-btn.active.oculto-leitura")) {
    const livre = [...document.querySelectorAll(".tab-btn")].find((b) => !b.classList.contains("oculto-leitura"));
    if (livre) livre.click();
  }
  if (!acesso.editor) {
    new MutationObserver((muts) => muts.forEach((mu) => mu.addedNodes.forEach((n) => n.nodeType === 1 && aplicarLeitura(n.parentNode || document)))).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
});

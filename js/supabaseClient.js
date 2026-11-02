// =========================================================================
// CIPA BOXER - Conexão com o Supabase + funções comuns a todas as telas
// =========================================================================

const SUPABASE_URL = "https://yybkkmjplzxxwsepkuuf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5YmtrbWpwbHp4eHdzZXBrdXVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MDQ5NTcsImV4cCI6MjEwODA4MDk1N30.wrUuy0z9Wkz5V_6GjvYKWQ2uE3gHPdln8Pp5Rx4vqig";

const CONFIGURADO = !SUPABASE_URL.startsWith("COLE_AQUI") && !SUPABASE_ANON_KEY.startsWith("COLE_AQUI");

let supabaseClient = null;
if (CONFIGURADO) {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Buckets de Storage (públicos)
const BUCKET_FOTOS = "fotos";
const BUCKET_DOCUMENTOS = "documentos";
// Bucket privado (certificados têm CPF): só editores conectados abrem, por link temporário
const BUCKET_PRIVADO = "certificados";

// Identidade visual Boxer (logo copiado do site boxersoldas.com.br)
const LOGO_PRETA_URL = SUPABASE_URL + "/storage/v1/object/public/fotos/marca/logo-boxer-preta.png";
const LOGO_BRANCA_URL = SUPABASE_URL + "/storage/v1/object/public/fotos/marca/logo-boxer-branca.png";
const COR_MARCA = [214, 8, 8]; // vermelho Boxer
const COR_ESCURA = [39, 38, 38]; // grafite do site

function mostrarAvisoConfiguracao() {
  if (CONFIGURADO) return;
  const el = document.getElementById("config-warning");
  if (el) {
    el.style.display = "block";
    el.innerHTML =
      "⚠️ O Supabase ainda não foi configurado. Edite o arquivo <code>js/supabaseClient.js</code> " +
      "e cole a Project URL e a chave anon do seu projeto Supabase.";
  }
}

function showToast(message, type = "") {
  // Na tela de entrada (antes do login) não mostra avisos das telas por trás
  const cl = document.documentElement.classList;
  if (cl.contains("na-portaria") || (cl.contains("verificando-acesso") && type === "error")) return;
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "toast" + (type ? " " + type : "");
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

async function uploadArquivo(bucket, file, pastaPrefixo = "") {
  if (!CONFIGURADO) throw new Error("Supabase não configurado.");
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const nomeArquivo = `${pastaPrefixo}${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseClient.storage.from(bucket).upload(nomeArquivo, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  const { data } = supabaseClient.storage.from(bucket).getPublicUrl(nomeArquivo);
  return data.publicUrl;
}

// Envia para o bucket privado e devolve a referência "privado:<bucket>/<caminho>"
async function uploadPrivado(file, pastaPrefixo = "") {
  if (!CONFIGURADO) throw new Error("Supabase não configurado.");
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const caminho = `${pastaPrefixo}${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseClient.storage.from(BUCKET_PRIVADO).upload(caminho, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return `privado:${BUCKET_PRIVADO}/${caminho}`;
}
const ehPrivado = (url) => String(url || "").startsWith("privado:");

// Abre um arquivo; os privados exigem login de líder e geram um link válido por 5 minutos
async function abrirArquivo(url) {
  if (!ehPrivado(url)) return window.open(url, "_blank");
  const janela = window.open("", "_blank");
  const ref = url.slice("privado:".length);
  const bucket = ref.split("/")[0];
  const caminho = ref.slice(bucket.length + 1);
  const { data, error } = await supabaseClient.storage.from(bucket).createSignedUrl(caminho, 300);
  if (error || !data) {
    if (janela) janela.close();
    return showToast("Este arquivo tem dados pessoais. Entre como editor (🔒 Entrar) para abrir.", "error");
  }
  if (janela) janela.location = data.signedUrl;
  else window.location = data.signedUrl;
}
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[data-arquivo]");
  if (!a) return;
  e.preventDefault();
  abrirArquivo(a.dataset.arquivo);
});

// ---------------- Utilitários comuns ----------------

// "José da Silva " -> "JOSE DA SILVA" (sem acentos, espaços extras ou caixa)
function normalizarNome(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function escHtml(str) {
  if (str == null) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatarDataBR(dateStr) {
  if (!dateStr) return "-";
  const [y, m, d] = String(dateStr).slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function hojeISOLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diasAte(dataISO) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const alvo = new Date(dataISO + "T00:00:00");
  return Math.round((alvo - hoje) / 86400000);
}

// ---------------- PDF com o logo da Boxer ----------------
let _logoPdfCache = null;
async function obterLogoPdf() {
  if (_logoPdfCache) return _logoPdfCache;
  try {
    const blob = await fetch(LOGO_PRETA_URL).then((r) => {
      if (!r.ok) throw new Error("logo");
      return r.blob();
    });
    const dataUrl = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
    const dims = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => res({ w: 250, h: 68 });
      im.src = dataUrl;
    });
    _logoPdfCache = { dataUrl, ...dims };
  } catch (e) {
    _logoPdfCache = null;
  }
  return _logoPdfCache;
}

// Desenha o cabeçalho padrão (logo + título + linha vermelha) e devolve o Y livre
async function cabecalhoPdf(doc, titulo, linhas = []) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 14;
  let y = 12;
  const logo = await obterLogoPdf();
  if (logo) {
    const h = 12;
    const w = (logo.w / logo.h) * h;
    doc.addImage(logo.dataUrl, "PNG", marginX, y, w, h);
  }
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.setFont("helvetica", "normal");
  doc.text("CIPA · Comissão Interna de Prevenção de Acidentes", pageWidth - marginX, y + 4, { align: "right" });
  doc.text("Emitido em " + new Date().toLocaleDateString("pt-BR"), pageWidth - marginX, y + 9, { align: "right" });
  y += 16;
  doc.setDrawColor(...COR_MARCA);
  doc.setLineWidth(0.8);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 9;

  doc.setTextColor(...COR_ESCURA);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(titulo, pageWidth / 2, y, { align: "center" });
  y += 7;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(40, 40, 40);
  linhas.forEach((l) => {
    doc.text(l, pageWidth / 2, y, { align: "center" });
    y += 5.5;
  });
  return y + 4;
}

// Rodapé com numeração em todas as páginas
function rodapePdf(doc) {
  const n = doc.internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    doc.text("Boxer Soldas · CIPA", 14, pageHeight - 8);
    doc.text(`Página ${i} de ${n}`, pageWidth - 14, pageHeight - 8, { align: "right" });
  }
}

const CORES_TABELA_PDF = { fillColor: COR_ESCURA, textColor: [255, 255, 255] };

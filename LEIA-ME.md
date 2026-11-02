# CIPA BOXER

Sistema de gestão da CIPA, no mesmo molde do app da Brigada (visual Boxer, acesso por CPF, dados no Supabase).

## O que tem
- Membros e Mandato: quadro da CIPA, lista, gestões (mandatos), estabilidade, CPF/nascimento para o acesso.
- Calendário de Reuniões: reuniões mensais (regra configurável, ex.: 3ª quarta), DQS quinzenais, eventos e campanhas.
- Reunião e ATA: pauta, deliberações, ações, presença, PDF, ATA assinada anexada.
- Plano de Ação: ações com tema, prioridade, prazo, origem (reunião, inspeção, acidente).
- Inspeções de Segurança: checklist (EPI, ergonomia, ambiente, máquinas, emergência), achados que viram ações, cobertura por setor.
- Eleição da CIPA: cronograma do processo eleitoral a partir do fim do mandato (prazos da NR-5, confirmar com o SESMT).
- SIPAT: edições anuais com programação de atividades.
- Acidentes e Incidentes: só editores veem (dados sensíveis), investigação, CAT, ações.
- Dashboard: indicadores e alertas.

## Banco de dados (já criado)
Projeto Supabase "brigada-boxer", tabelas com prefixo `cipa_` (separadas das da Brigada), função de acesso `cipa-acesso`.
Nada precisa ser executado: já está aplicado.

## Publicar o site (igual ao da Brigada)
1. Crie um repositório novo no GitHub chamado `cipa-boxer`.
2. Add file → Upload files → arraste TODO o conteúdo desta pasta (index.html, demais .html, pastas css, js, assets).
3. Settings → Pages → Branch main → Save. Em 1 a 2 minutos o site abre em `https://<usuario>.github.io/cipa-boxer/`.

## Primeiro acesso
1. Elizângela já está cadastrada como administradora. No site: nome no topo → Entrar como editor → "Primeiro acesso ou esqueci minha senha" → CPF, data de nascimento e a senha nova.
2. Em Membros → Gestões, cadastre a "Gestão 2026/2027" (início, fim, regra da reunião mensal) e marque como atual.
3. Em Membros → Novo membro, cadastre os cipeiros e, em cada um, o CPF e a data de nascimento (é com isso que entram para visualizar).
4. Para dar permissão de edição (presidente, secretário): clique no seu nome → "Incluir novo editor".

## Cuidados
- Ações, ATAs e registros excluídos não voltam.
- Acidentes: só editores leem. Anexos de CAT ficam em bucket privado.

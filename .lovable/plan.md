# Reestruturação do Clipfy — Projeto → Cortes → Editor

## Problemas hoje

1. **Legendas em 3 lugares** — Preferências (pré-processo), Editor do clipe (templates), e ainda estilos por clipe. Confuso.
2. **Preview sem legenda** — os cards de clipe mostram só o vídeo cru, sem karaokê nem estilo escolhido.
3. **Sem score de viral** — a IA já retorna score, mas não aparece no card.
4. **Página separada para editar** — abre uma tela nova só pra ajustar trim; deveria ser inline/drawer.
5. **Drafts perdidos** — projetos em rascunho não têm entrada clara.

## Nova estrutura (3 telas apenas)

### 1. `/app/projects` — Galeria
- Cards de projeto com thumbnail + status (Rascunho / Processando / Pronto).
- Rascunhos ficam no topo com badge amarelo "Continuar".
- Botão fixo "+ Novo projeto".

### 2. `/app/projects/$id` — Workspace unificado
Uma única tela com 3 estados progressivos, sem trocar de rota:

**Estado A — Fonte (só se ainda não ingeriu)**
- Tabs: Upload / YouTube.
- Após ingestão → transita direto para Estado B (sem clicar em "próximo").

**Estado B — Estilo global (uma vez só, colapsável depois)**
- Painel de topo com: aspect ratio (9:16 / 1:1 / 16:9), template de legenda (7 estilos), layout (Full / Split / PiP).
- Preview 9:16 ao vivo mostra amostra com o estilo aplicado.
- Botão "Gerar cortes" processa e vai para Estado C.
- Depois de gerado, esse painel vira uma barra compacta no topo ("Hormozi Slam • 9:16 • Full — Editar estilo") que expande em drawer.

**Estado C — Grid de cortes**
- Cards 9:16 com:
  - Player que dá **autoplay muted no hover** já com a legenda karaokê renderizada no estilo global.
  - Badge de **score viral** (0–100) no canto, colorido (verde >75, amarelo 50–75, cinza <50).
  - Título sugerido pela IA + duração.
  - Ações: Editar (abre drawer), Exportar MP4, Baixar quando pronto.
- Ordenado por score desc.

### 3. Drawer de edição fina (em vez de página nova)
Abre por cima do grid, não navega:
- Trim visual (slider dual + timestamps).
- Título editável.
- Texto da legenda editável linha a linha (raro; só se a transcrição errou).
- Override de template só desse clipe (opcional, escondido em "Avançado").
- Salvar / Cancelar.

Rota atual `/app/projects/$id/clips/$clipId` deixa de existir. Fica tudo em `/app/projects/$id`.

## Onde ficam as legendas (fim da confusão)

- **Template global do projeto** → definido no painel de estilo (Estado B). Aplica a todos os cortes automaticamente.
- **Override por clipe** → só dentro do drawer, aba "Avançado", raramente usado.
- **Preferências separadas** → REMOVIDO. A tela `PreferencesStage` some.

## Preview com legenda de verdade

Componente `<ClipPreview />` reutilizável:
- Renderiza `<video>` (Storage) ou embed YouTube com `startAt/endAt`.
- Overlay CSS com a palavra ativa destacada, dirigido pelo `transcript.words[]` já salvo.
- Usa o `caption_template` do projeto (fallback pro do clipe se houver override).
- Mesmo componente usado no card do grid, no drawer, e no botão "Preview" antes de exportar.

## Score de viral

- Já existe `clips.viral_score` no banco (a IA retorna).
- Adicionar badge no card + ordenação por score no grid.
- Se estiver null (projetos antigos), mostra "—".

## Detalhes técnicos

- `src/routes/app.projects.$id.tsx` vira o único ponto: máquina de estado A→B→C baseada em `project.status` + existência de clips.
- `src/routes/app.projects.$id.clips.$clipId.tsx` → deletar.
- `src/components/clip-card.tsx` novo com hover-autoplay e overlay de legenda.
- `src/components/edit-clip-drawer.tsx` novo (shadcn Sheet).
- `src/components/style-panel.tsx` novo (expandável/colapsável).
- `PreferencesStage` → apagar.
- Migração leve: garantir que `projects.preferences` tem `{aspect, template, layout}` default.
- Query invalidation: mutação de estilo global invalida a lista de clips (rerender dos previews).

## O que NÃO muda

- Backend/render worker: continua igual, só recebe o EDL como hoje.
- Autenticação, créditos, YouTube ingest, transcrição: intocados.
- Paleta dark premium: mantida.

## Ordem de entrega

1. Componente `<ClipPreview />` com legenda karaokê.
2. `<ClipCard />` + badge de score.
3. Grid novo em `/app/projects/$id` (Estado C).
4. Painel de estilo global colapsável (Estado B).
5. Drawer de edição fina.
6. Apagar rota `clips/$clipId` e `PreferencesStage`.
7. Redirecionar links antigos.

Posso começar pelo passo 1 (preview com legenda) — é o que destrava visualmente o resto. Confirma que a estrutura acima está certa e sigo?
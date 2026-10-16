# Gestão ClickUp — Painel de Liderança

Painel de gestão dos três contratos (Uberlândia, ALMG, Campina Grande) baseado no fluxo descrito em `geral.md`: pipeline por contrato, pacotes semanais, tetos de carga, cobrança com histórico, janelas de homologação/produção e produtividade medida por transições de status.

## Telas

| Rota | O que mostra |
|---|---|
| `/` | Rotina do dia (homolog/prod/validação/retro), alertas (soltos, hotfix, pedidos parados, atrasados) e pipeline por contrato |
| `/fila` | Kanban por contrato × status (`pedido → solto → a fazer → fazendo → revisão → correção → homologação → executado`) |
| `/pacote` | Task `PACOTE …` por contrato, cards com tag `pacote`, checklist de prontidão (peso, revisor, responsável, status) e formulário de **fechamento do ciclo** |
| `/time` | Carga da semana por pessoa vs tetos do geral.md (cards, pontos, peso máximo; aprendiz ≤ 2) |
| `/cobranca` | Snapshot diário (6h) de tasks vencidas/vencendo, por responsável, com notas por dia e DM via bot Discord |
| `/deploy` | Janelas do dia + cards do pacote, com botão para mover `revisão → homologação` / `homologação → executado` |
| `/produtividade` | Chegada em `revisão` vs data de homologação, por pessoa e por peso |

## Convenções reconhecidas (geral.md + prática real)

- **Peso**: tag `1 muito fácil` … `4 difícil`, ou `[n]` no título
- **Pacote**: tag `pacote`/`no-pacote` nos cards; task `PACOTE · …` com status `homologação`
- **Revisor**: linha `Revisor: nome` na descrição
- **Ordem**: prefixo `NN ·` no título

## Rodando local

```bash
cp .env.example .env   # preencher
npm install
npm run dev            # http://localhost:3000
npm run sync           # sync manual
```

## Deploy (Easypanel)

- Build via Dockerfile (multi-stage, compila better-sqlite3 em ARM64)
- Volume persistente em `/app/data` (SQLite `app.db`)
- `PORT=80` se o domínio aponta para a porta 80 do container
- Poll a cada 15 min (`POLL_SCHEDULE`), snapshot diário 6h (`CRON_SCHEDULE`), tudo em `America/Sao_Paulo`

## Notas

- O plano Free do ClickUp não expõe histórico de status — o app registra transições próprias em `status_events` a cada poll.
- Tokens no `.env` nunca vão para o git (`.env.example` tem só placeholders).

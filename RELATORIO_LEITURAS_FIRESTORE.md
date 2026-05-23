# Auditoria rápida de leituras Firestore — GuildaHub

## Principais pontos encontrados

1. `logic.js` — `checkAuth()` fazia várias leituras em toda troca de tela protegida:
   - `/users/{uid}`
   - buscas em `/configGuilda`
   - `/configGuilda/{guildId}` mais de uma vez
   - `/guildas/{guildId}` mais de uma vez
   - `/chefe/security`

   Isso podia chegar a 6–9 leituras por tela aberta, mesmo quando o usuário já estava logado e o contexto da guilda já estava salvo.

2. `findGuildByEmail()` em `logic.js`, `dashboard.js` e `recc.js` possui fallback com `limit(300)` em `/configGuilda`.
   - Isso só acontece quando `/users/{uid}` não tem `guildId`.
   - Se uma conta antiga cair nesse fallback, pode gastar até 300 leituras de uma vez.
   - Correção estrutural recomendada: garantir que todo usuário tenha `users/{uid}.guildId` e `role`.

3. `rec.js` — página pública de recrutamento lia a coleção inteira `rec` em todo acesso público.
   - Agora recebeu cache local de 15 minutos.

4. `suportechefe.js` — painel chefe escutava todos os chamados e todas as mensagens do chamado selecionado.
   - Agora limita aos 100 chamados mais recentes e às 80 mensagens mais recentes do chamado aberto.

5. `dashboard.js` — havia dois listeners de VIP em tempo real:
   - `/configGuilda/{guildId}`
   - `/guildas/{guildId}`
   Como o webhook grava também em `/configGuilda`, foi mantido só o listener de `/configGuilda`.

## Arquivos alterados

- `logic.js`
- `dashboard.js`
- `rec.js`
- `recc.js`
- `suportechefe.js`

## O que foi otimizado

### `logic.js`

Adicionado caminho rápido no `checkAuth()` usando `guildCtx_cache_v1` com TTL de 2 horas.

Quando o cache está válido e pertence ao usuário logado, o site evita reler Firebase apenas para montar o contexto da guilda. Isso reduz drasticamente as leituras ao trocar entre Dashboard, Membros, Lines, Ajustes, Upgrade, etc.

### `dashboard.js`

Removido o segundo listener em tempo real de `/guildas/{guildId}` para VIP. O dashboard continua acompanhando `/configGuilda/{guildId}`.

### `rec.js`

Adicionado cache local para a vitrine pública de recrutamento por 15 minutos. Visitantes repetidos ou recarregamentos não vão ler toda a coleção `rec` sempre.

### `recc.js`

Adicionado caminho rápido de cache no painel de gerenciamento de recrutamento, evitando reler `/users`, `/configGuilda` e `/guildas` quando o contexto da guilda está fresco.

### `suportechefe.js`

Limitados listeners do suporte:

- chamados: últimos 100
- mensagens do chamado aberto: últimas 80

## Próximos ajustes recomendados

1. Rodar uma migração para preencher `guildId` e `role` em todos os documentos da coleção `/users`.
   Isso elimina o fallback caro de `limit(300)`.

2. Criar uma coleção índice, por exemplo:
   - `/emailGuildIndex/{emailNormalizado}` → `{ guildId, role }`

   Aí a busca de admin/líder por e-mail vira 1 leitura direta, sem varrer `configGuilda`.

3. Na tela `chefe.html`, evitar carregar todas as guildas/configs em intervalo curto para todos os CEOs. Ela já tem cache de 30 minutos, mas ainda é uma tela naturalmente cara.

4. Evitar `onSnapshot` onde não precisa ser tempo real. Para telas administrativas pouco usadas, `getDoc` + botão atualizar costuma custar menos.

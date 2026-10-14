# Arquitetura — Açaí Everest

## Visão geral

```
Computador (navegador) ──► React + TypeScript (Vite) ──► Supabase
                        │     React Query (cache)            ├─ Auth (e-mail/senha)
                        │     React Hook Form + Zod          ├─ PostgREST (tabelas/views com RLS)
                        │                                    ├─ Funções RPC transacionais (estoque)
                        │                                    └─ Storage (logo da loja)
```

- O navegador usa **apenas a chave anon** + o token (JWT) do usuário logado.
- **Leituras**: tabelas e views (`v_stock_position`, `v_lots`, `v_movements`) protegidas por **RLS**; as views usam `security_invoker`, então respeitam o RLS de quem consulta.
- **Escritas de estoque, compras, vendas e inventário**: somente por funções `security definer` que (1) conferem o perfil na loja, (2) validam os dados, (3) executam tudo numa única transação. O cliente não tem permissão de `INSERT/UPDATE` nessas tabelas.
- **Cadastros** (produtos, categorias, unidades, fornecedores, fichas): escrita direta pelo PostgREST, permitida pelo RLS apenas para administradores; gatilhos validam que as referências pertencem à mesma loja e registram auditoria.

## Multi-loja

Toda tabela de negócio tem `store_id`. `store_members(store_id, user_id, role, active)` define quem acessa o quê. As funções `is_store_member()` / `is_store_admin()` são usadas por todas as políticas. Para abrir uma 2ª unidade, um administrador chama `create_store` (o app já tem seletor de loja na barra lateral quando há mais de uma).

## Modelo de estoque

| Item | Modelo | Como baixa |
|---|---|---|
| Ingredientes, embalagens, consumo, revenda | `stock_mode = 'stock'` | Movimentações próprias |
| Produto acabado comprado/produzido pronto | `stock_mode = 'stock'` | Movimentações próprias |
| Produto acabado montado na hora (ex.: copo de açaí) | `stock_mode = 'recipe'` | **Não tem saldo**; cada venda baixa os ingredientes da ficha técnica |

Assim nunca há baixa dupla (produto + ingredientes) da mesma saída física. Um produto por ficha não pode receber entradas nem ser ingrediente de outra ficha.

### Como o saldo é calculado

```
saldo(produto) = Σ quantidade (entradas) − Σ quantidade (saídas)      ← em stock_movements
```

`stock_balances` guarda esse resultado como cache, atualizado na **mesma transação** que grava a movimentação (função `_apply_movement`). Conferência: `check_stock_integrity(loja)` compara cache × soma real; `rebuild_stock_balances(loja)` reprocessa todas as movimentações (saldo, custo médio e lotes). Ambos estão em **Configurações → Dados e auditoria**.

### Custo

Custo médio ponderado móvel. Entradas entram pelo custo informado (compras: com rateio proporcional de frete e desconto). Saídas saem pelo custo médio do momento, que fica gravado na movimentação. Logo:

- Valor do estoque = Σ(entradas × custo) − Σ(saídas × custo gravado) — usado também na “evolução do valor do estoque”.
- CMV de uma venda = soma do custo das saídas que ela gerou.
- Se um item não tem custo (> 0), a venda é marcada `cost_complete = false` e a **margem não é exibida** (evita margem falsa).

### Lotes e validade (FEFO)

Itens com “Controlar lotes/validade” criam um registro em `stock_lots` em cada entrada. Saídas são alocadas por lote (`stock_movement_lots`) na ordem **FEFO** (vence primeiro, sai primeiro) — ou no lote escolhido. **Vendas não consomem lotes vencidos**: o sistema bloqueia e orienta registrar a baixa como “Produto vencido”.

## Regras de consistência

- Quantidade > 0; unidades inteiras (un, pct, cx) não aceitam fração.
- Saída que deixaria saldo negativo é **bloqueada**. Exceção apenas se o administrador ligar “Permitir estoque negativo”; cada ocorrência é marcada na movimentação e registrada em `audit_logs`.
- Movimentações são **imutáveis** (gatilho bloqueia UPDATE/DELETE, inclusive para o superusuário).
- Compra em rascunho não mexe no estoque; o recebimento acontece uma única vez.
- Datas futuras são rejeitadas.

## Concorrência

Toda operação trava as linhas de `stock_balances` envolvidas com `SELECT … FOR UPDATE`, **sempre em ordem de `product_id`** (evita deadlock). Duas vendas simultâneas do último item: a segunda espera a primeira terminar, relê o saldo e recebe “Estoque insuficiente”. Compras/vendas/inventários travam também a própria linha do documento (impede recebimento ou cancelamento duplo). Testado em `supabase/tests/02_concurrency.sh`.

## Idempotência (clique duplo / rede instável)

Cada formulário gera um `request_id` (UUID) ao abrir. As funções guardam o resultado em `operation_requests(store_id, request_id)` sob um *advisory lock*. Reenvios com o mesmo id devolvem o mesmo resultado **sem** nova movimentação. Os botões também ficam desabilitados durante o envio.

## Estornos

- **Movimentação avulsa** (`reverse_movement`, admin): cria a movimentação oposta, mesma quantidade e mesmo custo, ligada à original (`reverses_movement_id` ↔ `reversed_by_movement_id`). Não estorna estorno nem estorna duas vezes. Estorno de entrada com lote só é possível se o lote ainda estiver intacto.
- **Venda** (`cancel_sale`, admin): estorna todas as saídas da venda (devolvendo aos mesmos lotes); a venda fica “Cancelada” com motivo, usuário e data.
- **Compra recebida** (`cancel_purchase`, admin): estorna as entradas, se os itens ainda estiverem em estoque.
- **Inventário**: cada diferença vira um ajuste (`inventory_adjustment`) com quantidade teórica, contada, diferença, motivo, responsável e data.

## Definições financeiras

- **Receita bruta** = total das vendas confirmadas (já com descontos).
- **CMV** = custo das saídas por venda.
- **Margem bruta** = Receita − CMV (somente com custo completo).
- **Lucro líquido**: não calculado — exigiria despesas, impostos, taxas de cartão etc.

## Datas e fuso

Timestamps em `timestamptz` (UTC no banco); datas de calendário (`date`) para validade e compras. Agrupamentos por dia usam o fuso da loja (padrão `America/Sao_Paulo`). A interface exibe DD/MM/AAAA HH:mm.

## Segurança

- RLS em todas as tabelas; `store_counters` e `operation_requests` inacessíveis ao cliente.
- `anon` não lê nada nem executa funções.
- Operador não consegue: alterar preço/cadastro, configurações, promover-se a admin, ler auditoria, estornar, cancelar.
- Isolamento entre lojas testado (leitura, escrita, RPC, views, perfis).
- Gatilho de cadastro do usuário aplica convites pendentes; somente o **primeiro** usuário do sistema cria a loja inicial.
- Mensagens de erro do banco são em português e sem detalhes técnicos; erros desconhecidos viram mensagem genérica (`src/lib/errors.ts`).

## Futuro

- **PDF**: os relatórios já são definidos de forma declarativa (`REPORTS` em `ReportsPage.tsx`, com colunas e formatos); um exportador PDF pode reutilizar a mesma definição.
- **PDV / delivery**: `sales.channel` e `sales.external_ref` (único por canal) permitem importar pedidos sem duplicar; `create_sale` já aceita esses campos.

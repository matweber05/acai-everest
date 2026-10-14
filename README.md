# Açaí Everest — Sistema de Gestão da Loja

Mini ERP para a loja **Açaí Everest ABC**: estoque, produtos e insumos, lotes e validade, movimentações auditáveis, compras, vendas, fichas técnicas, inventário, dashboard, relatórios (CSV), usuários e permissões.

- **App web**: funciona no navegador do computador e do celular.
- **Backend**: Supabase (PostgreSQL + Auth + Storage), com RLS e funções transacionais.

> Tudo em português do Brasil, R$, datas DD/MM/AAAA, fuso America/Sao_Paulo.

---

## 1. O que está pronto e o que depende de você

| Item | Situação |
|---|---|
| Banco de dados (migrations, RLS, funções transacionais) | ✅ Pronto e testado (123 testes automatizados + concorrência) |
| Interface completa (todas as telas dos 9 módulos) | ✅ Pronta e testada de ponta a ponta no navegador |
| Login, cadastro, recuperação de senha, perfis admin/operador | ✅ Pronto |
| **Projeto Supabase** (onde os dados ficam guardados) | ⚙️ **Você precisa criar** (gratuito) — seção 3 |
| **Hospedagem do site** (endereço na internet) | ⚙️ Você escolhe (Vercel/Netlify gratuitos) — seção 5 |
| Exportação PDF dos relatórios | 🔜 Estrutura preparada (botão desabilitado); CSV já funciona |
| Integração com PDV/iFood | 🔜 Não implementada (campos `channel`/`external_ref` já existem nas vendas) |

Nenhum dado fictício é exibido como real. O sistema começa vazio: a proprietária cadastra os produtos e informa o estoque inicial.

---

## 2. Rodar no computador (desenvolvimento)

Requisitos: **Node.js 20+** (https://nodejs.org).

```bash
npm install
cp .env.example .env.local     # depois preencha com os dados do Supabase (seção 3)
npm run dev                    # abre em http://localhost:5173
```

Outros comandos:

```bash
npm run build      # gera a versão de produção em dist/
npm test           # testes unitários (cálculos monetários, formatação, CSV)
npm run test:db    # testes do banco (precisa de PostgreSQL local — ver seção 6)
```

---

## 3. Configurar o Supabase (passo a passo)

1. Crie uma conta em https://supabase.com e clique em **New project**.
   - Nome: `acai-everest` · Região: **South America (São Paulo)** · Guarde a senha do banco.
2. Quando o projeto estiver pronto, abra **SQL Editor → New query**, cole **todo** o conteúdo de
   [`supabase/setup_completo.sql`](supabase/setup_completo.sql) e clique em **Run**.
   (É a junção, em ordem, dos arquivos de `supabase/migrations/`. Quem usa a Supabase CLI pode rodar `supabase link` + `supabase db push`.)
3. Em **Project Settings → API**, copie:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon / publishable key** → `VITE_SUPABASE_ANON_KEY`
   - ⚠️ **Nunca** use a chave `service_role` no app.
4. Em **Authentication → URL Configuration**:
   - **Site URL**: o endereço onde o sistema ficará (ex.: `https://acai-everest.vercel.app`; em desenvolvimento, `http://localhost:5173`).
   - **Redirect URLs**: adicione `https://SEU-ENDERECO/redefinir-senha` e `http://localhost:5173/**`.
5. Em **Authentication → Providers → Email**: mantenha **Confirm email** ligado (recomendado).
6. (Opcional) Em **Authentication → Email Templates**, traduza os e-mails para português.

### Primeiro acesso

1. Abra o sistema e toque em **Criar conta** com o e-mail da proprietária. Confirme pelo link recebido.
2. Faça login. Como o sistema está vazio, aparece **“Bem-vinda!”**: crie a loja. Essa pessoa vira **administradora**.
3. A partir daí **ninguém mais consegue criar lojas** sozinho: novas pessoas precisam ser adicionadas em
   **Usuários e configurações → Usuários** (por e-mail) e depois usar **Criar conta** com esse e-mail.

### Implantação dos dados reais

1. **Produtos e insumos → Adicionar produto** para cada item (polpa, complementos, copos, colheres, bebidas…).
   - Itens montados na hora (ex.: “Açaí 500 mL”): tipo **Produto acabado** + **Baixa pela ficha técnica**, e cadastre a ficha (quanto de cada ingrediente sai por porção).
2. **Estoque → Inventário → Nova contagem** (ou **Registrar entrada** com motivo **Estoque inicial**) para lançar as quantidades reais.
3. Use **Compras** para reposições e **Lançar venda** no dia a dia.
4. Para treinar antes: **Configurações → Dados e auditoria → Criar itens de demonstração** (marcados “DEMO”, sem preço/estoque). Depois use **Limpar dados de demonstração** (exige digitar LIMPAR).

---

## 4. Funcionalidades

| Módulo | Destaques |
|---|---|
| **Dashboard** | Filtros Hoje / 7 / 30 dias / personalizado; SKUs, valor do estoque, quantidades **separadas por unidade**, abaixo do mínimo, sem estoque, validade, compras, receita, CMV e margem bruta (só quando há custo completo); gráficos de entradas × saídas, vendas, mais vendidos, estoque por categoria e evolução do valor; listas operacionais e atalhos. |
| **Estoque** | Posição atual, lotes e validade (vencidos / 7 / 15 / 30 dias — configurável), inventário com contagem, diferença, motivo e ajuste rastreável. |
| **Produtos e insumos** | Cadastro completo, busca por nome/SKU/código de barras, filtros, inativação, exclusão só sem histórico, ficha técnica com custo estimado. |
| **Movimentações** | Entrada/saída em uma tela (FEFO automático), histórico filtrável, estorno com motivo, exportação CSV. |
| **Vendas** | Tela tipo PDV (toque para adicionar, leitor de código de barras), desconto por item e geral, forma de pagamento, cancelamento com estorno. |
| **Compras** | Rascunho → revisão → recebimento único e transacional, rateio de frete/desconto no custo, lote/validade por item. |
| **Fornecedores** | Cadastro com validação de CPF/CNPJ, histórico de compras. |
| **Relatórios** | 12 relatórios com filtros e CSV (Excel-compatível, separador “;”). |
| **Configurações** | Loja, logo, fuso, alertas, estoque negativo (exceção auditada), categorias, unidades, usuários/perfis, meu perfil/senha, dados demo, conferência de saldos, auditoria. |

### Perfis

| Ação | Admin | Operador |
|---|:-:|:-:|
| Consultar estoque, produtos, relatórios, dashboard | ✅ | ✅ |
| Registrar entradas, saídas, vendas, compras, inventário | ✅ | ✅ |
| Cadastrar/editar produtos, preços, categorias, unidades, fornecedores, fichas | ✅ | ❌ |
| Estornar movimentação, cancelar venda, cancelar compra recebida | ✅ | ❌ |
| Configurações da loja, estoque negativo, usuários, auditoria, dados demo | ✅ | ❌ |

As permissões são garantidas **no banco** (RLS + validação dentro das funções), não apenas na tela.

---

## 5. Publicar o site (gratuito)

**Vercel** (recomendado): importe o repositório em https://vercel.com → Framework: Vite → adicione as variáveis
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` → Deploy. O arquivo `vercel.json` já trata as rotas.
**Netlify** também funciona (`public/_redirects` já incluso; build `npm run build`, pasta `dist`).

Depois, atualize a **Site URL** do Supabase (seção 3, passo 4) com o endereço final.

---

## 6. Testes

- `npm test` — testes unitários (Vitest).
- `npm run test:db` — aplica as migrations num PostgreSQL local e roda `supabase/tests/`:
  regras de negócio, permissões por perfil, isolamento entre lojas, RLS, lotes vencidos, estornos,
  idempotência, demonstração e **concorrência** (10 vendas simultâneas do último item; 5 recebimentos simultâneos da mesma compra).
  Exemplo: `PGHOST=localhost PGPORT=5432 PGUSER=postgres npm run test:db` (usa um banco `acai_test` descartável;
  o arquivo `00_supabase_shim.sql` simula o ambiente Supabase e **não** deve ser executado no projeto real).

Arquitetura, cálculo de saldo, concorrência e estornos: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

---

## 7. Estrutura

```
src/
  components/      UI reutilizável (botões, formulários, tabelas, diálogos, seletor de produto)
  contexts/        Autenticação/loja atual e ações rápidas (entrada/saída de qualquer tela)
  features/        Um diretório por módulo (dashboard, estoque, produtos, vendas, compras…)
  lib/             Acesso a dados (api.ts), formatação BR, dinheiro em centavos, CSV, erros
  types/           Tipos do banco
supabase/
  migrations/      Esquema, segurança/RLS, funções de estoque, relatórios, storage
  setup_completo.sql  Todas as migrations em um arquivo (para o SQL Editor)
  tests/           Testes SQL + concorrência
docs/              Documentação complementar (arquitetura)
```

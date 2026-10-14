// Teste de ponta a ponta no navegador (Playwright) usado na validação: cadastro, loja, produtos, ficha,
// entradas, saída bloqueada, venda, compra, estorno, dashboard, relatório CSV, inventário e celular.
// Requer o app rodando com um Supabase de testes em BASE.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8000';
const shots = '/tmp/e2e/shots';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url().replace(BASE, '')); });
  const step = async (name, fn) => { try { await fn(); console.log('ok -', name); } catch (e) { console.log('FAIL -', name, e.message.split('\n')[0]); await page.screenshot({ path: `${shots}/FAIL-${name.replace(/\W+/g, '_')}.png` }); throw e; } };
  const toast = async (re) => page.getByText(re).first().waitFor({ timeout: 8000 });

  await step('login redireciona', async () => { await page.goto(BASE + '/'); await page.waitForURL('**/entrar'); await page.screenshot({ path: `${shots}/01-login.png` }); });
  await step('criar conta', async () => {
    await page.getByRole('link', { name: 'Criar conta' }).click();
    await page.getByLabel(/^Seu nome/).fill('Maria Everest');
    await page.getByLabel(/^E-mail/).fill('mae@acaieverest.test');
    await page.getByLabel(/^Senha/).fill('senhaforte123');
    await page.getByLabel(/^Confirmar senha/).fill('senhaforte123');
    await page.getByRole('button', { name: 'Criar conta' }).click();
    await page.waitForURL('**/bem-vindo', { timeout: 10000 });
  });
  await step('criar loja', async () => {
    await page.getByRole('button', { name: 'Criar loja' }).click();
    await page.getByText('Vamos começar o seu estoque').waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${shots}/02-dashboard-vazio.png` });
  });

  async function addProduct(p) {
    await page.goto(BASE + '/produtos?novo=1');
    const d = page.getByRole('dialog');
    await d.getByLabel(/^Nome/).fill(p.name);
    await d.getByLabel(/^SKU/).fill(p.sku);
    await d.getByLabel(/^Tipo de item/).selectOption(p.type);
    if (p.cat) await d.getByLabel(/^Categoria/).selectOption({ label: p.cat });
    await d.getByLabel(/^Unidade de medida/).selectOption({ label: p.unit });
    if (p.recipe) await d.getByLabel(/^Como o estoque/).selectOption('recipe');
    await d.getByLabel(/^Custo unitário/).fill(p.cost ?? '0');
    if (p.price) await d.getByLabel(/^Preço de venda/).fill(p.price);
    if (p.min) await d.getByLabel(/^Estoque mínimo/).fill(p.min);
    if (p.expiry) await d.getByRole('switch', { name: 'Controlar validade' }).click();
    if (p.shot) await page.screenshot({ path: `${shots}/${p.shot}` });
    await d.getByRole('button', { name: 'Cadastrar' }).click();
    await page.waitForURL(/\/produtos\/[0-9a-f-]{36}$/, { timeout: 10000 });
  }
  await step('cadastrar produtos', async () => {
    await addProduct({ name: 'Polpa de açaí', sku: 'POLPA', type: 'ingredient', cat: 'Açaí', unit: 'Quilograma (kg)', cost: '18,50', min: '5', expiry: true, shot: '03-form-produto.png' });
    await addProduct({ name: 'Copo 500 mL', sku: 'COPO500', type: 'packaging', cat: 'Embalagens', unit: 'Unidade (un)', cost: '0,35', min: '50' });
    await addProduct({ name: 'Água mineral 500 mL', sku: 'AGUA', type: 'resale', cat: 'Produtos para revenda', unit: 'Unidade (un)', cost: '1,20', price: '3,50', min: '12' });
    await addProduct({ name: 'Açaí 500 mL', sku: 'ACAI500', type: 'finished', cat: 'Açaí', unit: 'Unidade (un)', price: '22', recipe: true });
  });
  await step('ficha técnica', async () => {
    await page.getByRole('button', { name: 'Cadastrar ficha' }).click();
    const pick = async (i, name, qty) => {
      const box = page.getByRole('combobox').nth(i);
      await box.click(); await box.fill(name.slice(0, 5));
      await page.getByRole('option', { name: new RegExp(name) }).first().click();
      await page.getByLabel(/^Qtd\./).nth(i).fill(qty);
    };
    await pick(0, 'Polpa de açaí', '0,35');
    await page.getByRole('button', { name: 'Adicionar ingrediente' }).click();
    await pick(1, 'Copo 500', '1');
    await page.getByRole('button', { name: 'Salvar ficha' }).click();
    await toast('Ficha técnica salva');
    await page.screenshot({ path: `${shots}/04-ficha-tecnica.png`, fullPage: true });
  });

  async function entry(name, qty, cost, expiry) {
    await page.getByRole('button', { name: 'Registrar entrada' }).first().click();
    const d = page.getByRole('dialog');
    const box = d.getByLabel(/^Item/); await box.fill(name.slice(0, 5));
    await page.getByRole('option', { name: new RegExp(name) }).first().click();
    await d.getByLabel(/^Quantidade/).fill(qty);
    await d.getByLabel(/^Motivo/).selectOption('initial_stock');
    await d.getByLabel(/^Custo unitário/).fill(cost);
    if (expiry) await d.getByLabel(/^Validade/).fill(expiry);
    if (name.startsWith('Polpa')) await page.screenshot({ path: `${shots}/05-entrada.png` });
    await d.getByRole('button', { name: 'Confirmar entrada' }).click();
    await toast('Entrada registrada');
    await d.waitFor({ state: 'detached' });
  }
  await step('entradas de estoque inicial', async () => {
    await page.goto(BASE + '/estoque');
    const exp = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
    await entry('Polpa de açaí', '10', '18,50', exp);
    await entry('Copo 500', '200', '0,30');
    await entry('Água mineral', '24', '1,10');
    await page.getByText('Polpa de açaí').first().waitFor({ state: 'attached' });
    await page.screenshot({ path: `${shots}/06-estoque.png`, fullPage: true });
  });

  await step('saída maior que estoque bloqueada', async () => {
    await page.getByRole('button', { name: 'Registrar saída' }).first().click();
    const d = page.getByRole('dialog');
    await d.getByLabel(/^Item/).fill('Água');
    await page.getByRole('option', { name: /Água mineral/ }).first().click();
    await d.getByLabel(/^Quantidade/).fill('500');
    await d.getByLabel(/^Motivo/).selectOption('loss');
    await d.getByText('A saída será bloqueada').waitFor();
    await d.getByRole('button', { name: 'Confirmar saída' }).click();
    await toast(/Estoque insuficiente/);
    await page.screenshot({ path: `${shots}/07-saida-bloqueada.png` });
    await d.getByLabel(/^Quantidade/).fill('2');
    await d.getByLabel(/^Motivo/).selectOption('damage');
    await d.getByRole('button', { name: 'Confirmar saída' }).click();
    await toast('Saída registrada');
  });

  await step('venda', async () => {
    await page.goto(BASE + '/vendas/nova');
    await page.getByRole('button', { name: /^Açaí 500 mL/ }).first().click();
    await page.getByRole('button', { name: /^Açaí 500 mL/ }).first().click();
    await page.getByRole('button', { name: /^Água mineral/ }).first().click();
    await page.getByText('R$ 47,50').first().waitFor({ state: 'attached' });
    await page.screenshot({ path: `${shots}/08-nova-venda.png` });
    await page.getByRole('button', { name: 'Confirmar venda' }).click();
    await page.waitForURL(/\/vendas\/[0-9a-f-]{36}$/);
    await page.getByText('Venda #1').waitFor();
    await page.screenshot({ path: `${shots}/09-venda.png` });
  });

  await step('compra rascunho e recebimento', async () => {
    await page.goto(BASE + '/compras/nova');
    const box = page.getByLabel(/^Item 1/); await box.fill('Água');
    await page.getByRole('option', { name: /Água mineral/ }).first().click();
    await page.getByLabel(/^Qtd\./).fill('48');
    await page.getByLabel(/^Custo un\./).fill('1,00');
    await page.getByLabel(/^Frete/).fill('10');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await page.waitForURL(/\/compras\/[0-9a-f-]{36}$/);
    await page.getByText('Rascunho: o estoque ainda NÃO').waitFor();
    await page.getByRole('button', { name: 'Confirmar recebimento' }).click();
    await page.getByRole('button', { name: 'Confirmar e dar entrada' }).click();
    await toast('Recebimento confirmado');
    await page.screenshot({ path: `${shots}/10-compra.png` });
  });

  await step('estorno', async () => {
    await page.goto(BASE + '/movimentacoes');
    await page.getByRole('button', { name: 'Estornar' }).first().click();
    await page.getByRole('dialog').getByLabel(/^Motivo/).fill('Lançado errado');
    await page.getByRole('dialog').getByRole('button', { name: 'Estornar' }).click();
    await toast('Movimentação estornada');
    await page.getByText('Estornada').first().waitFor({ state: 'attached' });
    await page.screenshot({ path: `${shots}/11-movimentacoes.png` });
  });

  await step('dashboard com dados', async () => {
    await page.goto(BASE + '/');
    await page.getByText('Receita bruta').first().waitFor();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${shots}/12-dashboard.png`, fullPage: true });
    const txt = (await page.textContent('main')).replace(/\u00a0/g, ' ');
    if (!txt.includes('R$ 47,50')) throw new Error('receita não bate: ' + txt.slice(0, 300));
  });

  await step('relatório + CSV', async () => {
    await page.goto(BASE + '/relatorios');
    await page.getByRole('button', { name: 'Margem bruta estimada' }).click();
    await page.getByText('Açaí 500 mL').first().waitFor({ state: 'attached' });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).click()]);
    await dl.saveAs('/tmp/e2e/shots/margem.csv');
    await page.screenshot({ path: `${shots}/13-relatorios.png` });
  });

  await step('inventário', async () => {
    await page.goto(BASE + '/estoque/inventario');
    await page.getByRole('button', { name: 'Nova contagem' }).click();
    await page.waitForURL(/inventario\/[0-9a-f-]{36}$/);
    await page.getByLabel('Quantidade contada de Copo 500 mL').fill('195');
    await page.getByRole('button', { name: 'Confirmar inventário' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Confirmar e ajustar/ }).click();
    await toast('Inventário confirmado');
  });

  await step('persistência após recarregar', async () => {
    await page.goto(BASE + '/estoque'); await page.reload();
    await page.getByText('Copo 500 mL').first().waitFor({ state: 'attached' });
    const t = (await page.textContent('main')).replace(/\u00a0/g, ' ');
    if (!t.includes('195 un')) throw new Error('saldo do copo não persistiu');
  });

  // Celular
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const mp = await m.newPage();
  await step('mobile login + dashboard', async () => {
    await mp.goto(BASE + '/entrar');
    await mp.screenshot({ path: `${shots}/20-mobile-login.png` });
    await mp.getByLabel(/^E-mail/).fill('mae@acaieverest.test');
    await mp.getByLabel(/^Senha/).fill('senhaforte123');
    await mp.getByRole('button', { name: 'Entrar' }).click();
    await mp.getByText('Receita bruta').first().waitFor({ timeout: 10000 });
    await mp.waitForTimeout(600);
    await mp.screenshot({ path: `${shots}/21-mobile-dashboard.png` });
    await mp.getByRole('button', { name: 'Ações rápidas' }).click();
    await mp.getByText('O que você quer fazer?').waitFor();
    await mp.screenshot({ path: `${shots}/22-mobile-acoes.png` });
    await mp.getByRole('button', { name: /Registrar saída/ }).click();
    await mp.getByRole('dialog').waitFor();
    await mp.waitForTimeout(300);
    await mp.screenshot({ path: `${shots}/23-mobile-saida.png` });
    await mp.keyboard.press('Escape');
    await mp.goto(BASE + '/estoque');
    await mp.getByText('Copo 500 mL').first().waitFor({ state: 'attached' });
    await mp.screenshot({ path: `${shots}/24-mobile-estoque.png` });
    await mp.goto(BASE + '/vendas/nova');
    await mp.getByRole('button', { name: /^Açaí 500 mL/ }).first().click();
    await mp.screenshot({ path: `${shots}/25-mobile-venda.png`, fullPage: true });
  });

  console.log('console errors:', errors.length ? errors.slice(0, 10) : 'nenhum');
  await browser.close();
})().catch((e) => { console.error('ABORT', e.message.split('\n')[0]); process.exit(1); });

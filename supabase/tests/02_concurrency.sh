#!/usr/bin/env bash
# Teste de concorrência: 10 sessões tentam vender o ÚLTIMO item ao mesmo tempo
# e 5 sessões tentam receber a MESMA compra ao mesmo tempo.
set -uo pipefail
DB=${1:-acai_test}
Q="psql -q -X -t -A -v ON_ERROR_STOP=1 -d $DB"

LOGIN="select tst.login('mae@acai.test'); set role authenticated;"
$Q -c "$LOGIN
  insert into public.products(store_id, sku, name, item_type, unit_id, sale_price)
  values (tst.get('store')::uuid, 'ULTIMO', 'Último item', 'resale', tst.get('un')::uuid, 5);
  select tst.put('ultimo', (select id::text from public.products where sku = 'ULTIMO'));
  select public.register_entry(tst.get('store')::uuid, tst.get('ultimo')::uuid, 1, 2);
  select tst.put('pur2', (public.save_purchase(tst.get('store')::uuid, null, jsonb_build_object('items',
     jsonb_build_array(jsonb_build_object('product_id', tst.get('ultimo'), 'quantity', 5, 'unit_cost', 2)))))->>'purchase_id');" >/dev/null

TMP=$(mktemp -d)
for i in $(seq 1 10); do
  ( $Q -c "$LOGIN select public.create_sale(tst.get('store')::uuid, jsonb_build_object('items',
        jsonb_build_array(jsonb_build_object('product_id', tst.get('ultimo'), 'quantity', 1))));" >"$TMP/sale$i" 2>&1; echo $? >"$TMP/sale$i.rc" ) &
done
wait
OK=$(grep -l '^0$' "$TMP"/sale*.rc | wc -l)
INSUF=$(grep -l 'Estoque insuficiente' "$TMP"/sale? "$TMP"/sale?? 2>/dev/null | wc -l)
BAL=$($Q -c "select quantity from public.stock_balances where product_id = tst.get('ultimo')::uuid")
if [[ "$OK" == "1" && "$INSUF" == "9" && "$BAL" == "0.000" ]]; then
  echo "  ok - 10 vendas simultâneas do último item: 1 aprovada, 9 bloqueadas, saldo final 0"
else
  echo "FALHOU: concorrência de vendas (aprovadas=$OK bloqueadas=$INSUF saldo=$BAL)"; cat "$TMP"/sale1; exit 1
fi

for i in $(seq 1 5); do
  ( $Q -c "$LOGIN select public.receive_purchase(tst.get('store')::uuid, tst.get('pur2')::uuid);" >"$TMP/rec$i" 2>&1; echo $? >"$TMP/rec$i.rc" ) &
done
wait
OK=$(grep -l '^0$' "$TMP"/rec*.rc | wc -l)
BAL=$($Q -c "select quantity from public.stock_balances where product_id = tst.get('ultimo')::uuid")
if [[ "$OK" == "1" && "$BAL" == "5.000" ]]; then
  echo "  ok - 5 recebimentos simultâneos da mesma compra: só 1 gerou entrada (saldo 5)"
else
  echo "FALHOU: concorrência de recebimento (aprovados=$OK saldo=$BAL)"; cat "$TMP"/rec*; exit 1
fi

INT=$($Q -c "$LOGIN select count(*) from public.check_stock_integrity(tst.get('store')::uuid);" | tail -1)
[[ "$INT" == "0" ]] && echo "  ok - integridade dos saldos após concorrência" || { echo "FALHOU: integridade ($INT)"; exit 1; }
rm -rf "$TMP"
echo "TESTES DE CONCORRÊNCIA PASSARAM"

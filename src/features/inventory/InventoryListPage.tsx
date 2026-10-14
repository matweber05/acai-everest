import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, ClipboardCheck, Plus } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { useInventoryCounts, useRpc } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { newRequestId } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

const STATUS = { open: ['Em andamento', 'warning'], confirmed: ['Confirmado', 'success'], cancelled: ['Cancelado', 'neutral'] } as const;

export default function InventoryListPage() {
  const { storeId } = useStore();
  const navigate = useNavigate();
  const { data = [], isLoading, error, refetch } = useInventoryCounts(storeId);
  const create = useRpc<Record<string, unknown>, { inventory_count_id: string }>('save_inventory_count');

  async function onNew() {
    try {
      const r = await create.mutateAsync({ p_store: storeId, p_count: null, p_notes: null, p_items: [], p_request_id: newRequestId() });
      navigate(`/estoque/inventario/${r.inventory_count_id}`);
    } catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <>
      <Link to="/estoque" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-acai-700"><ArrowLeft className="h-4 w-4" />Estoque</Link>
      <PageHeader title="Inventário" description="Conte o estoque físico e compare com o saldo do sistema. Cada diferença confirmada vira um ajuste rastreável."
        actions={<Button onClick={onNew} loading={create.isPending}><Plus className="h-4 w-4" />Nova contagem</Button>} />
      <Card>
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading ? <Spinner /> : data.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="h-7 w-7" />} title="Nenhuma contagem ainda"
            description="Faça uma contagem na implantação do sistema e depois periodicamente (ex.: todo mês)." />
        ) : (
          <Table>
            <THead><tr><TH>Nº</TH><TH>Criada em</TH><TH>Situação</TH><TH className="text-right">Itens contados</TH><TH>Confirmada em</TH></tr></THead>
            <TBody>
              {data.map((c) => (
                <TR key={c.id} className="cursor-pointer" onClick={() => navigate(`/estoque/inventario/${c.id}`)}>
                  <TD><Link to={`/estoque/inventario/${c.id}`} className="font-semibold hover:text-acai-700">#{c.number}</Link></TD>
                  <TD>{formatDateTime(c.created_at)}</TD>
                  <TD><Badge tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge></TD>
                  <TD className="text-right tabular">{c.inventory_count_items?.[0]?.count ?? 0}</TD>
                  <TD>{formatDateTime(c.confirmed_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}

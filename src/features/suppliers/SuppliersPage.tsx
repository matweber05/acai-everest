import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Mail, Pencil, Phone, Plus, Truck } from 'lucide-react';
import { useStore } from '@/contexts/AuthContext';
import { useSuppliers, useWrite } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { EmptyState, ErrorState, PageHeader, SearchInput, Spinner } from '@/components/ui/misc';
import { Pagination, Table, TBody, TD, TH, THead, TR, usePagination } from '@/components/ui/table';
import type { Supplier } from '@/types/db';

const digits = (s?: string) => (s ?? '').replace(/\D/g, '');
const schema = z.object({
  name: z.string().trim().min(2, 'Informe o nome ou razão social').max(160),
  contact_name: z.string().max(120).optional(),
  phone: z.string().max(30).optional().refine((v) => !v || digits(v).length >= 8, 'Telefone incompleto'),
  email: z.string().trim().optional().refine((v) => !v || z.string().email().safeParse(v).success, 'E-mail inválido'),
  document: z.string().optional().refine((v) => !v || [11, 14].includes(digits(v).length), 'CPF (11 dígitos) ou CNPJ (14 dígitos)'),
  address: z.string().max(300).optional(),
  notes: z.string().max(1000).optional(),
  active: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

function formatDoc(v?: string | null) {
  const d = digits(v ?? '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v ?? '';
}

function SupplierDialog({ open, onOpenChange, supplier }: { open: boolean; onOpenChange: (v: boolean) => void; supplier: Supplier | null }) {
  const { storeId } = useStore();
  const save = useWrite((v: Record<string, unknown>) => supplier
    ? supabase.from('suppliers').update(v).eq('id', supplier.id).select('id').single()
    : supabase.from('suppliers').insert({ ...v, store_id: storeId }).select('id').single());
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (open) reset({
      name: supplier?.name ?? '', contact_name: supplier?.contact_name ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '',
      document: formatDoc(supplier?.document), address: supplier?.address ?? '', notes: supplier?.notes ?? '', active: supplier?.active ?? true,
    });
  }, [open, supplier, reset]);

  async function onSubmit(v: FormValues) {
    const payload = {
      name: v.name.trim(), contact_name: v.contact_name?.trim() || null, phone: v.phone?.trim() || null, email: v.email?.trim() || null,
      document: digits(v.document) || null, address: v.address?.trim() || null, notes: v.notes?.trim() || null, active: v.active,
    };
    try { await save.mutateAsync(payload); toast.success(supplier ? 'Fornecedor atualizado' : 'Fornecedor cadastrado'); onOpenChange(false); }
    catch (e) { toast.error(errorMessage(e)); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !save.isPending && onOpenChange(v)} title={supplier ? 'Editar fornecedor' : 'Novo fornecedor'} size="md"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancelar</Button><Button loading={save.isPending} onClick={handleSubmit(onSubmit)}>Salvar</Button></>}>
      <form className="space-y-3" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Field label="Nome ou razão social" required error={errors.name?.message}>{(a) => <Input {...a} {...register('name')} autoFocus />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contato" error={errors.contact_name?.message}>{(a) => <Input {...a} {...register('contact_name')} />}</Field>
          <Field label="Telefone" error={errors.phone?.message}>{(a) => <Input {...a} inputMode="tel" placeholder="(11) 99999-9999" {...register('phone')} />}</Field>
          <Field label="E-mail" error={errors.email?.message}>{(a) => <Input {...a} type="email" inputMode="email" {...register('email')} />}</Field>
          <Field label="CPF/CNPJ" error={errors.document?.message}>{(a) => <Input {...a} inputMode="numeric" placeholder="Opcional" {...register('document')} />}</Field>
        </div>
        <Field label="Endereço">{(a) => <Input {...a} {...register('address')} placeholder="Opcional" />}</Field>
        <Field label="Observações">{(a) => <Textarea {...a} rows={2} {...register('notes')} placeholder="Dias de entrega, condições de pagamento…" />}</Field>
        {supplier && <Switch checked={watch('active')} onChange={(v) => setValue('active', v)} label="Fornecedor ativo" description="Inativos não aparecem em novas compras." />}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

export default function SuppliersPage() {
  const { storeId, isAdmin } = useStore();
  const { data = [], isLoading, error, refetch } = useSuppliers(storeId);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'all'>('active');
  const [edit, setEdit] = useState<{ open: boolean; s: Supplier | null }>({ open: false, s: null });
  const rows = useMemo(() => data.filter((s) =>
    (status === 'all' || (status === 'active' ? s.active : !s.active))
    && (!q || `${s.name} ${s.contact_name ?? ''} ${s.document ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, q, status]);
  const { slice, page, pages, setPage, total } = usePagination(rows);

  return (
    <>
      <PageHeader title="Fornecedores" description="Quem abastece a loja."
        actions={isAdmin && <Button onClick={() => setEdit({ open: true, s: null })}><Plus className="h-4 w-4" />Novo fornecedor</Button>} />
      <Card>
        <div className="flex flex-col gap-2 border-b border-line p-4 sm:flex-row">
          <SearchInput className="flex-1" placeholder="Buscar fornecedor" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar fornecedor" />
          <Select className="sm:w-40" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Situação">
            <option value="active">Ativos</option><option value="inactive">Inativos</option><option value="all">Todos</option>
          </Select>
        </div>
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : isLoading ? <Spinner /> : rows.length === 0 ? (
          <EmptyState icon={<Truck className="h-7 w-7" />} title={data.length ? 'Nenhum fornecedor encontrado' : 'Nenhum fornecedor cadastrado'}
            action={isAdmin && !data.length ? <Button onClick={() => setEdit({ open: true, s: null })}><Plus className="h-4 w-4" />Cadastrar fornecedor</Button> : undefined} />
        ) : (
          <>
            <Table>
              <THead><tr><TH>Fornecedor</TH><TH className="hidden sm:table-cell">Contato</TH><TH className="hidden md:table-cell">CPF/CNPJ</TH><TH>Situação</TH><TH className="text-right">Ações</TH></tr></THead>
              <TBody>
                {slice.map((s) => (
                  <TR key={s.id}>
                    <TD><div className="font-medium">{s.name}</div>{s.notes && <div className="max-w-xs truncate text-[12px] text-ink-muted">{s.notes}</div>}</TD>
                    <TD className="hidden sm:table-cell">
                      <div>{s.contact_name ?? '—'}</div>
                      <div className="flex flex-wrap gap-x-3 text-[12px] text-ink-muted">
                        {s.phone && <a href={`tel:${digits(s.phone)}`} className="inline-flex items-center gap-1 hover:text-acai-700"><Phone className="h-3 w-3" />{s.phone}</a>}
                        {s.email && <a href={`mailto:${s.email}`} className="inline-flex items-center gap-1 hover:text-acai-700"><Mail className="h-3 w-3" />{s.email}</a>}
                      </div>
                    </TD>
                    <TD className="hidden text-ink-muted md:table-cell">{formatDoc(s.document) || '—'}</TD>
                    <TD><Badge tone={s.active ? 'success' : 'neutral'}>{s.active ? 'Ativo' : 'Inativo'}</Badge></TD>
                    <TD className="text-right">
                      <div className="inline-flex gap-1">
                        <Link to={`/compras?fornecedor=${s.id}`}><Button size="sm" variant="ghost">Compras</Button></Link>
                        {isAdmin && <Button size="sm" variant="secondary" onClick={() => setEdit({ open: true, s })} aria-label={`Editar ${s.name}`}><Pencil className="h-4 w-4" /></Button>}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pages={pages} total={total} onPage={setPage} label="fornecedores" />
          </>
        )}
      </Card>
      <SupplierDialog open={edit.open} supplier={edit.s} onOpenChange={(open) => setEdit((e) => ({ ...e, open }))} />
    </>
  );
}

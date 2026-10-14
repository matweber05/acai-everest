-- =====================================================================
-- Açaí Everest — Migration 005: armazenamento do logo da loja
-- Bucket público para leitura (o logo aparece na tela de login);
-- upload/remoção apenas por administradores, na pasta {store_id}/.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-assets', 'store-assets', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy store_assets_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'store-assets' and public.is_store_admin(((storage.foldername(name))[1])::uuid));
create policy store_assets_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'store-assets' and public.is_store_admin(((storage.foldername(name))[1])::uuid));
create policy store_assets_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'store-assets' and public.is_store_admin(((storage.foldername(name))[1])::uuid));

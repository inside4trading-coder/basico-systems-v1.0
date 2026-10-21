-- Fotos de productos.
--
-- Bucket público product-images: la foto se ve en el POS, el inventario y
-- donde haga falta sin firmar enlaces. La ruta empieza por el negocio
-- ({tenant_id}/{product_id}/{archivo}); subir, reemplazar y borrar solo lo
-- hacen dueño, administrador o encargado de ese negocio. products.image_url
-- (ya existe) guarda el enlace público.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create or replace function app.product_image_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_folder text := split_part(p_name, '/', 1);
begin
  if v_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return app.has_tenant_role(v_folder::uuid, array['owner', 'admin', 'manager']);
end;
$$;
revoke all on function app.product_image_allowed(text) from public;
grant execute on function app.product_image_allowed(text) to authenticated;

create policy product_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and app.product_image_allowed(name));
create policy product_images_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and app.product_image_allowed(name))
  with check (bucket_id = 'product-images' and app.product_image_allowed(name));
create policy product_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and app.product_image_allowed(name));
-- Para reemplazar y borrar, el cliente necesita ver sus propios archivos.
create policy product_images_read on storage.objects for select to authenticated
  using (bucket_id = 'product-images' and app.product_image_allowed(name));

-- La foto es un enlace http(s); nada de javascript: ni data: en la ficha.
alter table public.products add constraint products_image_url_check
  check (image_url is null or image_url ~* '^https?://[^\s]+$');

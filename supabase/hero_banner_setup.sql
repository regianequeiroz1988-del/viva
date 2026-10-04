-- ===========================================================================
-- HERO BANNER — rode este SQL no SQL Editor do Supabase
-- Cria a config key + bucket de storage + policies de acesso
-- ===========================================================================

-- 1) Adiciona a chave de configuração (se ainda não existir)
insert into public.configuracoes (chave, valor)
values ('hero_banner_url', '')
on conflict (chave) do nothing;

-- 2) Cria o bucket de Storage público para o banner
insert into storage.buckets (id, name, public)
values ('hero-banner', 'hero-banner', true)
on conflict (id) do nothing;

-- 3) Policies: leitura pública, upload/update/delete somente admin
create policy "hero_banner_select" on storage.objects for select
  using (bucket_id = 'hero-banner');

create policy "hero_banner_insert" on storage.objects for insert
  with check (bucket_id = 'hero-banner' and public.is_admin());

create policy "hero_banner_update" on storage.objects for update
  using (bucket_id = 'hero-banner' and public.is_admin());

create policy "hero_banner_delete" on storage.objects for delete
  using (bucket_id = 'hero-banner' and public.is_admin());

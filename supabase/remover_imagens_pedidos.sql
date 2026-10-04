-- Remove imagens ja gravadas dentro do JSON de itens dos pedidos.
-- Execute uma vez no SQL Editor do Supabase.

begin;

update public.pedidos p
set itens = coalesce((
  select jsonb_agg(item - 'image' order by ord)
  from jsonb_array_elements(p.itens) with ordinality as e(item, ord)
), '[]'::jsonb)
where jsonb_typeof(p.itens) = 'array'
  and exists (
    select 1
    from jsonb_array_elements(p.itens) as e(item)
    where e.item ? 'image'
  );

commit;
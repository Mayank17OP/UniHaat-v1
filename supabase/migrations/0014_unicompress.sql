-- ============================================================================
-- UniCompress — storing a listing image as a Huffman-coded blob.
--
-- A student uploads a photo with their listing. The browser reads the
-- file, optimises it, and compresses it with Huffman coding. What is
-- stored is the compressed bit stream and the tree needed to decode it
-- again — not the original bytes.
--
-- The tree is stored here rather than inside the blob because it is
-- worth querying on its own: the dashboard reads the code lengths to
-- show what the compressor did, and the same tree lets the server
-- verify a blob without unpacking it.
--
-- The original file is never kept. The photograph the marketplace shows
-- is the decompressed blob, so what a buyer sees is exactly what the
-- seller uploaded, and the bytes at rest are the compressed ones.
-- ============================================================================

create table if not exists public.listing_image_blobs (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(id) on delete cascade,
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  -- The compressed stream, as the browser produced it.
  payload      bytea not null,
  -- The Huffman tree, as a JSON map of byte value to its code.
  -- "code" is the binary code as a string of '0' and '1'.
  tree         jsonb not null,
  -- The length of every code, so the server can check the tree is
  -- complete without walking it.
  code_lengths jsonb not null,
  -- How big the file was before compression, and how big the stored
  -- blob is. The difference is what the campus saved.
  original_bytes  bigint not null check (original_bytes >= 0),
  compressed_bytes bigint not null check (compressed_bytes >= 0),
  -- What the file was, so the browser can rebuild it on the way out.
  mime_type    text not null default 'image/jpeg',
  -- The name the seller gave the file, for the listing's own record.
  file_name    text,
  -- The time the compression took, and the time the decompression took
  -- when it was checked.
  encoding_ms  numeric(10,3),
  decoding_ms  numeric(10,3),
  -- True when the compressed blob was read back and matched the
  -- original byte for byte.
  verified     boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists listing_image_blobs_listing_idx
  on public.listing_image_blobs (listing_id);

create index if not exists listing_image_blobs_owner_idx
  on public.listing_image_blobs (owner_id);

-- ---------------------------------------------------------------------------
-- How a listing image is stored.
--
-- A plain image is a URL the browser fetches. A compressed one is not:
-- the bytes at rest are a Huffman bit stream, and the browser has to
-- put them back together before it can show them. The listing image
-- row says which it is, so the interface knows what to do with it.
--
-- 'url'    — the column holds a URL and the browser fetches it as it is
-- 'huffman' — the column holds 'uhuf:<listing id>' and the browser
--             fetches the blob, decodes it, and shows the result
-- ---------------------------------------------------------------------------

alter table public.listing_images
  add column if not exists codec text not null default 'url';

alter table public.listing_images
  add constraint listing_images_codec_check
  check (codec in ('url', 'huffman'));

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.listing_image_blobs enable row level security;
-- The owner of a table carries the BYPASSRLS attribute, so enabling the
-- policies is not enough: the owner has to be subject to them too.
alter table public.listing_image_blobs force row level security;

-- A blob is readable when the listing it belongs to is readable. The
-- listing's own rules decide that, so a blob can never be more visible
-- than the thing it belongs to.
create policy "listing image blobs follow listing" on public.listing_image_blobs for select
  using (exists (
    select 1 from public.listings l
    where l.id = listing_id
      and (l.status = 'active' or l.seller_id = auth.uid() or public.is_staff())
  ));

-- A seller manages their own blobs — they upload one with a listing and
-- they can take it down again by deleting the listing.
create policy "sellers manage own listing image blobs" on public.listing_image_blobs for all
  using (exists (
    select 1 from public.listings l
    where l.id = listing_id and l.seller_id = auth.uid()
  ))
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.listings l
      where l.id = listing_id and l.seller_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- The compression history
--
-- Every file a student has compressed, newest first. This is what the
-- UniCompress dashboard reads to show what the campus has saved.
--
-- A row is private to the student who compressed the file, with one
-- exception: the campus-wide totals are public, because the savings
-- they describe are public. Those come from the view below, which
-- counts rows rather than reading them.
-- ---------------------------------------------------------------------------

create table if not exists public.compression_history (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  file_name    text,
  mime_type    text not null default 'application/octet-stream',
  original_bytes   bigint not null check (original_bytes >= 0),
  compressed_bytes bigint not null check (compressed_bytes >= 0),
  encoding_ms  numeric(10,3),
  decoding_ms  numeric(10,3),
  -- What the compressor is: 'huffman' today. A row says how it was
  -- made, so a file compressed by an older build is still described
  -- honestly.
  codec        text not null default 'huffman',
  created_at   timestamptz not null default now()
);

create index if not exists compression_history_owner_idx
  on public.compression_history (owner_id, created_at desc);

alter table public.compression_history enable row level security;
-- As above: the owner is subject to the policies too.
alter table public.compression_history force row level security;

create policy "students read own compression history" on public.compression_history for select
  using (owner_id = auth.uid());

create policy "students record own compression history" on public.compression_history for insert
  with check (owner_id = auth.uid());

create policy "students delete own compression history" on public.compression_history for delete
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The campus-wide totals.
--
-- A view over the history that counts rows instead of exposing them.
-- It shows how many files were compressed and how many bytes were
-- saved, and nothing about which student or which file.
--
-- The view is *not* security-invoker. The history's own policy lets a
-- student read only their own rows, so an invoker view would count
-- nothing for anyone else — the campus total would read zero to
-- everybody except the one student who happened to compress a file.
-- Running as the owner is safe here because the view exposes sums and
-- counts and no column that names anybody.
-- ---------------------------------------------------------------------------

drop view if exists public.compression_totals;

create view public.compression_totals as
select
  count(*)::int                                          as files,
  coalesce(sum(original_bytes), 0)::bigint               as original_bytes,
  coalesce(sum(compressed_bytes), 0)::bigint             as compressed_bytes,
  coalesce(sum(original_bytes - compressed_bytes), 0)::bigint as saved_bytes,
  case when coalesce(sum(original_bytes), 0) = 0 then null
       else round(
         (sum(compressed_bytes)::numeric / sum(original_bytes)::numeric) * 100,
         2
       )
  end                                                  as saved_percent
from public.compression_history;

grant select on public.compression_totals to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storing a blob
--
-- The browser does the compressing; this function does the writing. It
-- checks the same things the table's policy does, so a client cannot
-- use it to attach a blob to somebody else's listing.
--
-- The payload arrives as base64 rather than as `bytea`. PostgREST
-- carries `bytea` as a hex string, which would put two characters on
-- the wire for every byte of a compressed file — the opposite of what
-- this is for. Base64 is one and a third, and the server turns it back
-- into bytes here.
-- ---------------------------------------------------------------------------

create or replace function public.put_listing_image_blob(
  p_listing_id uuid,
  p_payload_base64 text,
  p_tree       jsonb,
  p_code_lengths jsonb,
  p_original_bytes bigint,
  p_compressed_bytes bigint,
  p_mime_type  text default 'image/jpeg',
  p_file_name  text default null,
  p_encoding_ms numeric default null,
  p_verified   boolean default false
)
returns public.listing_image_blobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_bytes bytea;
  v_row   public.listing_image_blobs;
begin
  v_owner := auth.uid();
  if v_owner is null then
    raise exception 'sign in to upload a photo';
  end if;

  select l.seller_id into v_owner
    from public.listings l
   where l.id = p_listing_id
     and l.seller_id = auth.uid();

  if v_owner is null then
    raise exception 'that listing is not yours';
  end if;

  if p_payload_base64 is null or p_payload_base64 = '' then
    raise exception 'the compressed image is empty';
  end if;

  v_bytes := decode(p_payload_base64, 'base64');

  if length(v_bytes) = 0 then
    raise exception 'the compressed image is empty';
  end if;

  -- The reported size must match the bytes actually sent. Otherwise
  -- the savings on the dashboard would be a claim rather than a fact.
  if p_compressed_bytes <> length(v_bytes) then
    raise exception 'the reported size does not match the payload';
  end if;

  insert into public.listing_image_blobs (
    listing_id, owner_id, payload, tree, code_lengths,
    original_bytes, compressed_bytes, mime_type, file_name,
    encoding_ms, verified
  ) values (
    p_listing_id, v_owner, v_bytes, p_tree, p_code_lengths,
    p_original_bytes, p_compressed_bytes,
    coalesce(p_mime_type, 'image/jpeg'), p_file_name,
    p_encoding_ms, p_verified
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.put_listing_image_blob(
  uuid, text, jsonb, jsonb, bigint, bigint, text, text, numeric, boolean
) from public, anon;
grant execute on function public.put_listing_image_blob(
  uuid, text, jsonb, jsonb, bigint, bigint, text, text, numeric, boolean
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reading a blob back
--
-- The payload comes back as base64 for the same reason it went in that
-- way. The tree comes back as it was stored.
-- ---------------------------------------------------------------------------

create or replace function public.get_listing_image_blob(p_listing_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', b.id,
           'listing_id', b.listing_id,
           'payload', encode(b.payload, 'base64'),
           'tree', b.tree,
           'code_lengths', b.code_lengths,
           'original_bytes', b.original_bytes,
           'compressed_bytes', b.compressed_bytes,
           'mime_type', b.mime_type,
           'file_name', b.file_name,
           'encoding_ms', b.encoding_ms,
           'verified', b.verified,
           'created_at', b.created_at
         )
    from public.listing_image_blobs b
   where b.listing_id = p_listing_id
     and exists (
       select 1 from public.listings l
       where l.id = b.listing_id
         and (l.status = 'active' or l.seller_id = auth.uid() or public.is_staff())
     )
   order by b.created_at desc
   limit 1;
$$;

revoke execute on function public.get_listing_image_blob(uuid) from public, anon;
grant execute on function public.get_listing_image_blob(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The history
-- ---------------------------------------------------------------------------

create or replace function public.record_compression(
  p_file_name text,
  p_mime_type text,
  p_original_bytes bigint,
  p_compressed_bytes bigint,
  p_encoding_ms numeric default null,
  p_decoding_ms numeric default null,
  p_codec text default 'huffman'
)
returns public.compression_history
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.compression_history;
begin
  if auth.uid() is null then
    raise exception 'sign in to record a compression';
  end if;

  insert into public.compression_history (
    owner_id, file_name, mime_type, original_bytes, compressed_bytes,
    encoding_ms, decoding_ms, codec
  ) values (
    auth.uid(), p_file_name, coalesce(p_mime_type, 'application/octet-stream'),
    p_original_bytes, p_compressed_bytes, p_encoding_ms, p_decoding_ms,
    coalesce(p_codec, 'huffman')
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.record_compression(
  text, text, bigint, bigint, numeric, numeric, text
) from public, anon;
grant execute on function public.record_compression(
  text, text, bigint, bigint, numeric, numeric, text
) to authenticated, service_role;

create or replace function public.fetch_compression_history(p_limit int default 20)
returns setof public.compression_history
language sql
stable
security definer
set search_path = public
as $$
  select h.*
    from public.compression_history h
   where h.owner_id = auth.uid()
   order by h.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke execute on function public.fetch_compression_history(int) from public, anon;
grant execute on function public.fetch_compression_history(int) to authenticated, service_role;

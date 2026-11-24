-- ============================================================================
-- UniHaat v1 — UniCompress database regression suite.
--
-- Run it against a scratch database:
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--        -f supabase/tests/unicompress_regression.sql
--
-- or, without psql:
--
--   DATABASE_URL=postgres://... node scripts/run-sql-suite.mjs \
--        supabase/tests/unicompress_regression.sql
--
-- Every check either passes silently or raises, and the whole script runs
-- inside one transaction that is rolled back at the end, so it never leaves
-- anything behind — the demo data is exactly as it was.
--
-- The checks are the ones that matter for the feature:
--
--   1.  the tables, the columns and the row policies exist
--   2.  a compressed blob round-trips: the bytes that go in are the
--       bytes that come back out
--   3.  the tree and the code lengths are stored as they were sent
--   4.  the stored blob really does decode back to the original bytes
--   5.  a blob that claims the wrong size is refused
--   6.  an empty blob is refused
--   7.  a student cannot attach a blob to somebody else's listing
--   8.  an anonymous client cannot use the functions at all
--   9.  a blob can be read while its listing is active, and not after
--   10. the compression history is private to the student who made it
--   11. the campus totals count every row and expose nobody
--   12. the codec column only accepts the two kinds it knows
--   13. the tree the server was given is complete: every code length
--       matches the code it describes, and the codes are prefix-free
--
-- Note on the plumbing: psql does not substitute its variables inside a
-- dollar quoted block, so the values are handed to the anonymous blocks
-- through session settings instead.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- Two students to work with.
select id::text as student_a
  from public.profiles
 order by created_at, id
 limit 1 \gset

select id::text as student_b
  from public.profiles
 where id <> :'student_a'::uuid
 order by created_at, id
 limit 1 \gset

-- A listing owned by each of them, so the ownership checks have
-- something real to look at.
insert into public.listings (
  id, seller_id, title, listing_type, category_slug, price,
  original_price, condition, age_months, status
)
select gen_random_uuid(), :'student_a'::uuid, 'UniCompress regression A',
       'sell', 'electronics', 100, 200, 'Good', 6, 'active'
where not exists (
  select 1 from public.listings where title = 'UniCompress regression A'
);

insert into public.listings (
  id, seller_id, title, listing_type, category_slug, price,
  original_price, condition, age_months, status
)
select gen_random_uuid(), :'student_b'::uuid, 'UniCompress regression B',
       'sell', 'electronics', 100, 200, 'Good', 6, 'active'
where not exists (
  select 1 from public.listings where title = 'UniCompress regression B'
);

select id::text as listing_a
  from public.listings
 where title = 'UniCompress regression A'
 limit 1 \gset

select id::text as listing_b
  from public.listings
 where title = 'UniCompress regression B'
 limit 1 \gset

-- ---------------------------------------------------------------------------
-- The payload the tests compress.
--
-- It is the textbook vector, "abracadabra", under the textbook tree:
--
--   a -> 0      b -> 110    c -> 100    d -> 101    r -> 111
--
-- The bit stream is
--
--   0 110 111 0 100 0 101 0 110 111 0
--
-- which is 25 bits — 01101110100010101101110 — padded with zeros to four
-- bytes: 6E 8A DC 00.
--
-- The expected bytes are written out here rather than produced by the
-- implementation, so the test states its expectation rather than
-- agreeing with whatever the code happens to do.
-- ---------------------------------------------------------------------------

select encode(decode('6e8adc00', 'hex'), 'base64') as payload_b64 \gset

-- The tree, and the length of every code in it. Written out by hand for
-- the same reason.
--
-- They are cast to text on the way out: a JSON value that arrives as a
-- JSON value would be re-read as an object rather than as the document
-- it is, and the cast keeps the quotes.
select ('{"97":"0","98":"110","99":"100","100":"101","114":"111"}'::jsonb)::text as test_tree \gset

select ('{"97":1,"98":3,"99":3,"100":3,"114":3}'::jsonb)::text as test_lengths \gset

-- ---------------------------------------------------------------------------
-- A decoder, in SQL.
--
-- The point of the whole feature is that the stored blob can be read back
-- as the original bytes. This decodes the bit stream using only the tree
-- that was stored, so the check below is not "the server gave back what
-- it was given" but "the tree and the stream together reproduce the
-- original".
--
-- It lives in the session's temporary schema, so it leaves with the
-- transaction.
-- ---------------------------------------------------------------------------

create function pg_temp.uc_decode(p_payload bytea, p_tree jsonb, p_count int)
returns bytea
language plpgsql
immutable
as $$
declare
  v_bits   text;
  v_out    bytea := ''::bytea;
  v_maxlen int;
  v_len    int;
  v_code   text;
  v_sym    text;
  v_pos    int;
begin
  -- The bit stream, most significant bit of each byte first — the order
  -- the encoder writes it in.
  --
  -- The bits are counted down from seven, so the series runs upwards
  -- and the order is descending. (`generate_series(7, 0)` with the
  -- default step of one yields nothing at all.)
  select coalesce(string_agg(
           case when (get_byte(p_payload, g.i) >> h.b) & 1 = 1 then '1' else '0' end,
           '' order by g.i, h.b desc), '')
    into v_bits
    from generate_series(0, octet_length(p_payload) - 1) as g(i),
         lateral generate_series(0, 7) as h(b);

  select coalesce(max(length(value)), 1) into v_maxlen
    from jsonb_each_text(p_tree);

  v_pos := 1;
  while octet_length(v_out) < p_count and v_pos <= length(v_bits) loop
    v_sym := null;

    -- The codes are prefix-free, so exactly one length matches. The
    -- longest is tried first.
    for v_len in reverse v_maxlen..1 loop
      v_code := substr(v_bits, v_pos, v_len);
      select t.key into v_sym
        from jsonb_each_text(p_tree) t
       where t.value = v_code;

      if v_sym is not null then
        v_out := v_out || decode(lpad(to_hex(v_sym::int), 2, '0'), 'hex');
        v_pos := v_pos + v_len;
        exit;
      end if;
    end loop;

    if v_sym is null then
      raise exception 'the bit stream did not decode at bit %', v_pos;
    end if;
  end loop;

  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The tables, the columns and the row policies exist.
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
begin
  select string_agg(t.name, ', ')
    into v_missing
    from unnest(array[
      'listing_image_blobs', 'compression_history', 'compression_totals'
    ]) as t(name)
   where not exists (
     select 1 from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.name
   );

  if v_missing is not null then
    raise exception 'CHECKFAILED these UniCompress objects are missing: %', v_missing;
  end if;

  -- The codec column on the listing images.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'listing_images'
       and column_name = 'codec'
  ) then
    raise exception 'CHECKFAILED listing_images has no codec column';
  end if;

  -- Row level security is on for the new tables. A table without it
  -- would be readable by anyone who found the name.
  if exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in ('listing_image_blobs', 'compression_history')
       and not c.relrowsecurity
  ) then
    raise exception 'CHECKFAILED row level security is not enabled on a UniCompress table';
  end if;

  -- And the history is private to the student who made it.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'compression_history'
       and cmd = 'SELECT'
       and qual like '%owner_id = auth.uid()%'
  ) then
    raise exception 'CHECKFAILED the compression history has no owner-only read policy';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. A compressed blob round-trips: the bytes that go in are the bytes
--    that come back out.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_row    public.listing_image_blobs;
  v_back   jsonb;
  v_stored bytea;
begin
  v_row := public.put_listing_image_blob(
    :'listing_a'::uuid,
    :'payload_b64',
    :'test_tree'::jsonb,
    :'test_lengths'::jsonb,
    11,                      -- the original was eleven bytes
    length(decode(:'payload_b64', 'base64')),
    'image/jpeg',
    'abracadabra.jpg',
    1.25,
    true
  );

  if v_row.id is null then
    raise exception 'CHECKFAILED the blob was not stored';
  end if;

  if v_row.owner_id <> :'student_a'::uuid then
    raise exception 'CHECKFAILED the blob is owned by somebody else: %', v_row.owner_id;
  end if;

  v_back := public.get_listing_image_blob(:'listing_a'::uuid);

  if v_back is null then
    raise exception 'CHECKFAILED the blob could not be read back';
  end if;

  -- The bytes that came back must be the bytes that went in.
  v_stored := decode(v_back ->> 'payload', 'base64');

  if v_stored <> decode(:'payload_b64', 'base64') then
    raise exception 'CHECKFAILED the payload did not round-trip: % vs %',
      encode(v_stored, 'hex'), encode(decode(:'payload_b64', 'base64'), 'hex');
  end if;

  -- And the reported sizes have to agree with the bytes.
  if (v_back ->> 'compressed_bytes')::bigint <> length(v_stored) then
    raise exception 'CHECKFAILED the reported compressed size does not match the payload';
  end if;

  if (v_back ->> 'original_bytes')::bigint <> 11 then
    raise exception 'CHECKFAILED the reported original size is wrong: %', v_back ->> 'original_bytes';
  end if;

  if coalesce((v_back ->> 'verified')::boolean, false) is not true then
    raise exception 'CHECKFAILED the blob was not recorded as verified';
  end if;

  if (v_back ->> 'mime_type') <> 'image/jpeg' then
    raise exception 'CHECKFAILED the mime type was not kept: %', v_back ->> 'mime_type';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The tree and the code lengths are stored as they were sent.
-- ---------------------------------------------------------------------------

do $$
declare
  v_back jsonb;
begin
  v_back := public.get_listing_image_blob(:'listing_a'::uuid);

  if (v_back -> 'tree') <> :'test_tree'::jsonb then
    raise exception 'CHECKFAILED the tree was not stored as it was sent: %', v_back -> 'tree';
  end if;

  if (v_back -> 'code_lengths') <> :'test_lengths'::jsonb then
    raise exception 'CHECKFAILED the code lengths were not stored as they were sent: %', v_back -> 'code_lengths';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 4. The stored blob really does decode back to the original bytes.
--
--    This is the whole promise of the feature, checked against the tree
--    and the stream that are actually in the database.
-- ---------------------------------------------------------------------------

do $$
declare
  v_back    jsonb;
  v_decoded bytea;
begin
  v_back := public.get_listing_image_blob(:'listing_a'::uuid);

  v_decoded := pg_temp.uc_decode(
    decode(v_back ->> 'payload', 'base64'),
    v_back -> 'tree',
    (v_back ->> 'original_bytes')::int
  );

  if v_decoded <> convert_to('abracadabra', 'UTF8') then
    raise exception 'CHECKFAILED the stored blob did not decode back to the original: %',
      encode(v_decoded, 'escape');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. A blob that claims the wrong size is refused.
--
--    The savings on the dashboard would otherwise be a claim rather
--    than a fact.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  perform public.put_listing_image_blob(
    :'listing_a'::uuid,
    :'payload_b64',
    :'test_tree'::jsonb,
    :'test_lengths'::jsonb,
    11,
    999,                    -- not the length of the payload
    'image/jpeg',
    'lying.jpg',
    1.0,
    true
  );
  raise exception 'CHECKFAILED a blob that lied about its size was accepted';
exception
  when others then
    if sqlerrm like '%CHECKFAILED%' then
      raise;
    end if;
    if sqlerrm not like '%size does not match%' then
      raise exception 'CHECKFAILED the wrong error was raised: %', sqlerrm;
    end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 6. An empty blob is refused.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  perform public.put_listing_image_blob(
    :'listing_a'::uuid,
    '',
    :'test_tree'::jsonb,
    :'test_lengths'::jsonb,
    0,
    0,
    'image/jpeg',
    'nothing.jpg',
    0.1,
    true
  );
  raise exception 'CHECKFAILED an empty blob was accepted';
exception
  when others then
    if sqlerrm like '%CHECKFAILED%' then
      raise;
    end if;
    if sqlerrm not like '%empty%' then
      raise exception 'CHECKFAILED the wrong error was raised: %', sqlerrm;
    end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 7. A student cannot attach a blob to somebody else's listing.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  perform public.put_listing_image_blob(
    :'listing_b'::uuid,     -- student B's listing
    :'payload_b64',
    :'test_tree'::jsonb,
    :'test_lengths'::jsonb,
    11,
    length(decode(:'payload_b64', 'base64')),
    'image/jpeg',
    'stolen.jpg',
    1.0,
    true
  );
  raise exception 'CHECKFAILED a student attached a blob to a listing they do not own';
exception
  when others then
    if sqlerrm like '%CHECKFAILED%' then
      raise;
    end if;
    if sqlerrm not like '%not yours%' then
      raise exception 'CHECKFAILED the wrong error was raised: %', sqlerrm;
    end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 8. An anonymous client cannot use the functions at all.
--
--    The functions are SECURITY DEFINER, so if `anon` could reach them
--    it would be running with the owner's rights.
-- ---------------------------------------------------------------------------

set local role anon;

do $$
begin
  perform public.put_listing_image_blob(
    :'listing_a'::uuid,
    :'payload_b64',
    :'test_tree'::jsonb,
    :'test_lengths'::jsonb,
    11,
    length(decode(:'payload_b64', 'base64')),
    'image/jpeg',
    'anon.jpg',
    1.0,
    true
  );
  raise exception 'CHECKFAILED an anonymous client stored a blob';
exception
  when insufficient_privilege then
    null;                  -- refused, as it should be
  when others then
    if sqlerrm like '%CHECKFAILED%' then
      raise;
    end if;
    raise exception 'CHECKFAILED the wrong error was raised: %', sqlerrm;
end $$;

do $$
begin
  perform public.record_compression('anon.txt', 'text/plain', 10, 5, 1.0, 1.0, 'huffman');
  raise exception 'CHECKFAILED an anonymous client recorded a compression';
exception
  when insufficient_privilege then
    null;                  -- refused, as it should be
  when others then
    if sqlerrm like '%CHECKFAILED%' then
      raise;
    end if;
    raise exception 'CHECKFAILED the wrong error was raised: %', sqlerrm;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 9. A blob can be read while its listing is active, and not once the
--    listing has been taken down — unless you are the seller.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :'student_b', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_b' || '","role":"authenticated"}', true);
set local role authenticated;

-- Student B can read the blob on student A's active listing: an
-- active listing is public, and a blob is no more visible than the
-- thing it belongs to.
do $$
declare
  v_back jsonb;
begin
  v_back := public.get_listing_image_blob(:'listing_a'::uuid);
  if v_back is null then
    raise exception 'CHECKFAILED an active listing''s blob could not be read';
  end if;
end $$;

reset role;

-- Take the listing down.
update public.listings
   set status = 'sold'
 where id = :'listing_a'::uuid;

select set_config('request.jwt.claim.sub', :'student_b', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_b' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_back jsonb;
begin
  v_back := public.get_listing_image_blob(:'listing_a'::uuid);
  if v_back is not null then
    raise exception 'CHECKFAILED the blob of a taken-down listing was readable by another student';
  end if;
end $$;

reset role;

-- The seller can still read their own taken-down listing.
select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_back jsonb;
begin
  v_back := public.get_listing_image_blob(:'listing_a'::uuid);
  if v_back is null then
    raise exception 'CHECKFAILED the seller could not read their own blob';
  end if;
end $$;

reset role;

-- Put it back, for the checks that follow.
update public.listings
   set status = 'active'
 where id = :'listing_a'::uuid;

-- ---------------------------------------------------------------------------
-- 10. The compression history is private to the student who made it.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  perform public.record_compression(
    'a-student-a.txt', 'text/plain', 1000, 400, 1.5, 0.5, 'huffman'
  );
  perform public.record_compression(
    'a-student-a-two.txt', 'text/plain', 2000, 900, 2.5, 1.0, 'huffman'
  );
end $$;

-- Student A sees their own two rows.
do $$
declare
  v_count int;
begin
  select count(*)::int into v_count
    from public.fetch_compression_history(20) h
   where h.owner_id = :'student_a'::uuid;

  if v_count < 2 then
    raise exception 'CHECKFAILED the student cannot read their own history: % rows', v_count;
  end if;

  -- And nobody else's.
  if exists (
    select 1 from public.fetch_compression_history(100) h
     where h.owner_id <> :'student_a'::uuid
  ) then
    raise exception 'CHECKFAILED the history shows rows belonging to another student';
  end if;
end $$;

reset role;

-- Student B sees none of them.
select set_config('request.jwt.claim.sub', :'student_b', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_b' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_count int;
begin
  select count(*)::int into v_count
    from public.fetch_compression_history(100) h
   where h.owner_id = :'student_a'::uuid;

  if v_count <> 0 then
    raise exception 'CHECKFAILED the history of another student was readable: % rows', v_count;
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 11. The campus totals count every row and expose nobody.
-- ---------------------------------------------------------------------------

do $$
declare
  v_expected jsonb;
  v_actual   jsonb;
begin
  select jsonb_build_object(
           'files', count(*)::int,
           'original_bytes', coalesce(sum(original_bytes), 0)::bigint,
           'compressed_bytes', coalesce(sum(compressed_bytes), 0)::bigint,
           'saved_bytes', coalesce(sum(original_bytes - compressed_bytes), 0)::bigint
         )
    into v_expected
    from public.compression_history;

  select jsonb_build_object(
           'files', t.files,
           'original_bytes', t.original_bytes,
           'compressed_bytes', t.compressed_bytes,
           'saved_bytes', t.saved_bytes
         )
    into v_actual
    from (select * from public.compression_totals) t;

  if (v_actual ->> 'files')::int <> (v_expected ->> 'files')::int
     or (v_actual ->> 'original_bytes')::bigint <> (v_expected ->> 'original_bytes')::bigint
     or (v_actual ->> 'compressed_bytes')::bigint <> (v_expected ->> 'compressed_bytes')::bigint
     or (v_actual ->> 'saved_bytes')::bigint <> (v_expected ->> 'saved_bytes')::bigint then
    raise exception 'CHECKFAILED the totals do not agree with the history: % vs %', v_actual, v_expected;
  end if;
end $$;

-- The view carries no column that names a student or a file. A total
-- is a public fact; the rows behind it are not.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'compression_totals'
       and column_name in ('owner_id', 'file_name', 'id')
  ) then
    raise exception 'CHECKFAILED the totals view exposes a column it should not';
  end if;
end $$;

-- And the total is the campus's, not the reader's.
--
-- The history's own policy lets a student read only their own rows. If
-- the view ran with the reader's rights — as `security_invoker` would
-- make it — every student would be told the campus had compressed
-- nothing, because none of them can see anybody else's rows.
--
-- The true count is taken first, while the suite can still see every
-- row, and then compared with what each reader is told.
select count(*)::int as total_history_rows
  from public.compression_history \gset

select set_config('request.jwt.claim.sub', :'student_b', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_b' || '","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_files int;
begin
  select (t.files)::int into v_files
    from (select * from public.compression_totals) t;

  if v_files <> :'total_history_rows'::int then
    raise exception 'CHECKFAILED the totals show % files, but the history holds %',
      v_files, :'total_history_rows';
  end if;

  if v_files = 0 then
    raise exception 'CHECKFAILED the totals are empty even though the history is not';
  end if;
end $$;

reset role;

-- An anonymous visitor sees the same total. The savings are a public
-- fact; the files behind them are not.
set local role anon;

do $$
declare
  v_files int;
begin
  select (t.files)::int into v_files
    from (select * from public.compression_totals) t;

  if v_files <> :'total_history_rows'::int then
    raise exception 'CHECKFAILED an anonymous visitor sees % files, but the history holds %',
      v_files, :'total_history_rows';
  end if;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 12. The codec column only accepts the two kinds it knows.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :'student_a', true);
select set_config('request.jwt.claims', '{"sub":"' || :'student_a' || '","role":"authenticated"}', true);
set local role authenticated;

insert into public.listing_images (listing_id, url, alt, sort, codec)
values (:'listing_a'::uuid, 'uhuf:' || :'listing_a'::uuid, 'A photo', 0, 'huffman');

insert into public.listing_images (listing_id, url, alt, sort, codec)
values (:'listing_a'::uuid, 'https://example.test/other.jpg', 'Another photo', 1, 'url');

do $$
begin
  insert into public.listing_images (listing_id, url, alt, sort, codec)
  values (:'listing_a'::uuid, 'https://example.test/bad.jpg', 'A bad codec', 2, 'zip');
  raise exception 'CHECKFAILED an unknown codec was accepted';
exception
  when check_violation then
    null;                  -- refused, as it should be
  when others then
    if sqlerrm like '%CHECKFAILED%' then
      raise;
    end if;
    raise exception 'CHECKFAILED the wrong error was raised: %', sqlerrm;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- 13. The tree the server was given is complete.
--
--     Every code length has to match the code it describes, and the
--     codes have to be prefix-free — otherwise the bit stream could
--     not be read back unambiguously. A tree that fails either test is
--     a tree that cannot decode what it claims to decode.
-- ---------------------------------------------------------------------------

do $$
declare
  v_back    jsonb;
  v_lengths jsonb;
  v_symbol  text;
  v_code    text;
  v_other   text;
begin
  v_back := public.get_listing_image_blob(:'listing_a'::uuid);
  v_lengths := v_back -> 'code_lengths';

  -- Every symbol in the lengths has a code, and the lengths are right.
  for v_symbol in select jsonb_object_keys(v_lengths)
  loop
    v_code := v_back -> 'tree' ->> v_symbol;

    if v_code is null then
      raise exception 'CHECKFAILED the tree has no code for symbol %', v_symbol;
    end if;

    if length(v_code) <> (v_lengths ->> v_symbol)::int then
      raise exception 'CHECKFAILED the code for symbol % is % bits long, but the length says %',
        v_symbol, length(v_code), v_lengths ->> v_symbol;
    end if;

    if v_code !~ '^[01]+$' then
      raise exception 'CHECKFAILED the code for symbol % is not a bit string: %', v_symbol, v_code;
    end if;
  end loop;

  -- The codes are prefix-free: no code is the beginning of another.
  for v_symbol in select jsonb_object_keys(v_lengths)
  loop
    v_code := v_back -> 'tree' ->> v_symbol;
    for v_other in select jsonb_object_keys(v_lengths)
    loop
      if v_symbol <> v_other
         and (v_back -> 'tree' ->> v_other) like v_code || '%'
      then
        raise exception 'CHECKFAILED the code for % is the prefix of the code for %', v_symbol, v_other;
      end if;
    end loop;
  end loop;

  -- And the Kraft sum cannot exceed one, or the codes could not all
  -- be told apart.
  if (
    select sum(1.0 / (2 ^ (v_lengths ->> s)::int))
      from jsonb_object_keys(v_lengths) as s
  ) > 1.0 + 0.0000001 then
    raise exception 'CHECKFAILED the codes cannot all be told apart — the Kraft sum is above one';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The scratch rows go. The transaction is rolled back anyway, but a
-- clean end makes the failure easier to read.
-- ---------------------------------------------------------------------------

delete from public.listing_image_blobs
 where listing_id in (:'listing_a'::uuid, :'listing_b'::uuid);

delete from public.listing_images
 where listing_id in (:'listing_a'::uuid, :'listing_b'::uuid);

delete from public.listings
 where id in (:'listing_a'::uuid, :'listing_b'::uuid);

delete from public.compression_history
 where file_name in ('a-student-a.txt', 'a-student-a-two.txt');

rollback;

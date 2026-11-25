-- ============================================================================
-- Chat — the conversation list and live delivery.
--
-- The chat tables were built for two students talking to each other, but
-- three things kept that from ever happening:
--
--   1. A conversation had no record of when it was last active, so the
--      inbox could not be ordered and "new message" could not be told
--      from "old message". `last_message_at` is that record, and a
--      trigger keeps it honest — the browser never has to write it.
--
--   2. The messages table was not published for realtime, so a message
--      was stored and then waited for. A conversation is a conversation
--      only when the other side sees the reply arrive.
--
--   3. Reading a whole conversation meant fetching every message from
--      two tables and stitching them in the browser. `conversation_inbox`
--      does it in the database: the other party, the item, the last
--      message and the unread count, in one round trip.
--
-- Nothing here changes the messages themselves. It makes the ones that
-- were already being written actually visible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- When a conversation was last alive.
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column if not exists last_message_at timestamptz not null default now();

comment on column public.conversations.last_message_at is
  'When the last message was sent. Maintained by a trigger, never by the client.';

-- The old `conversations_touch` trigger did exactly what
-- `conversations_updated_at` already did — bump updated_at. Two triggers
-- for one job is one too many.
drop trigger if exists conversations_touch on public.conversations;

-- ---------------------------------------------------------------------------
-- A message moves its conversation to the top of the inbox.
-- ---------------------------------------------------------------------------

create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         updated_at       = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- ---------------------------------------------------------------------------
-- The inbox.
--
-- One row per conversation the caller is part of: who the other side is,
-- what it is about, what was said last, and how much of it is unread.
--
-- It runs with the caller's rights (security invoker), so the row level
-- security on messages, listings and profiles still decides what is
-- visible. A student cannot read a conversation they are not in.
-- ---------------------------------------------------------------------------

create or replace function public.conversation_inbox()
returns table (
  id            uuid,
  listing_id    uuid,
  listing_title text,
  listing_price numeric,
  other_id      uuid,
  other_name    text,
  last_body     text,
  last_at       timestamptz,
  unread        int
)
language sql
stable
security invoker
set search_path = public
as $$
  select c.id,
         c.listing_id,
         l.title,
         l.price,
         case when c.buyer_id = auth.uid() then c.seller_id else c.buyer_id end,
         coalesce(other.full_name, 'Student'),
         m.body,
         coalesce(m.created_at, c.created_at),
         (
           select count(*)::int
             from public.messages x
            where x.conversation_id = c.id
              and x.sender_id <> auth.uid()
              and x.read_at is null
         )
    from public.conversations c
    join public.profiles other
      on other.id = case when c.buyer_id = auth.uid() then c.seller_id else c.buyer_id end
    left join public.listings l
      on l.id = c.listing_id
    left join lateral (
      select x.body, x.created_at
        from public.messages x
       where x.conversation_id = c.id
       order by x.created_at desc
       limit 1
    ) m on true
   where c.buyer_id = auth.uid() or c.seller_id = auth.uid()
   order by coalesce(m.created_at, c.created_at) desc;
$$;

comment on function public.conversation_inbox() is
  'The caller''s conversations: the other party, the item, the last message and the unread count.';

-- ---------------------------------------------------------------------------
-- Live delivery.
--
-- A message that is stored but never delivered is a message that waits.
-- Publishing the table is what makes the reply arrive in the other
-- student's open conversation.
-- ---------------------------------------------------------------------------

do $$
begin
  -- The local test harness has no realtime publication. Creating one
  -- keeps this migration honest in both places.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading a conversation marks it read.
--
-- The other side's unread count has to fall when the message is read,
-- not when it is sent.
-- ---------------------------------------------------------------------------

create or replace function public.mark_conversation_read(p_conversation uuid)
returns int
language sql
security invoker
set search_path = public
as $$
  with touched as (
    update public.messages
       set read_at = now()
     where conversation_id = p_conversation
       and sender_id <> auth.uid()
       and read_at is null
    returning 1
  )
  select count(*)::int from touched;
$$;

comment on function public.mark_conversation_read(uuid) is
  'Marks the other side''s messages as read. Returns how many were marked.';

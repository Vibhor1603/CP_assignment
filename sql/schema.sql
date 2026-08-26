-- Deadline Agent schema
-- Run once in the Supabase SQL Editor (or applied via migration).

create extension if not exists pg_trgm;

create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  course        text,
  due_date      date,
  weightage     text,
  status        text not null default 'confirmed',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists task_sources (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references tasks(id) on delete cascade,
  raw_message         text not null,
  claimed_due_date    date,
  claim_type          text not null,
  channel             text not null default 'unknown',
  received_at         timestamptz not null default now()
);

create index if not exists tasks_course_idx on tasks (course);
create index if not exists tasks_due_date_idx on tasks (due_date);
create index if not exists tasks_title_trgm_idx on tasks using gin (title gin_trgm_ops);
create index if not exists task_sources_task_id_idx on task_sources (task_id);

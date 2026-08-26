-- Wipe all task data for a clean demo. Keeps table structure.

truncate table task_sources restart identity cascade;
truncate table tasks restart identity cascade;

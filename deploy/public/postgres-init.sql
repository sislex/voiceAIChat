-- The storage service keeps its metadata in its own database: Core's embedded file
-- storage tables use the same storage_* names with a different layout.
CREATE DATABASE storage OWNER sislexa;

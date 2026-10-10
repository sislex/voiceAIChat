\set ON_ERROR_STOP on
UPDATE users
SET email = 'user-' || regexp_replace(name, '[^a-zA-Z0-9._-]', '-', 'g') || '@stand.invalid',
    password_hash = '', totp_secret = NULL, reset_code_hash = NULL,
    reset_code_expires = NULL, must_change_password = 1;
WITH first_admin AS (
  SELECT name FROM users ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, created_at, name LIMIT 1
)
-- The hash is produced by environment_stand.scrypt_password_hash: Identity verifies scrypt only.
UPDATE users SET role = 'admin', password_hash = :'admin_password_hash',
  must_change_password = 0, blocked = 0
WHERE name = (SELECT name FROM first_admin);
UPDATE app_config SET value = '' WHERE key ILIKE '%smtp%' OR key ILIKE '%integration%'
  OR key ILIKE '%webhook%' OR key ILIKE '%external%';

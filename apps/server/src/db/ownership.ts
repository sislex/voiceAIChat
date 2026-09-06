// Карта владения таблицами SQLite: у каждой таблицы ровно один доменный репозиторий
// (apps/server/src/db/repos/<домен>.ts), и только он имеет право писать в неё. Чужие таблицы
// репозиторий читает напрямую (JOIN) — это допускается, но считается и не должно расти;
// чужие записи — долг, перечисленный ниже поимённо. Проверяет ownership.test.ts; зачем всё
// это — docs/plans/db-repositories.md.
//
// Меняешь схему — сначала впиши таблицу сюда, иначе гейт не пропустит.

export type RepoDomain = 'identity' | 'settings' | 'llm' | 'chat' | 'machines' | 'projects' | 'tasks' | 'ci' | 'qa' | 'releases' | 'kb'

export const TABLE_OWNER: Record<RepoDomain, readonly string[]> = {
  identity: ['users', 'sessions', 'session_revocations', 'security_events', 'invites', 'email_verifications', 'password_reset_tokens', 'login_device_emails', 'user_llm_access'],
  settings: ['settings', 'app_config', 'schema_migrations'],
  llm: ['llm_engines', 'model_prices'],
  chat: ['conversations', 'messages', 'messages_fts', 'fts_state', 'speakers', 'conversation_context_events', 'conversation_draft_requests', 'conversation_turn_queue', 'conversation_turn_control', 'conversation_workspaces'],
  machines: ['agents', 'machine_commands', 'machine_events', 'machine_storages', 'chat_storage_bindings', 'generated_cleanup_retry', 'login_enrollments', 'machine_project_shares', 'machine_project_share_audit', 'project_machines', 'user_project_machine_defaults', 'git_workspace_locks'],
  projects: ['projects', 'project_members', 'project_member_role_audit', 'project_invitations', 'project_types', 'project_type_review_audit', 'kanban_columns', 'board_views'],
  tasks: ['tasks', 'task_comments', 'task_worklog', 'task_history', 'task_designs', 'task_creation_requests', 'task_creation_audit', 'task_improvements', 'task_rework_cycles', 'task_rework_attachments', 'task_repositories', 'task_launch_results', 'task_preparation_runs', 'task_preparation_events', 'task_preparation_steps', 'task_preparation_questions', 'task_preparation_notification_dismissals', 'assistant_orchestrations', 'assistant_orchestration_items'],
  ci: ['ci_commands', 'ci_slot_commands', 'ci_command_suggestions', 'ci_events', 'ci_fix_attempts', 'ci_gate_results', 'ci_interactions', 'ci_llm_configs', 'ci_stage_llm_configs', 'ci_run_kb_gaps', 'ci_run_kb_metrics', 'ci_run_logs', 'ci_run_steps', 'ci_run_tool_calls', 'ci_run_tool_responses', 'ci_run_usage', 'ci_runs', 'ci_settings', 'ci_stage_runs', 'ci_task_browser_checks', 'ci_task_process_stages', 'ci_test_events', 'ci_test_fix_cycles', 'ci_test_fix_decisions', 'ci_test_fix_targeted_runs', 'ci_test_fix_task_state', 'ci_test_group_configs', 'ci_test_group_runs', 'ci_test_runs', 'ci_test_targeted_runs', 'ci_workspaces', 'merge_runs', 'integration_test_runs', 'component_qa_runs'],
  qa: ['qa_sessions', 'qa_stage_runs', 'qa_preparation_runs', 'qa_criterion_results', 'qa_issues', 'qa_attachments', 'qa_audit', 'acceptance_criteria', 'acceptance_criterion_versions'],
  releases: ['project_releases', 'project_release_steps', 'project_release_events'],
  kb: ['kb_documents', 'kb_usage_queries', 'kb_usage_sections', 'kb_usage_views']
}

/**
 * Записи в чужие таблицы, которые пока живут внутри репозитория-не-владельца (каскады удаления
 * аккаунта и машины, создание проекта с заготовкой статьи KB, переходы задач из CI). Список —
 * трещотка: убрал запись из кода — убери и здесь, иначе тест упадёт и напомнит, что долг закрыт.
 */
export const KNOWN_CROSS_WRITES: Partial<Record<RepoDomain, readonly string[]>> = {
  identity: ['agents', 'conversations', 'project_invitations', 'project_members', 'projects', 'settings', 'tasks'],
  machines: ['ci_runs', 'ci_test_runs', 'ci_workspaces', 'conversation_workspaces', 'conversations', 'projects'],
  projects: ['kb_documents', 'tasks'],
  tasks: ['projects'],
  ci: ['task_preparation_runs', 'tasks']
}

/** Сколько чужих таблиц репозиторий читает напрямую. Верхняя планка; снижать можно, повышать — с обоснованием в PR. */
export const CROSS_READ_BUDGET: Record<RepoDomain, number> = {
  identity: 5,
  settings: 0,
  llm: 0,
  chat: 5,
  machines: 4,
  projects: 5,
  tasks: 17,
  ci: 7,
  qa: 4,
  releases: 0,
  kb: 3
}

--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: messages_cost_dirty(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.messages_cost_dirty() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE conversations SET cost_dirty = 1 WHERE id = OLD.conversation_id;
  ELSE
    UPDATE conversations SET cost_dirty = 1 WHERE id = NEW.conversation_id;
  END IF;
  RETURN NULL;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: acceptance_criteria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acceptance_criteria (
    id text NOT NULL,
    task_id text NOT NULL,
    "position" bigint NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    preconditions text DEFAULT ''::text NOT NULL,
    steps text DEFAULT ''::text NOT NULL,
    test_data text DEFAULT ''::text NOT NULL,
    expected_result text DEFAULT ''::text NOT NULL,
    required bigint DEFAULT 1 NOT NULL,
    test_type text DEFAULT 'manual'::text NOT NULL,
    current_version bigint DEFAULT 1 NOT NULL,
    active bigint DEFAULT 1 NOT NULL,
    author text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: acceptance_criteria_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acceptance_criteria_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acceptance_criteria_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acceptance_criteria_rowid_seq OWNED BY public.acceptance_criteria.rowid;


--
-- Name: acceptance_criterion_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.acceptance_criterion_versions (
    criterion_id text NOT NULL,
    version bigint NOT NULL,
    snapshot_json text NOT NULL,
    author text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_at bigint NOT NULL,
    superseded_by bigint,
    rowid bigint NOT NULL
);


--
-- Name: acceptance_criterion_versions_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.acceptance_criterion_versions_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: acceptance_criterion_versions_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.acceptance_criterion_versions_rowid_seq OWNED BY public.acceptance_criterion_versions.rowid;


--
-- Name: agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agents (
    id text NOT NULL,
    name text NOT NULL,
    token_hash text NOT NULL,
    created_at bigint NOT NULL,
    last_seen bigint,
    policy text,
    user_id text,
    token_expires_at bigint,
    token_issued_at bigint,
    last_ip text,
    pin_ip bigint DEFAULT 0 NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: agents_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.agents_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: agents_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.agents_rowid_seq OWNED BY public.agents.rowid;


--
-- Name: app_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_config (
    key text NOT NULL,
    value text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: app_config_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.app_config_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: app_config_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.app_config_rowid_seq OWNED BY public.app_config.rowid;


--
-- Name: application_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_audit (
    id text NOT NULL,
    application_id text NOT NULL,
    grant_id text,
    actor_user_name text,
    action text NOT NULL,
    at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: application_audit_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.application_audit_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: application_audit_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.application_audit_rowid_seq OWNED BY public.application_audit.rowid;


--
-- Name: application_deployments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_deployments (
    id text NOT NULL,
    project_id text NOT NULL,
    environment text NOT NULL,
    request_id text NOT NULL,
    request_json text NOT NULL,
    record_json text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: application_deployments_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.application_deployments_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: application_deployments_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.application_deployments_rowid_seq OWNED BY public.application_deployments.rowid;


--
-- Name: application_environments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_environments (
    project_id text NOT NULL,
    environment text NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    state_json text NOT NULL,
    active_deployment_id text,
    rowid bigint NOT NULL
);


--
-- Name: application_environments_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.application_environments_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: application_environments_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.application_environments_rowid_seq OWNED BY public.application_environments.rowid;


--
-- Name: application_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_grants (
    id text NOT NULL,
    application_id text NOT NULL,
    user_name text NOT NULL,
    tenant_id text NOT NULL,
    audience text NOT NULL,
    permissions text NOT NULL,
    token_hash text NOT NULL,
    issued_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    revoked_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: application_grants_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.application_grants_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: application_grants_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.application_grants_rowid_seq OWNED BY public.application_grants.rowid;


--
-- Name: application_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_releases (
    id text NOT NULL,
    project_id text NOT NULL,
    application_id text NOT NULL,
    version text NOT NULL,
    record_json text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: application_releases_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.application_releases_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: application_releases_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.application_releases_rowid_seq OWNED BY public.application_releases.rowid;


--
-- Name: applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applications (
    id text NOT NULL,
    owner_user_name text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    created_at bigint NOT NULL,
    revoked_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: applications_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.applications_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: applications_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.applications_rowid_seq OWNED BY public.applications.rowid;


--
-- Name: assistant_orchestration_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_orchestration_items (
    id text NOT NULL,
    orchestration_id text NOT NULL,
    "position" bigint NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    task_id text,
    depends_on_json text DEFAULT '[]'::text NOT NULL,
    payload_json text DEFAULT '{}'::text NOT NULL,
    status text NOT NULL,
    attempts bigint DEFAULT 0 NOT NULL,
    run_id text,
    result_json text,
    error text,
    started_at bigint,
    finished_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: assistant_orchestration_items_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.assistant_orchestration_items_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assistant_orchestration_items_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.assistant_orchestration_items_rowid_seq OWNED BY public.assistant_orchestration_items.rowid;


--
-- Name: assistant_orchestrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assistant_orchestrations (
    id text NOT NULL,
    project_id text NOT NULL,
    conversation_id text,
    owner text NOT NULL,
    title text NOT NULL,
    status text NOT NULL,
    error text,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: assistant_orchestrations_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.assistant_orchestrations_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assistant_orchestrations_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.assistant_orchestrations_rowid_seq OWNED BY public.assistant_orchestrations.rowid;


--
-- Name: board_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_views (
    username text NOT NULL,
    project_id text NOT NULL,
    value text NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: board_views_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.board_views_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: board_views_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.board_views_rowid_seq OWNED BY public.board_views.rowid;


--
-- Name: browser_ui_release_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.browser_ui_release_operations (
    id text NOT NULL,
    project_id text NOT NULL,
    request_id text NOT NULL,
    record_json text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: browser_ui_release_operations_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.browser_ui_release_operations_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: browser_ui_release_operations_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.browser_ui_release_operations_rowid_seq OWNED BY public.browser_ui_release_operations.rowid;


--
-- Name: chat_storage_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_storage_bindings (
    conversation_id text NOT NULL,
    machine_id text NOT NULL,
    storage_id text NOT NULL,
    relative_path text NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: chat_storage_bindings_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_storage_bindings_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_storage_bindings_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_storage_bindings_rowid_seq OWNED BY public.chat_storage_bindings.rowid;


--
-- Name: ci_command_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_command_suggestions (
    id text NOT NULL,
    command_id text NOT NULL,
    run_step_id text,
    reason text DEFAULT ''::text NOT NULL,
    proposed_script text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    occurrences bigint DEFAULT 1 NOT NULL,
    created_at bigint NOT NULL,
    resolved_by text,
    resolved_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: ci_command_suggestions_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_command_suggestions_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_command_suggestions_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_command_suggestions_rowid_seq OWNED BY public.ci_command_suggestions.rowid;


--
-- Name: ci_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_commands (
    id text NOT NULL,
    scope text DEFAULT 'project'::text NOT NULL,
    project_id text,
    name text NOT NULL,
    script text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    workdir text DEFAULT ''::text NOT NULL,
    timeout_sec bigint,
    env_json text DEFAULT '{}'::text NOT NULL,
    allow_failure bigint DEFAULT 0 NOT NULL,
    is_cleanup bigint DEFAULT 0 NOT NULL,
    available_to_model bigint DEFAULT 1 NOT NULL,
    is_test bigint DEFAULT 0 NOT NULL,
    builtin text,
    version bigint DEFAULT 1 NOT NULL,
    created_by text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    deleted_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: ci_commands_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_commands_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_commands_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_commands_rowid_seq OWNED BY public.ci_commands.rowid;


--
-- Name: ci_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_events (
    id text NOT NULL,
    project_id text NOT NULL,
    run_id text,
    command_id text,
    type text NOT NULL,
    actor_type text NOT NULL,
    actor_id text,
    payload text DEFAULT '{}'::text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_events_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_events_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_events_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_events_rowid_seq OWNED BY public.ci_events.rowid;


--
-- Name: ci_fix_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_fix_attempts (
    id text NOT NULL,
    run_step_id text NOT NULL,
    attempt_no bigint NOT NULL,
    diagnosis text DEFAULT ''::text NOT NULL,
    action text DEFAULT ''::text NOT NULL,
    result text DEFAULT 'retrying'::text NOT NULL,
    diff text,
    changed_files_json text DEFAULT '[]'::text NOT NULL,
    targeted_tests_json text DEFAULT '[]'::text NOT NULL,
    full_rerun_json text,
    failures_json text DEFAULT '[]'::text NOT NULL,
    duration_ms bigint,
    tokens_used bigint,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_fix_attempts_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_fix_attempts_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_fix_attempts_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_fix_attempts_rowid_seq OWNED BY public.ci_fix_attempts.rowid;


--
-- Name: ci_gate_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_gate_results (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    commit_sha text NOT NULL,
    signature text NOT NULL,
    commands_json text DEFAULT '[]'::text NOT NULL,
    run_kind text NOT NULL,
    run_id text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_gate_results_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_gate_results_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_gate_results_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_gate_results_rowid_seq OWNED BY public.ci_gate_results.rowid;


--
-- Name: ci_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_interactions (
    id text NOT NULL,
    run_id text NOT NULL,
    step_id text NOT NULL,
    seq bigint NOT NULL,
    kind text NOT NULL,
    questions_json text DEFAULT '[]'::text NOT NULL,
    plan_text text,
    answer_text text,
    decision text,
    status text DEFAULT 'pending'::text NOT NULL,
    conversation_id text,
    message_id text,
    created_at bigint NOT NULL,
    answered_at bigint,
    answered_by text,
    rowid bigint NOT NULL
);


--
-- Name: ci_interactions_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_interactions_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_interactions_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_interactions_rowid_seq OWNED BY public.ci_interactions.rowid;


--
-- Name: ci_llm_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_llm_configs (
    owner_type text NOT NULL,
    owner_id text NOT NULL,
    llm_engine_id text,
    provider text NOT NULL,
    model text NOT NULL,
    mode text DEFAULT 'development'::text NOT NULL,
    clarify_level text DEFAULT 'few'::text NOT NULL,
    clarify_max bigint DEFAULT 3 NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_llm_configs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_llm_configs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_llm_configs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_llm_configs_rowid_seq OWNED BY public.ci_llm_configs.rowid;


--
-- Name: ci_run_kb_gaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_run_kb_gaps (
    run_id text NOT NULL,
    question text NOT NULL,
    answer text DEFAULT ''::text NOT NULL,
    topic text,
    step_id text,
    at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_run_kb_gaps_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_run_kb_gaps_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_run_kb_gaps_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_run_kb_gaps_rowid_seq OWNED BY public.ci_run_kb_gaps.rowid;


--
-- Name: ci_run_kb_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_run_kb_metrics (
    run_id text NOT NULL,
    sections_delivered bigint NOT NULL,
    sections_hit bigint NOT NULL,
    hit_ratio double precision NOT NULL,
    calculated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_run_kb_metrics_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_run_kb_metrics_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_run_kb_metrics_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_run_kb_metrics_rowid_seq OWNED BY public.ci_run_kb_metrics.rowid;


--
-- Name: ci_run_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_run_logs (
    id text NOT NULL,
    run_id text NOT NULL,
    step_id text NOT NULL,
    seq bigint NOT NULL,
    stream text DEFAULT 'stdout'::text NOT NULL,
    chunk text NOT NULL,
    at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_run_logs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_run_logs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_run_logs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_run_logs_rowid_seq OWNED BY public.ci_run_logs.rowid;


--
-- Name: ci_run_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_run_steps (
    id text NOT NULL,
    run_id text NOT NULL,
    slot text,
    "position" bigint NOT NULL,
    kind text NOT NULL,
    parent_step_id text,
    initiated_by text DEFAULT 'system'::text NOT NULL,
    command_id text,
    command_snapshot text,
    title text DEFAULT ''::text NOT NULL,
    workdir text,
    status text DEFAULT 'queued'::text NOT NULL,
    exit_code bigint,
    attempt bigint DEFAULT 1 NOT NULL,
    fixed_by_model bigint DEFAULT 0 NOT NULL,
    started_at bigint,
    finished_at bigint,
    duration_ms bigint,
    rowid bigint NOT NULL
);


--
-- Name: ci_run_steps_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_run_steps_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_run_steps_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_run_steps_rowid_seq OWNED BY public.ci_run_steps.rowid;


--
-- Name: ci_run_tool_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_run_tool_calls (
    run_id text NOT NULL,
    tool text NOT NULL,
    calls bigint DEFAULT 0 NOT NULL,
    chars bigint DEFAULT 0 NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_run_tool_calls_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_run_tool_calls_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_run_tool_calls_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_run_tool_calls_rowid_seq OWNED BY public.ci_run_tool_calls.rowid;


--
-- Name: ci_run_tool_responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_run_tool_responses (
    id text NOT NULL,
    run_id text NOT NULL,
    step_id text,
    tool text DEFAULT ''::text NOT NULL,
    kind text DEFAULT 'other'::text NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    chars bigint DEFAULT 0 NOT NULL,
    original_chars bigint,
    at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_run_tool_responses_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_run_tool_responses_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_run_tool_responses_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_run_tool_responses_rowid_seq OWNED BY public.ci_run_tool_responses.rowid;


--
-- Name: ci_run_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_run_usage (
    id text NOT NULL,
    run_id text NOT NULL,
    step_id text,
    kind text DEFAULT 'model_work'::text NOT NULL,
    provider text DEFAULT 'claude'::text NOT NULL,
    model text DEFAULT ''::text NOT NULL,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    cache_read_tokens bigint DEFAULT 0 NOT NULL,
    cache_creation_tokens bigint DEFAULT 0 NOT NULL,
    cost_usd double precision,
    duration_ms bigint,
    num_turns bigint,
    input_semantics text,
    at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_run_usage_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_run_usage_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_run_usage_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_run_usage_rowid_seq OWNED BY public.ci_run_usage.rowid;


--
-- Name: ci_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_runs (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    agent_id text,
    agent_owner_id text,
    agent_owner_name text,
    agent_selection_source text,
    status text DEFAULT 'queued'::text NOT NULL,
    error text,
    workspace_id text,
    triggered_by text NOT NULL,
    prev_column_id text,
    run_column_id text,
    terminal_column_id text,
    llm_engine_id text,
    llm_provider text DEFAULT 'claude'::text NOT NULL,
    llm_model text DEFAULT 'opus'::text NOT NULL,
    mode text DEFAULT 'development'::text NOT NULL,
    clarify_level text DEFAULT 'few'::text NOT NULL,
    clarify_max bigint DEFAULT 3 NOT NULL,
    conversation_id text,
    model_session_id text,
    fix_context_json text,
    kb_context_mode text DEFAULT 'auto'::text NOT NULL,
    slot_progress_json text DEFAULT '{}'::text NOT NULL,
    started_at bigint,
    finished_at bigint,
    duration_ms bigint,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_runs_rowid_seq OWNED BY public.ci_runs.rowid;


--
-- Name: ci_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_settings (
    id bigint NOT NULL,
    max_fix_attempts bigint NOT NULL,
    fix_time_limit_ms bigint NOT NULL,
    fix_token_limit bigint NOT NULL,
    default_step_timeout_sec bigint NOT NULL,
    metrics_window bigint NOT NULL,
    max_concurrent_runs bigint NOT NULL,
    max_model_command_calls bigint NOT NULL,
    interaction_wait_ms bigint DEFAULT 1800000 NOT NULL,
    stage_models text,
    bash_output_limit_chars bigint DEFAULT 8000 NOT NULL,
    read_output_limit_chars bigint DEFAULT 24000 NOT NULL,
    read_window_max_lines bigint DEFAULT 600 NOT NULL,
    grep_match_limit bigint DEFAULT 100 NOT NULL,
    grep_output_limit_chars bigint DEFAULT 8000 NOT NULL,
    rowid bigint NOT NULL,
    CONSTRAINT ci_settings_id_check CHECK ((id = 1))
);


--
-- Name: ci_settings_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_settings_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_settings_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_settings_rowid_seq OWNED BY public.ci_settings.rowid;


--
-- Name: ci_slot_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_slot_commands (
    id text NOT NULL,
    owner_type text NOT NULL,
    owner_id text NOT NULL,
    slot text NOT NULL,
    command_id text NOT NULL,
    "position" bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_slot_commands_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_slot_commands_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_slot_commands_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_slot_commands_rowid_seq OWNED BY public.ci_slot_commands.rowid;


--
-- Name: ci_stage_llm_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_stage_llm_configs (
    owner_type text NOT NULL,
    owner_id text NOT NULL,
    stage text NOT NULL,
    llm_engine_id text,
    provider text,
    model text,
    rowid bigint NOT NULL
);


--
-- Name: ci_stage_llm_configs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_stage_llm_configs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_stage_llm_configs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_stage_llm_configs_rowid_seq OWNED BY public.ci_stage_llm_configs.rowid;


--
-- Name: ci_stage_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_stage_runs (
    id text NOT NULL,
    run_id text NOT NULL,
    task_id text NOT NULL,
    stage text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    llm_engine_id text,
    llm_provider text NOT NULL,
    llm_model text NOT NULL,
    outcome text,
    started_at bigint,
    finished_at bigint,
    duration_ms bigint,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_stage_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_stage_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_stage_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_stage_runs_rowid_seq OWNED BY public.ci_stage_runs.rowid;


--
-- Name: ci_task_browser_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_task_browser_checks (
    task_id text NOT NULL,
    check_json text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_task_browser_checks_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_task_browser_checks_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_task_browser_checks_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_task_browser_checks_rowid_seq OWNED BY public.ci_task_browser_checks.rowid;


--
-- Name: ci_task_process_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_task_process_stages (
    task_id text NOT NULL,
    stages_json text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_task_process_stages_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_task_process_stages_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_task_process_stages_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_task_process_stages_rowid_seq OWNED BY public.ci_task_process_stages.rowid;


--
-- Name: ci_test_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_test_events (
    id text NOT NULL,
    run_id text NOT NULL,
    group_id text,
    type text NOT NULL,
    user_id text,
    payload text DEFAULT '{}'::text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_test_events_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_test_events_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_test_events_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_test_events_rowid_seq OWNED BY public.ci_test_events.rowid;


--
-- Name: ci_test_fix_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_test_fix_cycles (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    test_run_id text NOT NULL,
    failed_group_id text NOT NULL,
    source_commit_sha text NOT NULL,
    attempt_no bigint NOT NULL,
    effective_limit bigint NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    classification text NOT NULL,
    failures_json text DEFAULT '[]'::text NOT NULL,
    llm_engine_id text,
    llm_provider text NOT NULL,
    llm_model text NOT NULL,
    model_session_id text,
    diagnosis text DEFAULT ''::text NOT NULL,
    action text DEFAULT ''::text NOT NULL,
    changed_files_json text DEFAULT '[]'::text NOT NULL,
    fix_commit_sha text,
    next_test_run_id text,
    full_test_result text,
    blocked_reason text,
    created_at bigint NOT NULL,
    started_at bigint,
    finished_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: ci_test_fix_cycles_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_test_fix_cycles_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_test_fix_cycles_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_test_fix_cycles_rowid_seq OWNED BY public.ci_test_fix_cycles.rowid;


--
-- Name: ci_test_fix_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_test_fix_decisions (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    cycle_id text,
    kind text NOT NULL,
    reason text NOT NULL,
    user_id text NOT NULL,
    old_value bigint,
    new_value bigint,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_test_fix_decisions_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_test_fix_decisions_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_test_fix_decisions_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_test_fix_decisions_rowid_seq OWNED BY public.ci_test_fix_decisions.rowid;


--
-- Name: ci_test_fix_targeted_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_test_fix_targeted_runs (
    id text NOT NULL,
    fix_cycle_id text NOT NULL,
    command text NOT NULL,
    status text NOT NULL,
    exit_code bigint,
    log text DEFAULT ''::text NOT NULL,
    started_at bigint NOT NULL,
    finished_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: ci_test_fix_targeted_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_test_fix_targeted_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_test_fix_targeted_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_test_fix_targeted_runs_rowid_seq OWNED BY public.ci_test_fix_targeted_runs.rowid;


--
-- Name: ci_test_fix_task_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_test_fix_task_state (
    task_id text NOT NULL,
    used_attempts bigint DEFAULT 0 NOT NULL,
    override_limit bigint,
    active_cycle_id text,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL,
    CONSTRAINT ci_test_fix_task_state_override_limit_check CHECK (((override_limit IS NULL) OR (override_limit >= 0))),
    CONSTRAINT ci_test_fix_task_state_used_attempts_check CHECK ((used_attempts >= 0))
);


--
-- Name: ci_test_fix_task_state_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_test_fix_task_state_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_test_fix_task_state_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_test_fix_task_state_rowid_seq OWNED BY public.ci_test_fix_task_state.rowid;


--
-- Name: ci_test_group_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_test_group_configs (
    id text NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    command text NOT NULL,
    command_version bigint DEFAULT 1 NOT NULL,
    "position" bigint NOT NULL,
    required bigint DEFAULT 1 NOT NULL,
    applicability text DEFAULT 'always'::text NOT NULL,
    enabled bigint DEFAULT 1 NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_test_group_configs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_test_group_configs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_test_group_configs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_test_group_configs_rowid_seq OWNED BY public.ci_test_group_configs.rowid;


--
-- Name: ci_test_group_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_test_group_runs (
    id text NOT NULL,
    test_run_id text NOT NULL,
    config_id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    command text NOT NULL,
    command_version bigint NOT NULL,
    "position" bigint NOT NULL,
    required bigint NOT NULL,
    status text NOT NULL,
    commit_sha text NOT NULL,
    started_at bigint,
    finished_at bigint,
    duration_ms bigint,
    exit_code bigint,
    counters_json text DEFAULT '{}'::text NOT NULL,
    current_suite text,
    current_test text,
    progress double precision,
    log text DEFAULT ''::text NOT NULL,
    failures_json text DEFAULT '[]'::text NOT NULL,
    artifacts_json text DEFAULT '[]'::text NOT NULL,
    skip_reason text,
    not_applicable_json text,
    browser_project text,
    base_url text,
    test_data text,
    rowid bigint NOT NULL
);


--
-- Name: ci_test_group_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_test_group_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_test_group_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_test_group_runs_rowid_seq OWNED BY public.ci_test_group_runs.rowid;


--
-- Name: ci_test_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_test_runs (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    branch text NOT NULL,
    commit_sha text NOT NULL,
    workspace text NOT NULL,
    agent_id text,
    preview_id text,
    preview_commit_sha text,
    analysis_model text NOT NULL,
    triggered_by text NOT NULL,
    attempt bigint NOT NULL,
    previous_run_id text,
    status text NOT NULL,
    current_group_id text,
    started_at bigint,
    finished_at bigint,
    duration_ms bigint,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_test_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_test_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_test_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_test_runs_rowid_seq OWNED BY public.ci_test_runs.rowid;


--
-- Name: ci_test_targeted_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_test_targeted_runs (
    id text NOT NULL,
    run_id text NOT NULL,
    group_id text NOT NULL,
    command text NOT NULL,
    exit_code bigint,
    result_json text DEFAULT '{}'::text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: ci_test_targeted_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_test_targeted_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_test_targeted_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_test_targeted_runs_rowid_seq OWNED BY public.ci_test_targeted_runs.rowid;


--
-- Name: ci_workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ci_workspaces (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    agent_id text,
    path text NOT NULL,
    npm_cache_dir text,
    branch text,
    commit_sha text,
    pushed bigint DEFAULT 0 NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    size_bytes bigint,
    created_at bigint NOT NULL,
    released_by_step_id text,
    rowid bigint NOT NULL
);


--
-- Name: ci_workspaces_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ci_workspaces_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ci_workspaces_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ci_workspaces_rowid_seq OWNED BY public.ci_workspaces.rowid;


--
-- Name: component_qa_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.component_qa_runs (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    development_run_id text NOT NULL,
    linked_fix_run_id text,
    branch text NOT NULL,
    commit_sha text NOT NULL,
    attempt bigint NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    ui_impact text NOT NULL,
    readiness_run_id text NOT NULL,
    readiness_version text NOT NULL,
    scenarios_json text DEFAULT '[]'::text NOT NULL,
    components_json text DEFAULT '[]'::text NOT NULL,
    commands_json text DEFAULT '[]'::text NOT NULL,
    artifacts_json text DEFAULT '[]'::text NOT NULL,
    failure_classification text,
    blocker_reasons_json text DEFAULT '[]'::text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    log text DEFAULT ''::text NOT NULL,
    storybook_url text,
    created_at bigint NOT NULL,
    started_at bigint,
    finished_at bigint,
    stale_reason text,
    rowid bigint NOT NULL
);


--
-- Name: component_qa_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.component_qa_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: component_qa_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.component_qa_runs_rowid_seq OWNED BY public.component_qa_runs.rowid;


--
-- Name: conversation_context_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_context_events (
    id bigint NOT NULL,
    at bigint NOT NULL,
    conversation_id text NOT NULL,
    user_id text NOT NULL,
    actor text NOT NULL,
    item_id text NOT NULL,
    enabled bigint NOT NULL,
    value text,
    rowid bigint GENERATED ALWAYS AS (id) STORED
);


--
-- Name: conversation_context_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_context_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_context_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_context_events_id_seq OWNED BY public.conversation_context_events.id;


--
-- Name: conversation_draft_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_draft_requests (
    user_id text NOT NULL,
    idempotency_key text NOT NULL,
    conversation_id text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: conversation_draft_requests_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_draft_requests_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_draft_requests_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_draft_requests_rowid_seq OWNED BY public.conversation_draft_requests.rowid;


--
-- Name: conversation_group_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_group_memberships (
    group_id text NOT NULL,
    conversation_id text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: conversation_group_memberships_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_group_memberships_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_group_memberships_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_group_memberships_rowid_seq OWNED BY public.conversation_group_memberships.rowid;


--
-- Name: conversation_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_groups (
    id text NOT NULL,
    tenant_id text NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    "position" bigint NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL,
    CONSTRAINT conversation_groups_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0))
);


--
-- Name: conversation_groups_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_groups_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_groups_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_groups_rowid_seq OWNED BY public.conversation_groups.rowid;


--
-- Name: conversation_turn_control; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_turn_control (
    conversation_id text NOT NULL,
    paused bigint DEFAULT 0 NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: conversation_turn_control_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_turn_control_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_turn_control_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_turn_control_rowid_seq OWNED BY public.conversation_turn_control.rowid;


--
-- Name: conversation_turn_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_turn_queue (
    id text NOT NULL,
    conversation_id text NOT NULL,
    user_id text NOT NULL,
    message_id text NOT NULL,
    payload text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    "position" bigint NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: conversation_turn_queue_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_turn_queue_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_turn_queue_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_turn_queue_rowid_seq OWNED BY public.conversation_turn_queue.rowid;


--
-- Name: conversation_workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_workspaces (
    conversation_id text NOT NULL,
    project_id text NOT NULL,
    machine_id text NOT NULL,
    storage_id text NOT NULL,
    mode text NOT NULL,
    base_sha text NOT NULL,
    branch text NOT NULL,
    repository_path text NOT NULL,
    state text NOT NULL,
    diagnostic text,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: conversation_workspaces_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversation_workspaces_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversation_workspaces_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversation_workspaces_rowid_seq OWNED BY public.conversation_workspaces.rowid;


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id text NOT NULL,
    tenant_id text,
    title text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    claude_session_id text,
    user_id text,
    exec_target text,
    workdir text,
    skill_names text DEFAULT '[]'::text NOT NULL,
    llm_engine_id text,
    llm_provider text,
    llm_model text,
    reasoning_effort text DEFAULT 'medium'::text NOT NULL,
    deep_thinking bigint DEFAULT 0 NOT NULL,
    kb_context_mode text DEFAULT 'auto'::text NOT NULL,
    assistant_mode text DEFAULT 'workspace'::text NOT NULL,
    disabled_context_json text DEFAULT '[]'::text NOT NULL,
    project_id text,
    preview_url text,
    preview_engine text DEFAULT 'proxy'::text NOT NULL,
    make_browser_session text,
    task_id text,
    assistant_kind text,
    scope text DEFAULT 'chat'::text NOT NULL,
    assistant_autonomy text,
    status text DEFAULT 'developing'::text NOT NULL,
    cost_usd double precision,
    cost_status text,
    cost_prices_stamp bigint,
    cost_dirty bigint DEFAULT 1 NOT NULL,
    permission_mode text,
    archived_at bigint,
    summary_text text,
    summary_covers_message_id text,
    summary_updated_at bigint,
    summary_source text,
    context_usage_json text,
    rowid bigint NOT NULL,
    CONSTRAINT conversations_scope_check CHECK ((scope = ANY (ARRAY['chat'::text, 'kanban'::text, 'make'::text, 'images'::text, 'console'::text, 'playwright-reader'::text, 'web-reader'::text])))
);


--
-- Name: conversations_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.conversations_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: conversations_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.conversations_rowid_seq OWNED BY public.conversations.rowid;


--
-- Name: email_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verifications (
    token_hash text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: email_verifications_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_verifications_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_verifications_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_verifications_rowid_seq OWNED BY public.email_verifications.rowid;


--
-- Name: environment_configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environment_configurations (
    id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    revision bigint NOT NULL,
    modules_json text NOT NULL,
    note text,
    core_json text,
    created_by text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: environment_configurations_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.environment_configurations_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: environment_configurations_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.environment_configurations_rowid_seq OWNED BY public.environment_configurations.rowid;


--
-- Name: environment_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environment_links (
    id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    client_machine_id text NOT NULL,
    server_machine_id text NOT NULL,
    service_port bigint NOT NULL,
    listener_port bigint NOT NULL,
    transport text DEFAULT 'tunnel'::text NOT NULL,
    address text DEFAULT ''::text NOT NULL,
    state text DEFAULT 'down'::text NOT NULL,
    rowid bigint NOT NULL,
    CONSTRAINT environment_links_listener_port_check CHECK (((listener_port >= 1) AND (listener_port <= 65535))),
    CONSTRAINT environment_links_service_port_check CHECK (((service_port >= 1) AND (service_port <= 65535))),
    CONSTRAINT environment_links_state_check CHECK ((state = ANY (ARRAY['open'::text, 'down'::text]))),
    CONSTRAINT environment_links_transport_check CHECK ((transport = ANY (ARRAY['vpn'::text, 'tunnel'::text])))
);


--
-- Name: environment_links_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.environment_links_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: environment_links_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.environment_links_rowid_seq OWNED BY public.environment_links.rowid;


--
-- Name: environment_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environment_operations (
    id text NOT NULL,
    project_id text NOT NULL,
    environment_id text NOT NULL,
    configuration_id text NOT NULL,
    previous_configuration_id text,
    kind text DEFAULT 'apply'::text NOT NULL,
    status text NOT NULL,
    steps_json text DEFAULT '[]'::text NOT NULL,
    error text,
    started_by text NOT NULL,
    started_at bigint NOT NULL,
    finished_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: environment_operations_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.environment_operations_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: environment_operations_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.environment_operations_rowid_seq OWNED BY public.environment_operations.rowid;


--
-- Name: environment_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environment_settings (
    project_id text NOT NULL,
    environment_id text NOT NULL,
    key text NOT NULL,
    secret bigint DEFAULT 0 NOT NULL,
    value text NOT NULL,
    source text NOT NULL,
    updated_by text NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: environment_settings_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.environment_settings_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: environment_settings_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.environment_settings_rowid_seq OWNED BY public.environment_settings.rowid;


--
-- Name: environments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.environments (
    id text NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    machines_json text NOT NULL,
    checkout_path text NOT NULL,
    mode text DEFAULT 'external'::text NOT NULL,
    storage_id text,
    state text DEFAULT 'ready'::text NOT NULL,
    compose_project text,
    port bigint,
    created_by text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: environments_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.environments_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: environments_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.environments_rowid_seq OWNED BY public.environments.rowid;


--
-- Name: fts_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fts_state (
    name text NOT NULL,
    last_rowid bigint DEFAULT 0 NOT NULL,
    max_rowid bigint DEFAULT 0 NOT NULL,
    done bigint DEFAULT 0 NOT NULL,
    repairs bigint DEFAULT 0 NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: fts_state_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fts_state_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fts_state_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fts_state_rowid_seq OWNED BY public.fts_state.rowid;


--
-- Name: generated_cleanup_retry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_cleanup_retry (
    conversation_id text NOT NULL,
    user_id text NOT NULL,
    attempts bigint DEFAULT 0 NOT NULL,
    last_error text NOT NULL,
    next_attempt_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: generated_cleanup_retry_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.generated_cleanup_retry_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: generated_cleanup_retry_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.generated_cleanup_retry_rowid_seq OWNED BY public.generated_cleanup_retry.rowid;


--
-- Name: git_workspace_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.git_workspace_locks (
    agent_id text NOT NULL,
    path text NOT NULL,
    holder text NOT NULL,
    operation text NOT NULL,
    acquired_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: git_workspace_locks_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.git_workspace_locks_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: git_workspace_locks_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.git_workspace_locks_rowid_seq OWNED BY public.git_workspace_locks.rowid;


--
-- Name: identity_sign_in_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_sign_in_tickets (
    digest text NOT NULL,
    core_id text NOT NULL,
    realm text NOT NULL,
    callback_url text NOT NULL,
    challenge text NOT NULL,
    session_sid text NOT NULL,
    user_name text NOT NULL,
    expires_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: identity_sign_in_tickets_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.identity_sign_in_tickets_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: identity_sign_in_tickets_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.identity_sign_in_tickets_rowid_seq OWNED BY public.identity_sign_in_tickets.rowid;


--
-- Name: identity_subjects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_subjects (
    id text NOT NULL,
    user_name text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: identity_subjects_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.identity_subjects_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: identity_subjects_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.identity_subjects_rowid_seq OWNED BY public.identity_subjects.rowid;


--
-- Name: integration_test_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_test_runs (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    development_run_id text,
    linked_fix_run_id text,
    branch text NOT NULL,
    commit_sha text NOT NULL,
    attempt bigint NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    readiness_run_id text NOT NULL,
    snapshot_version text NOT NULL,
    test_cases_json text DEFAULT '[]'::text NOT NULL,
    automation_links_json text DEFAULT '[]'::text NOT NULL,
    commands_json text DEFAULT '[]'::text NOT NULL,
    log text DEFAULT ''::text NOT NULL,
    failure_classification text,
    failure_reason text,
    blocker_reasons_json text DEFAULT '[]'::text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    stale_reason text,
    created_at bigint NOT NULL,
    started_at bigint,
    finished_at bigint,
    rowid bigint NOT NULL,
    CONSTRAINT integration_test_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'passed'::text, 'failed'::text, 'blocked'::text, 'cancelled'::text, 'stale'::text, 'skipped'::text])))
);


--
-- Name: integration_test_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.integration_test_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: integration_test_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.integration_test_runs_rowid_seq OWNED BY public.integration_test_runs.rowid;


--
-- Name: integration_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_tokens (
    id text NOT NULL,
    project_id text NOT NULL,
    project_ids text DEFAULT '[]'::text NOT NULL,
    name text NOT NULL,
    scopes text NOT NULL,
    token_hash text NOT NULL,
    created_by text NOT NULL,
    created_at bigint NOT NULL,
    last_used_at bigint,
    revoked_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: integration_tokens_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.integration_tokens_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: integration_tokens_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.integration_tokens_rowid_seq OWNED BY public.integration_tokens.rowid;


--
-- Name: invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invites (
    token text NOT NULL,
    role text NOT NULL,
    created_by text NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    max_uses bigint DEFAULT 1 NOT NULL,
    uses bigint DEFAULT 0 NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    email text,
    emailed_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: invites_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invites_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: invites_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.invites_rowid_seq OWNED BY public.invites.rowid;


--
-- Name: kanban_columns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kanban_columns (
    id text NOT NULL,
    project_id text NOT NULL,
    name text NOT NULL,
    semantic_type text DEFAULT 'custom'::text NOT NULL,
    "position" double precision NOT NULL,
    hidden bigint DEFAULT 0 NOT NULL,
    wip_limit bigint,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: kanban_columns_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kanban_columns_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kanban_columns_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kanban_columns_rowid_seq OWNED BY public.kanban_columns.rowid;


--
-- Name: kb_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_documents (
    id text NOT NULL,
    scope text NOT NULL,
    owner_id text,
    project_id text,
    title text NOT NULL,
    kind text DEFAULT 'subsystem'::text NOT NULL,
    tags text DEFAULT '[]'::text NOT NULL,
    areas text DEFAULT '[]'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    checked_on text,
    created_by text DEFAULT ''::text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: kb_documents_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kb_documents_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kb_documents_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kb_documents_rowid_seq OWNED BY public.kb_documents.rowid;


--
-- Name: kb_usage_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_usage_queries (
    id text NOT NULL,
    seq bigint NOT NULL,
    user_id text NOT NULL,
    conversation_id text NOT NULL,
    project_id text,
    turn_id text,
    message_id text,
    ci_run_id text,
    ci_step_id text,
    source text NOT NULL,
    status text DEFAULT 'delivered'::text NOT NULL,
    query text DEFAULT ''::text NOT NULL,
    confidence text,
    injected bigint DEFAULT 0 NOT NULL,
    sections_count bigint DEFAULT 0 NOT NULL,
    chars bigint DEFAULT 0 NOT NULL,
    est_tokens bigint DEFAULT 0 NOT NULL,
    bundle_tokens bigint,
    prompt_chars bigint,
    turn_input_tokens bigint,
    duration_ms bigint,
    error text,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: kb_usage_queries_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kb_usage_queries_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kb_usage_queries_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kb_usage_queries_rowid_seq OWNED BY public.kb_usage_queries.rowid;


--
-- Name: kb_usage_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_usage_sections (
    id text NOT NULL,
    query_id text NOT NULL,
    document_id text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    heading text DEFAULT ''::text NOT NULL,
    anchor text DEFAULT ''::text NOT NULL,
    source_path text DEFAULT ''::text NOT NULL,
    related_files text DEFAULT '[]'::text NOT NULL,
    chars bigint DEFAULT 0 NOT NULL,
    est_tokens bigint DEFAULT 0 NOT NULL,
    score double precision,
    match_types text DEFAULT '[]'::text NOT NULL,
    freshness text DEFAULT 'unknown'::text NOT NULL,
    "position" bigint DEFAULT 0 NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: kb_usage_sections_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kb_usage_sections_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kb_usage_sections_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kb_usage_sections_rowid_seq OWNED BY public.kb_usage_sections.rowid;


--
-- Name: kb_usage_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_usage_views (
    user_id text NOT NULL,
    conversation_id text NOT NULL,
    last_seq bigint DEFAULT 0 NOT NULL,
    viewed_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: kb_usage_views_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.kb_usage_views_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: kb_usage_views_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.kb_usage_views_rowid_seq OWNED BY public.kb_usage_views.rowid;


--
-- Name: llm_engines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_engines (
    id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    base_url text NOT NULL,
    token text DEFAULT ''::text NOT NULL,
    enabled bigint DEFAULT 1 NOT NULL,
    allowed_roles text DEFAULT '["admin","developer","tester","observer"]'::text NOT NULL,
    is_default bigint DEFAULT 0 NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: llm_engines_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.llm_engines_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: llm_engines_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.llm_engines_rowid_seq OWNED BY public.llm_engines.rowid;


--
-- Name: login_device_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_device_emails (
    user_name text NOT NULL,
    ip text NOT NULL,
    user_agent text NOT NULL,
    sent_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: login_device_emails_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_device_emails_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_device_emails_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_device_emails_rowid_seq OWNED BY public.login_device_emails.rowid;


--
-- Name: login_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_enrollments (
    status_id text NOT NULL,
    token_hash text NOT NULL,
    user_id text NOT NULL,
    expires_at bigint NOT NULL,
    consumed_at bigint,
    agent_id text,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: login_enrollments_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.login_enrollments_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_enrollments_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.login_enrollments_rowid_seq OWNED BY public.login_enrollments.rowid;


--
-- Name: machine_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machine_commands (
    id bigint NOT NULL,
    machine_id text NOT NULL,
    user_id text NOT NULL,
    source text NOT NULL,
    command text NOT NULL,
    exit_code bigint,
    timed_out bigint DEFAULT 0 NOT NULL,
    error text,
    duration_ms bigint DEFAULT 0 NOT NULL,
    started_at bigint NOT NULL,
    conversation_id text,
    output_excerpt text DEFAULT ''::text NOT NULL,
    rowid bigint GENERATED ALWAYS AS (id) STORED
);


--
-- Name: machine_commands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.machine_commands_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: machine_commands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.machine_commands_id_seq OWNED BY public.machine_commands.id;


--
-- Name: machine_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machine_events (
    id bigint NOT NULL,
    machine_id text NOT NULL,
    user_id text NOT NULL,
    state text NOT NULL,
    at bigint NOT NULL,
    offline_for_ms bigint DEFAULT 0 NOT NULL,
    rowid bigint GENERATED ALWAYS AS (id) STORED
);


--
-- Name: machine_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.machine_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: machine_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.machine_events_id_seq OWNED BY public.machine_events.id;


--
-- Name: machine_project_share_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machine_project_share_audit (
    id text NOT NULL,
    project_id text NOT NULL,
    agent_id text NOT NULL,
    actor text NOT NULL,
    old_value bigint NOT NULL,
    new_value bigint NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: machine_project_share_audit_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.machine_project_share_audit_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: machine_project_share_audit_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.machine_project_share_audit_rowid_seq OWNED BY public.machine_project_share_audit.rowid;


--
-- Name: machine_project_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machine_project_shares (
    project_id text NOT NULL,
    agent_id text NOT NULL,
    shared bigint DEFAULT 0 NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    updated_by text NOT NULL,
    access text DEFAULT 'full'::text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: machine_project_shares_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.machine_project_shares_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: machine_project_shares_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.machine_project_shares_rowid_seq OWNED BY public.machine_project_shares.rowid;


--
-- Name: machine_storages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machine_storages (
    id text NOT NULL,
    machine_id text NOT NULL,
    root_path text NOT NULL,
    format_version bigint NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: machine_storages_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.machine_storages_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: machine_storages_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.machine_storages_rowid_seq OWNED BY public.machine_storages.rowid;


--
-- Name: machine_vpn_networks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.machine_vpn_networks (
    user_id text NOT NULL,
    tailnet text NOT NULL,
    encrypted_secret text NOT NULL,
    generation bigint DEFAULT 0 NOT NULL,
    state text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: machine_vpn_networks_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.machine_vpn_networks_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: machine_vpn_networks_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.machine_vpn_networks_rowid_seq OWNED BY public.machine_vpn_networks.rowid;


--
-- Name: merge_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merge_runs (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    triggered_by text NOT NULL,
    source_branch text NOT NULL,
    target_branch text DEFAULT 'main'::text NOT NULL,
    source_sha text,
    target_sha text,
    merge_sha text,
    revert_sha text,
    agent_id text NOT NULL,
    llm_engine_id text,
    llm_provider text DEFAULT 'claude'::text NOT NULL,
    llm_model text DEFAULT ''::text NOT NULL,
    requested_llm_provider text,
    requested_llm_model text,
    llm_fallback_reason text,
    assignment_version bigint DEFAULT 0 NOT NULL,
    machine_name text,
    stage text DEFAULT 'queued'::text NOT NULL,
    conflicts_json text DEFAULT '[]'::text NOT NULL,
    deploy_id text,
    deploy_version text,
    production_status text,
    error text,
    log text DEFAULT ''::text NOT NULL,
    stages_json text DEFAULT '[]'::text NOT NULL,
    checks_json text DEFAULT '[]'::text NOT NULL,
    recommended_action text,
    push_started_at bigint,
    started_at bigint,
    finished_at bigint,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: merge_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.merge_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: merge_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.merge_runs_rowid_seq OWNED BY public.merge_runs.rowid;


--
-- Name: message_service_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_service_data (
    message_id text NOT NULL,
    conversation_id text NOT NULL,
    activity text,
    request text,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: message_service_data_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_service_data_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_service_data_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_service_data_rowid_seq OWNED BY public.message_service_data.rowid;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id text NOT NULL,
    conversation_id text NOT NULL,
    role text NOT NULL,
    text text NOT NULL,
    "time" text NOT NULL,
    created_at bigint NOT NULL,
    engine text,
    meta text,
    exec_target text,
    attachments text,
    state text DEFAULT 'published'::text NOT NULL,
    history_position bigint,
    parent_message_id text,
    branch_selected bigint DEFAULT 1 NOT NULL,
    rowid bigint NOT NULL,
    text_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, text)) STORED
);


--
-- Name: messages_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.messages_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: messages_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.messages_rowid_seq OWNED BY public.messages.rowid;


--
-- Name: model_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_prices (
    provider text NOT NULL,
    model text NOT NULL,
    input_per_million double precision NOT NULL,
    cached_input_per_million double precision NOT NULL,
    cache_write_per_million double precision DEFAULT 0 NOT NULL,
    output_per_million double precision NOT NULL,
    tiers_json text DEFAULT '[]'::text NOT NULL,
    source_url text NOT NULL,
    effective_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: model_prices_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.model_prices_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: model_prices_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.model_prices_rowid_seq OWNED BY public.model_prices.rowid;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_reset_tokens (
    token_hash text NOT NULL,
    user_name text NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: password_reset_tokens_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.password_reset_tokens_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: password_reset_tokens_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.password_reset_tokens_rowid_seq OWNED BY public.password_reset_tokens.rowid;


--
-- Name: project_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_invitations (
    id text NOT NULL,
    project_id text NOT NULL,
    email text,
    invited_username text,
    role text DEFAULT 'member'::text NOT NULL,
    token_hash text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    invited_by text NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    responded_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: project_invitations_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_invitations_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_invitations_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_invitations_rowid_seq OWNED BY public.project_invitations.rowid;


--
-- Name: project_machines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_machines (
    project_id text NOT NULL,
    agent_id text NOT NULL,
    path text DEFAULT ''::text NOT NULL,
    repos_root text DEFAULT ''::text NOT NULL,
    ssh_host text DEFAULT ''::text NOT NULL,
    ssh_user text DEFAULT ''::text NOT NULL,
    storage_id text,
    directories_json text DEFAULT ''::text NOT NULL,
    added_at bigint NOT NULL,
    added_by text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: project_machines_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_machines_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_machines_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_machines_rowid_seq OWNED BY public.project_machines.rowid;


--
-- Name: project_member_role_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_member_role_audit (
    id text NOT NULL,
    project_id text NOT NULL,
    target_user text NOT NULL,
    actor text NOT NULL,
    old_role text,
    new_role text,
    action text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: project_member_role_audit_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_member_role_audit_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_member_role_audit_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_member_role_audit_rowid_seq OWNED BY public.project_member_role_audit.rowid;


--
-- Name: project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members (
    project_id text NOT NULL,
    username text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    qa_permission bigint DEFAULT 0 NOT NULL,
    added_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: project_members_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_members_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_members_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_members_rowid_seq OWNED BY public.project_members.rowid;


--
-- Name: project_release_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_release_events (
    id text NOT NULL,
    release_id text NOT NULL,
    type text NOT NULL,
    actor text,
    payload_json text DEFAULT '{}'::text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: project_release_events_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_release_events_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_release_events_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_release_events_rowid_seq OWNED BY public.project_release_events.rowid;


--
-- Name: project_release_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_release_steps (
    id text NOT NULL,
    release_id text NOT NULL,
    kind text NOT NULL,
    "position" bigint NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    model text,
    attempt bigint NOT NULL,
    log text DEFAULT ''::text NOT NULL,
    started_at bigint,
    finished_at bigint,
    limit_ms bigint,
    rowid bigint NOT NULL
);


--
-- Name: project_release_steps_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_release_steps_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_release_steps_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_release_steps_rowid_seq OWNED BY public.project_release_steps.rowid;


--
-- Name: project_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_releases (
    id text NOT NULL,
    project_id text NOT NULL,
    version text NOT NULL,
    branch text NOT NULL,
    commit_sha text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    triggered_by text NOT NULL,
    attempt bigint DEFAULT 1 NOT NULL,
    previous_release_id text,
    created_at bigint NOT NULL,
    released_at bigint,
    agent_id text,
    checkout_path text,
    deleted_at bigint,
    archived_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: project_releases_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_releases_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_releases_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_releases_rowid_seq OWNED BY public.project_releases.rowid;


--
-- Name: project_stand_previews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_stand_previews (
    project_id text NOT NULL,
    config_json text NOT NULL,
    updated_by text,
    updated_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: project_stand_previews_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_stand_previews_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_stand_previews_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_stand_previews_rowid_seq OWNED BY public.project_stand_previews.rowid;


--
-- Name: project_type_review_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_type_review_audit (
    id bigint NOT NULL,
    type_id text NOT NULL,
    actor text NOT NULL,
    old_status text NOT NULL,
    new_status text NOT NULL,
    note text DEFAULT ''::text NOT NULL,
    at bigint NOT NULL,
    rowid bigint GENERATED ALWAYS AS (id) STORED
);


--
-- Name: project_type_review_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_type_review_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_type_review_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_type_review_audit_id_seq OWNED BY public.project_type_review_audit.id;


--
-- Name: project_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_types (
    id text NOT NULL,
    parent_id text,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    features_json text DEFAULT '{}'::text NOT NULL,
    defaults_json text DEFAULT '{}'::text NOT NULL,
    builtin bigint DEFAULT 0 NOT NULL,
    owner_id text,
    status text DEFAULT 'private'::text NOT NULL,
    review_note text DEFAULT ''::text NOT NULL,
    reviewed_by text,
    reviewed_at bigint,
    created_by text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: project_types_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.project_types_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: project_types_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.project_types_rowid_seq OWNED BY public.project_types.rowid;


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id text NOT NULL,
    tenant_id text,
    tenant_kind text,
    project_type_id text,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    git_url text,
    preview_url text,
    technologies text DEFAULT '[]'::text NOT NULL,
    skills text DEFAULT '[]'::text NOT NULL,
    created_by text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    default_agent_id text,
    commit_policy text DEFAULT 'agent_commits'::text NOT NULL,
    merge_transport text DEFAULT 'local'::text NOT NULL,
    agent_plan_approval_mode text DEFAULT 'manual'::text NOT NULL,
    test_command text DEFAULT ''::text NOT NULL,
    merge_test_command text DEFAULT ''::text NOT NULL,
    component_qa_command text DEFAULT ''::text NOT NULL,
    integration_test_command text DEFAULT ''::text NOT NULL,
    automated_qa_command text DEFAULT 'npm test'::text NOT NULL,
    automated_qa_mode text DEFAULT 'command'::text NOT NULL,
    automated_qa_scenario_json text DEFAULT ''::text NOT NULL,
    autopilot_default bigint DEFAULT 0 NOT NULL,
    autopilot_requires_manual_qa bigint DEFAULT 0 NOT NULL,
    autopilot_fix_limit bigint DEFAULT 3 NOT NULL,
    production_deploy_command text DEFAULT ''::text NOT NULL,
    production_agent_id text,
    production_environment_mode text DEFAULT 'legacy'::text NOT NULL,
    production_checkout_path text DEFAULT ''::text NOT NULL,
    production_health_check_command text DEFAULT ''::text NOT NULL,
    release_timeouts_json text DEFAULT '{}'::text NOT NULL,
    default_skills_epic text DEFAULT '[]'::text NOT NULL,
    default_skills_story text DEFAULT '[]'::text NOT NULL,
    default_skills_task text DEFAULT '[]'::text NOT NULL,
    task_seq bigint DEFAULT 0 NOT NULL,
    done_retention_days bigint DEFAULT 14,
    ci_test_fix_cycle_limit bigint DEFAULT 10 NOT NULL,
    test_users_json text,
    command_policy text DEFAULT ''::text NOT NULL,
    ci_base_branch text DEFAULT 'main'::text NOT NULL,
    ci_branch_template text DEFAULT '{task_number}'::text NOT NULL,
    ci_reuse_strategy text DEFAULT 'fail'::text NOT NULL,
    ci_exec_auth_ref text DEFAULT ''::text NOT NULL,
    ci_kb_context_mode text DEFAULT 'auto'::text NOT NULL,
    rowid bigint NOT NULL,
    CONSTRAINT projects_tenant_kind_check CHECK ((tenant_kind = ANY (ARRAY['personal'::text, 'team'::text])))
);


--
-- Name: projects_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.projects_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: projects_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.projects_rowid_seq OWNED BY public.projects.rowid;


--
-- Name: public_client_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_client_access (
    token_hash text NOT NULL,
    grant_id text NOT NULL,
    family_id text NOT NULL,
    application_id text NOT NULL,
    user_name text NOT NULL,
    tenant_id text NOT NULL,
    session_sid text NOT NULL,
    audience text NOT NULL,
    permissions text NOT NULL,
    issued_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: public_client_access_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.public_client_access_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: public_client_access_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.public_client_access_rowid_seq OWNED BY public.public_client_access.rowid;


--
-- Name: public_client_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_client_codes (
    code_hash text NOT NULL,
    application_id text NOT NULL,
    redirect_uri text NOT NULL,
    user_name text NOT NULL,
    tenant_id text NOT NULL,
    session_sid text NOT NULL,
    challenge text NOT NULL,
    audience text NOT NULL,
    permissions text NOT NULL,
    expires_at bigint NOT NULL,
    consumed_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: public_client_codes_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.public_client_codes_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: public_client_codes_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.public_client_codes_rowid_seq OWNED BY public.public_client_codes.rowid;


--
-- Name: public_client_families; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_client_families (
    id text NOT NULL,
    application_id text NOT NULL,
    redirect_uri text NOT NULL,
    user_name text NOT NULL,
    tenant_id text NOT NULL,
    session_sid text NOT NULL,
    audience text NOT NULL,
    permissions text NOT NULL,
    expires_at bigint NOT NULL,
    revoked_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: public_client_families_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.public_client_families_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: public_client_families_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.public_client_families_rowid_seq OWNED BY public.public_client_families.rowid;


--
-- Name: public_client_redirects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_client_redirects (
    application_id text NOT NULL,
    uri text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: public_client_redirects_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.public_client_redirects_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: public_client_redirects_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.public_client_redirects_rowid_seq OWNED BY public.public_client_redirects.rowid;


--
-- Name: public_client_refresh; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_client_refresh (
    token_hash text NOT NULL,
    family_id text NOT NULL,
    consumed_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: public_client_refresh_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.public_client_refresh_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: public_client_refresh_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.public_client_refresh_rowid_seq OWNED BY public.public_client_refresh.rowid;


--
-- Name: qa_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_attachments (
    id text NOT NULL,
    result_id text NOT NULL,
    upload_id text NOT NULL,
    name text NOT NULL,
    mime_type text NOT NULL,
    size bigint NOT NULL,
    width bigint,
    height bigint,
    caption text DEFAULT ''::text NOT NULL,
    author text NOT NULL,
    created_at bigint NOT NULL,
    commit_sha text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: qa_attachments_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_attachments_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_attachments_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qa_attachments_rowid_seq OWNED BY public.qa_attachments.rowid;


--
-- Name: qa_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_audit (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    session_id text,
    criterion_id text,
    result_id text,
    action text NOT NULL,
    actor text NOT NULL,
    payload_json text DEFAULT '{}'::text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: qa_audit_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_audit_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_audit_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qa_audit_rowid_seq OWNED BY public.qa_audit.rowid;


--
-- Name: qa_criterion_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_criterion_results (
    id text NOT NULL,
    session_id text NOT NULL,
    criterion_id text NOT NULL,
    criterion_version bigint NOT NULL,
    status text DEFAULT 'not_tested'::text NOT NULL,
    draft bigint DEFAULT 0 NOT NULL,
    tester_id text,
    assignee_id text,
    started_at bigint,
    finished_at bigint,
    branch text NOT NULL,
    commit_sha text NOT NULL,
    preview_id text,
    preview_sha text,
    app_url text,
    storybook_url text,
    test_data_scenario text DEFAULT ''::text NOT NULL,
    executed_steps text DEFAULT ''::text NOT NULL,
    expected_result text DEFAULT ''::text NOT NULL,
    actual_result text DEFAULT ''::text NOT NULL,
    comment text DEFAULT ''::text NOT NULL,
    environment text DEFAULT ''::text NOT NULL,
    blocker_reason text DEFAULT ''::text NOT NULL,
    blocker_type text,
    blocker_owner text,
    not_applicable_reason text DEFAULT ''::text NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: qa_criterion_results_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_criterion_results_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_criterion_results_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qa_criterion_results_rowid_seq OWNED BY public.qa_criterion_results.rowid;


--
-- Name: qa_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_issues (
    id text NOT NULL,
    result_id text NOT NULL,
    classification text NOT NULL,
    severity text NOT NULL,
    frequency text NOT NULL,
    reproduction text NOT NULL,
    proposed_route text NOT NULL,
    requirement_proposal text DEFAULT ''::text NOT NULL,
    resolution text DEFAULT ''::text NOT NULL,
    linked_fix_run_id text,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: qa_issues_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_issues_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_issues_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qa_issues_rowid_seq OWNED BY public.qa_issues.rowid;


--
-- Name: qa_preparation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_preparation_runs (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    branch text NOT NULL,
    commit_sha text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    log text DEFAULT ''::text NOT NULL,
    error text,
    attempt bigint DEFAULT 1 NOT NULL,
    diagnostics_json text DEFAULT '[]'::text NOT NULL,
    created_at bigint NOT NULL,
    finished_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: qa_preparation_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_preparation_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_preparation_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qa_preparation_runs_rowid_seq OWNED BY public.qa_preparation_runs.rowid;


--
-- Name: qa_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_sessions (
    id text NOT NULL,
    task_id text NOT NULL,
    project_id text NOT NULL,
    branch text NOT NULL,
    commit_sha text NOT NULL,
    test_run_id text NOT NULL,
    preview_id text,
    preview_sha text,
    app_url text,
    storybook_url text,
    test_data_scenario text DEFAULT ''::text NOT NULL,
    criteria_snapshot_json text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    tester_id text,
    initiated_by text NOT NULL,
    started_at bigint NOT NULL,
    finished_at bigint,
    stale_reason text,
    summary text DEFAULT ''::text NOT NULL,
    additional_issues text DEFAULT ''::text NOT NULL,
    linked_fix_run_id text,
    rowid bigint NOT NULL
);


--
-- Name: qa_sessions_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_sessions_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_sessions_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qa_sessions_rowid_seq OWNED BY public.qa_sessions.rowid;


--
-- Name: qa_stage_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_stage_runs (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    stage text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempt bigint NOT NULL,
    triggered_by text NOT NULL,
    branch text DEFAULT ''::text NOT NULL,
    commit_sha text DEFAULT ''::text NOT NULL,
    llm_engine_id text,
    llm_provider text DEFAULT 'claude'::text NOT NULL,
    llm_model text DEFAULT ''::text NOT NULL,
    current_step text DEFAULT 'queued'::text NOT NULL,
    progress_json text DEFAULT '{"current":0,"total":0,"label":""}'::text NOT NULL,
    log_json text DEFAULT '[]'::text NOT NULL,
    result_json text,
    gate_reasons_json text DEFAULT '[]'::text NOT NULL,
    scenario_json text DEFAULT ''::text NOT NULL,
    error text,
    created_at bigint NOT NULL,
    started_at bigint,
    finished_at bigint,
    rowid bigint NOT NULL,
    CONSTRAINT qa_stage_runs_stage_check CHECK ((stage = ANY (ARRAY['component_qa'::text, 'integration_tests'::text, 'automated_qa'::text])))
);


--
-- Name: qa_stage_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.qa_stage_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: qa_stage_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.qa_stage_runs_rowid_seq OWNED BY public.qa_stage_runs.rowid;


--
-- Name: release_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.release_notifications (
    id text NOT NULL,
    user_id text NOT NULL,
    project_id text NOT NULL,
    release_id text NOT NULL,
    title text NOT NULL,
    text text NOT NULL,
    created_at bigint NOT NULL,
    dismissed_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: release_notifications_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.release_notifications_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: release_notifications_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.release_notifications_rowid_seq OWNED BY public.release_notifications.rowid;


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    name text NOT NULL,
    applied_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: schema_migrations_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.schema_migrations_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: schema_migrations_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.schema_migrations_rowid_seq OWNED BY public.schema_migrations.rowid;


--
-- Name: security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_events (
    id bigint NOT NULL,
    at bigint NOT NULL,
    user_name text NOT NULL,
    type text NOT NULL,
    ip text DEFAULT ''::text NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    details text DEFAULT ''::text NOT NULL,
    session_sid text,
    rowid bigint GENERATED ALWAYS AS (id) STORED
);


--
-- Name: security_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.security_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: security_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.security_events_id_seq OWNED BY public.security_events.id;


--
-- Name: session_revocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_revocations (
    token_hash text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: session_revocations_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.session_revocations_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: session_revocations_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.session_revocations_rowid_seq OWNED BY public.session_revocations.rowid;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    kind text DEFAULT 'session'::text NOT NULL,
    access text DEFAULT 'full'::text NOT NULL,
    sid text NOT NULL,
    user_name text NOT NULL,
    created_at bigint NOT NULL,
    last_seen bigint NOT NULL,
    expires_at bigint NOT NULL,
    ip text DEFAULT ''::text NOT NULL,
    user_agent text DEFAULT ''::text NOT NULL,
    revoked_at bigint,
    label text,
    device_key text,
    trusted_at bigint,
    platform text,
    client_version text,
    geo text,
    requests bigint DEFAULT 0 NOT NULL,
    last_path text,
    end_reason text,
    device_secret text,
    two_factor bigint DEFAULT 0 NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: sessions_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sessions_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sessions_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sessions_rowid_seq OWNED BY public.sessions.rowid;


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    key text NOT NULL,
    value text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: settings_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_rowid_seq OWNED BY public.settings.rowid;


--
-- Name: speakers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.speakers (
    conversation_id text NOT NULL,
    speaker_id bigint NOT NULL,
    label text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: speakers_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.speakers_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: speakers_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.speakers_rowid_seq OWNED BY public.speakers.rowid;


--
-- Name: storage_acceptances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_acceptances (
    share_id text NOT NULL,
    user_id text NOT NULL,
    data text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: storage_acceptances_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storage_acceptances_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storage_acceptances_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storage_acceptances_rowid_seq OWNED BY public.storage_acceptances.rowid;


--
-- Name: storage_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_entries (
    space_id text NOT NULL,
    path text NOT NULL,
    size bigint NOT NULL,
    data text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: storage_entries_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storage_entries_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storage_entries_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storage_entries_rowid_seq OWNED BY public.storage_entries.rowid;


--
-- Name: storage_lock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_lock (
    id bigint NOT NULL,
    version bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: storage_lock_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storage_lock_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storage_lock_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storage_lock_rowid_seq OWNED BY public.storage_lock.rowid;


--
-- Name: storage_shares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_shares (
    id text NOT NULL,
    space_id text NOT NULL,
    token text,
    data text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: storage_shares_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storage_shares_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storage_shares_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storage_shares_rowid_seq OWNED BY public.storage_shares.rowid;


--
-- Name: storage_space_refs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_space_refs (
    owner_id text NOT NULL,
    kind text NOT NULL,
    ref_key text NOT NULL,
    space_id text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: storage_space_refs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storage_space_refs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storage_space_refs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storage_space_refs_rowid_seq OWNED BY public.storage_space_refs.rowid;


--
-- Name: storage_spaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_spaces (
    id text NOT NULL,
    owner_id text NOT NULL,
    data text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: storage_spaces_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storage_spaces_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storage_spaces_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storage_spaces_rowid_seq OWNED BY public.storage_spaces.rowid;


--
-- Name: storage_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_uploads (
    id text NOT NULL,
    data text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: storage_uploads_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.storage_uploads_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: storage_uploads_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.storage_uploads_rowid_seq OWNED BY public.storage_uploads.rowid;


--
-- Name: tariff_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tariff_plans (
    id text NOT NULL,
    name text NOT NULL,
    capabilities text NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL,
    CONSTRAINT tariff_plans_revision_check CHECK ((revision > 0))
);


--
-- Name: tariff_plans_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tariff_plans_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tariff_plans_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tariff_plans_rowid_seq OWNED BY public.tariff_plans.rowid;


--
-- Name: task_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_attachments (
    id text NOT NULL,
    task_id text NOT NULL,
    rework_cycle_id text,
    scope text NOT NULL,
    name text NOT NULL,
    size bigint NOT NULL,
    mime_type text NOT NULL,
    storage_key text NOT NULL,
    checksum text NOT NULL,
    data_base64 text,
    status text DEFAULT 'ready'::text NOT NULL,
    created_by text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL,
    CONSTRAINT task_attachments_scope_check CHECK ((scope = ANY (ARRAY['source'::text, 'rework_draft'::text, 'rework_cycle'::text])))
);


--
-- Name: task_attachments_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_attachments_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_attachments_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_attachments_rowid_seq OWNED BY public.task_attachments.rowid;


--
-- Name: task_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_comments (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    author text NOT NULL,
    via text DEFAULT 'user'::text NOT NULL,
    text text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: task_comments_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_comments_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_comments_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_comments_rowid_seq OWNED BY public.task_comments.rowid;


--
-- Name: task_creation_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_creation_audit (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    created_by text,
    created_by_name text,
    assignee text,
    source text NOT NULL,
    assignment_method text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: task_creation_audit_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_creation_audit_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_creation_audit_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_creation_audit_rowid_seq OWNED BY public.task_creation_audit.rowid;


--
-- Name: task_creation_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_creation_requests (
    actor text NOT NULL,
    idempotency_key text NOT NULL,
    task_id text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: task_creation_requests_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_creation_requests_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_creation_requests_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_creation_requests_rowid_seq OWNED BY public.task_creation_requests.rowid;


--
-- Name: task_designs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_designs (
    id text NOT NULL,
    task_id text NOT NULL,
    conversation_id text NOT NULL,
    path text DEFAULT ''::text NOT NULL,
    mode text DEFAULT 'whole_project'::text NOT NULL,
    paths_json text DEFAULT '[]'::text NOT NULL,
    label text DEFAULT ''::text NOT NULL,
    created_by text,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: task_designs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_designs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_designs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_designs_rowid_seq OWNED BY public.task_designs.rowid;


--
-- Name: task_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_history (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    actor text NOT NULL,
    via text DEFAULT 'user'::text NOT NULL,
    field text NOT NULL,
    from_value text,
    to_value text,
    at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: task_history_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_history_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_history_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_history_rowid_seq OWNED BY public.task_history.rowid;


--
-- Name: task_improvements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_improvements (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    run_id text,
    step_id text,
    source text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    acceptance_criteria text DEFAULT ''::text NOT NULL,
    created_task_id text,
    fingerprint text NOT NULL,
    evidence_json text DEFAULT '[]'::text NOT NULL,
    files_json text DEFAULT '[]'::text NOT NULL,
    occurrences bigint DEFAULT 1 NOT NULL,
    suggested_action text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    resolved_by text,
    resolved_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: task_improvements_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_improvements_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_improvements_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_improvements_rowid_seq OWNED BY public.task_improvements.rowid;


--
-- Name: task_launch_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_launch_results (
    project_id text NOT NULL,
    proposal_id text NOT NULL,
    action text NOT NULL,
    task_id text NOT NULL,
    run_id text,
    error text,
    created_by text NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: task_launch_results_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_launch_results_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_launch_results_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_launch_results_rowid_seq OWNED BY public.task_launch_results.rowid;


--
-- Name: task_preparation_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_preparation_events (
    event_id text NOT NULL,
    attempt_id text NOT NULL,
    sequence bigint NOT NULL,
    "timestamp" bigint NOT NULL,
    type text NOT NULL,
    phase text NOT NULL,
    text text NOT NULL,
    data_json text,
    rowid bigint NOT NULL
);


--
-- Name: task_preparation_events_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_preparation_events_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_preparation_events_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_preparation_events_rowid_seq OWNED BY public.task_preparation_events.rowid;


--
-- Name: task_preparation_notification_dismissals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_preparation_notification_dismissals (
    question_id text NOT NULL,
    user_id text NOT NULL,
    dismissed_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: task_preparation_notification_dismissals_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_preparation_notification_dismissals_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_preparation_notification_dismissals_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_preparation_notification_dismissals_rowid_seq OWNED BY public.task_preparation_notification_dismissals.rowid;


--
-- Name: task_preparation_questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_preparation_questions (
    question_id text NOT NULL,
    attempt_id text NOT NULL,
    text text NOT NULL,
    material bigint DEFAULT 1 NOT NULL,
    answer text,
    asked_at bigint NOT NULL,
    answered_at bigint,
    answered_by text,
    rowid bigint NOT NULL
);


--
-- Name: task_preparation_questions_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_preparation_questions_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_preparation_questions_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_preparation_questions_rowid_seq OWNED BY public.task_preparation_questions.rowid;


--
-- Name: task_preparation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_preparation_runs (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    phase text DEFAULT 'initialization'::text NOT NULL,
    attempt bigint DEFAULT 1 NOT NULL,
    task_key text DEFAULT ''::text NOT NULL,
    machine_id text,
    machine_name_snapshot text,
    llm_engine_id text,
    provider text DEFAULT 'claude'::text NOT NULL,
    model text DEFAULT ''::text NOT NULL,
    profile_id text DEFAULT ''::text NOT NULL,
    log text DEFAULT ''::text NOT NULL,
    error text,
    readiness_json text,
    gate_reasons_json text DEFAULT '[]'::text NOT NULL,
    gate_results_json text DEFAULT '[]'::text NOT NULL,
    created_at bigint NOT NULL,
    started_at bigint,
    finished_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: task_preparation_runs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_preparation_runs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_preparation_runs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_preparation_runs_rowid_seq OWNED BY public.task_preparation_runs.rowid;


--
-- Name: task_preparation_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_preparation_steps (
    id text NOT NULL,
    attempt_id text NOT NULL,
    ordinal bigint NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    started_at bigint,
    finished_at bigint,
    error text,
    rowid bigint NOT NULL
);


--
-- Name: task_preparation_steps_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_preparation_steps_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_preparation_steps_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_preparation_steps_rowid_seq OWNED BY public.task_preparation_steps.rowid;


--
-- Name: task_repositories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_repositories (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    agent_id text NOT NULL,
    path text NOT NULL,
    kind text NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    created_at bigint NOT NULL,
    deleted_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: task_repositories_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_repositories_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_repositories_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_repositories_rowid_seq OWNED BY public.task_repositories.rowid;


--
-- Name: task_rework_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_rework_attachments (
    id text NOT NULL,
    cycle_id text NOT NULL,
    upload_id text NOT NULL,
    "position" bigint NOT NULL,
    name text NOT NULL,
    mime_type text NOT NULL,
    size bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: task_rework_attachments_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_rework_attachments_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_rework_attachments_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_rework_attachments_rowid_seq OWNED BY public.task_rework_attachments.rowid;


--
-- Name: task_rework_cycles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_rework_cycles (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    sequence bigint NOT NULL,
    description text NOT NULL,
    criteria_json text DEFAULT '[]'::text NOT NULL,
    make_sources_json text DEFAULT '[]'::text NOT NULL,
    implemented_result text DEFAULT ''::text NOT NULL,
    created_by text NOT NULL,
    created_at bigint NOT NULL,
    preparation_run_id text,
    idempotency_key text NOT NULL,
    payload_hash text NOT NULL,
    status text DEFAULT 'submitted'::text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: task_rework_cycles_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_rework_cycles_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_rework_cycles_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_rework_cycles_rowid_seq OWNED BY public.task_rework_cycles.rowid;


--
-- Name: task_worklog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_worklog (
    id text NOT NULL,
    project_id text NOT NULL,
    task_id text NOT NULL,
    author text NOT NULL,
    minutes bigint NOT NULL,
    comment text DEFAULT ''::text NOT NULL,
    started_at bigint NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint,
    rowid bigint NOT NULL
);


--
-- Name: task_worklog_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.task_worklog_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: task_worklog_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.task_worklog_rowid_seq OWNED BY public.task_worklog.rowid;


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id text NOT NULL,
    project_id text NOT NULL,
    column_id text NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    acceptance_criteria text DEFAULT ''::text NOT NULL,
    type text DEFAULT 'task'::text NOT NULL,
    parent_id text,
    source_task_id text,
    priority text DEFAULT 'medium'::text NOT NULL,
    assignee text,
    created_by text,
    created_by_name text,
    agent_id text,
    labels text DEFAULT '[]'::text NOT NULL,
    skills text DEFAULT '[]'::text NOT NULL,
    story_points double precision,
    due_date bigint,
    flagged bigint DEFAULT 0 NOT NULL,
    auto_pilot bigint DEFAULT 0 NOT NULL,
    auto_pilot_requires_manual_qa bigint DEFAULT 0 NOT NULL,
    auto_pilot_fix_cycles bigint DEFAULT 0 NOT NULL,
    done_at bigint,
    preview_ready bigint DEFAULT 0 NOT NULL,
    seq bigint,
    "position" double precision NOT NULL,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: tasks_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tasks_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tasks_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tasks_rowid_seq OWNED BY public.tasks.rowid;


--
-- Name: team_tenant_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_tenant_invitations (
    id text NOT NULL,
    tenant_id text NOT NULL,
    target text NOT NULL,
    role text NOT NULL,
    token_hash text NOT NULL,
    invited_by text NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    rowid bigint NOT NULL,
    CONSTRAINT team_tenant_invitations_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: team_tenant_invitations_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_tenant_invitations_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_tenant_invitations_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_tenant_invitations_rowid_seq OWNED BY public.team_tenant_invitations.rowid;


--
-- Name: team_tenant_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_tenant_memberships (
    tenant_id text NOT NULL,
    user_name text NOT NULL,
    role text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL,
    CONSTRAINT team_tenant_memberships_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);


--
-- Name: team_tenant_memberships_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_tenant_memberships_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_tenant_memberships_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_tenant_memberships_rowid_seq OWNED BY public.team_tenant_memberships.rowid;


--
-- Name: team_tenant_tariffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_tenant_tariffs (
    tenant_id text NOT NULL,
    tariff_id text NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: team_tenant_tariffs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_tenant_tariffs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_tenant_tariffs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_tenant_tariffs_rowid_seq OWNED BY public.team_tenant_tariffs.rowid;


--
-- Name: team_tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_tenants (
    id text NOT NULL,
    owner_user_name text NOT NULL,
    name text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: team_tenants_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.team_tenants_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: team_tenants_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.team_tenants_rowid_seq OWNED BY public.team_tenants.rowid;


--
-- Name: tenant_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_memberships (
    tenant_id text NOT NULL,
    user_name text NOT NULL,
    role text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL,
    CONSTRAINT tenant_memberships_role_check CHECK ((role = 'owner'::text))
);


--
-- Name: tenant_memberships_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_memberships_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_memberships_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_memberships_rowid_seq OWNED BY public.tenant_memberships.rowid;


--
-- Name: tenant_tariffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_tariffs (
    tenant_id text NOT NULL,
    tariff_id text NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: tenant_tariffs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenant_tariffs_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenant_tariffs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenant_tariffs_rowid_seq OWNED BY public.tenant_tariffs.rowid;


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id text NOT NULL,
    kind text NOT NULL,
    owner_user_name text NOT NULL,
    name text NOT NULL,
    created_at bigint NOT NULL,
    rowid bigint NOT NULL,
    CONSTRAINT tenants_kind_check CHECK ((kind = 'personal'::text))
);


--
-- Name: tenants_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tenants_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tenants_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tenants_rowid_seq OWNED BY public.tenants.rowid;


--
-- Name: user_llm_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_llm_access (
    user_name text NOT NULL,
    provider text NOT NULL,
    model_id text NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: user_llm_access_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_llm_access_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_llm_access_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_llm_access_rowid_seq OWNED BY public.user_llm_access.rowid;


--
-- Name: user_project_machine_defaults; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_project_machine_defaults (
    username text NOT NULL,
    project_id text NOT NULL,
    agent_id text NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: user_project_machine_defaults_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_project_machine_defaults_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_project_machine_defaults_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_project_machine_defaults_rowid_seq OWNED BY public.user_project_machine_defaults.rowid;


--
-- Name: user_project_release_machines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_project_release_machines (
    username text NOT NULL,
    project_id text NOT NULL,
    agent_id text NOT NULL,
    updated_at bigint NOT NULL,
    rowid bigint NOT NULL
);


--
-- Name: user_project_release_machines_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_project_release_machines_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_project_release_machines_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_project_release_machines_rowid_seq OWNED BY public.user_project_release_machines.rowid;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    name text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    blocked bigint DEFAULT 0 NOT NULL,
    created_at bigint NOT NULL,
    failed_logins bigint DEFAULT 0 NOT NULL,
    locked_until bigint,
    lock_reason text,
    totp_secret text,
    reset_code_hash text,
    reset_code_expires bigint,
    must_change_password bigint DEFAULT 0 NOT NULL,
    last_login bigint,
    notices_seen_at bigint DEFAULT 0 NOT NULL,
    llm_limit_usd double precision,
    email text,
    rowid bigint NOT NULL
);


--
-- Name: users_rowid_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_rowid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_rowid_seq OWNED BY public.users.rowid;


--
-- Name: acceptance_criteria rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acceptance_criteria ALTER COLUMN rowid SET DEFAULT nextval('public.acceptance_criteria_rowid_seq'::regclass);


--
-- Name: acceptance_criterion_versions rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acceptance_criterion_versions ALTER COLUMN rowid SET DEFAULT nextval('public.acceptance_criterion_versions_rowid_seq'::regclass);


--
-- Name: agents rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents ALTER COLUMN rowid SET DEFAULT nextval('public.agents_rowid_seq'::regclass);


--
-- Name: app_config rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config ALTER COLUMN rowid SET DEFAULT nextval('public.app_config_rowid_seq'::regclass);


--
-- Name: application_audit rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_audit ALTER COLUMN rowid SET DEFAULT nextval('public.application_audit_rowid_seq'::regclass);


--
-- Name: application_deployments rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_deployments ALTER COLUMN rowid SET DEFAULT nextval('public.application_deployments_rowid_seq'::regclass);


--
-- Name: application_environments rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_environments ALTER COLUMN rowid SET DEFAULT nextval('public.application_environments_rowid_seq'::regclass);


--
-- Name: application_grants rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_grants ALTER COLUMN rowid SET DEFAULT nextval('public.application_grants_rowid_seq'::regclass);


--
-- Name: application_releases rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_releases ALTER COLUMN rowid SET DEFAULT nextval('public.application_releases_rowid_seq'::regclass);


--
-- Name: applications rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications ALTER COLUMN rowid SET DEFAULT nextval('public.applications_rowid_seq'::regclass);


--
-- Name: assistant_orchestration_items rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_orchestration_items ALTER COLUMN rowid SET DEFAULT nextval('public.assistant_orchestration_items_rowid_seq'::regclass);


--
-- Name: assistant_orchestrations rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_orchestrations ALTER COLUMN rowid SET DEFAULT nextval('public.assistant_orchestrations_rowid_seq'::regclass);


--
-- Name: board_views rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_views ALTER COLUMN rowid SET DEFAULT nextval('public.board_views_rowid_seq'::regclass);


--
-- Name: browser_ui_release_operations rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.browser_ui_release_operations ALTER COLUMN rowid SET DEFAULT nextval('public.browser_ui_release_operations_rowid_seq'::regclass);


--
-- Name: chat_storage_bindings rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_storage_bindings ALTER COLUMN rowid SET DEFAULT nextval('public.chat_storage_bindings_rowid_seq'::regclass);


--
-- Name: ci_command_suggestions rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_command_suggestions ALTER COLUMN rowid SET DEFAULT nextval('public.ci_command_suggestions_rowid_seq'::regclass);


--
-- Name: ci_commands rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_commands ALTER COLUMN rowid SET DEFAULT nextval('public.ci_commands_rowid_seq'::regclass);


--
-- Name: ci_events rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_events ALTER COLUMN rowid SET DEFAULT nextval('public.ci_events_rowid_seq'::regclass);


--
-- Name: ci_fix_attempts rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_fix_attempts ALTER COLUMN rowid SET DEFAULT nextval('public.ci_fix_attempts_rowid_seq'::regclass);


--
-- Name: ci_gate_results rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_gate_results ALTER COLUMN rowid SET DEFAULT nextval('public.ci_gate_results_rowid_seq'::regclass);


--
-- Name: ci_interactions rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_interactions ALTER COLUMN rowid SET DEFAULT nextval('public.ci_interactions_rowid_seq'::regclass);


--
-- Name: ci_llm_configs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_llm_configs ALTER COLUMN rowid SET DEFAULT nextval('public.ci_llm_configs_rowid_seq'::regclass);


--
-- Name: ci_run_kb_gaps rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_kb_gaps ALTER COLUMN rowid SET DEFAULT nextval('public.ci_run_kb_gaps_rowid_seq'::regclass);


--
-- Name: ci_run_kb_metrics rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_kb_metrics ALTER COLUMN rowid SET DEFAULT nextval('public.ci_run_kb_metrics_rowid_seq'::regclass);


--
-- Name: ci_run_logs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_logs ALTER COLUMN rowid SET DEFAULT nextval('public.ci_run_logs_rowid_seq'::regclass);


--
-- Name: ci_run_steps rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_steps ALTER COLUMN rowid SET DEFAULT nextval('public.ci_run_steps_rowid_seq'::regclass);


--
-- Name: ci_run_tool_calls rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_tool_calls ALTER COLUMN rowid SET DEFAULT nextval('public.ci_run_tool_calls_rowid_seq'::regclass);


--
-- Name: ci_run_tool_responses rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_tool_responses ALTER COLUMN rowid SET DEFAULT nextval('public.ci_run_tool_responses_rowid_seq'::regclass);


--
-- Name: ci_run_usage rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_usage ALTER COLUMN rowid SET DEFAULT nextval('public.ci_run_usage_rowid_seq'::regclass);


--
-- Name: ci_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_runs ALTER COLUMN rowid SET DEFAULT nextval('public.ci_runs_rowid_seq'::regclass);


--
-- Name: ci_settings rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_settings ALTER COLUMN rowid SET DEFAULT nextval('public.ci_settings_rowid_seq'::regclass);


--
-- Name: ci_slot_commands rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_slot_commands ALTER COLUMN rowid SET DEFAULT nextval('public.ci_slot_commands_rowid_seq'::regclass);


--
-- Name: ci_stage_llm_configs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_stage_llm_configs ALTER COLUMN rowid SET DEFAULT nextval('public.ci_stage_llm_configs_rowid_seq'::regclass);


--
-- Name: ci_stage_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_stage_runs ALTER COLUMN rowid SET DEFAULT nextval('public.ci_stage_runs_rowid_seq'::regclass);


--
-- Name: ci_task_browser_checks rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_task_browser_checks ALTER COLUMN rowid SET DEFAULT nextval('public.ci_task_browser_checks_rowid_seq'::regclass);


--
-- Name: ci_task_process_stages rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_task_process_stages ALTER COLUMN rowid SET DEFAULT nextval('public.ci_task_process_stages_rowid_seq'::regclass);


--
-- Name: ci_test_events rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_events ALTER COLUMN rowid SET DEFAULT nextval('public.ci_test_events_rowid_seq'::regclass);


--
-- Name: ci_test_fix_cycles rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_cycles ALTER COLUMN rowid SET DEFAULT nextval('public.ci_test_fix_cycles_rowid_seq'::regclass);


--
-- Name: ci_test_fix_decisions rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_decisions ALTER COLUMN rowid SET DEFAULT nextval('public.ci_test_fix_decisions_rowid_seq'::regclass);


--
-- Name: ci_test_fix_targeted_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_targeted_runs ALTER COLUMN rowid SET DEFAULT nextval('public.ci_test_fix_targeted_runs_rowid_seq'::regclass);


--
-- Name: ci_test_fix_task_state rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_task_state ALTER COLUMN rowid SET DEFAULT nextval('public.ci_test_fix_task_state_rowid_seq'::regclass);


--
-- Name: ci_test_group_configs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_group_configs ALTER COLUMN rowid SET DEFAULT nextval('public.ci_test_group_configs_rowid_seq'::regclass);


--
-- Name: ci_test_group_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_group_runs ALTER COLUMN rowid SET DEFAULT nextval('public.ci_test_group_runs_rowid_seq'::regclass);


--
-- Name: ci_test_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_runs ALTER COLUMN rowid SET DEFAULT nextval('public.ci_test_runs_rowid_seq'::regclass);


--
-- Name: ci_test_targeted_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_targeted_runs ALTER COLUMN rowid SET DEFAULT nextval('public.ci_test_targeted_runs_rowid_seq'::regclass);


--
-- Name: ci_workspaces rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_workspaces ALTER COLUMN rowid SET DEFAULT nextval('public.ci_workspaces_rowid_seq'::regclass);


--
-- Name: component_qa_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_qa_runs ALTER COLUMN rowid SET DEFAULT nextval('public.component_qa_runs_rowid_seq'::regclass);


--
-- Name: conversation_context_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_context_events ALTER COLUMN id SET DEFAULT nextval('public.conversation_context_events_id_seq'::regclass);


--
-- Name: conversation_draft_requests rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_draft_requests ALTER COLUMN rowid SET DEFAULT nextval('public.conversation_draft_requests_rowid_seq'::regclass);


--
-- Name: conversation_group_memberships rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_group_memberships ALTER COLUMN rowid SET DEFAULT nextval('public.conversation_group_memberships_rowid_seq'::regclass);


--
-- Name: conversation_groups rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_groups ALTER COLUMN rowid SET DEFAULT nextval('public.conversation_groups_rowid_seq'::regclass);


--
-- Name: conversation_turn_control rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turn_control ALTER COLUMN rowid SET DEFAULT nextval('public.conversation_turn_control_rowid_seq'::regclass);


--
-- Name: conversation_turn_queue rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turn_queue ALTER COLUMN rowid SET DEFAULT nextval('public.conversation_turn_queue_rowid_seq'::regclass);


--
-- Name: conversation_workspaces rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_workspaces ALTER COLUMN rowid SET DEFAULT nextval('public.conversation_workspaces_rowid_seq'::regclass);


--
-- Name: conversations rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations ALTER COLUMN rowid SET DEFAULT nextval('public.conversations_rowid_seq'::regclass);


--
-- Name: email_verifications rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications ALTER COLUMN rowid SET DEFAULT nextval('public.email_verifications_rowid_seq'::regclass);


--
-- Name: environment_configurations rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_configurations ALTER COLUMN rowid SET DEFAULT nextval('public.environment_configurations_rowid_seq'::regclass);


--
-- Name: environment_links rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_links ALTER COLUMN rowid SET DEFAULT nextval('public.environment_links_rowid_seq'::regclass);


--
-- Name: environment_operations rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_operations ALTER COLUMN rowid SET DEFAULT nextval('public.environment_operations_rowid_seq'::regclass);


--
-- Name: environment_settings rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_settings ALTER COLUMN rowid SET DEFAULT nextval('public.environment_settings_rowid_seq'::regclass);


--
-- Name: environments rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments ALTER COLUMN rowid SET DEFAULT nextval('public.environments_rowid_seq'::regclass);


--
-- Name: fts_state rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fts_state ALTER COLUMN rowid SET DEFAULT nextval('public.fts_state_rowid_seq'::regclass);


--
-- Name: generated_cleanup_retry rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_cleanup_retry ALTER COLUMN rowid SET DEFAULT nextval('public.generated_cleanup_retry_rowid_seq'::regclass);


--
-- Name: git_workspace_locks rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.git_workspace_locks ALTER COLUMN rowid SET DEFAULT nextval('public.git_workspace_locks_rowid_seq'::regclass);


--
-- Name: identity_sign_in_tickets rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_sign_in_tickets ALTER COLUMN rowid SET DEFAULT nextval('public.identity_sign_in_tickets_rowid_seq'::regclass);


--
-- Name: identity_subjects rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_subjects ALTER COLUMN rowid SET DEFAULT nextval('public.identity_subjects_rowid_seq'::regclass);


--
-- Name: integration_test_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_test_runs ALTER COLUMN rowid SET DEFAULT nextval('public.integration_test_runs_rowid_seq'::regclass);


--
-- Name: integration_tokens rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_tokens ALTER COLUMN rowid SET DEFAULT nextval('public.integration_tokens_rowid_seq'::regclass);


--
-- Name: invites rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites ALTER COLUMN rowid SET DEFAULT nextval('public.invites_rowid_seq'::regclass);


--
-- Name: kanban_columns rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_columns ALTER COLUMN rowid SET DEFAULT nextval('public.kanban_columns_rowid_seq'::regclass);


--
-- Name: kb_documents rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_documents ALTER COLUMN rowid SET DEFAULT nextval('public.kb_documents_rowid_seq'::regclass);


--
-- Name: kb_usage_queries rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_usage_queries ALTER COLUMN rowid SET DEFAULT nextval('public.kb_usage_queries_rowid_seq'::regclass);


--
-- Name: kb_usage_sections rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_usage_sections ALTER COLUMN rowid SET DEFAULT nextval('public.kb_usage_sections_rowid_seq'::regclass);


--
-- Name: kb_usage_views rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_usage_views ALTER COLUMN rowid SET DEFAULT nextval('public.kb_usage_views_rowid_seq'::regclass);


--
-- Name: llm_engines rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_engines ALTER COLUMN rowid SET DEFAULT nextval('public.llm_engines_rowid_seq'::regclass);


--
-- Name: login_device_emails rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_device_emails ALTER COLUMN rowid SET DEFAULT nextval('public.login_device_emails_rowid_seq'::regclass);


--
-- Name: login_enrollments rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_enrollments ALTER COLUMN rowid SET DEFAULT nextval('public.login_enrollments_rowid_seq'::regclass);


--
-- Name: machine_commands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_commands ALTER COLUMN id SET DEFAULT nextval('public.machine_commands_id_seq'::regclass);


--
-- Name: machine_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_events ALTER COLUMN id SET DEFAULT nextval('public.machine_events_id_seq'::regclass);


--
-- Name: machine_project_share_audit rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_project_share_audit ALTER COLUMN rowid SET DEFAULT nextval('public.machine_project_share_audit_rowid_seq'::regclass);


--
-- Name: machine_project_shares rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_project_shares ALTER COLUMN rowid SET DEFAULT nextval('public.machine_project_shares_rowid_seq'::regclass);


--
-- Name: machine_storages rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_storages ALTER COLUMN rowid SET DEFAULT nextval('public.machine_storages_rowid_seq'::regclass);


--
-- Name: machine_vpn_networks rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_vpn_networks ALTER COLUMN rowid SET DEFAULT nextval('public.machine_vpn_networks_rowid_seq'::regclass);


--
-- Name: merge_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merge_runs ALTER COLUMN rowid SET DEFAULT nextval('public.merge_runs_rowid_seq'::regclass);


--
-- Name: message_service_data rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_service_data ALTER COLUMN rowid SET DEFAULT nextval('public.message_service_data_rowid_seq'::regclass);


--
-- Name: messages rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages ALTER COLUMN rowid SET DEFAULT nextval('public.messages_rowid_seq'::regclass);


--
-- Name: model_prices rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_prices ALTER COLUMN rowid SET DEFAULT nextval('public.model_prices_rowid_seq'::regclass);


--
-- Name: password_reset_tokens rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN rowid SET DEFAULT nextval('public.password_reset_tokens_rowid_seq'::regclass);


--
-- Name: project_invitations rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_invitations ALTER COLUMN rowid SET DEFAULT nextval('public.project_invitations_rowid_seq'::regclass);


--
-- Name: project_machines rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_machines ALTER COLUMN rowid SET DEFAULT nextval('public.project_machines_rowid_seq'::regclass);


--
-- Name: project_member_role_audit rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_member_role_audit ALTER COLUMN rowid SET DEFAULT nextval('public.project_member_role_audit_rowid_seq'::regclass);


--
-- Name: project_members rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members ALTER COLUMN rowid SET DEFAULT nextval('public.project_members_rowid_seq'::regclass);


--
-- Name: project_release_events rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_release_events ALTER COLUMN rowid SET DEFAULT nextval('public.project_release_events_rowid_seq'::regclass);


--
-- Name: project_release_steps rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_release_steps ALTER COLUMN rowid SET DEFAULT nextval('public.project_release_steps_rowid_seq'::regclass);


--
-- Name: project_releases rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_releases ALTER COLUMN rowid SET DEFAULT nextval('public.project_releases_rowid_seq'::regclass);


--
-- Name: project_stand_previews rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_stand_previews ALTER COLUMN rowid SET DEFAULT nextval('public.project_stand_previews_rowid_seq'::regclass);


--
-- Name: project_type_review_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_type_review_audit ALTER COLUMN id SET DEFAULT nextval('public.project_type_review_audit_id_seq'::regclass);


--
-- Name: project_types rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_types ALTER COLUMN rowid SET DEFAULT nextval('public.project_types_rowid_seq'::regclass);


--
-- Name: projects rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects ALTER COLUMN rowid SET DEFAULT nextval('public.projects_rowid_seq'::regclass);


--
-- Name: public_client_access rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_access ALTER COLUMN rowid SET DEFAULT nextval('public.public_client_access_rowid_seq'::regclass);


--
-- Name: public_client_codes rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_codes ALTER COLUMN rowid SET DEFAULT nextval('public.public_client_codes_rowid_seq'::regclass);


--
-- Name: public_client_families rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_families ALTER COLUMN rowid SET DEFAULT nextval('public.public_client_families_rowid_seq'::regclass);


--
-- Name: public_client_redirects rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_redirects ALTER COLUMN rowid SET DEFAULT nextval('public.public_client_redirects_rowid_seq'::regclass);


--
-- Name: public_client_refresh rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_refresh ALTER COLUMN rowid SET DEFAULT nextval('public.public_client_refresh_rowid_seq'::regclass);


--
-- Name: qa_attachments rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_attachments ALTER COLUMN rowid SET DEFAULT nextval('public.qa_attachments_rowid_seq'::regclass);


--
-- Name: qa_audit rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_audit ALTER COLUMN rowid SET DEFAULT nextval('public.qa_audit_rowid_seq'::regclass);


--
-- Name: qa_criterion_results rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_criterion_results ALTER COLUMN rowid SET DEFAULT nextval('public.qa_criterion_results_rowid_seq'::regclass);


--
-- Name: qa_issues rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_issues ALTER COLUMN rowid SET DEFAULT nextval('public.qa_issues_rowid_seq'::regclass);


--
-- Name: qa_preparation_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_preparation_runs ALTER COLUMN rowid SET DEFAULT nextval('public.qa_preparation_runs_rowid_seq'::regclass);


--
-- Name: qa_sessions rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_sessions ALTER COLUMN rowid SET DEFAULT nextval('public.qa_sessions_rowid_seq'::regclass);


--
-- Name: qa_stage_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_stage_runs ALTER COLUMN rowid SET DEFAULT nextval('public.qa_stage_runs_rowid_seq'::regclass);


--
-- Name: release_notifications rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_notifications ALTER COLUMN rowid SET DEFAULT nextval('public.release_notifications_rowid_seq'::regclass);


--
-- Name: schema_migrations rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations ALTER COLUMN rowid SET DEFAULT nextval('public.schema_migrations_rowid_seq'::regclass);


--
-- Name: security_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events ALTER COLUMN id SET DEFAULT nextval('public.security_events_id_seq'::regclass);


--
-- Name: session_revocations rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_revocations ALTER COLUMN rowid SET DEFAULT nextval('public.session_revocations_rowid_seq'::regclass);


--
-- Name: sessions rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions ALTER COLUMN rowid SET DEFAULT nextval('public.sessions_rowid_seq'::regclass);


--
-- Name: settings rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings ALTER COLUMN rowid SET DEFAULT nextval('public.settings_rowid_seq'::regclass);


--
-- Name: speakers rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speakers ALTER COLUMN rowid SET DEFAULT nextval('public.speakers_rowid_seq'::regclass);


--
-- Name: storage_acceptances rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_acceptances ALTER COLUMN rowid SET DEFAULT nextval('public.storage_acceptances_rowid_seq'::regclass);


--
-- Name: storage_entries rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_entries ALTER COLUMN rowid SET DEFAULT nextval('public.storage_entries_rowid_seq'::regclass);


--
-- Name: storage_lock rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_lock ALTER COLUMN rowid SET DEFAULT nextval('public.storage_lock_rowid_seq'::regclass);


--
-- Name: storage_shares rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_shares ALTER COLUMN rowid SET DEFAULT nextval('public.storage_shares_rowid_seq'::regclass);


--
-- Name: storage_space_refs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_space_refs ALTER COLUMN rowid SET DEFAULT nextval('public.storage_space_refs_rowid_seq'::regclass);


--
-- Name: storage_spaces rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_spaces ALTER COLUMN rowid SET DEFAULT nextval('public.storage_spaces_rowid_seq'::regclass);


--
-- Name: storage_uploads rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_uploads ALTER COLUMN rowid SET DEFAULT nextval('public.storage_uploads_rowid_seq'::regclass);


--
-- Name: tariff_plans rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_plans ALTER COLUMN rowid SET DEFAULT nextval('public.tariff_plans_rowid_seq'::regclass);


--
-- Name: task_attachments rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments ALTER COLUMN rowid SET DEFAULT nextval('public.task_attachments_rowid_seq'::regclass);


--
-- Name: task_comments rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments ALTER COLUMN rowid SET DEFAULT nextval('public.task_comments_rowid_seq'::regclass);


--
-- Name: task_creation_audit rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_creation_audit ALTER COLUMN rowid SET DEFAULT nextval('public.task_creation_audit_rowid_seq'::regclass);


--
-- Name: task_creation_requests rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_creation_requests ALTER COLUMN rowid SET DEFAULT nextval('public.task_creation_requests_rowid_seq'::regclass);


--
-- Name: task_designs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_designs ALTER COLUMN rowid SET DEFAULT nextval('public.task_designs_rowid_seq'::regclass);


--
-- Name: task_history rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_history ALTER COLUMN rowid SET DEFAULT nextval('public.task_history_rowid_seq'::regclass);


--
-- Name: task_improvements rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_improvements ALTER COLUMN rowid SET DEFAULT nextval('public.task_improvements_rowid_seq'::regclass);


--
-- Name: task_launch_results rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_launch_results ALTER COLUMN rowid SET DEFAULT nextval('public.task_launch_results_rowid_seq'::regclass);


--
-- Name: task_preparation_events rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_events ALTER COLUMN rowid SET DEFAULT nextval('public.task_preparation_events_rowid_seq'::regclass);


--
-- Name: task_preparation_notification_dismissals rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_notification_dismissals ALTER COLUMN rowid SET DEFAULT nextval('public.task_preparation_notification_dismissals_rowid_seq'::regclass);


--
-- Name: task_preparation_questions rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_questions ALTER COLUMN rowid SET DEFAULT nextval('public.task_preparation_questions_rowid_seq'::regclass);


--
-- Name: task_preparation_runs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_runs ALTER COLUMN rowid SET DEFAULT nextval('public.task_preparation_runs_rowid_seq'::regclass);


--
-- Name: task_preparation_steps rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_steps ALTER COLUMN rowid SET DEFAULT nextval('public.task_preparation_steps_rowid_seq'::regclass);


--
-- Name: task_repositories rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_repositories ALTER COLUMN rowid SET DEFAULT nextval('public.task_repositories_rowid_seq'::regclass);


--
-- Name: task_rework_attachments rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_rework_attachments ALTER COLUMN rowid SET DEFAULT nextval('public.task_rework_attachments_rowid_seq'::regclass);


--
-- Name: task_rework_cycles rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_rework_cycles ALTER COLUMN rowid SET DEFAULT nextval('public.task_rework_cycles_rowid_seq'::regclass);


--
-- Name: task_worklog rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_worklog ALTER COLUMN rowid SET DEFAULT nextval('public.task_worklog_rowid_seq'::regclass);


--
-- Name: tasks rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks ALTER COLUMN rowid SET DEFAULT nextval('public.tasks_rowid_seq'::regclass);


--
-- Name: team_tenant_invitations rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_invitations ALTER COLUMN rowid SET DEFAULT nextval('public.team_tenant_invitations_rowid_seq'::regclass);


--
-- Name: team_tenant_memberships rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_memberships ALTER COLUMN rowid SET DEFAULT nextval('public.team_tenant_memberships_rowid_seq'::regclass);


--
-- Name: team_tenant_tariffs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_tariffs ALTER COLUMN rowid SET DEFAULT nextval('public.team_tenant_tariffs_rowid_seq'::regclass);


--
-- Name: team_tenants rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenants ALTER COLUMN rowid SET DEFAULT nextval('public.team_tenants_rowid_seq'::regclass);


--
-- Name: tenant_memberships rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships ALTER COLUMN rowid SET DEFAULT nextval('public.tenant_memberships_rowid_seq'::regclass);


--
-- Name: tenant_tariffs rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_tariffs ALTER COLUMN rowid SET DEFAULT nextval('public.tenant_tariffs_rowid_seq'::regclass);


--
-- Name: tenants rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants ALTER COLUMN rowid SET DEFAULT nextval('public.tenants_rowid_seq'::regclass);


--
-- Name: user_llm_access rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_llm_access ALTER COLUMN rowid SET DEFAULT nextval('public.user_llm_access_rowid_seq'::regclass);


--
-- Name: user_project_machine_defaults rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_project_machine_defaults ALTER COLUMN rowid SET DEFAULT nextval('public.user_project_machine_defaults_rowid_seq'::regclass);


--
-- Name: user_project_release_machines rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_project_release_machines ALTER COLUMN rowid SET DEFAULT nextval('public.user_project_release_machines_rowid_seq'::regclass);


--
-- Name: users rowid; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN rowid SET DEFAULT nextval('public.users_rowid_seq'::regclass);


--
-- Data for Name: acceptance_criteria; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.acceptance_criteria (id, task_id, "position", title, description, preconditions, steps, test_data, expected_result, required, test_type, current_version, active, author, created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: acceptance_criterion_versions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.acceptance_criterion_versions (criterion_id, version, snapshot_json, author, reason, created_at, superseded_by, rowid) FROM stdin;
\.


--
-- Data for Name: agents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.agents (id, name, token_hash, created_at, last_seen, policy, user_id, token_expires_at, token_issued_at, last_ip, pin_ip, rowid) FROM stdin;
\.


--
-- Data for Name: app_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.app_config (key, value, rowid) FROM stdin;
codex_thread_usage_v2	1	2
message_branches_v1	1	1
\.


--
-- Data for Name: application_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.application_audit (id, application_id, grant_id, actor_user_name, action, at, rowid) FROM stdin;
\.


--
-- Data for Name: application_deployments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.application_deployments (id, project_id, environment, request_id, request_json, record_json, rowid) FROM stdin;
\.


--
-- Data for Name: application_environments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.application_environments (project_id, environment, revision, state_json, active_deployment_id, rowid) FROM stdin;
\.


--
-- Data for Name: application_grants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.application_grants (id, application_id, user_name, tenant_id, audience, permissions, token_hash, issued_at, expires_at, revoked_at, rowid) FROM stdin;
\.


--
-- Data for Name: application_releases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.application_releases (id, project_id, application_id, version, record_json, rowid) FROM stdin;
\.


--
-- Data for Name: applications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.applications (id, owner_user_name, tenant_id, name, created_at, revoked_at, rowid) FROM stdin;
\.


--
-- Data for Name: assistant_orchestration_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.assistant_orchestration_items (id, orchestration_id, "position", kind, title, task_id, depends_on_json, payload_json, status, attempts, run_id, result_json, error, started_at, finished_at, rowid) FROM stdin;
\.


--
-- Data for Name: assistant_orchestrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.assistant_orchestrations (id, project_id, conversation_id, owner, title, status, error, created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: board_views; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.board_views (username, project_id, value, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: browser_ui_release_operations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.browser_ui_release_operations (id, project_id, request_id, record_json, rowid) FROM stdin;
\.


--
-- Data for Name: chat_storage_bindings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.chat_storage_bindings (conversation_id, machine_id, storage_id, relative_path, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_command_suggestions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_command_suggestions (id, command_id, run_step_id, reason, proposed_script, status, occurrences, created_at, resolved_by, resolved_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_commands; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_commands (id, scope, project_id, name, script, description, workdir, timeout_sec, env_json, allow_failure, is_cleanup, available_to_model, is_test, builtin, version, created_by, created_at, updated_at, deleted_at, rowid) FROM stdin;
ci-builtin-kb-update	global	\N	Актуализировать базу знаний	# Серверный шаг: скрипт не выполняется.\n# Модель сверяет базу знаний с изменениями рабочей копии (см. kb/codeUpdate.ts).	Модель дописывает в базу знаний, что изменилось в этом ране: темы docs/kb/*.md в рабочей копии и статьи раздела проекта. Ошибка шага останавливает ран.		\N	{}	0	0	0	0	kb_update	1	system	1704067200000	1704067200000	\N	1
\.


--
-- Data for Name: ci_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_events (id, project_id, run_id, command_id, type, actor_type, actor_id, payload, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_fix_attempts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_fix_attempts (id, run_step_id, attempt_no, diagnosis, action, result, diff, changed_files_json, targeted_tests_json, full_rerun_json, failures_json, duration_ms, tokens_used, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_gate_results; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_gate_results (id, project_id, task_id, commit_sha, signature, commands_json, run_kind, run_id, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_interactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_interactions (id, run_id, step_id, seq, kind, questions_json, plan_text, answer_text, decision, status, conversation_id, message_id, created_at, answered_at, answered_by, rowid) FROM stdin;
\.


--
-- Data for Name: ci_llm_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_llm_configs (owner_type, owner_id, llm_engine_id, provider, model, mode, clarify_level, clarify_max, rowid) FROM stdin;
\.


--
-- Data for Name: ci_run_kb_gaps; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_run_kb_gaps (run_id, question, answer, topic, step_id, at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_run_kb_metrics; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_run_kb_metrics (run_id, sections_delivered, sections_hit, hit_ratio, calculated_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_run_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_run_logs (id, run_id, step_id, seq, stream, chunk, at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_run_steps; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_run_steps (id, run_id, slot, "position", kind, parent_step_id, initiated_by, command_id, command_snapshot, title, workdir, status, exit_code, attempt, fixed_by_model, started_at, finished_at, duration_ms, rowid) FROM stdin;
\.


--
-- Data for Name: ci_run_tool_calls; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_run_tool_calls (run_id, tool, calls, chars, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_run_tool_responses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_run_tool_responses (id, run_id, step_id, tool, kind, label, chars, original_chars, at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_run_usage; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_run_usage (id, run_id, step_id, kind, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms, num_turns, input_semantics, at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_runs (id, project_id, task_id, agent_id, agent_owner_id, agent_owner_name, agent_selection_source, status, error, workspace_id, triggered_by, prev_column_id, run_column_id, terminal_column_id, llm_engine_id, llm_provider, llm_model, mode, clarify_level, clarify_max, conversation_id, model_session_id, fix_context_json, kb_context_mode, slot_progress_json, started_at, finished_at, duration_ms, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_settings (id, max_fix_attempts, fix_time_limit_ms, fix_token_limit, default_step_timeout_sec, metrics_window, max_concurrent_runs, max_model_command_calls, interaction_wait_ms, stage_models, bash_output_limit_chars, read_output_limit_chars, read_window_max_lines, grep_match_limit, grep_output_limit_chars, rowid) FROM stdin;
\.


--
-- Data for Name: ci_slot_commands; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_slot_commands (id, owner_type, owner_id, slot, command_id, "position", rowid) FROM stdin;
\.


--
-- Data for Name: ci_stage_llm_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_stage_llm_configs (owner_type, owner_id, stage, llm_engine_id, provider, model, rowid) FROM stdin;
\.


--
-- Data for Name: ci_stage_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_stage_runs (id, run_id, task_id, stage, status, llm_engine_id, llm_provider, llm_model, outcome, started_at, finished_at, duration_ms, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_task_browser_checks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_task_browser_checks (task_id, check_json, rowid) FROM stdin;
\.


--
-- Data for Name: ci_task_process_stages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_task_process_stages (task_id, stages_json, rowid) FROM stdin;
\.


--
-- Data for Name: ci_test_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_test_events (id, run_id, group_id, type, user_id, payload, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_test_fix_cycles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_test_fix_cycles (id, project_id, task_id, test_run_id, failed_group_id, source_commit_sha, attempt_no, effective_limit, status, classification, failures_json, llm_engine_id, llm_provider, llm_model, model_session_id, diagnosis, action, changed_files_json, fix_commit_sha, next_test_run_id, full_test_result, blocked_reason, created_at, started_at, finished_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_test_fix_decisions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_test_fix_decisions (id, project_id, task_id, cycle_id, kind, reason, user_id, old_value, new_value, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_test_fix_targeted_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_test_fix_targeted_runs (id, fix_cycle_id, command, status, exit_code, log, started_at, finished_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_test_fix_task_state; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_test_fix_task_state (task_id, used_attempts, override_limit, active_cycle_id, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_test_group_configs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_test_group_configs (id, project_id, name, kind, command, command_version, "position", required, applicability, enabled, created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_test_group_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_test_group_runs (id, test_run_id, config_id, name, kind, command, command_version, "position", required, status, commit_sha, started_at, finished_at, duration_ms, exit_code, counters_json, current_suite, current_test, progress, log, failures_json, artifacts_json, skip_reason, not_applicable_json, browser_project, base_url, test_data, rowid) FROM stdin;
\.


--
-- Data for Name: ci_test_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_test_runs (id, project_id, task_id, branch, commit_sha, workspace, agent_id, preview_id, preview_commit_sha, analysis_model, triggered_by, attempt, previous_run_id, status, current_group_id, started_at, finished_at, duration_ms, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_test_targeted_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_test_targeted_runs (id, run_id, group_id, command, exit_code, result_json, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: ci_workspaces; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ci_workspaces (id, project_id, task_id, agent_id, path, npm_cache_dir, branch, commit_sha, pushed, state, size_bytes, created_at, released_by_step_id, rowid) FROM stdin;
\.


--
-- Data for Name: component_qa_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.component_qa_runs (id, project_id, task_id, development_run_id, linked_fix_run_id, branch, commit_sha, attempt, status, ui_impact, readiness_run_id, readiness_version, scenarios_json, components_json, commands_json, artifacts_json, failure_classification, blocker_reasons_json, summary, log, storybook_url, created_at, started_at, finished_at, stale_reason, rowid) FROM stdin;
\.


--
-- Data for Name: conversation_context_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversation_context_events (id, at, conversation_id, user_id, actor, item_id, enabled, value) FROM stdin;
\.


--
-- Data for Name: conversation_draft_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversation_draft_requests (user_id, idempotency_key, conversation_id, rowid) FROM stdin;
\.


--
-- Data for Name: conversation_group_memberships; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversation_group_memberships (group_id, conversation_id, rowid) FROM stdin;
\.


--
-- Data for Name: conversation_groups; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversation_groups (id, tenant_id, user_id, name, "position", created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: conversation_turn_control; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversation_turn_control (conversation_id, paused, rowid) FROM stdin;
\.


--
-- Data for Name: conversation_turn_queue; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversation_turn_queue (id, conversation_id, user_id, message_id, payload, status, "position", created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: conversation_workspaces; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversation_workspaces (conversation_id, project_id, machine_id, storage_id, mode, base_sha, branch, repository_path, state, diagnostic, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: conversations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversations (id, tenant_id, title, created_at, updated_at, claude_session_id, user_id, exec_target, workdir, skill_names, llm_engine_id, llm_provider, llm_model, reasoning_effort, deep_thinking, kb_context_mode, assistant_mode, disabled_context_json, project_id, preview_url, preview_engine, make_browser_session, task_id, assistant_kind, scope, assistant_autonomy, status, cost_usd, cost_status, cost_prices_stamp, cost_dirty, permission_mode, archived_at, summary_text, summary_covers_message_id, summary_updated_at, summary_source, context_usage_json, rowid) FROM stdin;
\.


--
-- Data for Name: email_verifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.email_verifications (token_hash, name, email, password_hash, created_at, expires_at, rowid) FROM stdin;
\.


--
-- Data for Name: environment_configurations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.environment_configurations (id, project_id, environment_id, revision, modules_json, note, core_json, created_by, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: environment_links; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.environment_links (id, project_id, environment_id, client_machine_id, server_machine_id, service_port, listener_port, transport, address, state, rowid) FROM stdin;
\.


--
-- Data for Name: environment_operations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.environment_operations (id, project_id, environment_id, configuration_id, previous_configuration_id, kind, status, steps_json, error, started_by, started_at, finished_at, rowid) FROM stdin;
\.


--
-- Data for Name: environment_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.environment_settings (project_id, environment_id, key, secret, value, source, updated_by, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: environments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.environments (id, project_id, name, machines_json, checkout_path, mode, storage_id, state, compose_project, port, created_by, created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: fts_state; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.fts_state (name, last_rowid, max_rowid, done, repairs, rowid) FROM stdin;
\.


--
-- Data for Name: generated_cleanup_retry; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.generated_cleanup_retry (conversation_id, user_id, attempts, last_error, next_attempt_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: git_workspace_locks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.git_workspace_locks (agent_id, path, holder, operation, acquired_at, expires_at, rowid) FROM stdin;
\.


--
-- Data for Name: identity_sign_in_tickets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.identity_sign_in_tickets (digest, core_id, realm, callback_url, challenge, session_sid, user_name, expires_at, rowid) FROM stdin;
\.


--
-- Data for Name: identity_subjects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.identity_subjects (id, user_name, created_at, rowid) FROM stdin;
00000000-0000-4000-8000-000000000001	admin	1704067200000	1
00000000-0000-4000-8000-000000000003	user	1704067200000	2
\.


--
-- Data for Name: integration_test_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.integration_test_runs (id, project_id, task_id, development_run_id, linked_fix_run_id, branch, commit_sha, attempt, status, readiness_run_id, snapshot_version, test_cases_json, automation_links_json, commands_json, log, failure_classification, failure_reason, blocker_reasons_json, summary, stale_reason, created_at, started_at, finished_at, rowid) FROM stdin;
\.


--
-- Data for Name: integration_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.integration_tokens (id, project_id, project_ids, name, scopes, token_hash, created_by, created_at, last_used_at, revoked_at, rowid) FROM stdin;
\.


--
-- Data for Name: invites; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.invites (token, role, created_by, created_at, expires_at, max_uses, uses, note, email, emailed_at, rowid) FROM stdin;
\.


--
-- Data for Name: kanban_columns; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.kanban_columns (id, project_id, name, semantic_type, "position", hidden, wip_limit, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: kb_documents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.kb_documents (id, scope, owner_id, project_id, title, kind, tags, areas, body, checked_on, created_by, created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: kb_usage_queries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.kb_usage_queries (id, seq, user_id, conversation_id, project_id, turn_id, message_id, ci_run_id, ci_step_id, source, status, query, confidence, injected, sections_count, chars, est_tokens, bundle_tokens, prompt_chars, turn_input_tokens, duration_ms, error, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: kb_usage_sections; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.kb_usage_sections (id, query_id, document_id, title, heading, anchor, source_path, related_files, chars, est_tokens, score, match_types, freshness, "position", rowid) FROM stdin;
\.


--
-- Data for Name: kb_usage_views; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.kb_usage_views (user_id, conversation_id, last_seq, viewed_at, rowid) FROM stdin;
\.


--
-- Data for Name: llm_engines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.llm_engines (id, name, kind, base_url, token, enabled, allowed_roles, is_default, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: login_device_emails; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.login_device_emails (user_name, ip, user_agent, sent_at, rowid) FROM stdin;
\.


--
-- Data for Name: login_enrollments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.login_enrollments (status_id, token_hash, user_id, expires_at, consumed_at, agent_id, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: machine_commands; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.machine_commands (id, machine_id, user_id, source, command, exit_code, timed_out, error, duration_ms, started_at, conversation_id, output_excerpt) FROM stdin;
\.


--
-- Data for Name: machine_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.machine_events (id, machine_id, user_id, state, at, offline_for_ms) FROM stdin;
\.


--
-- Data for Name: machine_project_share_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.machine_project_share_audit (id, project_id, agent_id, actor, old_value, new_value, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: machine_project_shares; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.machine_project_shares (project_id, agent_id, shared, created_at, updated_at, updated_by, access, rowid) FROM stdin;
\.


--
-- Data for Name: machine_storages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.machine_storages (id, machine_id, root_path, format_version, created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: machine_vpn_networks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.machine_vpn_networks (user_id, tailnet, encrypted_secret, generation, state, rowid) FROM stdin;
\.


--
-- Data for Name: merge_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.merge_runs (id, project_id, task_id, status, triggered_by, source_branch, target_branch, source_sha, target_sha, merge_sha, revert_sha, agent_id, llm_engine_id, llm_provider, llm_model, requested_llm_provider, requested_llm_model, llm_fallback_reason, assignment_version, machine_name, stage, conflicts_json, deploy_id, deploy_version, production_status, error, log, stages_json, checks_json, recommended_action, push_started_at, started_at, finished_at, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: message_service_data; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.message_service_data (message_id, conversation_id, activity, request, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.messages (id, conversation_id, role, text, "time", created_at, engine, meta, exec_target, attachments, state, history_position, parent_message_id, branch_selected, rowid) FROM stdin;
\.


--
-- Data for Name: model_prices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.model_prices (provider, model, input_per_million, cached_input_per_million, cache_write_per_million, output_per_million, tiers_json, source_url, effective_at, updated_at, rowid) FROM stdin;
codex	gpt-5.3-codex	1.75	0.175	0	14	[]	https://developers.openai.com/api/docs/pricing	1785801600000	1785801600000	14
codex	gpt-5.4	2.5	0.25	0	15	[]	https://developers.openai.com/api/docs/pricing	1785801600000	1785801600000	10
codex	gpt-5.4-mini	0.75	0.075	0	4.5	[]	https://developers.openai.com/api/docs/pricing	1785801600000	1785801600000	11
codex	gpt-5.4-nano	0.2	0.02	0	1.25	[]	https://developers.openai.com/api/docs/pricing	1785801600000	1785801600000	12
codex	gpt-5.4-pro	30	0	0	180	[]	https://developers.openai.com/api/docs/pricing	1785801600000	1785801600000	13
codex	gpt-5.5	5	0.5	0	30	[]	https://developers.openai.com/api/docs/pricing	1785801600000	1785801600000	8
codex	gpt-5.5-pro	30	0	0	180	[]	https://developers.openai.com/api/docs/pricing	1785801600000	1785801600000	9
codex	gpt-5.6-luna	0.2	0.02	0.25	1.2	[{"mode":"standard","context":"long","inputPerMillion":0.4,"cachedInputPerMillion":0.04,"cacheWritePerMillion":0.5,"outputPerMillion":1.8}]	https://developers.openai.com/api/docs/pricing	1788825600000	1788825600000	7
codex	gpt-5.6-sol	4	0.4	5	20	[{"mode":"standard","context":"long","inputPerMillion":8,"cachedInputPerMillion":0.8,"cacheWritePerMillion":10,"outputPerMillion":30}]	https://developers.openai.com/api/docs/pricing	1788825600000	1788825600000	5
codex	gpt-5.6-terra	2	0.2	2.5	12	[{"mode":"standard","context":"long","inputPerMillion":4,"cachedInputPerMillion":0.4,"cacheWritePerMillion":5,"outputPerMillion":18}]	https://developers.openai.com/api/docs/pricing	1788825600000	1788825600000	6
codex	gpt-6-astra	10	1	12.5	50	[{"mode":"standard","context":"long","inputPerMillion":20,"cachedInputPerMillion":2,"cacheWritePerMillion":25,"outputPerMillion":75}]	https://developers.openai.com/api/docs/pricing	1788825600000	1788825600000	4
codex	gpt-6-luna	0.1	0.01	0.125	0.5	[{"mode":"standard","context":"long","inputPerMillion":0.2,"cachedInputPerMillion":0.02,"cacheWritePerMillion":0.25,"outputPerMillion":0.75},{"mode":"batch","context":"short","inputPerMillion":0.05,"cachedInputPerMillion":0.005,"cacheWritePerMillion":0.0625,"outputPerMillion":0.25},{"mode":"batch","context":"long","inputPerMillion":0.1,"cachedInputPerMillion":0.01,"cacheWritePerMillion":0.125,"outputPerMillion":0.375},{"mode":"flex","context":"short","inputPerMillion":0.05,"cachedInputPerMillion":0.005,"cacheWritePerMillion":0.0625,"outputPerMillion":0.25},{"mode":"flex","context":"long","inputPerMillion":0.1,"cachedInputPerMillion":0.01,"cacheWritePerMillion":0.125,"outputPerMillion":0.375},{"mode":"fast","context":"short","inputPerMillion":0.2,"cachedInputPerMillion":0.02,"cacheWritePerMillion":0.25,"outputPerMillion":1.0},{"mode":"fast","context":"long","inputPerMillion":0.4,"cachedInputPerMillion":0.04,"cacheWritePerMillion":0.5,"outputPerMillion":1.5}]	https://developers.openai.com/api/docs/models/gpt-6-luna	1792886400000	1792886400000	3
codex	gpt-6-sol	2	0.2	2.5	10	[{"mode":"standard","context":"long","inputPerMillion":4,"cachedInputPerMillion":0.4,"cacheWritePerMillion":5.0,"outputPerMillion":15.0},{"mode":"batch","context":"short","inputPerMillion":1.0,"cachedInputPerMillion":0.1,"cacheWritePerMillion":1.25,"outputPerMillion":5.0},{"mode":"batch","context":"long","inputPerMillion":2.0,"cachedInputPerMillion":0.2,"cacheWritePerMillion":2.5,"outputPerMillion":7.5},{"mode":"flex","context":"short","inputPerMillion":1.0,"cachedInputPerMillion":0.1,"cacheWritePerMillion":1.25,"outputPerMillion":5.0},{"mode":"flex","context":"long","inputPerMillion":2.0,"cachedInputPerMillion":0.2,"cacheWritePerMillion":2.5,"outputPerMillion":7.5},{"mode":"fast","context":"short","inputPerMillion":4,"cachedInputPerMillion":0.4,"cacheWritePerMillion":5.0,"outputPerMillion":20},{"mode":"fast","context":"long","inputPerMillion":8,"cachedInputPerMillion":0.8,"cacheWritePerMillion":10.0,"outputPerMillion":30.0}]	https://developers.openai.com/api/docs/models/gpt-6-sol	1792886400000	1792886400000	2
codex	gpt-6.1-sol	2	0.1	2.5	10	[{"mode":"standard","context":"long","inputPerMillion":4,"cachedInputPerMillion":0.2,"cacheWritePerMillion":5.0,"outputPerMillion":15.0},{"mode":"batch","context":"short","inputPerMillion":1.0,"cachedInputPerMillion":0.05,"cacheWritePerMillion":1.25,"outputPerMillion":5.0},{"mode":"batch","context":"long","inputPerMillion":2.0,"cachedInputPerMillion":0.1,"cacheWritePerMillion":2.5,"outputPerMillion":7.5},{"mode":"flex","context":"short","inputPerMillion":1.0,"cachedInputPerMillion":0.05,"cacheWritePerMillion":1.25,"outputPerMillion":5.0},{"mode":"flex","context":"long","inputPerMillion":2.0,"cachedInputPerMillion":0.1,"cacheWritePerMillion":2.5,"outputPerMillion":7.5},{"mode":"fast","context":"short","inputPerMillion":4,"cachedInputPerMillion":0.2,"cacheWritePerMillion":5.0,"outputPerMillion":20},{"mode":"fast","context":"long","inputPerMillion":8,"cachedInputPerMillion":0.4,"cacheWritePerMillion":10.0,"outputPerMillion":30.0}]	https://developers.openai.com/api/docs/models/gpt-6.1-sol	1792886400000	1792886400000	1
\.


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.password_reset_tokens (token_hash, user_name, created_at, expires_at, rowid) FROM stdin;
\.


--
-- Data for Name: project_invitations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_invitations (id, project_id, email, invited_username, role, token_hash, status, invited_by, created_at, expires_at, responded_at, rowid) FROM stdin;
\.


--
-- Data for Name: project_machines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_machines (project_id, agent_id, path, repos_root, ssh_host, ssh_user, storage_id, directories_json, added_at, added_by, rowid) FROM stdin;
\.


--
-- Data for Name: project_member_role_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_member_role_audit (id, project_id, target_user, actor, old_role, new_role, action, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: project_members; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_members (project_id, username, role, qa_permission, added_at, rowid) FROM stdin;
\.


--
-- Data for Name: project_release_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_release_events (id, release_id, type, actor, payload_json, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: project_release_steps; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_release_steps (id, release_id, kind, "position", status, model, attempt, log, started_at, finished_at, limit_ms, rowid) FROM stdin;
\.


--
-- Data for Name: project_releases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_releases (id, project_id, version, branch, commit_sha, status, triggered_by, attempt, previous_release_id, created_at, released_at, agent_id, checkout_path, deleted_at, archived_at, rowid) FROM stdin;
\.


--
-- Data for Name: project_stand_previews; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_stand_previews (project_id, config_json, updated_by, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: project_type_review_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_type_review_audit (id, type_id, actor, old_status, new_status, note, at) FROM stdin;
\.


--
-- Data for Name: project_types; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.project_types (id, parent_id, name, description, features_json, defaults_json, builtin, owner_id, status, review_note, reviewed_by, reviewed_at, created_by, created_at, updated_at, rowid) FROM stdin;
type-general	\N	Общий проект	Доска, задачи и участники без разработческой обвязки: ни git, ни CI, ни релизов.	{"git":false,"machines":false,"ci":false,"qa":false,"releases":false,"preview":false}	{"columns":[{"name":"Бэклог","semanticType":"backlog"},{"name":"В работе","semanticType":"development"},{"name":"Готово","semanticType":"done"},{"name":"Отменено","semanticType":"cancelled"},{"name":"Требуется решение","semanticType":"decision_required"}]}	1	\N	published		\N	\N	system	1704067200000	1704067200000	6
type-software	\N	Разработка ПО	Канбан с конвейером разработки, git, CI-раны, QA-этапы, релизы и машины.	{"git":true,"machines":true,"ci":true,"qa":true,"releases":true,"preview":true}	{}	1	\N	published		\N	\N	system	1704067200000	1704067200000	1
type-software-backend	type-software	Бэкенд	Серверное приложение: API, база данных, автоматические проверки и развёртывание.	{}	{"ciBaseBranch":"main","ciBranchTemplate":"{task_number}","ciReuseStrategy":"clean","columns":[{"name":"Бэклог","semanticType":"backlog"},{"name":"Подготовка к разработке","semanticType":"preparation"},{"name":"Ready for Development","semanticType":"ready"},{"name":"Development","semanticType":"development"},{"name":"Component QA","semanticType":"component_qa"},{"name":"Создание интеграционных автотестов","semanticType":"integration_tests"},{"name":"Automated QA","semanticType":"automated_qa"},{"name":"Ручное QA","semanticType":"manual_qa"},{"name":"Ожидает мержа","semanticType":"awaiting_merge"},{"name":"Мерж","semanticType":"merge"},{"name":"Готово","semanticType":"done"},{"name":"Отменено","semanticType":"cancelled"},{"name":"Требуется решение","semanticType":"decision_required"}],"technologies":["backend","api","database"],"skills":["архитектура","API","базы данных"],"defaultSkills":{"epic":["архитектура"],"story":["API","базы данных"],"task":["backend","тестирование"]}}	1	\N	published		\N	\N	system	1704067200000	1704067200000	3
type-software-library	type-software	Библиотека	Переиспользуемый пакет или SDK: публичный API, совместимость, тесты и публикация.	{"preview":false}	{"ciBaseBranch":"main","ciBranchTemplate":"{task_number}","ciReuseStrategy":"clean","columns":[{"name":"Бэклог","semanticType":"backlog"},{"name":"Подготовка","semanticType":"preparation"},{"name":"Готово к разработке","semanticType":"ready"},{"name":"Разработка","semanticType":"development"},{"name":"Автотесты","semanticType":"automated_qa"},{"name":"Ожидает мержа","semanticType":"awaiting_merge"},{"name":"Мерж","semanticType":"merge"},{"name":"Готово","semanticType":"done"},{"name":"Отменено","semanticType":"cancelled"},{"name":"Требуется решение","semanticType":"decision_required"}],"technologies":["library","sdk","package"],"skills":["проектирование API","совместимость","документация"],"defaultSkills":{"epic":["проектирование API"],"story":["совместимость","документация"],"task":["тестирование","документация"]}}	1	\N	published		\N	\N	system	1704067200000	1704067200000	5
type-software-mobile	type-software	Мобильное приложение	Приложение для iOS и Android: мобильная разработка, тестирование и сборки.	{}	{"ciBaseBranch":"main","ciBranchTemplate":"{task_number}","ciReuseStrategy":"clean","columns":[{"name":"Бэклог","semanticType":"backlog"},{"name":"Подготовка к разработке","semanticType":"preparation"},{"name":"Ready for Development","semanticType":"ready"},{"name":"Development","semanticType":"development"},{"name":"Component QA","semanticType":"component_qa"},{"name":"Создание интеграционных автотестов","semanticType":"integration_tests"},{"name":"Automated QA","semanticType":"automated_qa"},{"name":"Ручное QA","semanticType":"manual_qa"},{"name":"Ожидает мержа","semanticType":"awaiting_merge"},{"name":"Мерж","semanticType":"merge"},{"name":"Готово","semanticType":"done"},{"name":"Отменено","semanticType":"cancelled"},{"name":"Требуется решение","semanticType":"decision_required"}],"technologies":["mobile","ios","android"],"skills":["мобильная разработка","UI/UX","тестирование"],"defaultSkills":{"epic":["мобильная архитектура"],"story":["UI/UX"],"task":["мобильная разработка","тестирование"]}}	1	\N	published		\N	\N	system	1704067200000	1704067200000	4
type-software-web	type-software	Веб-приложение	Разработка ПО с веб-превью и Storybook: заготовки под фронтенд-проект.	{}	{"technologies":["web"]}	1	\N	published		\N	\N	system	1704067200000	1704067200000	2
\.


--
-- Data for Name: projects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.projects (id, tenant_id, tenant_kind, project_type_id, name, description, git_url, preview_url, technologies, skills, created_by, created_at, updated_at, default_agent_id, commit_policy, merge_transport, agent_plan_approval_mode, test_command, merge_test_command, component_qa_command, integration_test_command, automated_qa_command, automated_qa_mode, automated_qa_scenario_json, autopilot_default, autopilot_requires_manual_qa, autopilot_fix_limit, production_deploy_command, production_agent_id, production_environment_mode, production_checkout_path, production_health_check_command, release_timeouts_json, default_skills_epic, default_skills_story, default_skills_task, task_seq, done_retention_days, ci_test_fix_cycle_limit, test_users_json, command_policy, ci_base_branch, ci_branch_template, ci_reuse_strategy, ci_exec_auth_ref, ci_kb_context_mode, rowid) FROM stdin;
\.


--
-- Data for Name: public_client_access; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.public_client_access (token_hash, grant_id, family_id, application_id, user_name, tenant_id, session_sid, audience, permissions, issued_at, expires_at, rowid) FROM stdin;
\.


--
-- Data for Name: public_client_codes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.public_client_codes (code_hash, application_id, redirect_uri, user_name, tenant_id, session_sid, challenge, audience, permissions, expires_at, consumed_at, rowid) FROM stdin;
\.


--
-- Data for Name: public_client_families; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.public_client_families (id, application_id, redirect_uri, user_name, tenant_id, session_sid, audience, permissions, expires_at, revoked_at, rowid) FROM stdin;
\.


--
-- Data for Name: public_client_redirects; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.public_client_redirects (application_id, uri, rowid) FROM stdin;
\.


--
-- Data for Name: public_client_refresh; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.public_client_refresh (token_hash, family_id, consumed_at, rowid) FROM stdin;
\.


--
-- Data for Name: qa_attachments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_attachments (id, result_id, upload_id, name, mime_type, size, width, height, caption, author, created_at, commit_sha, rowid) FROM stdin;
\.


--
-- Data for Name: qa_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_audit (id, project_id, task_id, session_id, criterion_id, result_id, action, actor, payload_json, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: qa_criterion_results; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_criterion_results (id, session_id, criterion_id, criterion_version, status, draft, tester_id, assignee_id, started_at, finished_at, branch, commit_sha, preview_id, preview_sha, app_url, storybook_url, test_data_scenario, executed_steps, expected_result, actual_result, comment, environment, blocker_reason, blocker_type, blocker_owner, not_applicable_reason, revision, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: qa_issues; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_issues (id, result_id, classification, severity, frequency, reproduction, proposed_route, requirement_proposal, resolution, linked_fix_run_id, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: qa_preparation_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_preparation_runs (id, project_id, task_id, branch, commit_sha, status, log, error, attempt, diagnostics_json, created_at, finished_at, rowid) FROM stdin;
\.


--
-- Data for Name: qa_sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_sessions (id, task_id, project_id, branch, commit_sha, test_run_id, preview_id, preview_sha, app_url, storybook_url, test_data_scenario, criteria_snapshot_json, status, tester_id, initiated_by, started_at, finished_at, stale_reason, summary, additional_issues, linked_fix_run_id, rowid) FROM stdin;
\.


--
-- Data for Name: qa_stage_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.qa_stage_runs (id, project_id, task_id, stage, status, attempt, triggered_by, branch, commit_sha, llm_engine_id, llm_provider, llm_model, current_step, progress_json, log_json, result_json, gate_reasons_json, scenario_json, error, created_at, started_at, finished_at, rowid) FROM stdin;
\.


--
-- Data for Name: release_notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.release_notifications (id, user_id, project_id, release_id, title, text, created_at, dismissed_at, rowid) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (name, applied_at, rowid) FROM stdin;
\.


--
-- Data for Name: security_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.security_events (id, at, user_name, type, ip, user_agent, details, session_sid) FROM stdin;
\.


--
-- Data for Name: session_revocations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.session_revocations (token_hash, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sessions (kind, access, sid, user_name, created_at, last_seen, expires_at, ip, user_agent, revoked_at, label, device_key, trusted_at, platform, client_version, geo, requests, last_path, end_reason, device_secret, two_factor, rowid) FROM stdin;
\.


--
-- Data for Name: settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.settings (key, value, rowid) FROM stdin;
app:admin	{"chatFilesBackend":"machine","model":"default","whisperModel":"large-v3-turbo","diarization":true,"voice":"ru_RU-ruslan-medium","micDeviceId":null,"autoSpeak":false,"showConsole":false,"theme":"light","onboarded":true,"machineCommandNotices":"failures","machineCommandNoticeSeconds":8,"machineCommandSystemNotifications":true,"permissionMode":"bypassPermissions","workdir":null,"bargeIn":false,"handsFree":false,"execTarget":null,"llmEngineId":null,"llmProvider":"claude","reasoningEffort":"medium","deepThinking":false,"codexModel":"gpt-6-astra","defaultAgentId":null,"aiAssistProvider":"claude","aiAssistModel":"haiku","aiAssistPrompts":[{"id":"clear","title":"Ясно и конкретно","text":"Сделай формулировку ясной, конкретной и однозначной.","enabled":true,"readonly":true},{"id":"concise","title":"Кратко","text":"Убери повторы и лишние слова, сохранив важные детали.","enabled":true},{"id":"structured","title":"Структурированно","text":"Если уместно, добавь структуру и явный ожидаемый результат.","enabled":true}],"generatedFilesTtlDays":30,"personalization":{"preferredName":null,"birthDay":null,"birthMonth":null,"birthYear":null,"responseLanguage":null,"responseStyle":"normal","tone":"neutral","avatar":null},"chatInstructions":[{"id":"console","kind":"console","enabled":true,"title":"Открывать терминал в чате","description":"По просьбе «открой консоль» модель вставляет в ответ живой терминал машины."},{"id":"explorer","kind":"explorer","enabled":true,"title":"Открывать проводник в чате","description":"По просьбе «открой проводник» модель вставляет файловый проводник машины."},{"id":"git","kind":"git","enabled":true,"title":"Открывать панель кода в чате","description":"По просьбе «покажи изменения» модель вставляет панель кода рабочей копии: diff, правка, коммит."},{"id":"questions","kind":"questions","enabled":true,"title":"Уточняющие вопросы с вариантами","description":"Модель может закончить ответ вопросами с кнопками-вариантами ответа."},{"id":"image","kind":"image","enabled":true,"title":"Показывать созданные изображения","description":"Файл-картинку, созданный на машине, модель показывает прямо в сообщении."},{"id":"taskLaunch","kind":"taskLaunch","enabled":true,"title":"Спрашивать разрешение перед изменением проекта","description":"Перед правкой файлов модель предлагает завести задачу в канбан или работать в чате."}],"loginNewDeviceEmails":true,"contextPresets":[],"requiredContextItems":[],"defaultContextPresetId":null}	1
app:user	{"chatFilesBackend":"machine","model":"default","whisperModel":"large-v3-turbo","diarization":true,"voice":"ru_RU-ruslan-medium","micDeviceId":null,"autoSpeak":false,"showConsole":false,"theme":"light","onboarded":true,"machineCommandNotices":"failures","machineCommandNoticeSeconds":8,"machineCommandSystemNotifications":true,"permissionMode":"bypassPermissions","workdir":null,"bargeIn":false,"handsFree":false,"execTarget":null,"llmEngineId":null,"llmProvider":"claude","reasoningEffort":"medium","deepThinking":false,"codexModel":"gpt-6-astra","defaultAgentId":null,"aiAssistProvider":"claude","aiAssistModel":"haiku","aiAssistPrompts":[{"id":"clear","title":"Ясно и конкретно","text":"Сделай формулировку ясной, конкретной и однозначной.","enabled":true,"readonly":true},{"id":"concise","title":"Кратко","text":"Убери повторы и лишние слова, сохранив важные детали.","enabled":true},{"id":"structured","title":"Структурированно","text":"Если уместно, добавь структуру и явный ожидаемый результат.","enabled":true}],"generatedFilesTtlDays":30,"personalization":{"preferredName":null,"birthDay":null,"birthMonth":null,"birthYear":null,"responseLanguage":null,"responseStyle":"normal","tone":"neutral","avatar":null},"chatInstructions":[{"id":"console","kind":"console","enabled":true,"title":"Открывать терминал в чате","description":"По просьбе «открой консоль» модель вставляет в ответ живой терминал машины."},{"id":"explorer","kind":"explorer","enabled":true,"title":"Открывать проводник в чате","description":"По просьбе «открой проводник» модель вставляет файловый проводник машины."},{"id":"git","kind":"git","enabled":true,"title":"Открывать панель кода в чате","description":"По просьбе «покажи изменения» модель вставляет панель кода рабочей копии: diff, правка, коммит."},{"id":"questions","kind":"questions","enabled":true,"title":"Уточняющие вопросы с вариантами","description":"Модель может закончить ответ вопросами с кнопками-вариантами ответа."},{"id":"image","kind":"image","enabled":true,"title":"Показывать созданные изображения","description":"Файл-картинку, созданный на машине, модель показывает прямо в сообщении."},{"id":"taskLaunch","kind":"taskLaunch","enabled":true,"title":"Спрашивать разрешение перед изменением проекта","description":"Перед правкой файлов модель предлагает завести задачу в канбан или работать в чате."}],"loginNewDeviceEmails":true,"contextPresets":[],"requiredContextItems":[],"defaultContextPresetId":null}	2
\.


--
-- Data for Name: speakers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.speakers (conversation_id, speaker_id, label, rowid) FROM stdin;
\.


--
-- Data for Name: storage_acceptances; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.storage_acceptances (share_id, user_id, data, rowid) FROM stdin;
\.


--
-- Data for Name: storage_entries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.storage_entries (space_id, path, size, data, rowid) FROM stdin;
\.


--
-- Data for Name: storage_lock; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.storage_lock (id, version, rowid) FROM stdin;
1	0	1
\.


--
-- Data for Name: storage_shares; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.storage_shares (id, space_id, token, data, rowid) FROM stdin;
\.


--
-- Data for Name: storage_space_refs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.storage_space_refs (owner_id, kind, ref_key, space_id, rowid) FROM stdin;
\.


--
-- Data for Name: storage_spaces; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.storage_spaces (id, owner_id, data, rowid) FROM stdin;
\.


--
-- Data for Name: storage_uploads; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.storage_uploads (id, data, rowid) FROM stdin;
\.


--
-- Data for Name: tariff_plans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tariff_plans (id, name, capabilities, revision, created_at, updated_at, rowid) FROM stdin;
standard	Стандартный	["chat.use","make.use","web-reader.use","playwright-reader.use","image-studio.use","voice.stt","voice.tts","projects.use","machines.use"]	1	1704067200000	1704067200000	1
\.


--
-- Data for Name: task_attachments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_attachments (id, task_id, rework_cycle_id, scope, name, size, mime_type, storage_key, checksum, data_base64, status, created_by, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: task_comments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_comments (id, project_id, task_id, author, via, text, created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: task_creation_audit; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_creation_audit (id, project_id, task_id, created_by, created_by_name, assignee, source, assignment_method, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: task_creation_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_creation_requests (actor, idempotency_key, task_id, rowid) FROM stdin;
\.


--
-- Data for Name: task_designs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_designs (id, task_id, conversation_id, path, mode, paths_json, label, created_by, created_at, rowid) FROM stdin;
\.


--
-- Data for Name: task_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_history (id, project_id, task_id, actor, via, field, from_value, to_value, at, rowid) FROM stdin;
\.


--
-- Data for Name: task_improvements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_improvements (id, project_id, task_id, run_id, step_id, source, status, title, description, acceptance_criteria, created_task_id, fingerprint, evidence_json, files_json, occurrences, suggested_action, created_at, updated_at, resolved_by, resolved_at, rowid) FROM stdin;
\.


--
-- Data for Name: task_launch_results; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_launch_results (project_id, proposal_id, action, task_id, run_id, error, created_by, created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: task_preparation_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_preparation_events (event_id, attempt_id, sequence, "timestamp", type, phase, text, data_json, rowid) FROM stdin;
\.


--
-- Data for Name: task_preparation_notification_dismissals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_preparation_notification_dismissals (question_id, user_id, dismissed_at, rowid) FROM stdin;
\.


--
-- Data for Name: task_preparation_questions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_preparation_questions (question_id, attempt_id, text, material, answer, asked_at, answered_at, answered_by, rowid) FROM stdin;
\.


--
-- Data for Name: task_preparation_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_preparation_runs (id, project_id, task_id, status, phase, attempt, task_key, machine_id, machine_name_snapshot, llm_engine_id, provider, model, profile_id, log, error, readiness_json, gate_reasons_json, gate_results_json, created_at, started_at, finished_at, rowid) FROM stdin;
\.


--
-- Data for Name: task_preparation_steps; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_preparation_steps (id, attempt_id, ordinal, name, status, started_at, finished_at, error, rowid) FROM stdin;
\.


--
-- Data for Name: task_repositories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_repositories (id, project_id, task_id, agent_id, path, kind, state, created_at, deleted_at, rowid) FROM stdin;
\.


--
-- Data for Name: task_rework_attachments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_rework_attachments (id, cycle_id, upload_id, "position", name, mime_type, size, rowid) FROM stdin;
\.


--
-- Data for Name: task_rework_cycles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_rework_cycles (id, project_id, task_id, sequence, description, criteria_json, make_sources_json, implemented_result, created_by, created_at, preparation_run_id, idempotency_key, payload_hash, status, rowid) FROM stdin;
\.


--
-- Data for Name: task_worklog; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.task_worklog (id, project_id, task_id, author, minutes, comment, started_at, created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tasks (id, project_id, column_id, title, description, acceptance_criteria, type, parent_id, source_task_id, priority, assignee, created_by, created_by_name, agent_id, labels, skills, story_points, due_date, flagged, auto_pilot, auto_pilot_requires_manual_qa, auto_pilot_fix_cycles, done_at, preview_ready, seq, "position", created_at, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: team_tenant_invitations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.team_tenant_invitations (id, tenant_id, target, role, token_hash, invited_by, created_at, expires_at, rowid) FROM stdin;
\.


--
-- Data for Name: team_tenant_memberships; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.team_tenant_memberships (tenant_id, user_name, role, created_at, rowid) FROM stdin;
00000000-0000-4000-8000-000000000005	admin	owner	1704067200000	1
\.


--
-- Data for Name: team_tenant_tariffs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.team_tenant_tariffs (tenant_id, tariff_id, updated_at, rowid) FROM stdin;
00000000-0000-4000-8000-000000000005	standard	1704067200000	1
\.


--
-- Data for Name: team_tenants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.team_tenants (id, owner_user_name, name, created_at, rowid) FROM stdin;
00000000-0000-4000-8000-000000000005	admin	Stand	1704067200000	1
\.


--
-- Data for Name: tenant_memberships; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tenant_memberships (tenant_id, user_name, role, created_at, rowid) FROM stdin;
00000000-0000-4000-8000-000000000002	admin	owner	1704067200000	1
00000000-0000-4000-8000-000000000004	user	owner	1704067200000	2
\.


--
-- Data for Name: tenant_tariffs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tenant_tariffs (tenant_id, tariff_id, updated_at, rowid) FROM stdin;
00000000-0000-4000-8000-000000000002	standard	1704067200000	1
00000000-0000-4000-8000-000000000004	standard	1704067200000	2
\.


--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tenants (id, kind, owner_user_name, name, created_at, rowid) FROM stdin;
00000000-0000-4000-8000-000000000002	personal	admin	admin	1704067200000	1
00000000-0000-4000-8000-000000000004	personal	user	user	1704067200000	2
\.


--
-- Data for Name: user_llm_access; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_llm_access (user_name, provider, model_id, rowid) FROM stdin;
\.


--
-- Data for Name: user_project_machine_defaults; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_project_machine_defaults (username, project_id, agent_id, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: user_project_release_machines; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_project_release_machines (username, project_id, agent_id, updated_at, rowid) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (name, password_hash, role, blocked, created_at, failed_logins, locked_until, lock_reason, totp_secret, reset_code_hash, reset_code_expires, must_change_password, last_login, notices_seen_at, llm_limit_usd, email, rowid) FROM stdin;
admin	scrypt$00000000000000000000000000000001$72170c30b6a09f3bf480b353d2b0ef01b6fe862831f769531d1b210fe9d3afb6	admin	0	1704067200000	0	\N	\N	\N	\N	\N	0	\N	0	\N	\N	1
user	scrypt$00000000000000000000000000000002$2ddece733df2dd1832e1a01b50b256d48719612be4adc8df862c23c208d76ce5	developer	0	1704067200000	0	\N	\N	\N	\N	\N	0	\N	0	\N	\N	2
\.


--
-- Name: acceptance_criteria_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.acceptance_criteria_rowid_seq', 1, false);


--
-- Name: acceptance_criterion_versions_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.acceptance_criterion_versions_rowid_seq', 1, false);


--
-- Name: agents_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.agents_rowid_seq', 1, false);


--
-- Name: app_config_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.app_config_rowid_seq', 2, true);


--
-- Name: application_audit_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.application_audit_rowid_seq', 1, false);


--
-- Name: application_deployments_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.application_deployments_rowid_seq', 1, false);


--
-- Name: application_environments_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.application_environments_rowid_seq', 1, false);


--
-- Name: application_grants_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.application_grants_rowid_seq', 1, false);


--
-- Name: application_releases_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.application_releases_rowid_seq', 1, false);


--
-- Name: applications_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.applications_rowid_seq', 1, false);


--
-- Name: assistant_orchestration_items_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.assistant_orchestration_items_rowid_seq', 1, false);


--
-- Name: assistant_orchestrations_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.assistant_orchestrations_rowid_seq', 1, false);


--
-- Name: board_views_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.board_views_rowid_seq', 1, false);


--
-- Name: browser_ui_release_operations_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.browser_ui_release_operations_rowid_seq', 1, false);


--
-- Name: chat_storage_bindings_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.chat_storage_bindings_rowid_seq', 1, false);


--
-- Name: ci_command_suggestions_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_command_suggestions_rowid_seq', 1, false);


--
-- Name: ci_commands_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_commands_rowid_seq', 1, true);


--
-- Name: ci_events_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_events_rowid_seq', 1, false);


--
-- Name: ci_fix_attempts_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_fix_attempts_rowid_seq', 1, false);


--
-- Name: ci_gate_results_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_gate_results_rowid_seq', 1, false);


--
-- Name: ci_interactions_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_interactions_rowid_seq', 1, false);


--
-- Name: ci_llm_configs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_llm_configs_rowid_seq', 1, false);


--
-- Name: ci_run_kb_gaps_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_run_kb_gaps_rowid_seq', 1, false);


--
-- Name: ci_run_kb_metrics_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_run_kb_metrics_rowid_seq', 1, false);


--
-- Name: ci_run_logs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_run_logs_rowid_seq', 1, false);


--
-- Name: ci_run_steps_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_run_steps_rowid_seq', 1, false);


--
-- Name: ci_run_tool_calls_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_run_tool_calls_rowid_seq', 1, false);


--
-- Name: ci_run_tool_responses_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_run_tool_responses_rowid_seq', 1, false);


--
-- Name: ci_run_usage_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_run_usage_rowid_seq', 1, false);


--
-- Name: ci_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_runs_rowid_seq', 1, false);


--
-- Name: ci_settings_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_settings_rowid_seq', 1, false);


--
-- Name: ci_slot_commands_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_slot_commands_rowid_seq', 1, false);


--
-- Name: ci_stage_llm_configs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_stage_llm_configs_rowid_seq', 1, false);


--
-- Name: ci_stage_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_stage_runs_rowid_seq', 1, false);


--
-- Name: ci_task_browser_checks_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_task_browser_checks_rowid_seq', 1, false);


--
-- Name: ci_task_process_stages_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_task_process_stages_rowid_seq', 1, false);


--
-- Name: ci_test_events_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_test_events_rowid_seq', 1, false);


--
-- Name: ci_test_fix_cycles_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_test_fix_cycles_rowid_seq', 1, false);


--
-- Name: ci_test_fix_decisions_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_test_fix_decisions_rowid_seq', 1, false);


--
-- Name: ci_test_fix_targeted_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_test_fix_targeted_runs_rowid_seq', 1, false);


--
-- Name: ci_test_fix_task_state_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_test_fix_task_state_rowid_seq', 1, false);


--
-- Name: ci_test_group_configs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_test_group_configs_rowid_seq', 1, false);


--
-- Name: ci_test_group_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_test_group_runs_rowid_seq', 1, false);


--
-- Name: ci_test_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_test_runs_rowid_seq', 1, false);


--
-- Name: ci_test_targeted_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_test_targeted_runs_rowid_seq', 1, false);


--
-- Name: ci_workspaces_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.ci_workspaces_rowid_seq', 1, false);


--
-- Name: component_qa_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.component_qa_runs_rowid_seq', 1, false);


--
-- Name: conversation_context_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.conversation_context_events_id_seq', 1, false);


--
-- Name: conversation_draft_requests_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.conversation_draft_requests_rowid_seq', 1, false);


--
-- Name: conversation_group_memberships_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.conversation_group_memberships_rowid_seq', 1, false);


--
-- Name: conversation_groups_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.conversation_groups_rowid_seq', 1, false);


--
-- Name: conversation_turn_control_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.conversation_turn_control_rowid_seq', 1, false);


--
-- Name: conversation_turn_queue_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.conversation_turn_queue_rowid_seq', 1, false);


--
-- Name: conversation_workspaces_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.conversation_workspaces_rowid_seq', 1, false);


--
-- Name: conversations_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.conversations_rowid_seq', 1, false);


--
-- Name: email_verifications_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.email_verifications_rowid_seq', 1, false);


--
-- Name: environment_configurations_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.environment_configurations_rowid_seq', 1, false);


--
-- Name: environment_links_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.environment_links_rowid_seq', 1, false);


--
-- Name: environment_operations_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.environment_operations_rowid_seq', 1, false);


--
-- Name: environment_settings_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.environment_settings_rowid_seq', 1, false);


--
-- Name: environments_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.environments_rowid_seq', 1, false);


--
-- Name: fts_state_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.fts_state_rowid_seq', 1, false);


--
-- Name: generated_cleanup_retry_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.generated_cleanup_retry_rowid_seq', 1, false);


--
-- Name: git_workspace_locks_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.git_workspace_locks_rowid_seq', 1, false);


--
-- Name: identity_sign_in_tickets_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.identity_sign_in_tickets_rowid_seq', 1, false);


--
-- Name: identity_subjects_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.identity_subjects_rowid_seq', 2, true);


--
-- Name: integration_test_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.integration_test_runs_rowid_seq', 1, false);


--
-- Name: integration_tokens_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.integration_tokens_rowid_seq', 1, false);


--
-- Name: invites_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.invites_rowid_seq', 1, false);


--
-- Name: kanban_columns_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kanban_columns_rowid_seq', 1, false);


--
-- Name: kb_documents_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kb_documents_rowid_seq', 1, false);


--
-- Name: kb_usage_queries_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kb_usage_queries_rowid_seq', 1, false);


--
-- Name: kb_usage_sections_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kb_usage_sections_rowid_seq', 1, false);


--
-- Name: kb_usage_views_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.kb_usage_views_rowid_seq', 1, false);


--
-- Name: llm_engines_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.llm_engines_rowid_seq', 1, false);


--
-- Name: login_device_emails_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.login_device_emails_rowid_seq', 1, false);


--
-- Name: login_enrollments_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.login_enrollments_rowid_seq', 1, false);


--
-- Name: machine_commands_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.machine_commands_id_seq', 1, false);


--
-- Name: machine_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.machine_events_id_seq', 1, false);


--
-- Name: machine_project_share_audit_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.machine_project_share_audit_rowid_seq', 1, false);


--
-- Name: machine_project_shares_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.machine_project_shares_rowid_seq', 1, false);


--
-- Name: machine_storages_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.machine_storages_rowid_seq', 1, false);


--
-- Name: machine_vpn_networks_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.machine_vpn_networks_rowid_seq', 1, false);


--
-- Name: merge_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.merge_runs_rowid_seq', 1, false);


--
-- Name: message_service_data_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.message_service_data_rowid_seq', 1, false);


--
-- Name: messages_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.messages_rowid_seq', 1, false);


--
-- Name: model_prices_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.model_prices_rowid_seq', 14, true);


--
-- Name: password_reset_tokens_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.password_reset_tokens_rowid_seq', 1, false);


--
-- Name: project_invitations_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_invitations_rowid_seq', 1, false);


--
-- Name: project_machines_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_machines_rowid_seq', 1, false);


--
-- Name: project_member_role_audit_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_member_role_audit_rowid_seq', 1, false);


--
-- Name: project_members_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_members_rowid_seq', 1, false);


--
-- Name: project_release_events_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_release_events_rowid_seq', 1, false);


--
-- Name: project_release_steps_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_release_steps_rowid_seq', 1, false);


--
-- Name: project_releases_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_releases_rowid_seq', 1, false);


--
-- Name: project_stand_previews_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_stand_previews_rowid_seq', 1, false);


--
-- Name: project_type_review_audit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_type_review_audit_id_seq', 1, false);


--
-- Name: project_types_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.project_types_rowid_seq', 6, true);


--
-- Name: projects_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.projects_rowid_seq', 1, false);


--
-- Name: public_client_access_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.public_client_access_rowid_seq', 1, false);


--
-- Name: public_client_codes_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.public_client_codes_rowid_seq', 1, false);


--
-- Name: public_client_families_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.public_client_families_rowid_seq', 1, false);


--
-- Name: public_client_redirects_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.public_client_redirects_rowid_seq', 1, false);


--
-- Name: public_client_refresh_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.public_client_refresh_rowid_seq', 1, false);


--
-- Name: qa_attachments_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qa_attachments_rowid_seq', 1, false);


--
-- Name: qa_audit_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qa_audit_rowid_seq', 1, false);


--
-- Name: qa_criterion_results_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qa_criterion_results_rowid_seq', 1, false);


--
-- Name: qa_issues_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qa_issues_rowid_seq', 1, false);


--
-- Name: qa_preparation_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qa_preparation_runs_rowid_seq', 1, false);


--
-- Name: qa_sessions_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qa_sessions_rowid_seq', 1, false);


--
-- Name: qa_stage_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.qa_stage_runs_rowid_seq', 1, false);


--
-- Name: release_notifications_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.release_notifications_rowid_seq', 1, false);


--
-- Name: schema_migrations_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.schema_migrations_rowid_seq', 1, false);


--
-- Name: security_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.security_events_id_seq', 1, false);


--
-- Name: session_revocations_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.session_revocations_rowid_seq', 1, false);


--
-- Name: sessions_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.sessions_rowid_seq', 1, false);


--
-- Name: settings_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.settings_rowid_seq', 2, true);


--
-- Name: speakers_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.speakers_rowid_seq', 1, false);


--
-- Name: storage_acceptances_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.storage_acceptances_rowid_seq', 1, false);


--
-- Name: storage_entries_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.storage_entries_rowid_seq', 1, false);


--
-- Name: storage_lock_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.storage_lock_rowid_seq', 1, true);


--
-- Name: storage_shares_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.storage_shares_rowid_seq', 1, false);


--
-- Name: storage_space_refs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.storage_space_refs_rowid_seq', 1, false);


--
-- Name: storage_spaces_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.storage_spaces_rowid_seq', 1, false);


--
-- Name: storage_uploads_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.storage_uploads_rowid_seq', 1, false);


--
-- Name: tariff_plans_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tariff_plans_rowid_seq', 3, true);


--
-- Name: task_attachments_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_attachments_rowid_seq', 1, false);


--
-- Name: task_comments_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_comments_rowid_seq', 1, false);


--
-- Name: task_creation_audit_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_creation_audit_rowid_seq', 1, false);


--
-- Name: task_creation_requests_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_creation_requests_rowid_seq', 1, false);


--
-- Name: task_designs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_designs_rowid_seq', 1, false);


--
-- Name: task_history_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_history_rowid_seq', 1, false);


--
-- Name: task_improvements_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_improvements_rowid_seq', 1, false);


--
-- Name: task_launch_results_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_launch_results_rowid_seq', 1, false);


--
-- Name: task_preparation_events_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_preparation_events_rowid_seq', 1, false);


--
-- Name: task_preparation_notification_dismissals_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_preparation_notification_dismissals_rowid_seq', 1, false);


--
-- Name: task_preparation_questions_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_preparation_questions_rowid_seq', 1, false);


--
-- Name: task_preparation_runs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_preparation_runs_rowid_seq', 1, false);


--
-- Name: task_preparation_steps_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_preparation_steps_rowid_seq', 1, false);


--
-- Name: task_repositories_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_repositories_rowid_seq', 1, false);


--
-- Name: task_rework_attachments_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_rework_attachments_rowid_seq', 1, false);


--
-- Name: task_rework_cycles_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_rework_cycles_rowid_seq', 1, false);


--
-- Name: task_worklog_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.task_worklog_rowid_seq', 1, false);


--
-- Name: tasks_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tasks_rowid_seq', 1, false);


--
-- Name: team_tenant_invitations_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.team_tenant_invitations_rowid_seq', 1, false);


--
-- Name: team_tenant_memberships_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.team_tenant_memberships_rowid_seq', 1, true);


--
-- Name: team_tenant_tariffs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.team_tenant_tariffs_rowid_seq', 1, true);


--
-- Name: team_tenants_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.team_tenants_rowid_seq', 1, true);


--
-- Name: tenant_memberships_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tenant_memberships_rowid_seq', 2, true);


--
-- Name: tenant_tariffs_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tenant_tariffs_rowid_seq', 2, true);


--
-- Name: tenants_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tenants_rowid_seq', 2, true);


--
-- Name: user_llm_access_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_llm_access_rowid_seq', 1, false);


--
-- Name: user_project_machine_defaults_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_project_machine_defaults_rowid_seq', 1, false);


--
-- Name: user_project_release_machines_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.user_project_release_machines_rowid_seq', 1, false);


--
-- Name: users_rowid_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_rowid_seq', 2, true);


--
-- Name: acceptance_criteria acceptance_criteria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acceptance_criteria
    ADD CONSTRAINT acceptance_criteria_pkey PRIMARY KEY (id);


--
-- Name: acceptance_criterion_versions acceptance_criterion_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acceptance_criterion_versions
    ADD CONSTRAINT acceptance_criterion_versions_pkey PRIMARY KEY (criterion_id, version);


--
-- Name: agents agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agents
    ADD CONSTRAINT agents_pkey PRIMARY KEY (id);


--
-- Name: app_config app_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);


--
-- Name: application_audit application_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_audit
    ADD CONSTRAINT application_audit_pkey PRIMARY KEY (id);


--
-- Name: application_deployments application_deployments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_deployments
    ADD CONSTRAINT application_deployments_pkey PRIMARY KEY (id);


--
-- Name: application_deployments application_deployments_project_id_environment_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_deployments
    ADD CONSTRAINT application_deployments_project_id_environment_request_id_key UNIQUE (project_id, environment, request_id);


--
-- Name: application_environments application_environments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_environments
    ADD CONSTRAINT application_environments_pkey PRIMARY KEY (project_id, environment);


--
-- Name: application_grants application_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_grants
    ADD CONSTRAINT application_grants_pkey PRIMARY KEY (id);


--
-- Name: application_grants application_grants_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_grants
    ADD CONSTRAINT application_grants_token_hash_key UNIQUE (token_hash);


--
-- Name: application_releases application_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_releases
    ADD CONSTRAINT application_releases_pkey PRIMARY KEY (id);


--
-- Name: application_releases application_releases_project_id_application_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_releases
    ADD CONSTRAINT application_releases_project_id_application_id_version_key UNIQUE (project_id, application_id, version);


--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);


--
-- Name: assistant_orchestration_items assistant_orchestration_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_orchestration_items
    ADD CONSTRAINT assistant_orchestration_items_pkey PRIMARY KEY (id);


--
-- Name: assistant_orchestrations assistant_orchestrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_orchestrations
    ADD CONSTRAINT assistant_orchestrations_pkey PRIMARY KEY (id);


--
-- Name: board_views board_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_views
    ADD CONSTRAINT board_views_pkey PRIMARY KEY (username, project_id);


--
-- Name: browser_ui_release_operations browser_ui_release_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.browser_ui_release_operations
    ADD CONSTRAINT browser_ui_release_operations_pkey PRIMARY KEY (id);


--
-- Name: browser_ui_release_operations browser_ui_release_operations_project_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.browser_ui_release_operations
    ADD CONSTRAINT browser_ui_release_operations_project_id_request_id_key UNIQUE (project_id, request_id);


--
-- Name: chat_storage_bindings chat_storage_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_storage_bindings
    ADD CONSTRAINT chat_storage_bindings_pkey PRIMARY KEY (conversation_id);


--
-- Name: ci_command_suggestions ci_command_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_command_suggestions
    ADD CONSTRAINT ci_command_suggestions_pkey PRIMARY KEY (id);


--
-- Name: ci_commands ci_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_commands
    ADD CONSTRAINT ci_commands_pkey PRIMARY KEY (id);


--
-- Name: ci_events ci_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_events
    ADD CONSTRAINT ci_events_pkey PRIMARY KEY (id);


--
-- Name: ci_fix_attempts ci_fix_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_fix_attempts
    ADD CONSTRAINT ci_fix_attempts_pkey PRIMARY KEY (id);


--
-- Name: ci_gate_results ci_gate_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_gate_results
    ADD CONSTRAINT ci_gate_results_pkey PRIMARY KEY (id);


--
-- Name: ci_interactions ci_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_interactions
    ADD CONSTRAINT ci_interactions_pkey PRIMARY KEY (id);


--
-- Name: ci_llm_configs ci_llm_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_llm_configs
    ADD CONSTRAINT ci_llm_configs_pkey PRIMARY KEY (owner_type, owner_id);


--
-- Name: ci_run_kb_gaps ci_run_kb_gaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_kb_gaps
    ADD CONSTRAINT ci_run_kb_gaps_pkey PRIMARY KEY (run_id, question);


--
-- Name: ci_run_kb_metrics ci_run_kb_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_kb_metrics
    ADD CONSTRAINT ci_run_kb_metrics_pkey PRIMARY KEY (run_id);


--
-- Name: ci_run_logs ci_run_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_logs
    ADD CONSTRAINT ci_run_logs_pkey PRIMARY KEY (id);


--
-- Name: ci_run_steps ci_run_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_steps
    ADD CONSTRAINT ci_run_steps_pkey PRIMARY KEY (id);


--
-- Name: ci_run_tool_calls ci_run_tool_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_tool_calls
    ADD CONSTRAINT ci_run_tool_calls_pkey PRIMARY KEY (run_id, tool);


--
-- Name: ci_run_tool_responses ci_run_tool_responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_tool_responses
    ADD CONSTRAINT ci_run_tool_responses_pkey PRIMARY KEY (id);


--
-- Name: ci_run_usage ci_run_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_usage
    ADD CONSTRAINT ci_run_usage_pkey PRIMARY KEY (id);


--
-- Name: ci_runs ci_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_runs
    ADD CONSTRAINT ci_runs_pkey PRIMARY KEY (id);


--
-- Name: ci_settings ci_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_settings
    ADD CONSTRAINT ci_settings_pkey PRIMARY KEY (id);


--
-- Name: ci_slot_commands ci_slot_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_slot_commands
    ADD CONSTRAINT ci_slot_commands_pkey PRIMARY KEY (id);


--
-- Name: ci_stage_llm_configs ci_stage_llm_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_stage_llm_configs
    ADD CONSTRAINT ci_stage_llm_configs_pkey PRIMARY KEY (owner_type, owner_id, stage);


--
-- Name: ci_stage_runs ci_stage_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_stage_runs
    ADD CONSTRAINT ci_stage_runs_pkey PRIMARY KEY (id);


--
-- Name: ci_task_browser_checks ci_task_browser_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_task_browser_checks
    ADD CONSTRAINT ci_task_browser_checks_pkey PRIMARY KEY (task_id);


--
-- Name: ci_task_process_stages ci_task_process_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_task_process_stages
    ADD CONSTRAINT ci_task_process_stages_pkey PRIMARY KEY (task_id);


--
-- Name: ci_test_events ci_test_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_events
    ADD CONSTRAINT ci_test_events_pkey PRIMARY KEY (id);


--
-- Name: ci_test_fix_cycles ci_test_fix_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_cycles
    ADD CONSTRAINT ci_test_fix_cycles_pkey PRIMARY KEY (id);


--
-- Name: ci_test_fix_cycles ci_test_fix_cycles_task_id_attempt_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_cycles
    ADD CONSTRAINT ci_test_fix_cycles_task_id_attempt_no_key UNIQUE (task_id, attempt_no);


--
-- Name: ci_test_fix_cycles ci_test_fix_cycles_test_run_id_failed_group_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_cycles
    ADD CONSTRAINT ci_test_fix_cycles_test_run_id_failed_group_id_key UNIQUE (test_run_id, failed_group_id);


--
-- Name: ci_test_fix_decisions ci_test_fix_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_decisions
    ADD CONSTRAINT ci_test_fix_decisions_pkey PRIMARY KEY (id);


--
-- Name: ci_test_fix_targeted_runs ci_test_fix_targeted_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_targeted_runs
    ADD CONSTRAINT ci_test_fix_targeted_runs_pkey PRIMARY KEY (id);


--
-- Name: ci_test_fix_task_state ci_test_fix_task_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_task_state
    ADD CONSTRAINT ci_test_fix_task_state_pkey PRIMARY KEY (task_id);


--
-- Name: ci_test_group_configs ci_test_group_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_group_configs
    ADD CONSTRAINT ci_test_group_configs_pkey PRIMARY KEY (id);


--
-- Name: ci_test_group_runs ci_test_group_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_group_runs
    ADD CONSTRAINT ci_test_group_runs_pkey PRIMARY KEY (id);


--
-- Name: ci_test_runs ci_test_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_runs
    ADD CONSTRAINT ci_test_runs_pkey PRIMARY KEY (id);


--
-- Name: ci_test_targeted_runs ci_test_targeted_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_targeted_runs
    ADD CONSTRAINT ci_test_targeted_runs_pkey PRIMARY KEY (id);


--
-- Name: ci_workspaces ci_workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_workspaces
    ADD CONSTRAINT ci_workspaces_pkey PRIMARY KEY (id);


--
-- Name: component_qa_runs component_qa_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_qa_runs
    ADD CONSTRAINT component_qa_runs_pkey PRIMARY KEY (id);


--
-- Name: conversation_context_events conversation_context_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_context_events
    ADD CONSTRAINT conversation_context_events_pkey PRIMARY KEY (id);


--
-- Name: conversation_draft_requests conversation_draft_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_draft_requests
    ADD CONSTRAINT conversation_draft_requests_pkey PRIMARY KEY (user_id, idempotency_key);


--
-- Name: conversation_group_memberships conversation_group_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_group_memberships
    ADD CONSTRAINT conversation_group_memberships_pkey PRIMARY KEY (group_id, conversation_id);


--
-- Name: conversation_groups conversation_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_groups
    ADD CONSTRAINT conversation_groups_pkey PRIMARY KEY (id);


--
-- Name: conversation_groups conversation_groups_tenant_id_user_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_groups
    ADD CONSTRAINT conversation_groups_tenant_id_user_id_position_key UNIQUE (tenant_id, user_id, "position");


--
-- Name: conversation_turn_control conversation_turn_control_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turn_control
    ADD CONSTRAINT conversation_turn_control_pkey PRIMARY KEY (conversation_id);


--
-- Name: conversation_turn_queue conversation_turn_queue_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turn_queue
    ADD CONSTRAINT conversation_turn_queue_message_id_key UNIQUE (message_id);


--
-- Name: conversation_turn_queue conversation_turn_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turn_queue
    ADD CONSTRAINT conversation_turn_queue_pkey PRIMARY KEY (id);


--
-- Name: conversation_workspaces conversation_workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_workspaces
    ADD CONSTRAINT conversation_workspaces_pkey PRIMARY KEY (conversation_id);


--
-- Name: conversation_workspaces conversation_workspaces_repository_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_workspaces
    ADD CONSTRAINT conversation_workspaces_repository_path_key UNIQUE (repository_path);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: email_verifications email_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (token_hash);


--
-- Name: environment_configurations environment_configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_configurations
    ADD CONSTRAINT environment_configurations_pkey PRIMARY KEY (id);


--
-- Name: environment_configurations environment_configurations_project_id_environment_id_revisi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_configurations
    ADD CONSTRAINT environment_configurations_project_id_environment_id_revisi_key UNIQUE (project_id, environment_id, revision);


--
-- Name: environment_links environment_links_client_machine_id_listener_port_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_links
    ADD CONSTRAINT environment_links_client_machine_id_listener_port_key UNIQUE (client_machine_id, listener_port);


--
-- Name: environment_links environment_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_links
    ADD CONSTRAINT environment_links_pkey PRIMARY KEY (id);


--
-- Name: environment_links environment_links_project_id_environment_id_client_machine__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_links
    ADD CONSTRAINT environment_links_project_id_environment_id_client_machine__key UNIQUE (project_id, environment_id, client_machine_id, server_machine_id, service_port);


--
-- Name: environment_operations environment_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_operations
    ADD CONSTRAINT environment_operations_pkey PRIMARY KEY (id);


--
-- Name: environment_settings environment_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_settings
    ADD CONSTRAINT environment_settings_pkey PRIMARY KEY (project_id, environment_id, key);


--
-- Name: environments environments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT environments_pkey PRIMARY KEY (project_id, id);


--
-- Name: fts_state fts_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fts_state
    ADD CONSTRAINT fts_state_pkey PRIMARY KEY (name);


--
-- Name: generated_cleanup_retry generated_cleanup_retry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_cleanup_retry
    ADD CONSTRAINT generated_cleanup_retry_pkey PRIMARY KEY (conversation_id);


--
-- Name: git_workspace_locks git_workspace_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.git_workspace_locks
    ADD CONSTRAINT git_workspace_locks_pkey PRIMARY KEY (agent_id, path);


--
-- Name: identity_sign_in_tickets identity_sign_in_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_sign_in_tickets
    ADD CONSTRAINT identity_sign_in_tickets_pkey PRIMARY KEY (digest);


--
-- Name: identity_subjects identity_subjects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_subjects
    ADD CONSTRAINT identity_subjects_pkey PRIMARY KEY (id);


--
-- Name: identity_subjects identity_subjects_user_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_subjects
    ADD CONSTRAINT identity_subjects_user_name_key UNIQUE (user_name);


--
-- Name: integration_test_runs integration_test_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_test_runs
    ADD CONSTRAINT integration_test_runs_pkey PRIMARY KEY (id);


--
-- Name: integration_tokens integration_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_tokens
    ADD CONSTRAINT integration_tokens_pkey PRIMARY KEY (id);


--
-- Name: integration_tokens integration_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_tokens
    ADD CONSTRAINT integration_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: invites invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_pkey PRIMARY KEY (token);


--
-- Name: kanban_columns kanban_columns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_columns
    ADD CONSTRAINT kanban_columns_pkey PRIMARY KEY (id);


--
-- Name: kb_documents kb_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_documents
    ADD CONSTRAINT kb_documents_pkey PRIMARY KEY (id);


--
-- Name: kb_usage_queries kb_usage_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_usage_queries
    ADD CONSTRAINT kb_usage_queries_pkey PRIMARY KEY (id);


--
-- Name: kb_usage_sections kb_usage_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_usage_sections
    ADD CONSTRAINT kb_usage_sections_pkey PRIMARY KEY (id);


--
-- Name: kb_usage_views kb_usage_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_usage_views
    ADD CONSTRAINT kb_usage_views_pkey PRIMARY KEY (user_id, conversation_id);


--
-- Name: llm_engines llm_engines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_engines
    ADD CONSTRAINT llm_engines_pkey PRIMARY KEY (id);


--
-- Name: login_device_emails login_device_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_device_emails
    ADD CONSTRAINT login_device_emails_pkey PRIMARY KEY (user_name, ip, user_agent);


--
-- Name: login_enrollments login_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_enrollments
    ADD CONSTRAINT login_enrollments_pkey PRIMARY KEY (status_id);


--
-- Name: login_enrollments login_enrollments_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_enrollments
    ADD CONSTRAINT login_enrollments_token_hash_key UNIQUE (token_hash);


--
-- Name: machine_commands machine_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_commands
    ADD CONSTRAINT machine_commands_pkey PRIMARY KEY (id);


--
-- Name: machine_events machine_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_events
    ADD CONSTRAINT machine_events_pkey PRIMARY KEY (id);


--
-- Name: machine_project_share_audit machine_project_share_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_project_share_audit
    ADD CONSTRAINT machine_project_share_audit_pkey PRIMARY KEY (id);


--
-- Name: machine_project_shares machine_project_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_project_shares
    ADD CONSTRAINT machine_project_shares_pkey PRIMARY KEY (project_id, agent_id);


--
-- Name: machine_storages machine_storages_machine_id_root_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_storages
    ADD CONSTRAINT machine_storages_machine_id_root_path_key UNIQUE (machine_id, root_path);


--
-- Name: machine_storages machine_storages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_storages
    ADD CONSTRAINT machine_storages_pkey PRIMARY KEY (id);


--
-- Name: machine_vpn_networks machine_vpn_networks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_vpn_networks
    ADD CONSTRAINT machine_vpn_networks_pkey PRIMARY KEY (user_id);


--
-- Name: machine_vpn_networks machine_vpn_networks_tailnet_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_vpn_networks
    ADD CONSTRAINT machine_vpn_networks_tailnet_key UNIQUE (tailnet);


--
-- Name: merge_runs merge_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merge_runs
    ADD CONSTRAINT merge_runs_pkey PRIMARY KEY (id);


--
-- Name: message_service_data message_service_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_service_data
    ADD CONSTRAINT message_service_data_pkey PRIMARY KEY (message_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: model_prices model_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_prices
    ADD CONSTRAINT model_prices_pkey PRIMARY KEY (provider, model);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: project_invitations project_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_invitations
    ADD CONSTRAINT project_invitations_pkey PRIMARY KEY (id);


--
-- Name: project_invitations project_invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_invitations
    ADD CONSTRAINT project_invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: project_machines project_machines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_machines
    ADD CONSTRAINT project_machines_pkey PRIMARY KEY (project_id, agent_id);


--
-- Name: project_member_role_audit project_member_role_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_member_role_audit
    ADD CONSTRAINT project_member_role_audit_pkey PRIMARY KEY (id);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (project_id, username);


--
-- Name: project_release_events project_release_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_release_events
    ADD CONSTRAINT project_release_events_pkey PRIMARY KEY (id);


--
-- Name: project_release_steps project_release_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_release_steps
    ADD CONSTRAINT project_release_steps_pkey PRIMARY KEY (id);


--
-- Name: project_releases project_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_releases
    ADD CONSTRAINT project_releases_pkey PRIMARY KEY (id);


--
-- Name: project_stand_previews project_stand_previews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_stand_previews
    ADD CONSTRAINT project_stand_previews_pkey PRIMARY KEY (project_id);


--
-- Name: project_type_review_audit project_type_review_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_type_review_audit
    ADD CONSTRAINT project_type_review_audit_pkey PRIMARY KEY (id);


--
-- Name: project_types project_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_types
    ADD CONSTRAINT project_types_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: public_client_access public_client_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_access
    ADD CONSTRAINT public_client_access_pkey PRIMARY KEY (token_hash);


--
-- Name: public_client_codes public_client_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_codes
    ADD CONSTRAINT public_client_codes_pkey PRIMARY KEY (code_hash);


--
-- Name: public_client_families public_client_families_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_families
    ADD CONSTRAINT public_client_families_pkey PRIMARY KEY (id);


--
-- Name: public_client_redirects public_client_redirects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_redirects
    ADD CONSTRAINT public_client_redirects_pkey PRIMARY KEY (application_id, uri);


--
-- Name: public_client_refresh public_client_refresh_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_refresh
    ADD CONSTRAINT public_client_refresh_pkey PRIMARY KEY (token_hash);


--
-- Name: qa_attachments qa_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_attachments
    ADD CONSTRAINT qa_attachments_pkey PRIMARY KEY (id);


--
-- Name: qa_audit qa_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_audit
    ADD CONSTRAINT qa_audit_pkey PRIMARY KEY (id);


--
-- Name: qa_criterion_results qa_criterion_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_criterion_results
    ADD CONSTRAINT qa_criterion_results_pkey PRIMARY KEY (id);


--
-- Name: qa_issues qa_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_issues
    ADD CONSTRAINT qa_issues_pkey PRIMARY KEY (id);


--
-- Name: qa_issues qa_issues_result_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_issues
    ADD CONSTRAINT qa_issues_result_id_key UNIQUE (result_id);


--
-- Name: qa_preparation_runs qa_preparation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_preparation_runs
    ADD CONSTRAINT qa_preparation_runs_pkey PRIMARY KEY (id);


--
-- Name: qa_preparation_runs qa_preparation_runs_task_id_commit_sha_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_preparation_runs
    ADD CONSTRAINT qa_preparation_runs_task_id_commit_sha_key UNIQUE (task_id, commit_sha);


--
-- Name: qa_sessions qa_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_sessions
    ADD CONSTRAINT qa_sessions_pkey PRIMARY KEY (id);


--
-- Name: qa_stage_runs qa_stage_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_stage_runs
    ADD CONSTRAINT qa_stage_runs_pkey PRIMARY KEY (id);


--
-- Name: release_notifications release_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_notifications
    ADD CONSTRAINT release_notifications_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (name);


--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);


--
-- Name: session_revocations session_revocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_revocations
    ADD CONSTRAINT session_revocations_pkey PRIMARY KEY (token_hash);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (key);


--
-- Name: speakers speakers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speakers
    ADD CONSTRAINT speakers_pkey PRIMARY KEY (conversation_id, speaker_id);


--
-- Name: storage_acceptances storage_acceptances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_acceptances
    ADD CONSTRAINT storage_acceptances_pkey PRIMARY KEY (share_id, user_id);


--
-- Name: storage_entries storage_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_entries
    ADD CONSTRAINT storage_entries_pkey PRIMARY KEY (space_id, path);


--
-- Name: storage_lock storage_lock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_lock
    ADD CONSTRAINT storage_lock_pkey PRIMARY KEY (id);


--
-- Name: storage_shares storage_shares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_shares
    ADD CONSTRAINT storage_shares_pkey PRIMARY KEY (id);


--
-- Name: storage_shares storage_shares_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_shares
    ADD CONSTRAINT storage_shares_token_key UNIQUE (token);


--
-- Name: storage_spaces storage_spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_spaces
    ADD CONSTRAINT storage_spaces_pkey PRIMARY KEY (id);


--
-- Name: storage_uploads storage_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_uploads
    ADD CONSTRAINT storage_uploads_pkey PRIMARY KEY (id);


--
-- Name: tariff_plans tariff_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tariff_plans
    ADD CONSTRAINT tariff_plans_pkey PRIMARY KEY (id);


--
-- Name: task_attachments task_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_pkey PRIMARY KEY (id);


--
-- Name: task_attachments task_attachments_storage_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_storage_key_key UNIQUE (storage_key);


--
-- Name: task_comments task_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_comments
    ADD CONSTRAINT task_comments_pkey PRIMARY KEY (id);


--
-- Name: task_creation_audit task_creation_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_creation_audit
    ADD CONSTRAINT task_creation_audit_pkey PRIMARY KEY (id);


--
-- Name: task_creation_audit task_creation_audit_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_creation_audit
    ADD CONSTRAINT task_creation_audit_task_id_key UNIQUE (task_id);


--
-- Name: task_creation_requests task_creation_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_creation_requests
    ADD CONSTRAINT task_creation_requests_pkey PRIMARY KEY (actor, idempotency_key);


--
-- Name: task_designs task_designs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_designs
    ADD CONSTRAINT task_designs_pkey PRIMARY KEY (id);


--
-- Name: task_history task_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_history
    ADD CONSTRAINT task_history_pkey PRIMARY KEY (id);


--
-- Name: task_improvements task_improvements_created_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_improvements
    ADD CONSTRAINT task_improvements_created_task_id_key UNIQUE (created_task_id);


--
-- Name: task_improvements task_improvements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_improvements
    ADD CONSTRAINT task_improvements_pkey PRIMARY KEY (id);


--
-- Name: task_improvements task_improvements_task_id_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_improvements
    ADD CONSTRAINT task_improvements_task_id_fingerprint_key UNIQUE (task_id, fingerprint);


--
-- Name: task_launch_results task_launch_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_launch_results
    ADD CONSTRAINT task_launch_results_pkey PRIMARY KEY (project_id, proposal_id, action);


--
-- Name: task_preparation_events task_preparation_events_attempt_id_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_events
    ADD CONSTRAINT task_preparation_events_attempt_id_sequence_key UNIQUE (attempt_id, sequence);


--
-- Name: task_preparation_events task_preparation_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_events
    ADD CONSTRAINT task_preparation_events_pkey PRIMARY KEY (event_id);


--
-- Name: task_preparation_notification_dismissals task_preparation_notification_dismissals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_notification_dismissals
    ADD CONSTRAINT task_preparation_notification_dismissals_pkey PRIMARY KEY (question_id, user_id);


--
-- Name: task_preparation_questions task_preparation_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_questions
    ADD CONSTRAINT task_preparation_questions_pkey PRIMARY KEY (question_id);


--
-- Name: task_preparation_runs task_preparation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_runs
    ADD CONSTRAINT task_preparation_runs_pkey PRIMARY KEY (id);


--
-- Name: task_preparation_steps task_preparation_steps_attempt_id_ordinal_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_steps
    ADD CONSTRAINT task_preparation_steps_attempt_id_ordinal_key UNIQUE (attempt_id, ordinal);


--
-- Name: task_preparation_steps task_preparation_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_steps
    ADD CONSTRAINT task_preparation_steps_pkey PRIMARY KEY (id);


--
-- Name: task_repositories task_repositories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_repositories
    ADD CONSTRAINT task_repositories_pkey PRIMARY KEY (id);


--
-- Name: task_repositories task_repositories_task_id_agent_id_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_repositories
    ADD CONSTRAINT task_repositories_task_id_agent_id_path_key UNIQUE (task_id, agent_id, path);


--
-- Name: task_rework_attachments task_rework_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_rework_attachments
    ADD CONSTRAINT task_rework_attachments_pkey PRIMARY KEY (id);


--
-- Name: task_rework_cycles task_rework_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_rework_cycles
    ADD CONSTRAINT task_rework_cycles_pkey PRIMARY KEY (id);


--
-- Name: task_worklog task_worklog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_worklog
    ADD CONSTRAINT task_worklog_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: team_tenant_invitations team_tenant_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_invitations
    ADD CONSTRAINT team_tenant_invitations_pkey PRIMARY KEY (id);


--
-- Name: team_tenant_invitations team_tenant_invitations_tenant_id_target_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_invitations
    ADD CONSTRAINT team_tenant_invitations_tenant_id_target_key UNIQUE (tenant_id, target);


--
-- Name: team_tenant_invitations team_tenant_invitations_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_invitations
    ADD CONSTRAINT team_tenant_invitations_token_hash_key UNIQUE (token_hash);


--
-- Name: team_tenant_memberships team_tenant_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_memberships
    ADD CONSTRAINT team_tenant_memberships_pkey PRIMARY KEY (tenant_id, user_name);


--
-- Name: team_tenant_tariffs team_tenant_tariffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_tariffs
    ADD CONSTRAINT team_tenant_tariffs_pkey PRIMARY KEY (tenant_id);


--
-- Name: team_tenants team_tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenants
    ADD CONSTRAINT team_tenants_pkey PRIMARY KEY (id);


--
-- Name: tenant_memberships tenant_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT tenant_memberships_pkey PRIMARY KEY (tenant_id, user_name);


--
-- Name: tenant_tariffs tenant_tariffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_tariffs
    ADD CONSTRAINT tenant_tariffs_pkey PRIMARY KEY (tenant_id);


--
-- Name: tenants tenants_owner_user_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_owner_user_name_key UNIQUE (owner_user_name);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: user_llm_access user_llm_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_llm_access
    ADD CONSTRAINT user_llm_access_pkey PRIMARY KEY (user_name, provider, model_id);


--
-- Name: user_project_machine_defaults user_project_machine_defaults_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_project_machine_defaults
    ADD CONSTRAINT user_project_machine_defaults_pkey PRIMARY KEY (username, project_id);


--
-- Name: user_project_release_machines user_project_release_machines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_project_release_machines
    ADD CONSTRAINT user_project_release_machines_pkey PRIMARY KEY (username, project_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (name);


--
-- Name: idx_acceptance_criteria_position; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_acceptance_criteria_position ON public.acceptance_criteria USING btree (task_id, "position") WHERE (active = 1);


--
-- Name: idx_application_audit_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_audit_app ON public.application_audit USING btree (application_id, at);


--
-- Name: idx_application_grants_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_grants_app ON public.application_grants USING btree (application_id, issued_at);


--
-- Name: idx_application_grants_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_application_grants_expiry ON public.application_grants USING btree (expires_at, revoked_at);


--
-- Name: idx_applications_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_owner ON public.applications USING btree (owner_user_name, tenant_id, created_at);


--
-- Name: idx_assistant_orchestration_items_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assistant_orchestration_items_run ON public.assistant_orchestration_items USING btree (orchestration_id, "position");


--
-- Name: idx_assistant_orchestrations_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assistant_orchestrations_project ON public.assistant_orchestrations USING btree (project_id, status);


--
-- Name: idx_browser_ui_release_operations_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_browser_ui_release_operations_project ON public.browser_ui_release_operations USING btree (project_id, id DESC);


--
-- Name: idx_ci_commands_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_commands_scope ON public.ci_commands USING btree (scope, project_id, deleted_at);


--
-- Name: idx_ci_events_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_events_project ON public.ci_events USING btree (project_id, created_at DESC);


--
-- Name: idx_ci_events_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_events_run ON public.ci_events USING btree (run_id, created_at);


--
-- Name: idx_ci_fix_attempts_step; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_fix_attempts_step ON public.ci_fix_attempts USING btree (run_step_id, attempt_no);


--
-- Name: idx_ci_gate_results_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ci_gate_results_key ON public.ci_gate_results USING btree (commit_sha, signature);


--
-- Name: idx_ci_interactions_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_interactions_run ON public.ci_interactions USING btree (run_id, seq);


--
-- Name: idx_ci_run_logs_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_run_logs_run ON public.ci_run_logs USING btree (run_id, seq);


--
-- Name: idx_ci_run_steps_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_run_steps_run ON public.ci_run_steps USING btree (run_id, "position");


--
-- Name: idx_ci_run_tool_responses_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_run_tool_responses_run ON public.ci_run_tool_responses USING btree (run_id, chars DESC);


--
-- Name: idx_ci_run_usage_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_run_usage_run ON public.ci_run_usage USING btree (run_id, at);


--
-- Name: idx_ci_runs_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_runs_project ON public.ci_runs USING btree (project_id, created_at DESC);


--
-- Name: idx_ci_runs_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_runs_task ON public.ci_runs USING btree (task_id, created_at DESC);


--
-- Name: idx_ci_slot_commands_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_slot_commands_owner ON public.ci_slot_commands USING btree (owner_type, owner_id, slot, "position");


--
-- Name: idx_ci_stage_runs_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_stage_runs_run ON public.ci_stage_runs USING btree (run_id, created_at);


--
-- Name: idx_ci_stage_runs_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_stage_runs_task ON public.ci_stage_runs USING btree (task_id, created_at DESC);


--
-- Name: idx_ci_suggestions_command; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_suggestions_command ON public.ci_command_suggestions USING btree (command_id, status);


--
-- Name: idx_ci_test_events_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_test_events_run ON public.ci_test_events USING btree (run_id, created_at);


--
-- Name: idx_ci_test_fix_cycles_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_test_fix_cycles_task ON public.ci_test_fix_cycles USING btree (task_id, attempt_no DESC);


--
-- Name: idx_ci_test_fix_targeted_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_test_fix_targeted_cycle ON public.ci_test_fix_targeted_runs USING btree (fix_cycle_id, started_at);


--
-- Name: idx_ci_test_group_config_position; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ci_test_group_config_position ON public.ci_test_group_configs USING btree (project_id, "position");


--
-- Name: idx_ci_test_group_runs_position; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ci_test_group_runs_position ON public.ci_test_group_runs USING btree (test_run_id, "position");


--
-- Name: idx_ci_test_runs_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_test_runs_task ON public.ci_test_runs USING btree (task_id, created_at DESC);


--
-- Name: idx_ci_workspaces_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_workspaces_project ON public.ci_workspaces USING btree (project_id, state);


--
-- Name: idx_ci_workspaces_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ci_workspaces_task ON public.ci_workspaces USING btree (task_id, pushed, created_at DESC);


--
-- Name: idx_component_qa_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_component_qa_active ON public.component_qa_runs USING btree (task_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: idx_component_qa_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_component_qa_task ON public.component_qa_runs USING btree (task_id, created_at DESC);


--
-- Name: idx_context_events_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_context_events_conversation ON public.conversation_context_events USING btree (conversation_id, id DESC);


--
-- Name: idx_conversation_group_memberships_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversation_group_memberships_conversation ON public.conversation_group_memberships USING btree (conversation_id, group_id);


--
-- Name: idx_conversation_groups_owner_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversation_groups_owner_order ON public.conversation_groups USING btree (tenant_id, user_id, "position", id);


--
-- Name: idx_conversations_owner_archive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_owner_archive ON public.conversations USING btree (tenant_id, user_id, archived_at, updated_at);


--
-- Name: idx_email_verifications_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_verifications_email ON public.email_verifications USING btree (email);


--
-- Name: idx_environment_active_operation_v2; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_environment_active_operation_v2 ON public.environment_operations USING btree (project_id, environment_id) WHERE (status = ANY (ARRAY['pending'::text, 'preparing'::text, 'pulling'::text, 'building'::text, 'starting'::text, 'switching'::text, 'health_check'::text, 'removing'::text]));


--
-- Name: idx_environment_compose_project; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_environment_compose_project ON public.environments USING btree (compose_project) WHERE (compose_project IS NOT NULL);


--
-- Name: idx_environment_operations; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_environment_operations ON public.environment_operations USING btree (project_id, environment_id, started_at DESC);


--
-- Name: idx_generated_cleanup_retry_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_cleanup_retry_due ON public.generated_cleanup_retry USING btree (next_attempt_at);


--
-- Name: idx_identity_sign_in_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_identity_sign_in_expiry ON public.identity_sign_in_tickets USING btree (expires_at);


--
-- Name: idx_integration_test_runs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_integration_test_runs_active ON public.integration_test_runs USING btree (task_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));


--
-- Name: idx_integration_test_runs_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_test_runs_task ON public.integration_test_runs USING btree (task_id, created_at DESC);


--
-- Name: idx_integration_tokens_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_tokens_project ON public.integration_tokens USING btree (project_id);


--
-- Name: idx_kanban_columns_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kanban_columns_project ON public.kanban_columns USING btree (project_id, "position");


--
-- Name: idx_kb_documents_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_documents_scope ON public.kb_documents USING btree (scope, project_id, owner_id);


--
-- Name: idx_kb_usage_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_usage_project ON public.kb_usage_queries USING btree (project_id, created_at DESC);


--
-- Name: idx_kb_usage_sections_doc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_usage_sections_doc ON public.kb_usage_sections USING btree (document_id, anchor);


--
-- Name: idx_kb_usage_sections_query; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_usage_sections_query ON public.kb_usage_sections USING btree (query_id);


--
-- Name: idx_kb_usage_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_kb_usage_seq ON public.kb_usage_queries USING btree (conversation_id, seq);


--
-- Name: idx_kb_usage_turn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_usage_turn ON public.kb_usage_queries USING btree (turn_id);


--
-- Name: idx_llm_engines_default_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_llm_engines_default_kind ON public.llm_engines USING btree (kind) WHERE (is_default = 1);


--
-- Name: idx_llm_engines_kind_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_llm_engines_kind_enabled ON public.llm_engines USING btree (kind, enabled, created_at);


--
-- Name: idx_login_enrollments_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_enrollments_expiry ON public.login_enrollments USING btree (expires_at);


--
-- Name: idx_machine_commands_machine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_machine_commands_machine ON public.machine_commands USING btree (machine_id, id DESC);


--
-- Name: idx_machine_events_machine; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_machine_events_machine ON public.machine_events USING btree (machine_id, id DESC);


--
-- Name: idx_merge_runs_one_active_task; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_merge_runs_one_active_task ON public.merge_runs USING btree (task_id) WHERE (status = ANY (ARRAY['queued'::text, 'checking'::text, 'fetching'::text, 'merging'::text, 'resolving_conflicts'::text, 'kb_update'::text, 'testing'::text, 'pushing'::text]));


--
-- Name: idx_merge_runs_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_merge_runs_task ON public.merge_runs USING btree (task_id, created_at DESC);


--
-- Name: idx_message_service_data_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_service_data_conversation ON public.message_service_data USING btree (conversation_id);


--
-- Name: idx_messages_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_branch ON public.messages USING btree (conversation_id, parent_message_id, role, history_position, id);


--
-- Name: idx_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id, created_at);


--
-- Name: idx_messages_history_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_history_page ON public.messages USING btree (conversation_id, state, history_position, id);


--
-- Name: idx_messages_role_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_role_created ON public.messages USING btree (role, created_at);


--
-- Name: idx_messages_text_tsv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_text_tsv ON public.messages USING gin (text_tsv);


--
-- Name: idx_password_reset_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_password_reset_tokens_user ON public.password_reset_tokens USING btree (user_name);


--
-- Name: idx_project_invitations_pending_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_project_invitations_pending_email ON public.project_invitations USING btree (project_id, email) WHERE ((status = 'pending'::text) AND (email IS NOT NULL));


--
-- Name: idx_project_invitations_pending_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_project_invitations_pending_user ON public.project_invitations USING btree (project_id, invited_username) WHERE ((status = 'pending'::text) AND (invited_username IS NOT NULL));


--
-- Name: idx_project_invitations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_invitations_user ON public.project_invitations USING btree (invited_username, status);


--
-- Name: idx_project_member_role_audit_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_member_role_audit_project ON public.project_member_role_audit USING btree (project_id, created_at);


--
-- Name: idx_project_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_members_user ON public.project_members USING btree (username);


--
-- Name: idx_project_release_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_project_release_attempt ON public.project_releases USING btree (project_id, branch, attempt);


--
-- Name: idx_project_release_events; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_release_events ON public.project_release_events USING btree (release_id, created_at);


--
-- Name: idx_project_release_step; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_project_release_step ON public.project_release_steps USING btree (release_id, "position");


--
-- Name: idx_project_releases_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_releases_project ON public.project_releases USING btree (project_id, created_at DESC);


--
-- Name: idx_project_type_review_audit_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_type_review_audit_type ON public.project_type_review_audit USING btree (type_id, at);


--
-- Name: idx_project_types_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_types_parent ON public.project_types USING btree (parent_id);


--
-- Name: idx_project_types_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_types_status ON public.project_types USING btree (status, owner_id);


--
-- Name: idx_public_client_access_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_public_client_access_expiry ON public.public_client_access USING btree (expires_at);


--
-- Name: idx_public_client_codes_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_public_client_codes_expiry ON public.public_client_codes USING btree (expires_at);


--
-- Name: idx_public_client_families_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_public_client_families_expiry ON public.public_client_families USING btree (expires_at);


--
-- Name: idx_public_client_families_user_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_public_client_families_user_tenant ON public.public_client_families USING btree (user_name, tenant_id, expires_at);


--
-- Name: idx_public_client_refresh_family; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_public_client_refresh_family ON public.public_client_refresh USING btree (family_id);


--
-- Name: idx_qa_attachments_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_attachments_result ON public.qa_attachments USING btree (result_id);


--
-- Name: idx_qa_audit_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_audit_task ON public.qa_audit USING btree (task_id, created_at);


--
-- Name: idx_qa_preparation_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_preparation_task ON public.qa_preparation_runs USING btree (task_id, created_at DESC);


--
-- Name: idx_qa_result_per_snapshot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_qa_result_per_snapshot ON public.qa_criterion_results USING btree (session_id, criterion_id, criterion_version);


--
-- Name: idx_qa_sessions_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_qa_sessions_one_active ON public.qa_sessions USING btree (task_id) WHERE (status = 'active'::text);


--
-- Name: idx_qa_sessions_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_sessions_task ON public.qa_sessions USING btree (task_id, started_at DESC);


--
-- Name: idx_qa_stage_runs_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_qa_stage_runs_one_active ON public.qa_stage_runs USING btree (task_id, stage) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text, 'awaiting_input'::text]));


--
-- Name: idx_qa_stage_runs_task_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_stage_runs_task_stage ON public.qa_stage_runs USING btree (task_id, stage, created_at DESC);


--
-- Name: idx_release_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_release_notifications_user ON public.release_notifications USING btree (user_id, dismissed_at, created_at DESC);


--
-- Name: idx_security_events_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_user ON public.security_events USING btree (user_name, at DESC);


--
-- Name: idx_sessions_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_live ON public.sessions USING btree (revoked_at, expires_at, user_name);


--
-- Name: idx_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_user ON public.sessions USING btree (user_name);


--
-- Name: idx_task_attachments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_attachments_task ON public.task_attachments USING btree (task_id, scope, created_at);


--
-- Name: idx_task_comments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_comments_task ON public.task_comments USING btree (task_id, created_at);


--
-- Name: idx_task_designs_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_designs_source ON public.task_designs USING btree (conversation_id, path);


--
-- Name: idx_task_designs_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_task_designs_unique ON public.task_designs USING btree (task_id, conversation_id, path);


--
-- Name: idx_task_history_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_history_task ON public.task_history USING btree (task_id, at);


--
-- Name: idx_task_improvements_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_improvements_project ON public.task_improvements USING btree (project_id, status, updated_at DESC);


--
-- Name: idx_task_improvements_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_improvements_task ON public.task_improvements USING btree (task_id, status, updated_at DESC);


--
-- Name: idx_task_preparation_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_task_preparation_active ON public.task_preparation_runs USING btree (task_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text, 'waiting_for_answer'::text, 'validating'::text]));


--
-- Name: idx_task_preparation_events_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_preparation_events_attempt ON public.task_preparation_events USING btree (attempt_id, sequence);


--
-- Name: idx_task_preparation_questions_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_preparation_questions_attempt ON public.task_preparation_questions USING btree (attempt_id, asked_at);


--
-- Name: idx_task_preparation_steps_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_preparation_steps_attempt ON public.task_preparation_steps USING btree (attempt_id, ordinal);


--
-- Name: idx_task_preparation_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_preparation_task ON public.task_preparation_runs USING btree (task_id, created_at DESC);


--
-- Name: idx_task_repositories_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_repositories_task ON public.task_repositories USING btree (task_id, state);


--
-- Name: idx_task_rework_attachments_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_rework_attachments_cycle ON public.task_rework_attachments USING btree (cycle_id, "position");


--
-- Name: idx_task_rework_cycles_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_task_rework_cycles_idempotency ON public.task_rework_cycles USING btree (task_id, idempotency_key);


--
-- Name: idx_task_rework_cycles_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_task_rework_cycles_sequence ON public.task_rework_cycles USING btree (task_id, sequence);


--
-- Name: idx_task_worklog_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_worklog_task ON public.task_worklog USING btree (task_id, started_at);


--
-- Name: idx_tasks_column; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_column ON public.tasks USING btree (project_id, column_id, "position");


--
-- Name: idx_team_tenant_invitations_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_tenant_invitations_expiry ON public.team_tenant_invitations USING btree (expires_at);


--
-- Name: idx_team_tenant_memberships_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_tenant_memberships_user ON public.team_tenant_memberships USING btree (user_name);


--
-- Name: idx_tenant_memberships_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_memberships_user ON public.tenant_memberships USING btree (user_name);


--
-- Name: idx_tenant_tariffs_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_tariffs_plan ON public.tenant_tariffs USING btree (tariff_id);


--
-- Name: idx_turn_queue_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_turn_queue_owner ON public.conversation_turn_queue USING btree (user_id, conversation_id, status, "position");


--
-- Name: idx_turn_queue_position; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_turn_queue_position ON public.conversation_turn_queue USING btree (conversation_id, "position");


--
-- Name: storage_space_refs_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX storage_space_refs_unique ON public.storage_space_refs USING btree (owner_id, kind, ref_key);


--
-- Name: messages trg_messages_cost_dirty; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_messages_cost_dirty AFTER INSERT OR DELETE OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.messages_cost_dirty();


--
-- Name: acceptance_criteria fk_acceptance_criteria_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acceptance_criteria
    ADD CONSTRAINT fk_acceptance_criteria_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: acceptance_criterion_versions fk_acceptance_criterion_versions_criterion_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.acceptance_criterion_versions
    ADD CONSTRAINT fk_acceptance_criterion_versions_criterion_id FOREIGN KEY (criterion_id) REFERENCES public.acceptance_criteria(id) ON DELETE CASCADE;


--
-- Name: application_audit fk_application_audit_application_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_audit
    ADD CONSTRAINT fk_application_audit_application_id FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: application_deployments fk_application_deployments_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_deployments
    ADD CONSTRAINT fk_application_deployments_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: application_environments fk_application_environments_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_environments
    ADD CONSTRAINT fk_application_environments_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: application_grants fk_application_grants_application_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_grants
    ADD CONSTRAINT fk_application_grants_application_id FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: application_grants fk_application_grants_user_name; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_grants
    ADD CONSTRAINT fk_application_grants_user_name FOREIGN KEY (user_name) REFERENCES public.users(name) ON DELETE CASCADE;


--
-- Name: application_releases fk_application_releases_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_releases
    ADD CONSTRAINT fk_application_releases_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: applications fk_applications_owner_user_name; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT fk_applications_owner_user_name FOREIGN KEY (owner_user_name) REFERENCES public.users(name) ON DELETE CASCADE;


--
-- Name: assistant_orchestration_items fk_assistant_orchestration_items_orchestration_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_orchestration_items
    ADD CONSTRAINT fk_assistant_orchestration_items_orchestration_id FOREIGN KEY (orchestration_id) REFERENCES public.assistant_orchestrations(id) ON DELETE CASCADE;


--
-- Name: assistant_orchestrations fk_assistant_orchestrations_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assistant_orchestrations
    ADD CONSTRAINT fk_assistant_orchestrations_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: board_views fk_board_views_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_views
    ADD CONSTRAINT fk_board_views_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: browser_ui_release_operations fk_browser_ui_release_operations_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.browser_ui_release_operations
    ADD CONSTRAINT fk_browser_ui_release_operations_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: chat_storage_bindings fk_chat_storage_bindings_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_storage_bindings
    ADD CONSTRAINT fk_chat_storage_bindings_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: chat_storage_bindings fk_chat_storage_bindings_machine_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_storage_bindings
    ADD CONSTRAINT fk_chat_storage_bindings_machine_id FOREIGN KEY (machine_id) REFERENCES public.agents(id) ON DELETE RESTRICT;


--
-- Name: chat_storage_bindings fk_chat_storage_bindings_storage_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_storage_bindings
    ADD CONSTRAINT fk_chat_storage_bindings_storage_id FOREIGN KEY (storage_id) REFERENCES public.machine_storages(id) ON DELETE RESTRICT;


--
-- Name: ci_command_suggestions fk_ci_command_suggestions_command_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_command_suggestions
    ADD CONSTRAINT fk_ci_command_suggestions_command_id FOREIGN KEY (command_id) REFERENCES public.ci_commands(id) ON DELETE CASCADE;


--
-- Name: ci_commands fk_ci_commands_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_commands
    ADD CONSTRAINT fk_ci_commands_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: ci_events fk_ci_events_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_events
    ADD CONSTRAINT fk_ci_events_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: ci_fix_attempts fk_ci_fix_attempts_run_step_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_fix_attempts
    ADD CONSTRAINT fk_ci_fix_attempts_run_step_id FOREIGN KEY (run_step_id) REFERENCES public.ci_run_steps(id) ON DELETE CASCADE;


--
-- Name: ci_gate_results fk_ci_gate_results_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_gate_results
    ADD CONSTRAINT fk_ci_gate_results_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: ci_interactions fk_ci_interactions_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_interactions
    ADD CONSTRAINT fk_ci_interactions_run_id FOREIGN KEY (run_id) REFERENCES public.ci_runs(id) ON DELETE CASCADE;


--
-- Name: ci_run_kb_gaps fk_ci_run_kb_gaps_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_kb_gaps
    ADD CONSTRAINT fk_ci_run_kb_gaps_run_id FOREIGN KEY (run_id) REFERENCES public.ci_runs(id) ON DELETE CASCADE;


--
-- Name: ci_run_kb_metrics fk_ci_run_kb_metrics_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_kb_metrics
    ADD CONSTRAINT fk_ci_run_kb_metrics_run_id FOREIGN KEY (run_id) REFERENCES public.ci_runs(id) ON DELETE CASCADE;


--
-- Name: ci_run_logs fk_ci_run_logs_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_logs
    ADD CONSTRAINT fk_ci_run_logs_run_id FOREIGN KEY (run_id) REFERENCES public.ci_runs(id) ON DELETE CASCADE;


--
-- Name: ci_run_steps fk_ci_run_steps_command_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_steps
    ADD CONSTRAINT fk_ci_run_steps_command_id FOREIGN KEY (command_id) REFERENCES public.ci_commands(id) ON DELETE SET NULL;


--
-- Name: ci_run_steps fk_ci_run_steps_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_steps
    ADD CONSTRAINT fk_ci_run_steps_run_id FOREIGN KEY (run_id) REFERENCES public.ci_runs(id) ON DELETE CASCADE;


--
-- Name: ci_run_tool_calls fk_ci_run_tool_calls_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_tool_calls
    ADD CONSTRAINT fk_ci_run_tool_calls_run_id FOREIGN KEY (run_id) REFERENCES public.ci_runs(id) ON DELETE CASCADE;


--
-- Name: ci_run_tool_responses fk_ci_run_tool_responses_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_tool_responses
    ADD CONSTRAINT fk_ci_run_tool_responses_run_id FOREIGN KEY (run_id) REFERENCES public.ci_runs(id) ON DELETE CASCADE;


--
-- Name: ci_run_usage fk_ci_run_usage_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_run_usage
    ADD CONSTRAINT fk_ci_run_usage_run_id FOREIGN KEY (run_id) REFERENCES public.ci_runs(id) ON DELETE CASCADE;


--
-- Name: ci_runs fk_ci_runs_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_runs
    ADD CONSTRAINT fk_ci_runs_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: ci_runs fk_ci_runs_workspace_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_runs
    ADD CONSTRAINT fk_ci_runs_workspace_id FOREIGN KEY (workspace_id) REFERENCES public.ci_workspaces(id) ON DELETE SET NULL;


--
-- Name: ci_slot_commands fk_ci_slot_commands_command_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_slot_commands
    ADD CONSTRAINT fk_ci_slot_commands_command_id FOREIGN KEY (command_id) REFERENCES public.ci_commands(id) ON DELETE CASCADE;


--
-- Name: ci_stage_runs fk_ci_stage_runs_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_stage_runs
    ADD CONSTRAINT fk_ci_stage_runs_run_id FOREIGN KEY (run_id) REFERENCES public.ci_runs(id) ON DELETE CASCADE;


--
-- Name: ci_task_browser_checks fk_ci_task_browser_checks_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_task_browser_checks
    ADD CONSTRAINT fk_ci_task_browser_checks_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: ci_task_process_stages fk_ci_task_process_stages_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_task_process_stages
    ADD CONSTRAINT fk_ci_task_process_stages_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: ci_test_events fk_ci_test_events_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_events
    ADD CONSTRAINT fk_ci_test_events_run_id FOREIGN KEY (run_id) REFERENCES public.ci_test_runs(id) ON DELETE CASCADE;


--
-- Name: ci_test_fix_cycles fk_ci_test_fix_cycles_failed_group_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_cycles
    ADD CONSTRAINT fk_ci_test_fix_cycles_failed_group_id FOREIGN KEY (failed_group_id) REFERENCES public.ci_test_group_runs(id) ON DELETE CASCADE;


--
-- Name: ci_test_fix_cycles fk_ci_test_fix_cycles_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_cycles
    ADD CONSTRAINT fk_ci_test_fix_cycles_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: ci_test_fix_cycles fk_ci_test_fix_cycles_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_cycles
    ADD CONSTRAINT fk_ci_test_fix_cycles_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: ci_test_fix_cycles fk_ci_test_fix_cycles_test_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_cycles
    ADD CONSTRAINT fk_ci_test_fix_cycles_test_run_id FOREIGN KEY (test_run_id) REFERENCES public.ci_test_runs(id) ON DELETE CASCADE;


--
-- Name: ci_test_fix_decisions fk_ci_test_fix_decisions_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_decisions
    ADD CONSTRAINT fk_ci_test_fix_decisions_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: ci_test_fix_decisions fk_ci_test_fix_decisions_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_decisions
    ADD CONSTRAINT fk_ci_test_fix_decisions_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: ci_test_fix_targeted_runs fk_ci_test_fix_targeted_runs_fix_cycle_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_targeted_runs
    ADD CONSTRAINT fk_ci_test_fix_targeted_runs_fix_cycle_id FOREIGN KEY (fix_cycle_id) REFERENCES public.ci_test_fix_cycles(id) ON DELETE CASCADE;


--
-- Name: ci_test_fix_task_state fk_ci_test_fix_task_state_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_fix_task_state
    ADD CONSTRAINT fk_ci_test_fix_task_state_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: ci_test_group_configs fk_ci_test_group_configs_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_group_configs
    ADD CONSTRAINT fk_ci_test_group_configs_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: ci_test_group_runs fk_ci_test_group_runs_test_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_group_runs
    ADD CONSTRAINT fk_ci_test_group_runs_test_run_id FOREIGN KEY (test_run_id) REFERENCES public.ci_test_runs(id) ON DELETE CASCADE;


--
-- Name: ci_test_runs fk_ci_test_runs_previous_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_runs
    ADD CONSTRAINT fk_ci_test_runs_previous_run_id FOREIGN KEY (previous_run_id) REFERENCES public.ci_test_runs(id);


--
-- Name: ci_test_runs fk_ci_test_runs_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_runs
    ADD CONSTRAINT fk_ci_test_runs_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: ci_test_runs fk_ci_test_runs_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_runs
    ADD CONSTRAINT fk_ci_test_runs_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: ci_test_targeted_runs fk_ci_test_targeted_runs_group_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_targeted_runs
    ADD CONSTRAINT fk_ci_test_targeted_runs_group_id FOREIGN KEY (group_id) REFERENCES public.ci_test_group_runs(id) ON DELETE CASCADE;


--
-- Name: ci_test_targeted_runs fk_ci_test_targeted_runs_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_test_targeted_runs
    ADD CONSTRAINT fk_ci_test_targeted_runs_run_id FOREIGN KEY (run_id) REFERENCES public.ci_test_runs(id) ON DELETE CASCADE;


--
-- Name: ci_workspaces fk_ci_workspaces_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ci_workspaces
    ADD CONSTRAINT fk_ci_workspaces_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: component_qa_runs fk_component_qa_runs_development_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_qa_runs
    ADD CONSTRAINT fk_component_qa_runs_development_run_id FOREIGN KEY (development_run_id) REFERENCES public.ci_runs(id);


--
-- Name: component_qa_runs fk_component_qa_runs_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_qa_runs
    ADD CONSTRAINT fk_component_qa_runs_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: component_qa_runs fk_component_qa_runs_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component_qa_runs
    ADD CONSTRAINT fk_component_qa_runs_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: conversation_draft_requests fk_conversation_draft_requests_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_draft_requests
    ADD CONSTRAINT fk_conversation_draft_requests_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_group_memberships fk_conversation_group_memberships_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_group_memberships
    ADD CONSTRAINT fk_conversation_group_memberships_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_group_memberships fk_conversation_group_memberships_group_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_group_memberships
    ADD CONSTRAINT fk_conversation_group_memberships_group_id FOREIGN KEY (group_id) REFERENCES public.conversation_groups(id) ON DELETE CASCADE;


--
-- Name: conversation_turn_control fk_conversation_turn_control_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turn_control
    ADD CONSTRAINT fk_conversation_turn_control_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_turn_queue fk_conversation_turn_queue_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turn_queue
    ADD CONSTRAINT fk_conversation_turn_queue_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_turn_queue fk_conversation_turn_queue_message_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_turn_queue
    ADD CONSTRAINT fk_conversation_turn_queue_message_id FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: conversation_workspaces fk_conversation_workspaces_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_workspaces
    ADD CONSTRAINT fk_conversation_workspaces_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_workspaces fk_conversation_workspaces_machine_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_workspaces
    ADD CONSTRAINT fk_conversation_workspaces_machine_id FOREIGN KEY (machine_id) REFERENCES public.agents(id) ON DELETE RESTRICT;


--
-- Name: conversation_workspaces fk_conversation_workspaces_storage_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_workspaces
    ADD CONSTRAINT fk_conversation_workspaces_storage_id FOREIGN KEY (storage_id) REFERENCES public.machine_storages(id) ON DELETE RESTRICT;


--
-- Name: environment_configurations fk_environment_configurations_project_id_environment_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_configurations
    ADD CONSTRAINT fk_environment_configurations_project_id_environment_id FOREIGN KEY (project_id, environment_id) REFERENCES public.environments(project_id, id) ON DELETE CASCADE;


--
-- Name: environment_links fk_environment_links_project_id_environment_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_links
    ADD CONSTRAINT fk_environment_links_project_id_environment_id FOREIGN KEY (project_id, environment_id) REFERENCES public.environments(project_id, id) ON DELETE CASCADE;


--
-- Name: environment_operations fk_environment_operations_configuration_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_operations
    ADD CONSTRAINT fk_environment_operations_configuration_id FOREIGN KEY (configuration_id) REFERENCES public.environment_configurations(id);


--
-- Name: environment_operations fk_environment_operations_previous_configuration_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_operations
    ADD CONSTRAINT fk_environment_operations_previous_configuration_id FOREIGN KEY (previous_configuration_id) REFERENCES public.environment_configurations(id);


--
-- Name: environment_operations fk_environment_operations_project_id_environment_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_operations
    ADD CONSTRAINT fk_environment_operations_project_id_environment_id FOREIGN KEY (project_id, environment_id) REFERENCES public.environments(project_id, id) ON DELETE CASCADE;


--
-- Name: environment_settings fk_environment_settings_project_id_environment_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environment_settings
    ADD CONSTRAINT fk_environment_settings_project_id_environment_id FOREIGN KEY (project_id, environment_id) REFERENCES public.environments(project_id, id) ON DELETE CASCADE;


--
-- Name: environments fk_environments_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.environments
    ADD CONSTRAINT fk_environments_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: generated_cleanup_retry fk_generated_cleanup_retry_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_cleanup_retry
    ADD CONSTRAINT fk_generated_cleanup_retry_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: identity_subjects fk_identity_subjects_user_name; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_subjects
    ADD CONSTRAINT fk_identity_subjects_user_name FOREIGN KEY (user_name) REFERENCES public.users(name) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: integration_test_runs fk_integration_test_runs_development_run_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_test_runs
    ADD CONSTRAINT fk_integration_test_runs_development_run_id FOREIGN KEY (development_run_id) REFERENCES public.ci_runs(id);


--
-- Name: integration_test_runs fk_integration_test_runs_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_test_runs
    ADD CONSTRAINT fk_integration_test_runs_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: integration_test_runs fk_integration_test_runs_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_test_runs
    ADD CONSTRAINT fk_integration_test_runs_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: integration_tokens fk_integration_tokens_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_tokens
    ADD CONSTRAINT fk_integration_tokens_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: kanban_columns fk_kanban_columns_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kanban_columns
    ADD CONSTRAINT fk_kanban_columns_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: kb_documents fk_kb_documents_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_documents
    ADD CONSTRAINT fk_kb_documents_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: kb_usage_queries fk_kb_usage_queries_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_usage_queries
    ADD CONSTRAINT fk_kb_usage_queries_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: kb_usage_sections fk_kb_usage_sections_query_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_usage_sections
    ADD CONSTRAINT fk_kb_usage_sections_query_id FOREIGN KEY (query_id) REFERENCES public.kb_usage_queries(id) ON DELETE CASCADE;


--
-- Name: kb_usage_views fk_kb_usage_views_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_usage_views
    ADD CONSTRAINT fk_kb_usage_views_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: login_enrollments fk_login_enrollments_agent_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_enrollments
    ADD CONSTRAINT fk_login_enrollments_agent_id FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE SET NULL;


--
-- Name: machine_project_shares fk_machine_project_shares_agent_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_project_shares
    ADD CONSTRAINT fk_machine_project_shares_agent_id FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: machine_project_shares fk_machine_project_shares_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_project_shares
    ADD CONSTRAINT fk_machine_project_shares_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: machine_storages fk_machine_storages_machine_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.machine_storages
    ADD CONSTRAINT fk_machine_storages_machine_id FOREIGN KEY (machine_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: merge_runs fk_merge_runs_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merge_runs
    ADD CONSTRAINT fk_merge_runs_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: merge_runs fk_merge_runs_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merge_runs
    ADD CONSTRAINT fk_merge_runs_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: message_service_data fk_message_service_data_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_service_data
    ADD CONSTRAINT fk_message_service_data_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: message_service_data fk_message_service_data_message_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_service_data
    ADD CONSTRAINT fk_message_service_data_message_id FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: messages fk_messages_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT fk_messages_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: project_invitations fk_project_invitations_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_invitations
    ADD CONSTRAINT fk_project_invitations_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_machines fk_project_machines_agent_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_machines
    ADD CONSTRAINT fk_project_machines_agent_id FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: project_machines fk_project_machines_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_machines
    ADD CONSTRAINT fk_project_machines_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_machines fk_project_machines_storage_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_machines
    ADD CONSTRAINT fk_project_machines_storage_id FOREIGN KEY (storage_id) REFERENCES public.machine_storages(id) ON DELETE SET NULL;


--
-- Name: project_member_role_audit fk_project_member_role_audit_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_member_role_audit
    ADD CONSTRAINT fk_project_member_role_audit_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members fk_project_members_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT fk_project_members_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_release_events fk_project_release_events_release_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_release_events
    ADD CONSTRAINT fk_project_release_events_release_id FOREIGN KEY (release_id) REFERENCES public.project_releases(id) ON DELETE CASCADE;


--
-- Name: project_release_steps fk_project_release_steps_release_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_release_steps
    ADD CONSTRAINT fk_project_release_steps_release_id FOREIGN KEY (release_id) REFERENCES public.project_releases(id) ON DELETE CASCADE;


--
-- Name: project_releases fk_project_releases_previous_release_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_releases
    ADD CONSTRAINT fk_project_releases_previous_release_id FOREIGN KEY (previous_release_id) REFERENCES public.project_releases(id);


--
-- Name: project_releases fk_project_releases_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_releases
    ADD CONSTRAINT fk_project_releases_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_types fk_project_types_parent_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_types
    ADD CONSTRAINT fk_project_types_parent_id FOREIGN KEY (parent_id) REFERENCES public.project_types(id) ON DELETE RESTRICT;


--
-- Name: projects fk_projects_project_type_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT fk_projects_project_type_id FOREIGN KEY (project_type_id) REFERENCES public.project_types(id);


--
-- Name: public_client_access fk_public_client_access_application_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_access
    ADD CONSTRAINT fk_public_client_access_application_id FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: public_client_access fk_public_client_access_family_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_access
    ADD CONSTRAINT fk_public_client_access_family_id FOREIGN KEY (family_id) REFERENCES public.public_client_families(id) ON DELETE CASCADE;


--
-- Name: public_client_codes fk_public_client_codes_application_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_codes
    ADD CONSTRAINT fk_public_client_codes_application_id FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: public_client_families fk_public_client_families_application_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_families
    ADD CONSTRAINT fk_public_client_families_application_id FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: public_client_redirects fk_public_client_redirects_application_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_redirects
    ADD CONSTRAINT fk_public_client_redirects_application_id FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: public_client_refresh fk_public_client_refresh_family_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_client_refresh
    ADD CONSTRAINT fk_public_client_refresh_family_id FOREIGN KEY (family_id) REFERENCES public.public_client_families(id) ON DELETE CASCADE;


--
-- Name: qa_attachments fk_qa_attachments_result_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_attachments
    ADD CONSTRAINT fk_qa_attachments_result_id FOREIGN KEY (result_id) REFERENCES public.qa_criterion_results(id) ON DELETE CASCADE;


--
-- Name: qa_audit fk_qa_audit_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_audit
    ADD CONSTRAINT fk_qa_audit_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: qa_audit fk_qa_audit_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_audit
    ADD CONSTRAINT fk_qa_audit_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: qa_criterion_results fk_qa_criterion_results_criterion_id_criterion_version; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_criterion_results
    ADD CONSTRAINT fk_qa_criterion_results_criterion_id_criterion_version FOREIGN KEY (criterion_id, criterion_version) REFERENCES public.acceptance_criterion_versions(criterion_id, version);


--
-- Name: qa_criterion_results fk_qa_criterion_results_session_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_criterion_results
    ADD CONSTRAINT fk_qa_criterion_results_session_id FOREIGN KEY (session_id) REFERENCES public.qa_sessions(id) ON DELETE CASCADE;


--
-- Name: qa_issues fk_qa_issues_result_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_issues
    ADD CONSTRAINT fk_qa_issues_result_id FOREIGN KEY (result_id) REFERENCES public.qa_criterion_results(id) ON DELETE CASCADE;


--
-- Name: qa_preparation_runs fk_qa_preparation_runs_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_preparation_runs
    ADD CONSTRAINT fk_qa_preparation_runs_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: qa_preparation_runs fk_qa_preparation_runs_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_preparation_runs
    ADD CONSTRAINT fk_qa_preparation_runs_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: qa_sessions fk_qa_sessions_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_sessions
    ADD CONSTRAINT fk_qa_sessions_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: qa_sessions fk_qa_sessions_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_sessions
    ADD CONSTRAINT fk_qa_sessions_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: qa_stage_runs fk_qa_stage_runs_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_stage_runs
    ADD CONSTRAINT fk_qa_stage_runs_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: qa_stage_runs fk_qa_stage_runs_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_stage_runs
    ADD CONSTRAINT fk_qa_stage_runs_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: release_notifications fk_release_notifications_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_notifications
    ADD CONSTRAINT fk_release_notifications_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: release_notifications fk_release_notifications_release_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.release_notifications
    ADD CONSTRAINT fk_release_notifications_release_id FOREIGN KEY (release_id) REFERENCES public.project_releases(id) ON DELETE CASCADE;


--
-- Name: speakers fk_speakers_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.speakers
    ADD CONSTRAINT fk_speakers_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: storage_acceptances fk_storage_acceptances_share_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_acceptances
    ADD CONSTRAINT fk_storage_acceptances_share_id FOREIGN KEY (share_id) REFERENCES public.storage_shares(id) ON DELETE CASCADE;


--
-- Name: storage_entries fk_storage_entries_space_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_entries
    ADD CONSTRAINT fk_storage_entries_space_id FOREIGN KEY (space_id) REFERENCES public.storage_spaces(id) ON DELETE CASCADE;


--
-- Name: storage_shares fk_storage_shares_space_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_shares
    ADD CONSTRAINT fk_storage_shares_space_id FOREIGN KEY (space_id) REFERENCES public.storage_spaces(id) ON DELETE CASCADE;


--
-- Name: storage_space_refs fk_storage_space_refs_space_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_space_refs
    ADD CONSTRAINT fk_storage_space_refs_space_id FOREIGN KEY (space_id) REFERENCES public.storage_spaces(id) ON DELETE CASCADE;


--
-- Name: task_attachments fk_task_attachments_rework_cycle_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT fk_task_attachments_rework_cycle_id FOREIGN KEY (rework_cycle_id) REFERENCES public.task_rework_cycles(id) ON DELETE CASCADE;


--
-- Name: task_attachments fk_task_attachments_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT fk_task_attachments_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_creation_audit fk_task_creation_audit_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_creation_audit
    ADD CONSTRAINT fk_task_creation_audit_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: task_creation_audit fk_task_creation_audit_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_creation_audit
    ADD CONSTRAINT fk_task_creation_audit_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_creation_requests fk_task_creation_requests_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_creation_requests
    ADD CONSTRAINT fk_task_creation_requests_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_designs fk_task_designs_conversation_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_designs
    ADD CONSTRAINT fk_task_designs_conversation_id FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: task_designs fk_task_designs_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_designs
    ADD CONSTRAINT fk_task_designs_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_improvements fk_task_improvements_created_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_improvements
    ADD CONSTRAINT fk_task_improvements_created_task_id FOREIGN KEY (created_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: task_improvements fk_task_improvements_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_improvements
    ADD CONSTRAINT fk_task_improvements_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: task_improvements fk_task_improvements_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_improvements
    ADD CONSTRAINT fk_task_improvements_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_launch_results fk_task_launch_results_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_launch_results
    ADD CONSTRAINT fk_task_launch_results_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: task_launch_results fk_task_launch_results_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_launch_results
    ADD CONSTRAINT fk_task_launch_results_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_preparation_events fk_task_preparation_events_attempt_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_events
    ADD CONSTRAINT fk_task_preparation_events_attempt_id FOREIGN KEY (attempt_id) REFERENCES public.task_preparation_runs(id) ON DELETE CASCADE;


--
-- Name: task_preparation_notification_dismissals fk_task_preparation_notification_dismissals_question_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_notification_dismissals
    ADD CONSTRAINT fk_task_preparation_notification_dismissals_question_id FOREIGN KEY (question_id) REFERENCES public.task_preparation_questions(question_id) ON DELETE CASCADE;


--
-- Name: task_preparation_questions fk_task_preparation_questions_attempt_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_questions
    ADD CONSTRAINT fk_task_preparation_questions_attempt_id FOREIGN KEY (attempt_id) REFERENCES public.task_preparation_runs(id) ON DELETE CASCADE;


--
-- Name: task_preparation_runs fk_task_preparation_runs_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_runs
    ADD CONSTRAINT fk_task_preparation_runs_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: task_preparation_runs fk_task_preparation_runs_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_runs
    ADD CONSTRAINT fk_task_preparation_runs_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_preparation_steps fk_task_preparation_steps_attempt_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_preparation_steps
    ADD CONSTRAINT fk_task_preparation_steps_attempt_id FOREIGN KEY (attempt_id) REFERENCES public.task_preparation_runs(id) ON DELETE CASCADE;


--
-- Name: task_repositories fk_task_repositories_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_repositories
    ADD CONSTRAINT fk_task_repositories_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: task_repositories fk_task_repositories_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_repositories
    ADD CONSTRAINT fk_task_repositories_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_rework_attachments fk_task_rework_attachments_cycle_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_rework_attachments
    ADD CONSTRAINT fk_task_rework_attachments_cycle_id FOREIGN KEY (cycle_id) REFERENCES public.task_rework_cycles(id) ON DELETE CASCADE;


--
-- Name: task_rework_cycles fk_task_rework_cycles_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_rework_cycles
    ADD CONSTRAINT fk_task_rework_cycles_task_id FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: tasks fk_tasks_column_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_column_id FOREIGN KEY (column_id) REFERENCES public.kanban_columns(id) ON DELETE CASCADE;


--
-- Name: tasks fk_tasks_parent_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_parent_id FOREIGN KEY (parent_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: tasks fk_tasks_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: tasks fk_tasks_source_task_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_tasks_source_task_id FOREIGN KEY (source_task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: team_tenant_invitations fk_team_tenant_invitations_invited_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_invitations
    ADD CONSTRAINT fk_team_tenant_invitations_invited_by FOREIGN KEY (invited_by) REFERENCES public.users(name) ON DELETE CASCADE;


--
-- Name: team_tenant_invitations fk_team_tenant_invitations_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_invitations
    ADD CONSTRAINT fk_team_tenant_invitations_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.team_tenants(id) ON DELETE CASCADE;


--
-- Name: team_tenant_memberships fk_team_tenant_memberships_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_memberships
    ADD CONSTRAINT fk_team_tenant_memberships_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.team_tenants(id) ON DELETE CASCADE;


--
-- Name: team_tenant_memberships fk_team_tenant_memberships_user_name; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_memberships
    ADD CONSTRAINT fk_team_tenant_memberships_user_name FOREIGN KEY (user_name) REFERENCES public.users(name) ON DELETE CASCADE;


--
-- Name: team_tenant_tariffs fk_team_tenant_tariffs_tariff_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_tariffs
    ADD CONSTRAINT fk_team_tenant_tariffs_tariff_id FOREIGN KEY (tariff_id) REFERENCES public.tariff_plans(id);


--
-- Name: team_tenant_tariffs fk_team_tenant_tariffs_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenant_tariffs
    ADD CONSTRAINT fk_team_tenant_tariffs_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.team_tenants(id) ON DELETE CASCADE;


--
-- Name: team_tenants fk_team_tenants_owner_user_name; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_tenants
    ADD CONSTRAINT fk_team_tenants_owner_user_name FOREIGN KEY (owner_user_name) REFERENCES public.users(name) ON DELETE CASCADE;


--
-- Name: tenant_memberships fk_tenant_memberships_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT fk_tenant_memberships_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_memberships fk_tenant_memberships_user_name; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_memberships
    ADD CONSTRAINT fk_tenant_memberships_user_name FOREIGN KEY (user_name) REFERENCES public.users(name) ON DELETE CASCADE;


--
-- Name: tenant_tariffs fk_tenant_tariffs_tariff_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_tariffs
    ADD CONSTRAINT fk_tenant_tariffs_tariff_id FOREIGN KEY (tariff_id) REFERENCES public.tariff_plans(id);


--
-- Name: tenant_tariffs fk_tenant_tariffs_tenant_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_tariffs
    ADD CONSTRAINT fk_tenant_tariffs_tenant_id FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenants fk_tenants_owner_user_name; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT fk_tenants_owner_user_name FOREIGN KEY (owner_user_name) REFERENCES public.users(name) ON DELETE CASCADE;


--
-- Name: user_llm_access fk_user_llm_access_user_name; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_llm_access
    ADD CONSTRAINT fk_user_llm_access_user_name FOREIGN KEY (user_name) REFERENCES public.users(name) ON DELETE CASCADE;


--
-- Name: user_project_machine_defaults fk_user_project_machine_defaults_agent_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_project_machine_defaults
    ADD CONSTRAINT fk_user_project_machine_defaults_agent_id FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: user_project_machine_defaults fk_user_project_machine_defaults_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_project_machine_defaults
    ADD CONSTRAINT fk_user_project_machine_defaults_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: user_project_release_machines fk_user_project_release_machines_agent_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_project_release_machines
    ADD CONSTRAINT fk_user_project_release_machines_agent_id FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;


--
-- Name: user_project_release_machines fk_user_project_release_machines_project_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_project_release_machines
    ADD CONSTRAINT fk_user_project_release_machines_project_id FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



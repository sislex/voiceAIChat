// Домен «qa»: таблицы qa_sessions, qa_stage_runs, qa_preparation_runs, qa_criterion_results, qa_issues, qa_attachments, qa_audit, acceptance_criteria, acceptance_criterion_versions.
// Файл получен разрезанием бывшего VoiceChatDb (apps/server/src/db/database.ts) по владению таблицами;
// карта владения — ./ownership.ts, правила — docs/plans/db-repositories.md.
import { BaseRepo } from './base.js'

// Manual and automated QA workflows moved to Kanban; the domain keeps its tables (see ownership.ts).
export class QaRepo extends BaseRepo {}

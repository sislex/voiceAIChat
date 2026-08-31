// Очередь типов проекта: отдельная страница `#/users/project-types`.

import type { ProjectTypeNode } from '@shared/projectTypes'
import { ProjectTypesAdmin } from '../ProjectTypesAdmin'

export interface ProjectTypesPageProps {
  pendingProjectTypes?: ProjectTypeNode[]
  onReviewProjectType: (input: { id: string; decision: 'approve' | 'reject'; note?: string }) => void | Promise<void>
}

export function ProjectTypesPage({ pendingProjectTypes = [], onReviewProjectType }: ProjectTypesPageProps): JSX.Element {
  return (
    <section className="uadmin-sec" data-testid="project-types-queue-section">
            <ProjectTypesAdmin pending={pendingProjectTypes} onReview={onReviewProjectType} />
    </section>
  )
}

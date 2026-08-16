import { useEffect, type ReactNode } from 'react'
import type { ProjectsRoute } from './routes/projectsRoute'
import { projectRouteId } from './routes/projectsRoute'
import { useProjectsActions, useProjectsStore } from './store/ProjectsProvider'

export interface ProjectsAppProps {
  route: ProjectsRoute
  render(input: ReturnType<typeof useProjectsStore> & { route: ProjectsRoute }): ReactNode
}

export function ProjectsApp({ route, render }: ProjectsAppProps): JSX.Element {
  const state = useProjectsStore()
  const actions = useProjectsActions()
  const projectId = projectRouteId(route)
  useEffect(() => { actions.setRoute(route) }, [actions, route])
  useEffect(() => {
    if (!state.projectsLoaded) void actions.loadProjects()
  }, [actions, state.projectsLoaded])
  useEffect(() => {
    if (projectId && projectId !== state.activeProjectId) void actions.openProject(projectId)
    if (!projectId && state.activeProjectId) actions.closeProject()
  }, [actions, projectId, state.activeProjectId])
  return <div className="projects-app">{render({ ...state, route })}</div>
}

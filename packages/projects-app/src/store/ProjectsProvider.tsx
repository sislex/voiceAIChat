import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { ProjectsNavigationModel } from '../contracts'
import type { ProjectsState, ProjectsStore } from './projectsStore'

const ProjectsContext = createContext<ProjectsStore | null>(null)

export function ProjectsProvider({ store, children }: { store: ProjectsStore; children: ReactNode }): JSX.Element {
  return <ProjectsContext.Provider value={store}>{children}</ProjectsContext.Provider>
}

export function useProjectsStore<T = ProjectsState>(selector: (state: ProjectsState) => T = ((state) => state as T)): T {
  const store = useContext(ProjectsContext)
  if (!store) throw new Error('useProjectsStore must be used inside ProjectsProvider')
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  return selector(state)
}

export function useProjectsActions(): ProjectsStore['actions'] {
  const store = useContext(ProjectsContext)
  if (!store) throw new Error('useProjectsActions must be used inside ProjectsProvider')
  return store.actions
}

export function useProjectsNavigation(input: { createProject(): void; navigate(path: string): void }): ProjectsNavigationModel {
  const store = useContext(ProjectsContext)
  if (!store) throw new Error('useProjectsNavigation must be used inside ProjectsProvider')
  useSyncExternalStore(store.subscribe, store.getState, store.getState)
  return store.navigation(input)
}

export interface MachineRequiredGuard {
  require(available: boolean, action: () => void): boolean
  cancel(): void
  resume(): boolean
  pending(): boolean
}

export function createMachineRequiredGuard(onBlocked: () => void): MachineRequiredGuard {
  let continuation: (() => void) | null = null
  return {
    require(available, action) {
      if (available) { action(); return true }
      continuation = action
      onBlocked()
      return false
    },
    cancel() { continuation = null },
    resume() {
      const action = continuation
      continuation = null
      if (!action) return false
      action()
      return true
    },
    pending: () => continuation !== null
  }
}

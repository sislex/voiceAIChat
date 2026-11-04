export const STAND_BASE_PORT_OFFSETS = Object.freeze({
  core: 787,
  make: 788,
  kanban: 789,
  tts: 791,
  stt: 792,
  browser: 793,
  automation: 794,
  reader: 795,
  imageStudio: 796,
  playwrightReader: 797,
  identity: 798,
  billing: 800,
  analytics: 801,
  makeUi: 802
})

export const STAND_PROXY_PORT_OFFSETS = Object.freeze([810, 811, 812, 813, 814])
export const STAND_DERIVED_PORT_OFFSETS = Object.freeze([
  ...new Set([...Object.values(STAND_BASE_PORT_OFFSETS), ...STAND_PROXY_PORT_OFFSETS])
])

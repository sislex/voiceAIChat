export type PlaywrightReaderRoute={conversationId:string|null}
export function parsePlaywrightReaderRoute(hash:string):PlaywrightReaderRoute|null{const match=/^#?\/playwright-reader(?:\/([^/?#]+))?\/?$/.exec(hash);if(!match)return null;try{return{conversationId:match[1]?decodeURIComponent(match[1]):null}}catch{return null}}
export const buildPlaywrightReaderRoute=(route:PlaywrightReaderRoute):string=>`#/playwright-reader${route.conversationId?'/'+encodeURIComponent(route.conversationId):''}`

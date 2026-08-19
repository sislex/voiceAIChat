export type WebReaderRoute={conversationId:string|null}
const decode=(value:string):string|null=>{try{return decodeURIComponent(value)}catch{return null}}
export function parseWebReaderRoute(hash:string):WebReaderRoute|null{const value=hash.replace(/^#/,'');const match=/^\/web-reader(?:\/([^/?#]+))?\/?$/.exec(value);if(!match)return null;const id=match[1]?decode(match[1]):null;return match[1]&&!id?null:{conversationId:id}}
export function parseLegacyWebRecorderRoute(hash:string):WebReaderRoute|null{const match=/^#?\/web-recorder\/([^/?#]+)\/?$/.exec(hash);if(!match)return null;const id=decode(match[1]);return id?{conversationId:id}:null}
export const buildWebReaderRoute=(route:WebReaderRoute):string=>`#/web-reader${route.conversationId?'/'+encodeURIComponent(route.conversationId):''}`

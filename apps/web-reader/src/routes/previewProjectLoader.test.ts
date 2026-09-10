import { describe, expect, it, vi } from 'vitest'
import { loadPreviewProject } from './previewProjectLoader.js'
import { PreviewCookieStore } from './previewCookies.js'
const url=new URL('https://app.internal/#/machines')
describe('переходы внутри текущего проекта',()=>{
  it('302 после POST переносит cookie и hash, снимает тело и Content-Type',async()=>{
    const request=vi.fn().mockResolvedValueOnce({status:302,headers:{Location:'/next','Set-Cookie':'sid=one; Secure; Path=/'},bodyBase64:''}).mockResolvedValueOnce({status:200,headers:{},bodyBase64:'b2s='})
    const response=await loadPreviewProject(request,new PreviewCookieStore(),'user',url,'POST','body',{'content-type':'text/plain'})
    expect(response.finalUrl.toString()).toBe('https://app.internal/next#/machines');expect(request.mock.calls[1]![0]).toEqual({method:'GET',path:'/next',headers:{cookie:'sid=one'}})
  })
  it('307 сохраняет бинарное тело и метод',async()=>{const request=vi.fn().mockResolvedValueOnce({status:307,headers:{location:'/next'},bodyBase64:''}).mockResolvedValueOnce({status:200,headers:{},bodyBase64:''});await loadPreviewProject(request,new PreviewCookieStore(),'user',url,'PATCH',Buffer.from([0,255]),{'content-type':'application/octet-stream'});expect(request.mock.calls[1]![0]).toMatchObject({method:'PATCH',bodyBase64:'AP8='})})
  it('не идёт за redirect к служебному адресу или чужому хосту',async()=>{for(const location of ['/api/preview?url=x','https://other.internal/']){const request=vi.fn().mockResolvedValue({status:302,headers:{location},bodyBase64:''});await expect(loadPreviewProject(request,new PreviewCookieStore(),'user',url,'GET',undefined,{})).rejects.toMatchObject({status:403});expect(request).toHaveBeenCalledTimes(1)}})
  it('останавливает цикл после пяти redirect',async()=>{const request=vi.fn().mockResolvedValue({status:302,headers:{location:'/loop'},bodyBase64:''});await expect(loadPreviewProject(request,new PreviewCookieStore(),'user',url,'GET',undefined,{})).rejects.toMatchObject({status:502});expect(request).toHaveBeenCalledTimes(6)})
  it('не оставляет бесконечное ожидание зависшего ядра',async()=>{await expect(loadPreviewProject(()=>new Promise(()=>{}),new PreviewCookieStore(),'user',url,'GET',undefined,{},20)).rejects.toMatchObject({status:504})})
})

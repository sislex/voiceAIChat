import { AUTOMATION_RUNNER,type AutomationEvent,type AutomationJob,type AutomationJobRequest } from '@voicechat/shared'

export class AutomationClientError extends Error {
  constructor(readonly status:number,readonly code:string){super(`Automation Runner: ${status} ${code}`)}
}
export class AutomationClient {
  constructor(private readonly baseUrl:string,private readonly token:string,private readonly fetchImpl:typeof fetch=fetch){}
  private async request<T>(path:string,init:RequestInit={}):Promise<T>{
    const response=await this.fetchImpl(new URL(path,this.baseUrl),{
      ...init,headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json',...init.headers}
    })
    if(!response.ok){
      let code=response.statusText
      try{code=String((await response.json() as {error?:string}).error??code)}catch{}
      throw new AutomationClientError(response.status,code)
    }
    return response.json() as Promise<T>
  }
  create(request:AutomationJobRequest):Promise<AutomationJob>{
    return this.request(AUTOMATION_RUNNER.jobs,{method:'POST',body:JSON.stringify(request)})
  }
  get(jobId:string):Promise<AutomationJob>{return this.request(`${AUTOMATION_RUNNER.jobs}/${encodeURIComponent(jobId)}`)}
  cancel(jobId:string):Promise<{stopped:boolean}>{return this.request(`${AUTOMATION_RUNNER.jobs}/${encodeURIComponent(jobId)}`,{method:'DELETE'})}
  resume(jobId:string,pauseId:string,answer:unknown):Promise<{resumed:boolean}>{
    return this.request(`${AUTOMATION_RUNNER.jobs}/${encodeURIComponent(jobId)}/resume`,{method:'POST',body:JSON.stringify({pauseId,answer})})
  }
  events(jobId:string,after:number):Promise<{events:AutomationEvent[]}>{
    return this.request(`${AUTOMATION_RUNNER.jobs}/${encodeURIComponent(jobId)}/events?after=${after}`)
  }
}

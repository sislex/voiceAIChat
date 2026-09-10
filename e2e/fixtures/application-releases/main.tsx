import React from 'react'
import { createRoot } from 'react-dom/client'
import { APPLICATION_CATALOG, type ApplicationReleaseManifest, type ApplicationReleaseOverview } from '@voicechat/shared'
import { ApplicationReleaseCenter } from '../../../packages/ui/src/components/releases/ApplicationReleaseCenter'
import { createFakeApi } from '@voicechat/ui-foundation/test/fakeApi'
import '@voicechat/ui-kit/styles.css'
import '../../../packages/ui/src/styles/global.css'
import '../../../packages/ui/src/styles/app.css'
const api=createFakeApi()
const manifest=(id='make',version='1.1.0'):ApplicationReleaseManifest=>({schemaVersion:1,applicationId:id,version,apiVersion:'1.0.0',commit:'a'.repeat(40),dataVersion:'1.0.0',capabilities:[],requires:id==='make'?[{applicationId:'core',minVersion:'1.0.0',maxVersionExclusive:'2.0.0',minApiVersion:'1.0.0',maxApiVersionExclusive:'2.0.0'}]:[],artifacts:[{service:id==='core'?'voicechat':id,kind:'oci',reference:`registry.test/${id}@sha256:${'b'.repeat(64)}`}]})
const make=manifest()
const overview:ApplicationReleaseOverview={environment:{schemaVersion:1,revision:1,applications:[{manifest:manifest('core','1.0.0'),healthy:true,installedAt:1}]},activeDeploymentId:null,releases:[{id:'make-release',projectId:'fixture',input:{applicationId:'make',version:'1.1.0',image:'registry.test/make',baseBranch:'main',requires:make.requires},branch:'release/make/1.1.0',status:'ready',manifest:make,createdAt:1,finishedAt:2,triggeredBy:'fixture',log:'Проверки пройдены'}],deployments:[]}
api['releases:applicationCatalog']=async()=>[...APPLICATION_CATALOG]
api['releases:applicationOverview']=async({environment})=>environment==='staging'?structuredClone(overview):{...structuredClone(overview),environment:{...overview.environment,applications:[{manifest:manifest('core','2.0.0'),healthy:true,installedAt:1}]}}
api['releases:applicationDeploy']=async({input,environment})=>{const record={id:'deployment',projectId:'fixture',environment,requestId:input.requestId,status:'released' as const,releases:[make],previous:structuredClone(overview.environment),result:null,rollbackOf:null,createdAt:1,finishedAt:2,triggeredBy:'fixture',log:'Digest и container ID проверены'};overview.deployments.unshift(record);overview.environment.applications.push({manifest:make,healthy:true,installedAt:2});overview.environment.revision++;return record}
document.body.style.overflow='auto'
createRoot(document.getElementById('root')!).render(<main style={{padding:'24px',maxWidth:'1100px',margin:'auto'}}><h1>Релизы приложений</h1><ApplicationReleaseCenter projectId="fixture" baseBranch="main" owner api={api}/></main>)

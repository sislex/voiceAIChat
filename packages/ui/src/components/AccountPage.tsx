import {AccountPage as IdentityAccountPage, type AccountPageProps} from '@sislexa/identity/account/AccountPage'
import {readResources} from '../clients/readResources'
import {isObsoleteRead} from '../lib/readCache'
import {uiPerformance} from '../lib/uiPerformance'
export {periodRange,toProfileUsage,toProfileUser,toProfileEvents} from '@sislexa/identity/account/AccountPage'
export type {AccountPageProps} from '@sislexa/identity/account/AccountPage'
export function AccountPage(props: AccountPageProps): JSX.Element {
 return <IdentityAccountPage {...props} reads={readResources(props.api)} isObsoleteRead={isObsoleteRead} onReady={()=>{const p=uiPerformance();p.mark('route','account_ready');p.finish('route','account')}}/>
}

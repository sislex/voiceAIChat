import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {WebReaderEngineSelect} from './WebReaderEngineSelect'
afterEach(cleanup)
describe('выбор движка Web Reader',()=>{
 it('ждёт сохранения и не меняет выбранный движок при отказе',async()=>{let reject!:(reason:Error)=>void;const onChange=vi.fn(()=>new Promise<void>((_resolve,no)=>{reject=no}));render(<WebReaderEngineSelect value="proxy" onChange={onChange}/>);const select=screen.getByLabelText('Движок Web Reader') as HTMLSelectElement;fireEvent.change(select,{target:{value:'chromium'}});expect(onChange).toHaveBeenCalledWith('chromium');expect(select.disabled).toBe(true);reject(new Error('Нет соединения'));await screen.findByRole('alert');expect(select.value).toBe('proxy');expect(select.disabled).toBe(false)})
 it('успешный ответ хоста обновляет выбранную поверхность',async()=>{const onChange=vi.fn(async()=>{});const rendered=render(<WebReaderEngineSelect value="proxy" onChange={onChange}/>);fireEvent.change(screen.getByLabelText('Движок Web Reader'),{target:{value:'chromium'}});await waitFor(()=>expect(screen.queryByRole('status')).toBeNull());rendered.rerender(<WebReaderEngineSelect value="chromium" onChange={onChange}/>);expect((screen.getByLabelText('Движок Web Reader') as HTMLSelectElement).value).toBe('chromium')})
})

import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { MakeMockTable, mockTableFor } from './MakeMockTable'

const FILE = JSON.stringify({ $collection: true, $body: [{ id: 1, name: 'Анна' }, { id: 2, name: 'Борис' }] }, null, 2)

describe('MakeMockTable', () => {
  it('mockTableFor: только mock/*.json с массивом объектов', () => {
    expect(mockTableFor('mock/api/users.json', FILE)).not.toBeNull()
    expect(mockTableFor('src/x.json', FILE)).toBeNull()
    expect(mockTableFor('mock/api/one.json', '{"$body": {"a": 1}}')).toBeNull()
    expect(mockTableFor('mock/api/bad.json', '{')).toBeNull()
  })
  it('правка ячейки, добавление строки и колонки, удаление строки — всё уходит в onChange как JSON', async () => {
    const onChange = vi.fn()
    render(<MakeMockTable path="mock/api/users.json" value={FILE} onChange={onChange} />)
    const name = screen.getByLabelText('name строки 2') as HTMLInputElement
    await userEvent.type(name, '!')
    expect(JSON.parse(onChange.mock.lastCall![0] as string).$body[1]).toEqual({ id: 2, name: 'Борис!' })
    await userEvent.click(screen.getByRole('button', { name: '+ Строка' }))
    expect(JSON.parse(onChange.mock.lastCall![0] as string).$body[2]).toEqual({ id: 3 })
    await userEvent.type(screen.getByLabelText('Имя новой колонки'), 'role{enter}')
    const json = JSON.parse(onChange.mock.lastCall![0] as string) as { $body: unknown[]; $collection: boolean }
    expect(json.$collection).toBe(true)
    expect(Object.keys(json.$body[0] as object)).toEqual(['id', 'name'])
    await userEvent.click(screen.getByRole('button', { name: 'Удалить строку 1' }))
    expect(JSON.parse(onChange.mock.lastCall![0] as string).$body).toEqual([{ id: 2, name: 'Борис' }])
  })
})

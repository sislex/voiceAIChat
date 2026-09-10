import { expect, it } from 'vitest'
import { recordPointerClick, recordScroll } from './scenarioRecorder'
const element = {
  selector: '#button',
  stability: 'id' as const,
  tag: 'button',
  text: 'Кнопка',
  rect: { x: 0, y: 0, width: 100, height: 20 }
}
it('два физических click записываются одним двойным с устойчивым id', () => {
  const first = recordPointerClick([], element, 'left', ['shift'], 1)
  const second = recordPointerClick(first, element, 'left', ['shift'], 2)
  expect(second).toHaveLength(1)
  expect(second[0]).toMatchObject({ id: first[0].id, action: { kind: 'click', dblclick: true, modifiers: ['shift'] } })
})
it('смена цели между кликами не превращает разные шаги в двойной', () => {
  const first = recordPointerClick([], element, 'left', [], 1)
  const second = recordPointerClick(first, { ...element, selector: '#other' }, 'left', [], 2)
  expect(second).toHaveLength(2)
  expect(second[1].action).not.toHaveProperty('dblclick')
})
it('frame и модификаторы входят в идентичность пары кликов', () => {
  const first = recordPointerClick([], element, 'left', ['shift'], 1)
  expect(recordPointerClick(first, element, 'left', [], 2)).toHaveLength(2)
  expect(recordPointerClick(first, { ...element, frame: ['#child'] }, 'left', ['shift'], 2)).toHaveLength(2)
})

it('горизонтальная прокрутка сохраняется и сливается независимо от вертикали', () => {
  const first = recordScroll([], 0, 200)
  expect(first[0].action).toEqual({ kind: 'scroll', dy: 0, dx: 200 })
  const next = recordScroll(first, 40, -30)
  expect(next[0].action).toEqual({ kind: 'scroll', dy: 40, dx: 170 })
  expect(recordScroll(next, -40, -170)).toEqual([])
})

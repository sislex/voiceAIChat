// Витрина строительных блоков карточки: строка свойства, заголовок секции и
// список чипов. Все три раньше собирались руками в каждом месте — здесь видно,
// что они одинаковые.
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { ChipList, PropertyRow, SectionHeader } from '@voicechat/ui-kit'

const meta: Meta = {
  title: 'UI/Card primitives',
  parameters: {
    docs: {
      description: {
        component:
          'PropertyRow в режиме `label` связывает подпись с контролом — списком определений ' +
          '(dt/dd) этого не добиться, скринридер не считает dt подписью формы. ChipList сам ' +
          'отсекает пустые и повторные значения: раньше эту проверку повторял каждый список, ' +
          'и один из двух её терял.'
      }
    }
  }
}
export default meta
type Story = StoryObj

export const Properties: Story = {
  name: 'Строки свойств',
  render: function PropertiesStory() {
    const [priority, setPriority] = useState('high')
    return (
      <div style={{ width: 300, padding: 16, background: 'var(--surface-sunken)', borderRadius: 12 }}>
        <PropertyRow as="label" label="Статус">
          <select className="sel"><option>В разработке</option></select>
        </PropertyRow>
        <PropertyRow as="label" label="Приоритет">
          <select className="sel" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="high">Высокий</option>
            <option value="medium">Средний</option>
          </select>
        </PropertyRow>
        <PropertyRow label="Автор"><strong>Михаил Сергеев</strong></PropertyRow>
        <PropertyRow as="label" label="Срок">
          <input className="login-input" type="date" defaultValue="2026-09-04" />
        </PropertyRow>
        <PropertyRow label="Метки" wide>
          <ChipList items={['frontend', 'search']} itemLabel="метку" placeholder="+ метка" chipClassName="jcard-label" onAdd={() => {}} onRemove={() => {}} />
        </PropertyRow>
      </div>
    )
  }
}

export const Sections: Story = {
  name: 'Заголовки секций',
  render: () => (
    <div style={{ display: 'grid', gap: 24, maxWidth: 560 }}>
      <SectionHeader title="Описание" action={<button className="task-section-action">Редактировать</button>} />
      <SectionHeader title="Подзадачи" meta="2 из 3" />
      <SectionHeader title="Активность" action={<button className="task-section-action">Вся временная шкала</button>} />
      <SectionHeader title="Очень длинное название секции, которое не помещается в одну строку" meta="9 из 12" action={<button className="task-section-action">Действие</button>} />
    </div>
  )
}

export const Chips: Story = {
  name: 'Список чипов',
  render: function ChipsStory() {
    const [items, setItems] = useState(['payments', 'critical'])
    return (
      <div style={{ maxWidth: 320 }}>
        <ChipList
          items={items}
          itemLabel="метку"
          placeholder="+ метка"
          chipClassName="jcard-label"
          onAdd={(value) => setItems((current) => [...current, value])}
          onRemove={(value) => setItems((current) => current.filter((item) => item !== value))}
        />
      </div>
    )
  }
}
